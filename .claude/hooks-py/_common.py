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
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().isoformat()
        with LOG_PATH.open("a") as f:
            f.write(f"[{timestamp}] [{hook_name}] {message}\n")

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
