#!/usr/bin/env python3
"""Pre-edit Plan Mode guard hook.

Bloquea Edit/Write/MultiEdit en branches `workstream/*` cuando no hay
evidencia de Plan Mode activo o de actividad reciente sobre un plan file
en `/root/.claude/plans/`. Enforces la práctica:
"Always Plan Mode before non-trivial implementation in workstream branches"
(documentada en feedback/workflow.md §planning-before-execution).

DETECCIÓN:
  1. Branch actual matches `^workstream/.*` (via git rev-parse).
  2. Recent transcript (last 200KB) lacks BOTH:
     a. Any tool_use of EnterPlanMode/ExitPlanMode within recent turns.
     b. Any Read/Edit/Write on /root/.claude/plans/*.md.

EXCEPCIÓN — trivial edits passes:
  - Edit con `new_string` < 30 newlines AND `old_string` < 30 newlines.
  - MultiEdit con total newlines en edits < 30.
  - Write to a file that already exists (read it first to know? complicated;
    we use Write as "create new file" semantic — always non-trivial).

BYPASS:
  1. Env var EDWARD_AUTHORIZED_NO_PLAN=yes (case-by-case, audited en
     .claude/heuristic-overrides.log).
  2. Token .claude/.allowed/no-plan-mode (15 min TTL, mismo contrato que
     sensitive-edit). Created by omnipost-allow no-plan-mode.

Block via exit 2 + stderr.

Skip rules (no block):
  - .md / .mdx files (docs editing is not phase work).
  - Branches that don't match workstream/* (main, prototype/*, etc.).
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    check_grant_token,
    current_branch,
    make_logger,
    read_hook_input,
)

HOOK_NAME = "pre-edit-planmode-guard"
log, block, _allow = make_logger(HOOK_NAME)

PLAN_BLOCKS_LOG = Path(".claude/planmode-blocks.log")
HEURISTIC_OVERRIDES_LOG = Path(".claude/heuristic-overrides.log")

WORKSTREAM_BRANCH_RE = re.compile(r"^workstream/")
PLAN_FILE_PATH_RE = re.compile(r'/\.claude/plans/[^"\']+\.md')
PLAN_MODE_TOOL_RE = re.compile(r'"name":\s*"(?:EnterPlanMode|ExitPlanMode)"')

TRIVIAL_LINE_THRESHOLD = 30


def is_documentation(file_path: str) -> bool:
    return file_path.endswith(".md") or file_path.endswith(".mdx")


def is_trivial_edit(data: dict) -> bool:
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    if tool_name == "Write":
        # Treat Write as non-trivial (it creates / overwrites whole files).
        return False
    if tool_name == "Edit":
        new_lines = tool_input.get("new_string", "").count("\n")
        old_lines = tool_input.get("old_string", "").count("\n")
        return new_lines < TRIVIAL_LINE_THRESHOLD and old_lines < TRIVIAL_LINE_THRESHOLD
    if tool_name == "MultiEdit":
        total_lines = sum(
            e.get("new_string", "").count("\n")
            for e in tool_input.get("edits", [])
        )
        return total_lines < TRIVIAL_LINE_THRESHOLD
    return False


def has_recent_plan_activity(transcript_path: str | None) -> bool:
    if not transcript_path:
        return False
    try:
        path = Path(transcript_path)
        if not path.exists():
            return False
        with path.open("rb") as f:
            try:
                f.seek(-200_000, 2)
            except OSError:
                f.seek(0)
            tail = f.read().decode("utf-8", errors="ignore")
    except OSError as e:
        log(f"WARN: cannot read transcript {transcript_path}: {e}")
        return False
    if PLAN_FILE_PATH_RE.search(tail):
        log("plan file path found in recent transcript")
        return True
    if PLAN_MODE_TOOL_RE.search(tail):
        log("EnterPlanMode/ExitPlanMode tool found in recent transcript")
        return True
    return False


def log_block(file_path: str, branch: str, suffix: str = "") -> None:
    try:
        PLAN_BLOCKS_LOG.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat()
        with PLAN_BLOCKS_LOG.open("a", encoding="utf-8") as f:
            f.write(f"{ts}\t{branch}\t{file_path}\t{suffix}\n")
    except OSError as e:
        log(f"WARN: cannot write planmode-blocks.log: {e}")


def log_override(file_path: str, branch: str, source: str) -> None:
    try:
        HEURISTIC_OVERRIDES_LOG.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat()
        with HEURISTIC_OVERRIDES_LOG.open("a", encoding="utf-8") as f:
            f.write(f"{ts}\t{branch}\t{file_path}\tPLANMODE_OVERRIDE:{source}\n")
    except OSError as e:
        log(f"WARN: cannot write heuristic-overrides.log: {e}")


def main() -> None:
    try:
        data = read_hook_input(log)
    except SystemExit:
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    if tool_name not in ("Edit", "Write", "MultiEdit"):
        sys.exit(0)

    file_path = data.get("tool_input", {}).get("file_path", "")
    if is_documentation(file_path):
        log(f"SKIP: documentation file ({file_path})")
        sys.exit(0)

    branch = current_branch()
    if not WORKSTREAM_BRANCH_RE.match(branch):
        log(f"SKIP: branch '{branch}' is not workstream/*")
        sys.exit(0)

    if is_trivial_edit(data):
        log(f"SKIP: trivial edit on {file_path} (< {TRIVIAL_LINE_THRESHOLD} lines)")
        sys.exit(0)

    transcript_path = data.get("transcript_path", "")
    if has_recent_plan_activity(transcript_path):
        log(f"ALLOW: recent plan activity detected ({file_path})")
        sys.exit(0)

    # Bypass: env var
    if os.environ.get("EDWARD_AUTHORIZED_NO_PLAN") == "yes":
        log(f"ALLOW: EDWARD_AUTHORIZED_NO_PLAN=yes ({file_path})")
        log_override(file_path, branch, "EDWARD_AUTHORIZED_NO_PLAN")
        sys.exit(0)

    # Bypass: token no-plan-mode
    token_status = check_grant_token("no-plan-mode", log)
    if token_status is None:
        log(f"ALLOW: no-plan-mode token valid ({file_path})")
        log_override(file_path, branch, "token-no-plan-mode")
        sys.exit(0)

    log_block(file_path, branch)
    reason = (
        f"Branch '{branch}' matches workstream/* but no Plan Mode activity "
        f"detected in recent transcript.\n\n"
        f"Per feedback/workflow.md §planning-before-execution, non-trivial "
        f"phase work requires Plan Mode active OR a plan file referenced "
        f"in /root/.claude/plans/.\n\n"
        f"To proceed, do ONE of:\n"
        f"  1. Invoke EnterPlanMode to enter Plan Mode.\n"
        f"  2. Read/Edit a plan file under /root/.claude/plans/.\n"
        f"  3. (emergency) ask Edward to run "
        f"`omnipost-allow no-plan-mode` (15 min TTL).\n"
        f"  4. (case-by-case) set EDWARD_AUTHORIZED_NO_PLAN=yes in session.\n\n"
        f"Trivial edits (< {TRIVIAL_LINE_THRESHOLD} lines diff on existing "
        f"file) auto-pass. Current edit exceeds threshold."
    )
    block(reason)


if __name__ == "__main__":
    main()
