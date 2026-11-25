#!/usr/bin/env python3
"""Pre-edit hook — blocks Edit/Write/MultiEdit on sensitive files.

Closes the privilege-escalation hole: if Claude could edit `pre_bash.py` or
`settings.json`, it could neutralize the other hooks. It also protects
schema/secrets from accidental changes, and the rule that counts the existing
error sites from a change that would lower the count without converting a site.

Bypass: a time-boxed token created by `omnipost-allow sensitive-edit`
(TTL 15 min), validated like the push token. Missing or expired
→ block. Auditable through .claude/hooks.log.

The grant store itself (`.claude/.allowed/`) has NO bypass: a session that
could write it could issue its own grants, the `sensitive-edit` token
included, so it is refused before any token is read.
"""

import contextlib
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import check_grant_token, make_logger, read_hook_input  # noqa: E402

HOOK_NAME = "pre-edit"
log, block, allow = make_logger(HOOK_NAME)

SENSITIVE_PATTERNS = [
    "/.claude/hooks-py/",
    "/.claude/settings.json",
    "/.claude/settings.local.json",
    "/.claude/bin/",
    "/infra/prisma/schema.prisma",
    "/infra/prisma/migrations/",
    "/.env",  # includes .env, .env.test, .env.example, .envrc
    "/encryption/",
    "/.github/workflows/",
    # What counts an existing error site: the rule, its scope and the gate that holds
    # the list to shrinking. A session that could edit them could lower the list by
    # changing what is counted instead of converting a site (ADR-0047).
    "/packages/eslint-plugin-errors/",
    "/scripts/testing/lib/error-scope.mjs",
    "/scripts/testing/error-sites-gate.mjs",
    # The reminder the sites gate's stall alarm opens its issue through, which the
    # patched-dependencies gate shares. It counts nothing, but a session that could
    # edit it could silence the alarm that says the list stopped shrinking.
    "/scripts/testing/lib/issue-reminder.mjs",
    # The commit gate: the secret scan and lint-staged run from here before every
    # commit, and no review reads it the way CI is read. A session that could edit
    # it could drop the scan from its own next commit.
    "/.husky/",
]

# The grant store, or a file in it.
_GRANT_STORE_PATH_RE = re.compile(r"(?:^|/)\.claude/\.allowed(?:/|$)")


def is_sensitive(file_path: str) -> str | None:
    """Returns the matched pattern, or None when the path is not sensitive."""
    if not file_path:
        return None
    for pattern in SENSITIVE_PATTERNS:
        if pattern in file_path:
            return pattern
    return None


def is_grant_store(file_path: str) -> bool:
    """Whether `file_path` is the grant store or a file in it, read as written
    (with `.` and `..` collapsed: `.claude/./.allowed/push` is the store) and
    with its symlinks resolved."""
    if not file_path:
        return False
    candidates = [os.path.normpath(file_path)]
    with contextlib.suppress(OSError, RuntimeError):
        candidates.append(str(Path(file_path).resolve()))
    return any(_GRANT_STORE_PATH_RE.search(candidate) for candidate in candidates)


def main() -> None:
    data = read_hook_input(log)

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    file_path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""

    log(f"inspecting: tool={tool_name}, path={file_path}")

    if is_grant_store(file_path):
        block(
            f"{file_path} is in the grant store (.claude/.allowed/). No session writes it, "
            f"with or without a token: only the Maintainer issues, extends or revokes grants, from "
            f"their own terminal, with 'omnipost-allow'. Ask the Maintainer in chat."
        )

    matched = is_sensitive(file_path)
    if not matched:
        allow(f"path not sensitive ({file_path})")

    status = check_grant_token("sensitive-edit", log)
    if status is None:
        allow(f"sensitive path {file_path} authorized via valid sensitive-edit token")

    block(
        f"{file_path} matches sensitive pattern '{matched}' (token: {status}). "
        f"Time-boxed authorization by token: ask the Maintainer to run "
        f"'omnipost-allow sensitive-edit' (TTL 15 min), as for push."
    )


if __name__ == "__main__":
    main()
