"""Helpers compartidos por todos los hooks Python de OmniPost.

Reusable building blocks: logger factory, JSON-stdin reader, git helpers,
y constantes regex compartidas. Cada hook importa lo que necesita.

Uso típico desde un hook:

    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _common import make_logger, read_hook_input, GIT_PUSH_RE

    log, block, allow = make_logger("pre-bash")

    def main():
        data = read_hook_input(log)
        ...
"""

import fcntl
import json
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, NoReturn


# Raíz del repo, resuelta desde la ubicación de ESTE archivo
# (.claude/hooks-py/_common.py -> .claude/ -> raíz), nunca desde el cwd del
# proceso. Claude Code dispara los hooks con el cwd de la sesión, que puede ser
# un subdirectorio: con rutas relativas al cwd, un token creado en la raíz era
# invisible desde apps/api ("missing") y cada hook sembraba un `.claude/`
# huérfano en el directorio donde le tocara correr.
PROJECT_ROOT = Path(__file__).resolve().parents[2]

LOG_PATH = PROJECT_ROOT / ".claude" / "hooks.log"

# Time-boxed authorization tokens created by `.claude/bin/omnipost-allow`.
# One token per operation (`push`, `sensitive-edit`, ...). Validated
# identically by pre-bash and pre-edit (shared contract, no drift).
ALLOWED_TOKENS_DIR = PROJECT_ROOT / ".claude" / ".allowed"


def _main_repository_root(root: Path) -> tuple[Path, bool]:
    """Raíz del worktree PRINCIPAL del repositorio que contiene `root`, y si git
    la resolvió.

    Claude Code nombra el directorio de auto memory a partir del repositorio
    git, no del worktree: "all worktrees and subdirectories within the same
    repo share one auto memory directory" (code.claude.com/docs/en/memory,
    Storage location). Desde un worktree enlazado `PROJECT_ROOT` es el
    worktree, pero su `--git-common-dir` es el `.git` del principal, y el padre
    de ese `.git` es la ruta con la que Claude Code arma el nombre. Sin git, o
    con un repo bare, cae a `root` y lo dice (False).
    """
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return root, False
    common_dir = Path(result.stdout.strip()).resolve()
    return (common_dir.parent, True) if common_dir.name == ".git" else (root, False)


def _write_log_line(tag: str, message: str) -> None:
    """La ÚNICA forma de una línea de hooks.log: `[iso-local] [tag] message`.

    make_logger la usa con el nombre del hook; _common, que no tiene nombre de
    hook, con `_common`. Un solo escritor: el formato no puede divergir.
    """
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"[{datetime.now().isoformat()}] [{tag}] {message}\n")


def _append_log(line: str) -> None:
    """Línea en hooks.log desde _common; un fallo de E/S no frena un hook."""
    try:
        _write_log_line("_common", line)
    except OSError:
        pass


# `memory_dir` memoriza SOLO una resolución exitosa, así un fallo transitorio
# de git no fija la ruta de respaldo; el aviso del respaldo sale una vez por
# proceso. Cada hook es un proceso nuevo y de un solo hilo: la memoria vale
# dentro de ese proceso y no necesita bloqueo. Los hooks que leen el índice la
# resuelven al USARLA (`canon_index_path()`), no al importar: un fallo
# transitorio en el import no deja al proceso mirando el respaldo, y un hook
# que termina sin leer el índice no paga el subproceso.
_MEMORY_DIR_CACHE: Path | None = None
_MEMORY_DIR_WARNED = False
MEMORY_DIR_FALLBACK_NOTE = "memory_dir: git no resolvió la raíz principal; ruta derivada de PROJECT_ROOT sin caché"


def _resolve_memory_dir() -> tuple[Path, bool]:
    """Auto memory del proyecto y si git resolvió la raíz principal.

    Es el contrato de nombres de Claude Code: `~/.claude/projects/<raíz con "/"
    -> "-">/memory` (`/root/omni-post` -> `-root-omni-post`), un directorio por
    repositorio compartido por sus worktrees; ahí viven canon-index.json y
    canon_research_index.md. Cuesta un `git rev-parse` (medido 0,8 ms). Las dos
    ramas parten de una ruta RESUELTA (sin symlinks): la de git lo está por
    `_main_repository_root`; la de respaldo se resuelve acá, así un
    PROJECT_ROOT alcanzado por symlink no inventa un segundo nombre.
    """
    root, resolved = _main_repository_root(PROJECT_ROOT)
    if not resolved:
        root = root.resolve()
    slug = str(root).replace("/", "-")
    return Path.home() / ".claude" / "projects" / slug / "memory", resolved


def memory_dir() -> Path:
    global _MEMORY_DIR_CACHE, _MEMORY_DIR_WARNED
    if _MEMORY_DIR_CACHE is not None:
        return _MEMORY_DIR_CACHE
    path, resolved = _resolve_memory_dir()
    if resolved:
        _MEMORY_DIR_CACHE = path
    elif not _MEMORY_DIR_WARNED:
        # El respaldo no se cachea, pero el aviso sí: una vez por proceso.
        _MEMORY_DIR_WARNED = True
        _append_log(f"{MEMORY_DIR_FALLBACK_NOTE} ({PROJECT_ROOT})")
    return path


def canon_index_path() -> Path:
    """Ruta de canon-index.json — el JSON que leen los hooks de edición —
    resuelta al usarla, no al importar (ver memory_dir)."""
    return memory_dir() / "canon-index.json"


def canon_research_index_path() -> Path:
    """Ruta de canon_research_index.md — el markdown que lee el hook de prompt,
    no el JSON de `canon_index_path` — resuelta al usarla, no al importar."""
    return memory_dir() / "canon_research_index.md"


# Regex compartida entre pre-bash y post-bash. Matchea 'git' y 'push' como
# tokens separados aunque haya flags intermedias (-C /path, --git-dir=...).
# El negative lookahead excluye `git stash push`/`git stash pop` (operaciones
# LOCALES del stash, no publicación remota) — sin él, "stash push" disparaba
# el gate de autorización como si fuera `git push`.
# Limitación: no detecta composición con && (cd /path && ...).
GIT_PUSH_RE = re.compile(r"\bgit\b(?!\s+stash\b)\s.*\bpush\b")


def make_logger(hook_name: str) -> tuple[Callable[[str], None], Callable[[str], None], Callable[[str], None]]:
    """Crea las 3 funciones (log, block, allow) atadas a un hook_name.

    log(msg) — append timestamped entry a hooks.log.
    block(reason) — print a stderr + log + exit 2 (CC interpreta como veto).
    allow(reason) — log + exit 0.
    """

    def log(message: str) -> None:
        _write_log_line(hook_name, message)

    def block(reason: str) -> None:
        print(f"BLOCKED [{hook_name}]: {reason}", file=sys.stderr)
        log(f"BLOCK: {reason}")
        sys.exit(2)

    def allow(reason: str = "ok") -> None:
        log(f"ALLOW: {reason}")
        sys.exit(0)

    return log, block, allow


def read_hook_input(log_fn: Callable[[str], None]) -> dict:
    """Parsea el JSON de stdin que CC pasa al hook. Si falla, exit 1."""
    raw = sys.stdin.read()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        log_fn(f"ERROR: JSON inválido: {e}")
        sys.exit(1)


def current_branch(repo: Path | None = None) -> str:
    """Branch checked out en `repo` (default PROJECT_ROOT), o '' si falla.

    `symbolic-ref --short HEAD` (no `rev-parse --abbrev-ref HEAD` ni `branch
    --show-current`, que exige git >= 2.22): lee también una rama recién creada
    sin commits, en HEAD suelto falla y devuelve '' (bloquea), y existe en todo
    git desde 1.7.
    Sin `cwd` explícito git leía el cwd del proceso del hook, que nunca es el
    repositorio al que apunta un `cd <worktree> && git commit`: el gate de
    commits validaba la branch del repo vivo, no la del commit. Un `repo`
    inexistente devuelve '' — el llamador decide (el gate de commits bloquea).
    """
    try:
        result = subprocess.run(
            ["git", "symbolic-ref", "--short", "HEAD"],
            cwd=repo or PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return ""


# `cd <ruta> &&`, `cd <ruta>;` o `cd <ruta>` + salto de línea al INICIO del
# comando. La ruta puede venir entre comillas simples o dobles. El salto de
# línea cuenta: medido, `cd X\ngit commit` sin él resolvía al cwd de la sesión
# y el gate validaba otro repo. Límites deliberados (solo el PRIMER cd, solo
# si abre el comando, sin `cd -` ni variables): ver el docstring de commit_repos.
_CD_PREFIX_RE = re.compile(r"""^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)[ \t]*(?:&&|;|\n)""")
# Opciones globales de git cuyo valor viaja en el token SIGUIENTE. Las de la
# forma `--opcion=valor` y los flags sin valor se saltan solos.
_GIT_VALUE_OPTIONS = frozenset(
    {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
     "--super-prefix", "--config-env", "--list-cmds", "--attr-source"}
)
# Las que mueven el árbol sobre el que actúa ESA invocación de git
# (`git -C a -C b commit` es `cd a; cd b; git commit`).
_GIT_TREE_OPTIONS = frozenset({"-C", "--work-tree"})
_SHELL_SEPARATORS = frozenset({"&&", "||", ";", "|"})
# Respaldo cuando shlex no puede tokenizar (comilla sin cerrar): la forma
# conservadora `git … commit` dentro de un mismo segmento de shell. Solo
# `commit` es recuperable así; un gate sobre otro subcomando no puede
# apoyarse en el respaldo.
_GIT_COMMIT_FALLBACK_RE = re.compile(r"\bgit\b[^|;&\n]*\bcommit\b")


def _unquote(token: str) -> str:
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "\"'":
        return token[1:-1]
    return token


def _shell_tokens(command: str) -> list[str]:
    """Tokens de shell con `&&`, `||`, `;` y `|` como tokens PROPIOS aunque vayan
    pegados (`git commit&&…`); dentro de comillas siguen siendo texto. Lanza
    ValueError con una comilla sin cerrar, como shlex.split."""
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    return list(lexer)


def shell_segments(command: str) -> list[list[str]] | None:
    """Los comandos de `command` como listas de tokens, cortados en `&&`, `||`,
    `;` y `|` (separadores pegados incluidos); None si no se puede tokenizar."""
    try:
        tokens = _shell_tokens(command)
    except ValueError:
        return None
    segments: list[list[str]] = [[]]
    for tok in tokens:
        if tok in _SHELL_SEPARATORS:
            segments.append([])
        else:
            segments[-1].append(tok)
    return [seg for seg in segments if seg]


def git_invocations(command: str) -> list[tuple[str, list[str]]]:
    """Cada invocación de git en `command`: (subcomando, árboles que ESA
    invocación recibió por `-C`/`--work-tree`, en orden).

    Tokeniza con shlex en vez de una regex de opciones: `git --work-tree /p
    commit` y `git -c "user.name=Foo Bar" commit` llevan el subcomando detrás
    de un valor que ninguna regex absorbía, y ese hueco saltaba el gate de
    branch y el de Co-Authored-By a la vez. Una cadena entre comillas es UN
    token: un `git commit` o un `git -C` dentro de ella no cuenta. Un
    separador pegado (`commit&&`) es un token aparte y no esconde el
    subcomando. Si shlex no puede tokenizar, cae a la regex conservadora:
    [("commit", [])] o nada.
    """
    try:
        tokens = _shell_tokens(command)
    except ValueError as e:
        _append_log(f"git_invocations: comando no tokenizable ({e}); respaldo solo-commit")
        return [("commit", [])] if _GIT_COMMIT_FALLBACK_RE.search(command) else []
    found: list[tuple[str, list[str]]] = []
    i = 0
    while i < len(tokens):
        if tokens[i] != "git" and not tokens[i].endswith("/git"):
            i += 1
            continue
        trees: list[str] = []
        j = i + 1
        while j < len(tokens):
            tok = tokens[j]
            if tok in _GIT_TREE_OPTIONS and j + 1 < len(tokens):
                trees.append(tokens[j + 1])
                j += 2
                continue
            if tok in _GIT_VALUE_OPTIONS:
                j += 2
                continue
            if tok.startswith("-"):
                j += 1
                continue
            if tok in _SHELL_SEPARATORS:
                break
            found.append((tok, trees))
            break
        i = max(j, i + 1)
    return found


def git_subcommands(command: str) -> set[str]:
    """Subcomandos de git invocados en `command` (`commit`, `fetch`, …); ver git_invocations."""
    return {subcommand for subcommand, _ in git_invocations(command)}


def commit_repos(command: str, fallback: Path) -> list[Path]:
    """Directorio sobre el que actúa CADA `git commit` de `command`.

    Un `cd <ruta>` inicial — con `&&`, `;` o salto de línea — cambia la base
    para todo el comando; los `-C`/`--work-tree` de ESA invocación se resuelven
    contra la base, en orden, como lo haría la shell. Los de OTRA invocación
    no cuentan: `git -C /otro status && git commit` commitea en `fallback`, el
    `cwd` que Claude Code pasa en el input del hook.

    Límites, dichos en voz alta: solo el PRIMER `cd`, y solo si abre el
    comando; `cd -`, variables o subshells no se expanden. Una ruta mal
    resuelta apunta a un directorio sin repo, y `current_branch` devuelve ''
    — falla cerrado, no abierto.
    """
    base = fallback
    cd_match = _CD_PREFIX_RE.match(command)
    if cd_match:
        base = fallback / Path(_unquote(cd_match.group(1))).expanduser()
    repos: list[Path] = []
    for subcommand, trees in git_invocations(command):
        if subcommand != "commit":
            continue
        repo = base
        for tree in trees:
            repo = repo / Path(tree).expanduser()
        repos.append(repo)
    return repos


NOTICES_LOG = PROJECT_ROOT / ".claude" / "context-notices.log"


def _notice_field(value: str) -> str:
    """Un campo del registro de avisos: la tabulación separa campos y el salto de
    línea separa registros, así que un tab, un salto de línea o una barra dentro
    del valor se escapan y no pueden partir el marcador ni el registro."""
    return value.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n")


def _notice_key(tag: str, name: str, state: str) -> str:
    """La clave de un aviso sobre un archivo: la escribe emit_missing_file_context
    y la lee recovered_file_notice; una sola forma, un solo lugar."""
    return f"{tag}:{name}:{state}"


def emit_additional_context(hook_event: str, body: str = "", prefix: tuple[str, ...] = ()) -> NoReturn:
    """Imprime UN `additionalContext` — las líneas de `prefix` primero (p. ej. el
    aviso RECOVERED), después `body` — y exit 0. Sin texto, exit 0 en silencio."""
    text = "\n\n".join([*prefix, body]).strip()
    if text:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": hook_event, "additionalContext": text}}))
    sys.exit(0)


def notice_seen(session_id: str, key: str) -> bool:
    """True si `key` ya se registró en `session_id` (solo lectura, sin registrar)."""
    if not session_id:
        return False
    marker = f"{_notice_field(session_id)}\t{_notice_field(key)}\t"
    try:
        return any(line.startswith(marker) for line in NOTICES_LOG.read_text(encoding="utf-8").splitlines())
    except OSError:
        return False


def notice_already_sent(session_id: str, key: str) -> bool:
    """True si `key` ya se avisó en `session_id`; si no, lo registra y devuelve False.

    Un aviso de archivo ausente llega al contexto UNA vez por sesión: el modelo
    lo conserva, y repetirlo en cada Edit (la guardia de decisiones corre en
    todas) sería ruido sin información nueva. Sin session_id no se deduplica.

    Lectura y registro bajo `flock`: los hooks PreToolUse de un mismo Edit
    corren en paralelo, y sin el lock los dos podían leer "no avisado" y avisar
    los dos. El archivo guarda solo la sesión actual — al registrar se
    descartan las líneas de otras sesiones — así nunca pasa de un puñado de
    líneas. Si no se puede leer o escribir (OSError) se avisa igual: mejor un
    aviso repetido que una ceguera callada; el fallo queda en hooks.log.
    """
    if not session_id:
        return False
    session_field = _notice_field(session_id)
    marker = f"{session_field}\t{_notice_field(key)}"
    try:
        NOTICES_LOG.parent.mkdir(parents=True, exist_ok=True)
        with NOTICES_LOG.open("a+", encoding="utf-8") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            handle.seek(0)
            lines = handle.read().splitlines()
            if any(line.startswith(marker + "\t") for line in lines):
                return True
            kept = [line for line in lines if line.startswith(session_field + "\t")]
            handle.seek(0)
            handle.truncate()
            handle.write("".join(f"{line}\n" for line in kept) + f"{marker}\t{datetime.now().isoformat()}\n")
    except OSError as e:
        _append_log(f"notice_already_sent: {NOTICES_LOG} no disponible ({e}); aviso emitido sin deduplicar")
        return False
    return False


def emit_missing_file_context(
    tag: str,
    name: str,
    path: Path,
    consequence: str,
    *,
    hook_event: str,
    state: str = "MISSING",
    session_id: str = "",
) -> NoReturn:
    """Emite UNA línea de `additionalContext` sobre un archivo ausente y exit 0.

    Existe porque un archivo de entrada faltante se registraba solo en
    hooks.log: el hook seguía "funcionando" sin datos y nadie lo veía. Así la
    ceguera llega al contexto del modelo, que es quien puede reportarla. Con
    `session_id`, la segunda vez en la misma sesión sale en silencio.
    """
    if notice_already_sent(session_id, _notice_key(tag, name, state)):
        sys.exit(0)
    emit_additional_context(hook_event, f"[{tag}] {name} {state} at {path} — {consequence}")


def recovered_file_notice(tag: str, name: str, path: Path, session_id: str = "") -> str | None:
    """`[tag] name RECOVERED at path` si ESTA sesión ya avisó MISSING o UNREADABLE
    de ese archivo y aún no avisó la recuperación; si no, None.

    El hook la antepone a lo que emita: el modelo que leyó "blind until …"
    se entera de que ya no lo está, en vez de cargar una ceguera vencida el
    resto de la sesión. Se registra como cualquier aviso: una vez por sesión.
    """
    failed = any(notice_seen(session_id, _notice_key(tag, name, state)) for state in ("MISSING", "UNREADABLE"))
    if not failed or notice_already_sent(session_id, _notice_key(tag, name, "RECOVERED")):
        return None
    return f"[{tag}] {name} RECOVERED at {path}"


def check_grant_token(operation: str, log_fn: Callable[[str], None]) -> str | None:
    """Validate the time-boxed token for `operation` in .claude/.allowed/<op>.

    Returns None when the token is valid (not expired). Returns the reason
    ("missing"|"corrupt"|"malformed"|"expired") otherwise, deleting the file
    when expired. Identical contract for `push` and `sensitive-edit`.
    """
    token_path = ALLOWED_TOKENS_DIR / operation
    if not token_path.exists():
        return "missing"
    try:
        with token_path.open("r") as f:
            token_data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log_fn(f"ERROR: token {operation} unreadable: {e}")
        return "corrupt"
    expires_at_str = token_data.get("expires_at")
    if not expires_at_str:
        log_fn(f"ERROR: token {operation} missing expires_at")
        return "malformed"
    try:
        expires_at = datetime.fromisoformat(expires_at_str)
    except ValueError as e:
        log_fn(f"ERROR: token {operation} invalid expires_at: {e}")
        return "malformed"
    if datetime.now(timezone.utc) >= expires_at:
        log_fn(f"token {operation} expired (was {expires_at_str})")
        try:
            token_path.unlink()
        except OSError:
            pass
        return "expired"
    log_fn(f"token {operation} valid (expires {expires_at_str})")
    return None
