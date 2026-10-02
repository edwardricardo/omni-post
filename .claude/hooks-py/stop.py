#!/usr/bin/env python3
"""Stop hook — end-of-turn audit.

Before CC closes the turn, it audits invariants the model forgets:
  1. New .ts/.tsx files in apps/api/src/ without a matching test.
  2. New files in apps/ or packages/ without @file and @layer headers.

When it finds issues, it blocks through stdout JSON {"decision":"block","reason":...}
so CC injects the reason into the model and lets it fix them before closing.

Critical anti-loop: when stop_hook_active=true in the input, it exits cleanly
without blocking again (CC is already stopping again after a previous block).

Global kill switch: EDWARD_DISABLE_STOP_HOOK=yes disables the hook entirely.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import PROJECT_ROOT, make_logger, read_hook_input  # noqa: E402

HOOK_NAME = "stop"
log, _block, _allow = make_logger(HOOK_NAME)

KILL_SWITCH_ENV = "EDWARD_DISABLE_STOP_HOOK"


def get_new_files(extensions: list[str] | None = None) -> list[str]:
    """Untracked files (git ls-files --others --exclude-standard), relative to PROJECT_ROOT.

    Runs with cwd=PROJECT_ROOT: from a subdirectory, `ls-files` lists only
    what hangs below it, with paths relative to it, so no file would start
    with `apps/` and both audits would pass without looking at anything.
    """
    try:
        out = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []
    files = [f for f in out.stdout.strip().split("\n") if f]
    if extensions:
        files = [f for f in files if any(f.endswith(e) for e in extensions)]
    return files


def guess_test_path(src_path: str) -> str:
    """apps/api/src/services/foo.ts → apps/api/tests/unit/services/foo.test.ts"""
    if not src_path.startswith("apps/api/src/"):
        return ""
    rel = src_path[len("apps/api/src/"):]
    p = Path(rel)
    base = p.stem
    parent = str(p.parent) if str(p.parent) != "." else ""
    test_dir = f"apps/api/tests/unit/{parent}".rstrip("/")
    return f"{test_dir}/{base}.test.ts"


def audit_missing_tests() -> list[str]:
    """New .ts/.tsx in apps/api/src/ must have a matching test."""
    issues = []
    for f in get_new_files([".ts", ".tsx"]):
        if not f.startswith("apps/api/src/"):
            continue
        if "/tests/" in f or f.endswith(".test.ts") or f.endswith(".test.tsx"):
            continue
        # Skip module-level files that typically have no test of their own.
        base = Path(f).name
        if base in ("index.ts", "index.tsx", "types.ts"):
            continue
        test_path = guess_test_path(f)
        if test_path and not (PROJECT_ROOT / test_path).exists():
            issues.append(
                f"Missing test for `{f}` — expected at `{test_path}` "
                f"(CLAUDE.md: 'Tests are never deferred to a later sprint')"
            )
    return issues


def audit_missing_headers() -> list[str]:
    """New .ts/.tsx in apps/ or packages/ must have @file and @layer."""
    issues = []
    for f in get_new_files([".ts", ".tsx"]):
        if not (f.startswith("apps/") or f.startswith("packages/")):
            continue
        try:
            with open(PROJECT_ROOT / f, encoding="utf-8") as fh:
                # 4096, not 1500: a file with a thorough doc header pushed
                # @layer past the old window and this hook reported the header
                # as MISSING while it was there (trustedProxy.ts, 2026-09-05) —
                # a false positive from a gate about honesty is the worst kind.
                # Still bounded on purpose: the header canon puts @file/@layer
                # at the TOP of the file, so a header past 4KB is its own
                # violation worth flagging, and an unbounded read would make
                # the hook's cost scale with file size.
                head = fh.read(4096)
        except OSError:
            continue
        missing = []
        if "@file" not in head:
            missing.append("@file")
        if "@layer" not in head:
            missing.append("@layer")
        if missing:
            issues.append(
                f"`{f}` lacks {', '.join(missing)} in its JSDoc header "
                f"(CLAUDE.md: 'Every file gets a JSDoc header — no exceptions')"
            )
    return issues


def main() -> None:
    data = read_hook_input(log)

    # Anti-loop: when CC is already stopping again after a previous block, do not block again.
    if data.get("stop_hook_active"):
        log("stop_hook_active=true, allow without re-check")
        sys.exit(0)

    # Global kill switch.
    if os.environ.get(KILL_SWITCH_ENV) == "yes":
        log(f"disabled via {KILL_SWITCH_ENV}=yes")
        sys.exit(0)

    log("running audits")

    issues: list[str] = []
    issues.extend(audit_missing_tests())
    issues.extend(audit_missing_headers())

    if not issues:
        log("ALLOW: all audits passed (0 issues)")
        sys.exit(0)

    reason_lines = [
        "Turn close blocked — open items, so no work is deferred:",
        "",
    ]
    for i in issues:
        reason_lines.append(f"- {i}")
    reason_lines.extend(
        [
            "",
            f"Resolve these items before closing the turn, or set "
            f"{KILL_SWITCH_ENV}=yes in your shell to skip this hook once.",
        ]
    )
    reason = "\n".join(reason_lines)

    output = {"decision": "block", "reason": reason}
    print(json.dumps(output))
    log(f"BLOCK: {len(issues)} issue(s)")
    sys.exit(0)


if __name__ == "__main__":
    main()
