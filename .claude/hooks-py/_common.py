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

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


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


# Auto memory del proyecto: ~/.claude/projects/<raíz con "/" -> "-">/memory
# (`/root/omni-post` -> `-root-omni-post`). Ahí viven canon-index.json y
# canon_research_index.md; la ruta antes estaba fija a /home/edward/..., que
# en esta máquina no existe. Dos funciones: `_resolve_memory_dir` calcula
# (un `git rev-parse`, medido 0,8 ms) y `memory_dir` memoriza SOLO la
# resolución exitosa, así un fallo transitorio de git no fija la ruta de
# respaldo. Cada hook es un proceso nuevo y de un solo hilo: la memoria vale
# dentro de ese proceso y no necesita bloqueo. Los hooks que leen el índice la
# resuelven al USARLA
# (`canon_index_path()`), no al importar: un fallo transitorio en el import
# no deja al proceso mirando el respaldo, y un hook que termina sin leer el
# índice no paga el subproceso.
_MEMORY_DIR_CACHE: Path | None = None
_MEMORY_DIR_WARNED = False


def _resolve_memory_dir() -> tuple[Path, bool]:
    """Ruta de la memoria y si git resolvió la raíz principal.

    Las dos ramas parten de una ruta RESUELTA (sin symlinks): la de git lo está
    por `_main_repository_root`; la de respaldo se resuelve acá, así un
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
        _append_log(f"memory_dir: git no resolvió la raíz principal; derivada de {PROJECT_ROOT} sin caché")
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
