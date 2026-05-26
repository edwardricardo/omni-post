#!/usr/bin/env python3
"""Pre-edit hook — bloquea Edit/Write/MultiEdit sobre archivos sensibles.

Cierra el agujero de privilege escalation: si Claude pudiera editar
`pre_bash.py` o `settings.json`, podría neutralizar los demás hooks. También
protege schema/secrets de cambios accidentales.

Bypass: token time-boxed creado por `omnipost-allow sensitive-edit`
(TTL 15 min), validado igual que el token de push. Ausente o expirado
→ bloqueo. Auditable vía .claude/hooks.log.
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
    "/.env",  # incluye .env, .env.test, .env.example, .envrc
    "/encryption/",
    "/.github/workflows/",
]

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

    status = check_grant_token("sensitive-edit", log)
    if status is None:
        allow(f"sensitive path {file_path} authorized via valid sensitive-edit token")

    block(
        f"{file_path} matchea pattern sensible '{matched}' (token: {status}). "
        f"Autorización time-boxed por token: pedíle a Edward que ejecute "
        f"'omnipost-allow sensitive-edit' (TTL 15 min), igual que para push."
    )


if __name__ == "__main__":
    main()
