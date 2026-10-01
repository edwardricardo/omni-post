#!/usr/bin/env python3
"""Pre-bash hook — bloquea comandos prohibidos antes de ejecutarse."""

import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    GIT_PUSH_RE,
    PROJECT_ROOT,
    check_grant_token,
    commit_repos,
    current_branch,
    git_subcommands,
    make_logger,
    read_hook_input,
    shell_segments,
)

# THE SAME list pre-edit gates on, imported rather than copied. A second copy of
# these patterns would drift the moment one file gained a path the other did not
# — and a sensitive-path list that disagrees with itself protects whichever half
# the writer did not go through.
from pre_edit import SENSITIVE_PATTERNS  # noqa: E402

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

# Qué cuenta como ESCRIBIR una ruta por Bash. Existe porque el gate de rutas
# sensibles vivía solo en pre-edit, que inspecciona `tool_input.file_path` — un
# campo que Bash no tiene. Un agente al que se le negó el `Edit` sobre
# `.github/workflows/fitness.yml` ya había escrito el archivo con `python3`
# por Bash: la compuerta no falló, es que ese camino nunca pasaba por ella.
#
# Dos clases. Las construcciones cuyo DESTINO se lee del comando (redirección,
# tee, cp/mv/rm/…, dd of=) bloquean solo si ese destino es la ruta sensible:
# `cat > /tmp/x <<EOF` con la ruta dentro del heredoc, `2>/dev/null` o
# `2>&1` NO son escrituras a esa ruta — medido: tres bloqueos falsos en un día
# enseñan a esquivar el gate, que es como los gates mueren. Las construcciones
# cuyo destino va en código o en argumentos que el texto no ordena (`sed -i`,
# `open('w')`, `git checkout`) bloquean por mención, como antes.
_WRITE_VERBS = frozenset({"tee", "cp", "mv", "install", "rsync", "ln", "rm", "rmdir", "unlink", "shred", "truncate", "dd"})
# De estos, el origen solo se lee: el destino es el ÚLTIMO operando.
_DESTINATION_LAST_VERBS = frozenset({"cp", "mv", "install", "rsync", "ln"})
_REDIRECTS = frozenset({">", ">>", "&>", "&>>"})
_NOT_A_FILE = frozenset({"/dev/null", "/dev/stdout", "/dev/stderr"})
_ENV_ASSIGNMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
COARSE_WRITE_RES = [
    re.compile(r"\b(?:sd|sed|perl|ruby)\b[^|;]*\s-i\b"),            # edición in-place
    re.compile(r"\bpython3?\b[^|;]*\bopen\s*\([^)]*['\"][wax]"),   # open(...,'w')
    re.compile(r"\bnode\b[^|;]*\bwrite(?:File|FileSync)\b"),        # fs.writeFile
    re.compile(r"\bgit\s+(?:checkout|restore|apply|revert|rm|clean)\b"),  # restauran o borran contenido
]
# Respaldo cuando el comando no se puede tokenizar (comilla sin cerrar): toda
# redirección o verbo de escritura cuenta, por mención.
_UNTOKENIZABLE_WRITE_RE = re.compile(r">>?|\b(?:" + "|".join(sorted(_WRITE_VERBS)) + r")\b")


def _mentions(pattern: str, text: str) -> bool:
    """`pattern` (con "/" inicial, como en pre-edit) nombrado en `text`.

    Se compara también sin esa barra, porque un comando suele citar rutas
    relativas — pero con FRONTERA: el `in` pelado hacía que `.env` matcheara
    DENTRO de `process.env`, que aparece en cantidades industriales de comandos
    legítimos de solo lectura. `process.env` no matchea (la `s` lo precede);
    `.env`, `cp .env`, `../.env` y `--env-file=.env` sí.
    """
    stripped = pattern.lstrip("/")
    return pattern in text or re.search(r"(?<![A-Za-z0-9_])" + re.escape(stripped), text) is not None


def write_targets(command: str) -> list[str] | None:
    """Rutas que las construcciones de escritura de `command` nombran como destino:
    redirecciones (salvo /dev/null y los `>&N`), el último operando de
    cp/mv/install/rsync/ln (el origen solo se lee), todos los operandos de
    tee/rm/rmdir/unlink/shred/truncate, y `dd of=`; None si no se puede
    tokenizar."""
    segments = shell_segments(command)
    if segments is None:
        return None
    targets: list[str] = []
    for segment in segments:
        words: list[str] = []
        i = 0
        while i < len(segment):
            tok = segment[i]
            if tok in _REDIRECTS and i + 1 < len(segment):
                target = segment[i + 1]
                if target not in _NOT_A_FILE and not target.startswith("&"):
                    targets.append(target)
                i += 2
            elif tok.startswith(("<", ">")):
                # entrada, heredoc o duplicado de descriptor: operador y operando no son argumentos
                i += 2
            else:
                words.append(tok)
                i += 1
        while words and (_ENV_ASSIGNMENT_RE.match(words[0]) or words[0] in ("sudo", "command", "nice")):
            words.pop(0)
        if not words or words[0] not in _WRITE_VERBS:
            continue
        verb, args = words[0], words[1:]
        if verb == "dd":
            targets.extend(arg[3:] for arg in args if arg.startswith("of="))
            continue
        if "--" in args:
            args = args[args.index("--") + 1:]
        operands = [arg for arg in args if not arg.startswith("-")]
        if verb in _DESTINATION_LAST_VERBS and len(operands) >= 2:
            operands = operands[-1:]
        targets.extend(operands)
    return targets


def gate_sensitive_path_writes_require_token(command: str) -> None:
    """Exigir el token `sensitive-edit` cuando Bash escribe una ruta sensible.

    Mismo contrato que pre-edit, misma lista de patrones (importada, no
    copiada): lo que Edit/Write no pueden tocar sin token, Bash tampoco.

    LEER SIGUE SIENDO LIBRE, y es deliberado: `bat schema.prisma`,
    `rg x migrations/` o un `prisma migrate diff` se usan constantemente y no
    mutan nada. Bloquear toda mención volvería inusable la inspección y
    empujaría a buscarle la vuelta, que es exactamente cómo mueren los gates.

    LÍMITE, dicho en voz alta: esto es un tripwire, no una caja de arena. Una
    shell puede ofuscar la ruta con variables, `eval`, base64 o un script en
    disco que arma la ruta por partes, y ninguna inspección del comando lo va a
    ver. Lo que cierra es el bypass ACCIDENTAL y el de conveniencia — sube el
    costo de evadir de "escribí python3 en vez de Edit" a "acto deliberado de
    ocultamiento". Ese salto es el punto; afirmar equivalencia total con
    pre-edit sería la clase de mentira que este repo persigue.
    """
    mentioned = [pattern for pattern in SENSITIVE_PATTERNS if _mentions(pattern, command)]
    if not mentioned:
        return
    targets = write_targets(command)
    coarse = any(rx.search(command) for rx in COARSE_WRITE_RES)
    if targets is None:
        coarse = coarse or _UNTOKENIZABLE_WRITE_RE.search(command) is not None
        targets = []
    matched_path = next(
        (pattern for pattern in mentioned if coarse or any(_mentions(pattern, target) for target in targets)),
        None,
    )
    if matched_path is None:
        log(f"sensitive path {mentioned[0]} mentioned, no write construct targets it — read-only, allowed")
        return

    status = check_grant_token("sensitive-edit", log)
    if status is None:
        log(f"sensitive Bash write to {matched_path} authorized via valid sensitive-edit token")
        return

    block(
        f"Bash escribe una ruta sensible ({matched_path}) sin token: {status}.\n"
        f"Es la MISMA compuerta que pre-edit aplica a Edit/Write — tenerla solo en "
        f"Edit dejaba que un `python3`, un `sd -i` o un `>` la rodearan sin que "
        f"nadie se enterara.\n"
        f"Pedí a Edward que ejecute 'omnipost-allow sensitive-edit' (TTL 15 min), "
        f"igual que para push. Si el comando solo LEE, reescribilo sin "
        f"construcciones de escritura sobre esa ruta."
    )

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
    if "commit" not in git_subcommands(command):
        return
    if re.search(r"co-authored-by:\s*claude", command, re.IGNORECASE):
        block("Trailer 'Co-Authored-By: Claude' prohibido. Removelo y reintentá.")


def gate_commit_only_in_allowed_branch(command: str, session_cwd: Path) -> None:
    """Bloquea `git commit` fuera de una branch `workstream/*`.

    La branch se lee en el repo AL QUE APUNTA cada commit (`cd <ruta> &&`, o
    el `-C`/`--work-tree` de ESA invocación; si no, el `cwd` de la sesión) —
    no en el cwd del proceso del hook, que es lo que leía antes y por eso
    nunca vio la branch de un `cd <worktree> && git commit`.

    `session_cwd` es el `cwd` del input del hook: el directorio donde la
    herramienta Bash ejecuta el comando, y contra el que un `cd` relativo se
    resuelve. Cada repo distinto se sondea UNA vez y la sonda queda en
    hooks.log, así una divergencia entre ese cwd y el real se ve.
    """
    for repo in dict.fromkeys(commit_repos(command, session_cwd)):
        branch = current_branch(repo)
        log(f"commit gate: {repo} -> branch '{branch}'")
        if not branch.startswith(ALLOWED_BRANCH_PREFIX):
            block(
                f"Branch '{branch}' en {repo} no acepta commits. "
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
    gate_sensitive_path_writes_require_token(command)
    gate_no_npm_or_yarn(command)
    gate_no_co_authored_in_commit(command)
    gate_commit_only_in_allowed_branch(command, Path(data.get("cwd") or PROJECT_ROOT))
    gate_db_migrations_require_running_db(command)
    gate_no_patches_in_ts_writes(command)

    allow("command passed all gates")


if __name__ == "__main__":
    main()
