#!/usr/bin/env python3
"""Pre-bash hook — bloquea comandos prohibidos antes de ejecutarse."""

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    GIT_PUSH_RE,
    check_grant_token,
    current_branch,
    make_logger,
    read_hook_input,
)

HOOK_NAME = "pre-bash"
ALLOWED_BRANCH_PREFIX = "workstream/"

# Detecta comandos que escriben (redirect / tee) a un archivo .ts/.tsx.
# Cubre: 'cat > foo.ts <<EOF', 'echo ... > bar.tsx', 'tee baz.ts'.
WRITES_TS_RE = re.compile(r"(>\s*\S*\.tsx?\b|\btee\s+\S*\.tsx?\b)")
# Patrones de patch sintácticos prohibidos por CLAUDE.md.
TS_IGNORE_RE = re.compile(r"@ts-(ignore|nocheck)")
CONSOLE_LOG_RE = re.compile(r"\bconsole\.log\s*\(")
# Paths de producción donde console.log está prohibido.
PROD_PATH_RE = re.compile(r"(apps/api/src/|packages/[^/]+/src/)")
# Comandos de migración Prisma que requieren DB corriendo.
PNPM_MIGRATE_RE = re.compile(r"pnpm\s+(?:db:migrate|db:push|prisma\s+migrate)")

log, block, allow = make_logger(HOOK_NAME)


# ────────────────────────────────────────────────────────────────────
# Gates — cada uno chequea una sola cosa.
# ────────────────────────────────────────────────────────────────────

def gate_git_push_requires_token(command: str) -> None:
    """Block the remote-publish command unless a valid token exists.

    Validation delegated to the shared `check_grant_token` helper — the
    same contract pre-edit uses for `sensitive-edit` (no drift).

    LIMITATION: matches variants with intermediate flags (-C /path,
    --git-dir, ...) but not && composition (cd /path && ...).
    """
    if not GIT_PUSH_RE.search(command):
        return

    status = check_grant_token("push", log)
    if status is None:
        log("push token valid, deferring consumption to post-hook")
        allow("remote publish authorized via valid token")

    messages = {
        "missing": (
            "Remote publish requires authorization. Ask Edward in chat; "
            "he runs 'omnipost-allow push' and you retry."
        ),
        "corrupt": (
            "Authorization token corrupt. Edward must inspect "
            ".claude/.allowed/push, delete it, and re-run 'omnipost-allow push'."
        ),
        "malformed": (
            "Authorization token malformed (missing/!expires_at). "
            "Edward must re-run 'omnipost-allow push'."
        ),
        "expired": (
            "Authorization token expired. "
            "Ask Edward for a fresh one via 'omnipost-allow push'."
        ),
    }
    block(messages[status])


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


def gate_db_migrations_require_running_db(command: str) -> None:
    """Bloquea pnpm db:migrate / prisma migrate si Postgres no está arriba."""
    if not PNPM_MIGRATE_RE.search(command):
        return
    try:
        result = subprocess.run(
            ["docker", "ps", "--filter", "name=postgres", "--filter", "status=running", "--quiet"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        # Docker no disponible o lento — no bloqueamos preventivamente.
        log("docker check skipped (timeout or not found)")
        return
    if not result.stdout.strip():
        block(
            "Postgres no está corriendo. Levantá DB con `pnpm db:up` antes de migrar. "
            "(Detectado vía `docker ps --filter name=postgres --filter status=running`)"
        )


def gate_no_patches_in_ts_writes(command: str) -> None:
    """Bloquea @ts-ignore/@ts-nocheck en cualquier escritura a .ts/.tsx
    y console.log si la escritura va a apps/api/src/ o packages/*/src/.

    Aplica solo si el comando es claramente de escritura (redirect, tee).
    Evita falsos positivos de comandos de lectura como `grep '@ts-ignore'`.
    """
    if not WRITES_TS_RE.search(command):
        return
    if TS_IGNORE_RE.search(command):
        block(
            "@ts-ignore / @ts-nocheck prohibidos en código de producción "
            "(CLAUDE.md zero-tolerance). Resolvé el tipo correctamente — usá "
            "interfaces, generics, o `unknown` + type guard."
        )
    if PROD_PATH_RE.search(command) and CONSOLE_LOG_RE.search(command):
        block(
            "console.log prohibido en producción (CLAUDE.md 'Zero console.* en "
            "producción'). Usá `createLogger(name)` de `apps/api/src/lib/logger.ts` "
            "o `@observability/logger` según corresponda."
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
    gate_db_migrations_require_running_db(command)
    gate_no_patches_in_ts_writes(command)

    allow("command passed all gates")


if __name__ == "__main__":
    main()
