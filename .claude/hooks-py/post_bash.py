#!/usr/bin/env python3
"""Post-bash hook — consumes the authorization token after a successful push.

Claude Code fires PostToolUse only when the tool succeeded (failures go to
PostToolUseFailure, a separate event). So this hook does not need to check
the result: if it runs, the push worked.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import ALLOWED_TOKENS_DIR, GIT_PUSH_RE, make_logger, read_hook_input  # noqa: E402

HOOK_NAME = "post-bash"
log, _block, _allow = make_logger(HOOK_NAME)


def main() -> None:
    data = read_hook_input(log)

    tool_name = data.get("tool_name", "")
    command = data.get("tool_input", {}).get("command", "")

    log(f"invoked: tool={tool_name}, cmd={command[:80]}")

    if tool_name != "Bash":
        sys.exit(0)

    if not GIT_PUSH_RE.search(command):
        sys.exit(0)

    token_path = ALLOWED_TOKENS_DIR / "push"
    if token_path.exists():
        try:
            with token_path.open("r") as f:
                token_data = json.load(f)
            log(f"git push succeeded — token consumed (it expired at {token_data.get('expires_at')})")
        except Exception:
            log("git push succeeded — token consumed (metadata unreadable)")
        token_path.unlink()
    else:
        log("git push succeeded but the token no longer exists (odd, but OK)")

    sys.exit(0)


if __name__ == "__main__":
    main()
