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
  2. Token .claude/.allowed/tripwire-override (15 min TTL, same protocol
     as sensitive-edit). Created by omnipost-allow tripwire-override.
  3. Env var EDWARD_AUTHORIZED_TRIPWIRE=yes (case-by-case, audited en
     .claude/heuristic-overrides.log).

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
        "regex": re.compile(r"//\s*(?:temporary|puente|bridge|phase-bridge|hack)\b", re.IGNORECASE),
        "canon_ref": "feedback/canon-research.md §no-time-bombs",
        "description": "Time-bomb comment marker — workaround sin remediation real",
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

    # Bypass 2: env var (case-by-case authorization).
    if os.environ.get("EDWARD_AUTHORIZED_TRIPWIRE") == "yes":
        log(f"ALLOW: EDWARD_AUTHORIZED_TRIPWIRE=yes ({file_path})")
        log_override(file_path, matches, "EDWARD_AUTHORIZED_TRIPWIRE")
        sys.exit(0)

    # Bypass 3: token tripwire-override (parallel to sensitive-edit).
    token_status = check_grant_token("tripwire-override", log)
    if token_status is None:
        log(f"ALLOW: tripwire-override token valid ({file_path})")
        log_override(file_path, matches, "token-tripwire-override")
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
            "(emergency) ask Edward to run `omnipost-allow tripwire-override` (15 min TTL), OR",
            "(case-by-case) set EDWARD_AUTHORIZED_TRIPWIRE=yes in the session.",
        ]
    )
    block("\n".join(lines))


if __name__ == "__main__":
    main()
