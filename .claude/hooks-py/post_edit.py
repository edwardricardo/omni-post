#!/usr/bin/env python3
"""Post-edit hook — runs secretlint on the file just touched.

Defense in depth on top of Ring 2 (lint-staged). Catches accidental pastes
of credentials/keys/tokens as soon as the file is saved to disk, without
waiting for `git add`. Single-file scope to keep latency <1s.

By the CC contract, PostToolUse fires only when the operation succeeds;
failures go to PostToolUseFailure (a separate event). It does not check
whether the Edit worked — if this hook runs, the file was written.
"""

import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import PROJECT_ROOT, make_logger, read_hook_input  # noqa: E402

HOOK_NAME = "post-edit"
log, block, _allow = make_logger(HOOK_NAME)

# Same exclusions as .secretlintignore, to avoid redundant cost.
SKIP_SUBSTRINGS = (
    "node_modules/",
    "/dist/",
    "/.next/",
    "/coverage/",
    "/reports/",
    "/.test.",
    ".test.ts",
    ".test.tsx",
    "pnpm-lock.yaml",
)

SECRETLINT_TIMEOUT_SEC = 10

# secretlint treats its file argument as a glob. Next.js route filenames contain
# glob metacharacters — dynamic `[id]`, catch-all `[...path]`, route groups
# `(group)` — which a glob parser reads as character classes / extglob, so the
# literal file is never matched ("Not found target files") and the scan silently
# never runs. Escaping these makes secretlint scan the actual file.
_GLOB_MAGIC = re.compile(r"([\[\]()?*!{}@+])")


def escape_glob(path: str) -> str:
    """Backslash-escape glob metacharacters so a literal path matches itself."""
    return _GLOB_MAGIC.sub(r"\\\1", path)


def should_skip(file_path: str) -> bool:
    if not file_path:
        return True
    if not Path(file_path).exists():
        return True
    for substr in SKIP_SUBSTRINGS:
        if substr in file_path:
            return True
    return False


def main() -> None:
    data = read_hook_input(log)

    tool_name = data.get("tool_name", "")
    file_path = data.get("tool_input", {}).get("file_path", "")

    log(f"invoked: tool={tool_name}, path={file_path}")

    if tool_name not in ("Edit", "Write", "MultiEdit"):
        sys.exit(0)

    if should_skip(file_path):
        sys.exit(0)

    try:
        result = subprocess.run(
            [
                "pnpm",
                "exec",
                "secretlint",
                "--secretlintrc",
                ".secretlintrc.json",
                "--secretlintignore",
                ".secretlintignore",
                "--format",
                "compact",
                escape_glob(file_path),
            ],
            capture_output=True,
            text=True,
            timeout=SECRETLINT_TIMEOUT_SEC,
            # Always from the repository root: the patched @secretlint/node pins
            # node_moduleDir to "<cwd>/node_modules" and the rule preset lives
            # only in the root node_modules; from apps/* (no local @secretlint)
            # the loader does not find the preset and aborts with a false
            # positive. lint-staged and the secret:scan script invoke it the same way.
            cwd=str(PROJECT_ROOT),
        )
    except subprocess.TimeoutExpired:
        log(f"secretlint timeout on {file_path} ({SECRETLINT_TIMEOUT_SEC}s) — allow")
        sys.exit(0)
    except FileNotFoundError:
        log("pnpm/secretlint not found in PATH — allow")
        sys.exit(0)

    if result.returncode != 0:
        report = (result.stdout + result.stderr).strip() or "<no output>"
        block(
            f"secretlint detected a possible leak in {file_path}:\n{report}\n\n"
            "Review the file and remove the secret before continuing. "
            "If it is a false positive, adjust .secretlintignore or .secretlintrc.json."
        )

    log(f"secretlint OK on {file_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
