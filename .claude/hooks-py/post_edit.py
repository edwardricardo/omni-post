#!/usr/bin/env python3
"""Post-edit hook — runs secretlint on the file just touched.

Defense in depth on top of Ring 2 (lint-staged). Catches accidental pastes
of credentials/keys/tokens as soon as the file is saved to disk, without
waiting for `git add`. Single-file scope to keep latency <1s.

By the CC contract, PostToolUse fires only when the operation succeeds;
failures go to PostToolUseFailure (a separate event). It does not check
whether the Edit worked — if this hook runs, the file was written.
"""

import os
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

# The argument is the one file just written, never a pattern. Next.js route
# segments such as `[id]`, `[...path]` and `(group)` are glob syntax. secretlint
# 13 already reads a path that exists on disk literally; this flag states it,
# so the scan never depends on that rule. lint-staged passes the same flag. The
# path goes verbatim: a backslash-escaped one names no file ("Not found target
# files").
LITERAL_PATH_FLAG = "--no-glob"

# File selection must be the one lint-staged and secret:scan use. secretlint
# merges `.gitignore` into the same ignore level as `.secretlintignore` unless
# told not to, and `.gitignore` is read last, so its `!.env.example` negations
# re-include the env templates `.secretlintignore` excludes on purpose.
SECRETLINTIGNORE_ONLY_FLAG = "--no-gitignore"

GIT_TIMEOUT_SEC = 2

# What a checkout must hold for the scan to run from its root: the command
# names both files relative to the working directory, and `pnpm exec` resolves
# the binary from that checkout's own install.
SCAN_ROOT_REQUIREMENTS = (".secretlintrc.json", ".secretlintignore", "node_modules/.bin/secretlint")

# pnpm's verifyDepsBeforeRun defaults to `install`: `pnpm exec` first installs
# the workspace whenever its node_modules lag the manifests, and a checkout
# without node_modules got all 98 projects installed by one `pnpm exec
# secretlint` (measured 2026-10-04). A hook must never install packages, least
# of all under its timeout or while a manifest is being edited.
NO_INSTALL_ENV = {"PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN": "false"}


def scan_target(file_path: str) -> tuple[Path, str]:
    """Working directory and path argument that scan `file_path`.

    secretlint matches .secretlintignore against the path relative to its
    working directory, so the scan runs from the root of the git checkout that
    holds the file (a linked worktree's own root, not PROJECT_ROOT, whose hook
    every session runs) with the path relative to that root. The path is
    resolved first: an absolute path reached through a symlink escapes the
    ignore file even from the right root (measured 2026-10-04). A file outside
    any git checkout, or in a checkout that cannot run secretlint itself, is
    scanned as before: from PROJECT_ROOT, with the path as given.
    """
    resolved = Path(file_path).resolve()
    try:
        result = subprocess.run(
            ["git", "-C", str(resolved.parent), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT_SEC,
            check=True,
        )
        root = Path(result.stdout.strip()).resolve()
        relative = resolved.relative_to(root)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError):
        return PROJECT_ROOT, file_path
    missing = [name for name in SCAN_ROOT_REQUIREMENTS if not (root / name).exists()]
    if missing:
        log(f"{root} lacks {', '.join(missing)}: {file_path} is scanned from {PROJECT_ROOT}")
        return PROJECT_ROOT, file_path
    return root, str(relative)


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

    cwd, target = scan_target(file_path)
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
                SECRETLINTIGNORE_ONLY_FLAG,
                LITERAL_PATH_FLAG,
                "--format",
                "compact",
                target,
            ],
            capture_output=True,
            text=True,
            timeout=SECRETLINT_TIMEOUT_SEC,
            # From the root of the checkout that holds the file, where that
            # checkout's pre-commit hook runs lint-staged and where the
            # secret:scan script runs, so the relative .secretlintrc.json and
            # .secretlintignore are that checkout's and its ignore patterns
            # match (scan_target). The rule preset itself resolves from any
            # working directory while enableGlobalVirtualStore is false
            # (measured 2026-10-03, decision D40).
            cwd=str(cwd),
            env={**os.environ, **NO_INSTALL_ENV},
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

    log(f"secretlint OK on {target} from {cwd}")
    sys.exit(0)


if __name__ == "__main__":
    main()
