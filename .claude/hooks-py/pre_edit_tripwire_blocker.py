#!/usr/bin/env python3
"""Pre-edit tripwire blocker hook.

Bloquea Edit/Write/MultiEdit cuando el diff contiene un tripwire pattern
listado en CLAUDE.md §"Mandatory Pre-Action Triggers", a menos que el
último mensaje del assistant en el transcript contenga una línea
canon-check válida.

PATTERNS BLOCKED:
  1. time-bomb-comment       — // temporary | puente | bridge | phase-bridge | hack
  2. todo-phase-marker       — // TODO §X.Y (defers to undefined future phase)
  3. canon-exception-untagged — // canon-exception: <not in allowed scenarios>
  4. cross-bounded-context-import — from "@core/<a>/" inside packages/core/<b>/
     where a != b and a not in {domain, embeddings, application}

BYPASS PRIORITY (any of these silences a block):
  1. Línea canon-check válida en el último assistant message del transcript
     (regex: ^canon-check:\\s*\\S+\\.md\\s+§\\S+\\s+—\\s+.+)
  2. Token .claude/.allowed/sensitive-edit (15 min TTL). Created by
     omnipost-allow sensitive-edit. Same token gates sensitive-path edits;
     reused here to keep the authorization surface unified.

Block via exit 2 + stderr — Claude Code lo interpreta como veto del tool.

Loguea bloqueos en .claude/hooks.log y .claude/tripwire-blocks.log
(audit trail separado).
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import check_grant_token, make_logger, read_hook_input  # noqa: E402

HOOK_NAME = "pre-edit-tripwire-blocker"
log, block, _allow = make_logger(HOOK_NAME)

TRIPWIRE_BLOCKS_LOG = Path(".claude/tripwire-blocks.log")
HEURISTIC_OVERRIDES_LOG = Path(".claude/heuristic-overrides.log")

# Canon-check signature line that bypasses tripwires.
# Format: canon-check: <canon-file>.md §<rule-id> — <decision> autorizada porque <reason>
# Example: canon-check: feedback/canon-research.md §no-time-bombs — bridge rechazado, ...
CANON_CHECK_RE = re.compile(
    r"^canon-check:\s*\S+\.md\s+§\S.*?\s+[—\-]\s+.+",
    re.MULTILINE,
)

# Allowed canon-exception scenarios from CLAUDE.md §Pragmatic Exceptions.
ALLOWED_EXCEPTION_SCENARIOS = ("migration", "prototype", "hotfix", "spike", "test-fixture", "generated")

# Whitelist for cross-bounded-context imports (transversal infra/shared).
CROSS_CONTEXT_WHITELIST = frozenset({"domain", "embeddings", "application"})

TRIPWIRE_PATTERNS: list[dict] = [
    {
        "id": "time-bomb-comment",
        # Word list derived from grep over ~/.claude/feedback/ + feedback_archive/.
        # Bilingual (EN + ES) workaround/patch signatures that Edward has flagged
        # historically. Excludes overly generic words (TODO, defer, skip, ignore)
        # that would create high false-positive rate in legit domain code.
        "regex": re.compile(
            r"//\s*(?:"
            r"temporary|temporal|provisional|"  # time-axis markers
            r"puente|bridge|phase-bridge|"      # bridging workarounds
            r"hack|kludge|"                     # admitted hacks
            r"workaround|patch|parche|atajo|"   # workaround names (EN+ES)
            r"stub|placeholder|"                # incomplete-impl markers
            r"FIXME|XXX|"                       # dev-stage markers
            r"time.?bomb|"                      # explicit self-naming
            r"silencioso|"                      # ES "silent failure" warning
            r"truco|trampa"                     # ES "trick"/"trap"
            r")\b",
            re.IGNORECASE,
        ),
        "canon_ref": "feedback/canon-research.md §no-time-bombs §no-patches",
        "description": "Time-bomb / patch / workaround comment marker — derived from feedback files history",
    },
    {
        "id": "todo-phase-marker",
        "regex": re.compile(r"//\s*TODO\s+§"),
        "canon_ref": "feedback/canon-research.md §no-time-bombs",
        "description": "TODO §X.Y marker — defers work to undefined future phase",
    },
    {
        "id": "canon-exception-untagged",
        "regex": re.compile(
            r"//\s*canon-exception:\s*(?!"
            + "|".join(ALLOWED_EXCEPTION_SCENARIOS)
            + r")\S",
        ),
        "canon_ref": "CLAUDE.md §Pragmatic-Exceptions",
        "description": "canon-exception marker without allowed scenario (migration/prototype/hotfix/spike/test-fixture/generated)",
    },
    {
        "id": "plan-phase-reference-in-comment",
        # Matches plan/phase/sprint/timeline references inside line comments
        # (`//`) or JSDoc-style block comments (` * ...`). Per CLAUDE.md
        # §Coding-Standards §Comment-Quality-Rules: "No references to sprint
        # numbers, implementation phases, or development timeline — they
        # belong in git history, not source code".
        "regex": re.compile(
            r"^\s*(?://|\*)\s*(?:"
            r"Workstream\s*:|"                       # JSDoc Workstream tag
            r"Phase\s+[A-Z]\d+|"                     # Phase A1, Phase B2
            r"§\d+\.\d+(?:\.[a-z])?|"                # §5.1, §5.1.b, §5.1.b.2
            r"S\d+\.\d+[a-z]?|"                      # S2.1a (sprint refs)
            r"Per\s+§|Resolves\s+§|Closes\s+§|"      # narrative refs to phases
            r"\b(?:Sprint|Phase|Fase)\s+\d+|"        # Sprint 3, Phase 2, Fase 1
            r"Roadmap\s+(?:item|fase|phase|§)"       # Roadmap references
            r")",
            re.MULTILINE,
        ),
        "canon_ref": "CLAUDE.md §Coding-Standards §Comment-Quality-Rules",
        "description": "Plan/phase/sprint/timeline reference in code comment — belongs in git history, not source",
    },
]

# Cross-bounded-context detection is contextual (depends on file_path),
# so it's checked separately, not in TRIPWIRE_PATTERNS.
CROSS_CONTEXT_RE = re.compile(r'from\s+["\']@core/([a-zA-Z0-9_-]+)(?:/|["\'])')
FILE_BOUNDED_CONTEXT_RE = re.compile(r"packages/core/([a-zA-Z0-9_-]+)/src/")


def extract_diff_text(data: dict) -> str:
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    chunks: list[str] = []
    if tool_name == "Edit":
        chunks.append(tool_input.get("new_string", ""))
    elif tool_name == "Write":
        chunks.append(tool_input.get("content", ""))
    elif tool_name == "MultiEdit":
        for edit in tool_input.get("edits", []):
            chunks.append(edit.get("new_string", ""))
    return "\n".join(chunks)


def read_last_assistant_text(transcript_path: str | None) -> str:
    """Read the last `type: assistant` entry from the JSONL transcript and
    extract all `content[].type == "text"` chunks concatenated.
    Returns empty string on any failure (don't bypass on error)."""
    if not transcript_path:
        return ""
    try:
        path = Path(transcript_path)
        if not path.exists():
            return ""
        # Read last ~50 lines (enough to find the last assistant turn).
        with path.open("rb") as f:
            try:
                f.seek(-100_000, 2)  # 100KB tail
            except OSError:
                f.seek(0)
            tail_bytes = f.read()
        lines = tail_bytes.decode("utf-8", errors="ignore").splitlines()
    except OSError as e:
        log(f"WARN: cannot read transcript {transcript_path}: {e}")
        return ""

    last_assistant_text: str = ""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("type") != "assistant":
            continue
        msg = entry.get("message", {})
        content = msg.get("content", "")
        chunks: list[str] = []
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    chunks.append(item.get("text", ""))
        elif isinstance(content, str):
            chunks.append(content)
        if chunks:
            last_assistant_text = "\n".join(chunks)  # overwrite — keep latest
    return last_assistant_text


def find_tripwire_matches(diff_text: str, file_path: str) -> list[dict]:
    matches: list[dict] = []
    for pattern in TRIPWIRE_PATTERNS:
        if pattern["regex"].search(diff_text):
            matches.append(pattern)
    # Cross-context check: only when editing inside packages/core/<b>/src/
    bc_match = FILE_BOUNDED_CONTEXT_RE.search(file_path)
    if bc_match:
        own_ctx = bc_match.group(1)
        for import_match in CROSS_CONTEXT_RE.finditer(diff_text):
            target = import_match.group(1)
            if target == own_ctx:
                continue
            if target in CROSS_CONTEXT_WHITELIST:
                continue
            matches.append(
                {
                    "id": "cross-bounded-context-import",
                    "canon_ref": "ARCHITECTURE_CANON.md §Hexagonal-DDD",
                    "description": (
                        f'Cross-bounded-context import: file lives in @core/{own_ctx}, '
                        f"imports from @core/{target} (not in whitelist "
                        f"{sorted(CROSS_CONTEXT_WHITELIST)}). Resolve via port-adapter."
                    ),
                }
            )
            break  # one report per file is enough
    return matches


def log_block(file_path: str, matches: list[dict], suffix: str = "") -> None:
    try:
        TRIPWIRE_BLOCKS_LOG.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat()
        ids = ",".join(m["id"] for m in matches)
        with TRIPWIRE_BLOCKS_LOG.open("a", encoding="utf-8") as f:
            f.write(f"{ts}\t{file_path}\t{ids}\t{suffix}\n")
    except OSError as e:
        log(f"WARN: cannot write tripwire-blocks.log: {e}")


def log_override(file_path: str, matches: list[dict], source: str) -> None:
    try:
        HEURISTIC_OVERRIDES_LOG.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat()
        ids = ",".join(m["id"] for m in matches)
        with HEURISTIC_OVERRIDES_LOG.open("a", encoding="utf-8") as f:
            f.write(f"{ts}\t{file_path}\t{ids}\tTRIPWIRE_OVERRIDE:{source}\n")
    except OSError as e:
        log(f"WARN: cannot write heuristic-overrides.log: {e}")


def main() -> None:
    try:
        data = read_hook_input(log)
    except SystemExit:
        # _common already exited; mirror "no block" semantics on input error.
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    if tool_name not in ("Edit", "Write", "MultiEdit"):
        sys.exit(0)

    file_path = data.get("tool_input", {}).get("file_path", "")
    diff_text = extract_diff_text(data)
    if not diff_text:
        sys.exit(0)

    # Skip Markdown documentation files. Docs legitimately mention the
    # tripwire patterns as reference (CLAUDE.md §Mandatory Pre-Action
    # Triggers, NORMALIZATION_ROADMAP.md §1.6, etc.). The patterns are
    # only meaningful inside executable code (TS/JS/Python), so scoping
    # the hook to non-.md preserves intent without false positives.
    if file_path.endswith(".md") or file_path.endswith(".mdx"):
        log(f"SKIP: documentation file ({file_path})")
        sys.exit(0)

    matches = find_tripwire_matches(diff_text, file_path)
    if not matches:
        log(f"no tripwire matches in {file_path}")
        sys.exit(0)

    log(f"detected {len(matches)} tripwire pattern(s) in {file_path}: " +
        ",".join(m["id"] for m in matches))

    # Bypass 1: canon-check signature in prior assistant message.
    transcript_path = data.get("transcript_path", "")
    prior_text = read_last_assistant_text(transcript_path)
    if prior_text and CANON_CHECK_RE.search(prior_text):
        log(f"ALLOW: canon-check citation present in prior assistant text ({file_path})")
        log_override(file_path, matches, "canon-check-signature")
        sys.exit(0)

    # Bypass 2: token sensitive-edit (unified token gate; same one used by
    # the sensitive-path pre-edit hook).
    token_status = check_grant_token("sensitive-edit", log)
    if token_status is None:
        log(f"ALLOW: sensitive-edit token valid ({file_path})")
        log_override(file_path, matches, "token-sensitive-edit")
        sys.exit(0)

    # No bypass — block.
    log_block(file_path, matches)
    lines = [
        f"TRIPWIRE matched in {file_path}:",
        "",
    ]
    for m in matches:
        lines.append(f"  - {m['id']} — {m['description']}")
        lines.append(f"    canon: {m['canon_ref']}")
    lines.extend(
        [
            "",
            "Per CLAUDE.md §Mandatory Pre-Action Triggers, this Edit/Write is blocked.",
            "",
            "To proceed, the assistant's prior message must include a line:",
            "  canon-check: <canon-file>.md §<rule-id> — <decision> autorizada porque <razón>",
            "",
            "Invoke `/canon-check` to evaluate, OR",
            "(emergency) ask Edward to run `omnipost-allow sensitive-edit` (15 min TTL).",
        ]
    )
    block("\n".join(lines))


if __name__ == "__main__":
    main()
