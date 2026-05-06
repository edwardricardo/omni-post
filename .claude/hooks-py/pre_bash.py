#!/usr/bin/env python3
"""Pre-bash hook — bloquea comandos prohibidos antes de ejecutarse."""

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from datetime import datetime
from pathlib import Path


LOG_PATH = Path(".claude/hooks.log")
HOOK_NAME = "pre-bash"
ALLOWED_BRANCH_PREFIX = "refactor/remediation-v2.1"


# ────────────────────────────────────────────────────────────────────
# Utilities
# ────────────────────────────────────────────────────────────────────

def log(message: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().isoformat()
    with LOG_PATH.open("a") as f:
        f.write(f"[{timestamp}] [{HOOK_NAME}] {message}\n")


def block(reason: str) -> None:
    print(f"BLOCKED [{HOOK_NAME}]: {reason}", file=sys.stderr)
    log(f"BLOCK: {reason}")
    sys.exit(2)


def allow(reason: str = "ok") -> None:
    log(f"ALLOW: {reason}")
    sys.exit(0)


def current_branch() -> str:
    """Devuelve el nombre de la branch actual, o '' si falla."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return ""


# ────────────────────────────────────────────────────────────────────
# Gates — cada uno chequea una sola cosa.
# ────────────────────────────────────────────────────────────────────

def gate_git_push_requires_token(command: str) -> None:
    """Bloquea git push salvo que exista un token válido (no expirado).

    LIMITACIÓN: este gate detecta variantes comunes de 'git push' (con o sin
    flags intermedias como -C <path>, --git-dir, etc.), pero no detecta
    casos como 'cd /path && git push' donde el comando se compone con &&.
    Para esos casos confiamos en que CC respete la convención y en revisión
    posterior de logs.
    """
    # Regex que matchea 'git' seguido eventualmente de 'push' como tokens separados.
    # Cubre: 'git push', 'git -C /path push', 'git --git-dir=... push', etc.
    if not re.search(r"\bgit\b\s.*\bpush\b", command):
        return

    # Resto de la función sin cambios...
    token_path = Path(".claude/.allowed/push")

    if not token_path.exists():
        block(
            "git push requiere autorización. Pedile permiso a Edward en el chat. "
            "Si te lo concede, él ejecutará 'omnipost-allow push' y vas a poder reintentar."
        )

    try:
        with token_path.open("r") as f:
            token_data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log(f"ERROR: token corrupto o no legible: {e}")
        block(
            "Token de autorización corrupto. Edward debe revisar .claude/.allowed/push, "
            "borrarlo, y ejecutar 'omnipost-allow push' nuevamente."
        )

    expires_at_str = token_data.get("expires_at")
    if not expires_at_str:
        log("ERROR: token sin campo expires_at")
        block(
            "Token de autorización malformado (falta expires_at). "
            "Edward debe ejecutar 'omnipost-allow push' nuevamente."
        )

    try:
        expires_at = datetime.fromisoformat(expires_at_str)
    except ValueError as e:
        log(f"ERROR: expires_at inválido: {e}")
        block(
            "Token con fecha de expiración malformada. "
            "Edward debe ejecutar 'omnipost-allow push' nuevamente."
        )

    now = datetime.now(timezone.utc)

    if now >= expires_at:
        log(f"token de push expirado (creado para expirar a las {expires_at_str}, ahora {now.isoformat()})")
        token_path.unlink()
        block(
            f"Token de push expirado. Fue creado para expirar a las {expires_at_str}. "
            "Pedile a Edward un token nuevo con 'omnipost-allow push'."
        )

    log(f"push token válido (expira a las {expires_at_str}), deferring consumption to post-hook")
    allow("git push authorized via valid token")


def gate_no_npm_or_yarn(command: str) -> None:
    pattern = r"(^|\s)(npm|yarn)\s+(install|i|add|ci|run|exec|update|upgrade)"
    if re.search(pattern, command):
        block("Convención OmniPost: usar pnpm, nunca npm/yarn. Reescribí el comando con 'pnpm'.")


def gate_no_co_authored_in_commit(command: str) -> None:
    if not re.search(r"git\s+commit", command):
        return
    if re.search(r"co-authored-by:\s*claude", command, re.IGNORECASE):
        block("Trailer 'Co-Authored-By: Claude' prohibido. Removelo y reintentá.")


def gate_commit_only_in_allowed_branch(command: str) -> None:
    if not re.search(r"git\s+commit", command):
        return
    branch = current_branch()
    if not branch.startswith(ALLOWED_BRANCH_PREFIX):
        block(
            f"Branch actual '{branch}' no acepta commits. "
            f"Solo {ALLOWED_BRANCH_PREFIX}*."
        )


# ────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────

def main() -> None:
    raw_input = sys.stdin.read()

    try:
        data = json.loads(raw_input)
    except json.JSONDecodeError as e:
        log(f"ERROR: JSON inválido: {e}")
        sys.exit(1)

    tool_name = data.get("tool_name", "")
    command = data.get("tool_input", {}).get("command", "")

    if tool_name != "Bash":
        allow(f"not bash (tool={tool_name})")

    log(f"inspecting: {command}")

    gate_git_push_requires_token(command)
    gate_no_npm_or_yarn(command)
    gate_no_co_authored_in_commit(command)
    gate_commit_only_in_allowed_branch(command)

    allow("command passed all gates")


if __name__ == "__main__":
    main()
