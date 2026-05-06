#!/usr/bin/env python3
"""Pre-bash hook — bloquea comandos prohibidos antes de ejecutarse."""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import GIT_PUSH_RE, current_branch, make_logger, read_hook_input  # noqa: E402

HOOK_NAME = "pre-bash"
ALLOWED_BRANCH_PREFIX = "refactor/remediation-v2.1"

log, block, allow = make_logger(HOOK_NAME)


# ────────────────────────────────────────────────────────────────────
# Gates — cada uno chequea una sola cosa.
# ────────────────────────────────────────────────────────────────────

def gate_git_push_requires_token(command: str) -> None:
    """Bloquea git push salvo que exista un token válido (no expirado).

    LIMITACIÓN: detecta variantes con flags intermedias (-C /path,
    --git-dir, etc.) pero no composición con && (cd /path && ...).
    """
    if not GIT_PUSH_RE.search(command):
        return

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
        log(f"token de push expirado (expiraba a las {expires_at_str}, ahora {now.isoformat()})")
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
    data = read_hook_input(log)

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
