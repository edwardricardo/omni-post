#!/usr/bin/env python3
"""Pre-edit hook — blocks Edit/Write/MultiEdit on sensitive files.

Closes the privilege-escalation hole: if Claude could edit `pre_bash.py` or
`settings.json`, it could neutralize the other hooks. It also protects
schema/secrets from accidental changes.

Bypass: a time-boxed token created by `omnipost-allow sensitive-edit`
(TTL 15 min), validated like the push token. Missing or expired
→ block. Auditable through .claude/hooks.log.
"""

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
]


def is_sensitive(file_path: str) -> str | None:
    """Returns the matched pattern, or None when the path is not sensitive."""
    if not file_path:
        return None
    for pattern in SENSITIVE_PATTERNS:
        if pattern in file_path:
            return pattern
    return None


def main() -> None:
    data = read_hook_input(log)

    tool_name = data.get("tool_name", "")
    file_path = data.get("tool_input", {}).get("file_path", "")

    log(f"inspecting: tool={tool_name}, path={file_path}")

    matched = is_sensitive(file_path)
    if not matched:
        allow(f"path not sensitive ({file_path})")

    status = check_grant_token("sensitive-edit", log)
    if status is None:
        allow(f"sensitive path {file_path} authorized via valid sensitive-edit token")

    block(
        f"{file_path} matches sensitive pattern '{matched}' (token: {status}). "
        f"Time-boxed authorization by token: ask Edward to run "
        f"'omnipost-allow sensitive-edit' (TTL 15 min), as for push."
    )


if __name__ == "__main__":
    main()
