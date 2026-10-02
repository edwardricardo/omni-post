#!/usr/bin/env python3
"""Pre-edit decision-guard hook.

Detects high-risk technical decision patterns in the diff and warns when no
canon covers them. ADVISORY ONLY: it emits a warning through additionalContext
and never blocks, so the patterns can be calibrated before any hard gate.

Covered patterns (starter set):
  - argon2-params       — Argon2 hash/verify parameter choice (RFC 9106)
  - jwt-algorithm       — JWT signing algorithm
  - oauth-scopes        — OAuth scope declaration
  - cors-config         — CORS configuration
  - session-cookie      — Session/cookie security flags (httpOnly/secure/sameSite)
  - csp-header          — Content Security Policy
  - rate-limit          — Rate limiting config

For each match, it looks in `canon-index.json`:
  1. Strict: entries whose `decisionGuards: [...]` contains the pattern_id.
  2. Fallback: keyword match against topic/area/summary/keyTakeaway/key.

When none covers it → emits an advisory warning + logs to
`canon-decision-gaps.log`, the calibration data for any move to a hard gate
(exit 2).

Case-by-case bypass: the env var `EDWARD_AUTHORIZED_HEURISTIC=yes` silences
the warning for this invocation (recorded in the log for auditing).

This hook NEVER blocks: always exit 0.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    PROJECT_ROOT,
    canon_index_path,
    emit_additional_context,
    emit_missing_file_context,
    make_logger,
    read_hook_input,
    recovered_file_notice,
)

HOOK_NAME = "pre-edit-decision-guard"
log, _block, _allow = make_logger(HOOK_NAME)

DECISION_GAPS_LOG = PROJECT_ROOT / ".claude" / "canon-decision-gaps.log"
HEURISTIC_OVERRIDES_LOG = PROJECT_ROOT / ".claude" / "heuristic-overrides.log"

DECISION_PATTERNS: list[dict] = [
    {
        "id": "argon2-params",
        "regex": re.compile(r"argon2\.(?:hash|verify)\s*\("),
        "description": "Argon2 hash/verify parameter choice (RFC 9106 second recommendation)",
        "canon_keywords": ["argon2", "rfc 9106", "rfc-9106", "password hashing"],
    },
    {
        "id": "jwt-algorithm",
        "regex": re.compile(r"\b(?:jsonwebtoken|jwt\.(?:sign|verify)|JsonWebToken)\b"),
        "description": "JWT signing algorithm choice (RFC 8725 BCP)",
        "canon_keywords": ["jwt", "rfc 8725", "rfc-8725", "jose", "jws"],
    },
    {
        "id": "oauth-scopes",
        "regex": re.compile(
            r"scope[s]?\s*[:=]\s*['\"][^'\"]*\b(?:read|write|manage|admin|publish)"
        ),
        "description": "OAuth scope declaration (least-privilege per provider docs)",
        "canon_keywords": ["oauth", "scope"],
    },
    {
        "id": "cors-config",
        "regex": re.compile(r"@fastify/cors|\bcors\s*\(\s*\{|origin\s*:\s*['\"]"),
        "description": "CORS configuration (origin whitelist, credentials)",
        "canon_keywords": ["cors"],
    },
    {
        "id": "session-cookie",
        "regex": re.compile(r"\b(?:httpOnly|sameSite|secure)\s*:\s*"),
        "description": "Session/cookie security flag",
        "canon_keywords": ["cookie", "session", "samesite", "owasp a07", "owasp-a07"],
    },
    {
        "id": "csp-header",
        "regex": re.compile(r"Content-Security-Policy|contentSecurityPolicy"),
        "description": "Content Security Policy",
        "canon_keywords": ["csp", "content security policy", "content-security-policy"],
    },
    {
        "id": "rate-limit",
        "regex": re.compile(r"@fastify/rate-limit|\brateLimit\s*\("),
        "description": "Rate limiting configuration",
        "canon_keywords": ["rate limit", "rate-limit", "ddos"],
    },
]


def emit_no_warning(prefix: tuple[str, ...] = ()) -> None:
    """Exit 0 without injecting anything, except `prefix` (e.g. the RECOVERED notice)."""
    emit_additional_context("PreToolUse", "", prefix)


def emit_warning(content: str, prefix: tuple[str, ...] = ()) -> None:
    """Exit 0 with additionalContext on stdout (`prefix` first)."""
    emit_additional_context("PreToolUse", content, prefix)


def load_index(*, decision_ids: str, session_id: str = "") -> dict:
    """Loads canon-index.json, or reports IN THE CONTEXT and exits (exit 0).

    Without an index there is no way to know whether a decision is covered, so
    NO DECISION GAP is emitted: with the index absent, every detection became
    a false gap (75 notices, all false, while the path pointed at another
    machine's home directory). The blindness is reported, not an invented
    finding — once per session; what followed (gaps and overrides) compared
    against nothing.
    """
    path = canon_index_path()
    consequence = f"decision-gap check for {decision_ids} is blind until it exists"
    if not path.exists():
        log(f"canon-index.json does not exist at {path} — no DECISION GAP, reported in the context")
        emit_missing_file_context("canon", "canon-index.json", path, consequence, hook_event="PreToolUse", session_id=session_id)
    try:
        with path.open("r", encoding="utf-8") as f:
            index = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log(f"ERROR reading canon-index: {e} — no DECISION GAP, reported in the context")
        emit_missing_file_context(
            "canon",
            "canon-index.json",
            path,
            f"decision-gap check for {decision_ids} is blind until it is readable ({type(e).__name__})",
            hook_event="PreToolUse",
            state="UNREADABLE",
            session_id=session_id,
        )
    if not isinstance(index, dict) or not isinstance(index.get("entries"), dict):
        # Valid JSON without the shape the hook reads (an object with `entries`):
        # a `{}` or a `[]` would compare against nothing and hide the gap unreported.
        found = type(index).__name__ if not isinstance(index, dict) else "object without entries"
        log(f"canon-index.json does not have the expected shape ({found}) — no DECISION GAP, reported in the context")
        emit_missing_file_context(
            "canon",
            "canon-index.json",
            path,
            f"decision-gap check for {decision_ids} is blind until it is a JSON object with entries ({found} found)",
            hook_event="PreToolUse",
            state="UNREADABLE",
            session_id=session_id,
        )
    return index


def extract_diff_text(data: dict) -> str:
    """Extracts the text to check from tool_input according to tool_name."""
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


def canon_covers_pattern(index: dict, pattern: dict) -> bool:
    """True when some canon entry covers this pattern (strict or keyword fallback)."""
    pattern_id = pattern["id"]
    keywords = [kw.lower() for kw in pattern.get("canon_keywords", [])]
    for entry in index.get("entries", {}).values():
        guards = entry.get("decisionGuards", [])
        if pattern_id in guards:
            return True
        haystack = " ".join(
            [
                entry.get("topic", ""),
                entry.get("area", ""),
                entry.get("summary", ""),
                entry.get("keyTakeaway", ""),
                entry.get("key", ""),
            ]
        ).lower()
        for kw in keywords:
            if kw and kw in haystack:
                return True
    return False


def log_event(path: Path, file_path: str, pattern_id: str, suffix: str = "") -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat()
        with path.open("a", encoding="utf-8") as f:
            f.write(f"{ts}\t{file_path}\t{pattern_id}\t{suffix}\n")
    except OSError as e:
        log(f"WARN: could not write {path}: {e}")


def main() -> None:
    try:
        data = read_hook_input(log)
    except SystemExit:
        emit_no_warning()
        return

    tool_name = data.get("tool_name", "")
    if tool_name not in ("Edit", "Write", "MultiEdit"):
        emit_no_warning()

    file_path = data.get("tool_input", {}).get("file_path", "")
    diff_text = extract_diff_text(data)
    if not diff_text:
        emit_no_warning()

    matched: list[dict] = []
    for pattern in DECISION_PATTERNS:
        if pattern["regex"].search(diff_text):
            matched.append(pattern)

    if not matched:
        emit_no_warning()

    log(f"detected {len(matched)} decision patterns in {file_path}")

    session_id = data.get("session_id", "")
    index = load_index(decision_ids=", ".join(p["id"] for p in matched), session_id=session_id)
    recovered = recovered_file_notice("canon", "canon-index.json", canon_index_path(), session_id)
    prefix = (recovered,) if recovered else ()
    gaps: list[dict] = []
    for pattern in matched:
        if canon_covers_pattern(index, pattern):
            continue
        gaps.append(pattern)
        log_event(DECISION_GAPS_LOG, file_path, pattern["id"])

    if not gaps:
        log("all decision patterns covered by canon — silent")
        emit_no_warning(prefix)

    if os.environ.get("EDWARD_AUTHORIZED_HEURISTIC") == "yes":
        for p in gaps:
            log_event(HEURISTIC_OVERRIDES_LOG, file_path, p["id"], "EDWARD_AUTHORIZED_HEURISTIC")
        log(
            f"{len(gaps)} gaps overridden by EDWARD_AUTHORIZED_HEURISTIC for {file_path}"
        )
        emit_no_warning(prefix)

    lines = [f"[DECISION GAP — {file_path}]", ""]
    lines.append(
        "The following technical decisions in the diff have NO canon entry that covers them:"
    )
    lines.append("")
    for p in gaps:
        lines.append(f"  - **{p['id']}** — {p['description']}")
    lines.append("")
    lines.append(
        "**Advisory** (non-blocking). Before applying the change, consider asking Edward to:"
    )
    lines.append("  (a) start canon research for this decision, or")
    lines.append(
        "  (b) confirm that he already authorized the heuristic (set `EDWARD_AUTHORIZED_HEURISTIC=yes` in the session)."
    )
    lines.append("")
    lines.append(
        "Logged to `.claude/canon-decision-gaps.log` for calibration before any move to a hard gate."
    )

    emit_warning("\n".join(lines), prefix)


if __name__ == "__main__":
    main()
