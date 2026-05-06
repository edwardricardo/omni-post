#!/usr/bin/env python3
"""Post-bash hook — consume el token de autorización después de un push exitoso.

Claude Code dispara PostToolUse solo cuando la herramienta tuvo éxito
(los fallos van a PostToolUseFailure, evento aparte). Por eso este hook
no necesita chequear el resultado: si corre, el push funcionó.
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path


LOG_PATH = Path(".claude/hooks.log")
HOOK_NAME = "post-bash"

# Regex compartida con pre_bash: matchea 'git' y 'push' como tokens
# separados aunque haya flags intermedias (-C /path, --git-dir=...).
# Limitación: no detecta composición con && (cd /path && ...).
GIT_PUSH_RE = re.compile(r"\bgit\b\s.*\bpush\b")


def log(message: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().isoformat()
    with LOG_PATH.open("a") as f:
        f.write(f"[{timestamp}] [{HOOK_NAME}] {message}\n")


def main() -> None:
    raw_input = sys.stdin.read()

    try:
        data = json.loads(raw_input)
    except json.JSONDecodeError as e:
        log(f"ERROR: JSON inválido: {e}")
        sys.exit(1)

    tool_name = data.get("tool_name", "")
    command = data.get("tool_input", {}).get("command", "")

    log(f"invoked: tool={tool_name}, cmd={command[:80]}")

    if tool_name != "Bash":
        sys.exit(0)

    if not GIT_PUSH_RE.search(command):
        sys.exit(0)

    token_path = Path(".claude/.allowed/push")
    if token_path.exists():
        try:
            with token_path.open("r") as f:
                token_data = json.load(f)
            log(f"git push exitoso — token consumido (expiraba a las {token_data.get('expires_at')})")
        except Exception:
            log("git push exitoso — token consumido (no se pudo leer metadata)")
        token_path.unlink()
    else:
        log("git push exitoso pero token ya no existe (raro, pero OK)")

    sys.exit(0)


if __name__ == "__main__":
    main()
