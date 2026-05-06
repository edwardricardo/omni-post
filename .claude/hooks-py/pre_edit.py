#!/usr/bin/env python3
"""Pre-edit hook — bloquea Edit/Write/MultiEdit sobre archivos sensibles.

Cierra el agujero de privilege escalation: si Claude pudiera editar
`pre_bash.py` o `settings.json`, podría neutralizar los demás hooks. También
protege schema/secrets de cambios accidentales.

Bypass: variable de entorno `EDWARD_AUTHORIZED_SENSITIVE=yes` (Edward la
setea puntualmente desde su shell). Ausente → bloqueo. Auditable vía git.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import make_logger, read_hook_input  # noqa: E402

HOOK_NAME = "pre-edit"
log, block, allow = make_logger(HOOK_NAME)

SENSITIVE_PATTERNS = [
    "/.claude/hooks-py/",
    "/.claude/settings.json",
    "/.claude/settings.local.json",
    "/.claude/bin/",
    "/infra/prisma/schema.prisma",
    "/infra/prisma/migrations/",
    "/.env",  # incluye .env, .env.test, .env.example, .envrc
    "/encryption/",
    "/.github/workflows/",
]

BYPASS_ENV_VAR = "EDWARD_AUTHORIZED_SENSITIVE"


def is_sensitive(file_path: str) -> str | None:
    """Devuelve el pattern matched, o None si el path no es sensible."""
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
        allow(f"path no sensible ({file_path})")

    if os.environ.get(BYPASS_ENV_VAR) == "yes":
        log(f"sensitive path {file_path} permitido vía {BYPASS_ENV_VAR}=yes")
        allow(f"sensitive path authorized via {BYPASS_ENV_VAR}")

    block(
        f"{file_path} matchea pattern sensible '{matched}'. "
        f"Para autorizar puntualmente, Edward debe ejecutar: "
        f"export {BYPASS_ENV_VAR}=yes (y luego unset cuando termine)."
    )


if __name__ == "__main__":
    main()
