#!/usr/bin/env python3
"""Post-bash hook — limpia tokens de autorización después de operaciones exitosas."""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


LOG_PATH = Path(".claude/hooks.log")
HOOK_NAME = "post-bash"


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
    if tool_name != "Bash":
        sys.exit(0)

    command = data.get("tool_input", {}).get("command", "")

    if not re.search(r"git\s+push", command):
        sys.exit(0)

    tool_response = data.get("tool_response", {})
    success = tool_response.get("success", False)

    if not success:
        log("git push falló — manteniendo token para reintento (si no expiró)")
        sys.exit(0)

    # Operación exitosa — consumir el token
    token_path = Path(".claude/.allowed/push")
    if token_path.exists():
        try:
            with token_path.open("r") as f:
                token_data = json.load(f)
            log(f"git push exitoso — token consumido (era válido, expiraba a las {token_data.get('expires_at')})")
        except Exception:
            log("git push exitoso — token consumido (no se pudo leer metadata)")
        token_path.unlink()
    else:
        log("git push exitoso pero token ya no existe (raro, pero OK)")

    sys.exit(0)
