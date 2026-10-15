#!/usr/bin/env python3
"""Post-bash hook — consumes the push grant that authorized a successful push.

Claude Code fires PostToolUse only when the tool succeeded (failures go to
PostToolUseFailure, a separate event). So this hook does not need to check
the result: if it runs, the push worked. A failed push never reaches it, so
the grant pre-bash claimed for it stays, and a retry inside the same window is
allowed and consumes that same grant.

It consumes ONE grant: the one pre-bash claimed for this command (see
`_common.consume_grant`), never the windows after it, which open at their own
start times.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import command_fingerprint, consume_grant, make_logger, read_hook_input, runs_git_push  # noqa: E402

HOOK_NAME = "post-bash"
log, _block, _allow = make_logger(HOOK_NAME)


def main() -> None:
    data = read_hook_input(log)

    tool_name = data.get("tool_name", "")
    command = data.get("tool_input", {}).get("command", "")

    log(f"invoked: tool={tool_name}, cmd={command[:80]}")

    if tool_name != "Bash":
        sys.exit(0)

    if not runs_git_push(command):
        sys.exit(0)

    grant = consume_grant("push", command_fingerprint(command), log)
    if grant is None:
        log("git push succeeded but no push grant was there to consume (odd, but OK)")
    else:
        log(f"git push succeeded — grant {grant.id} consumed")

    sys.exit(0)


if __name__ == "__main__":
    main()
