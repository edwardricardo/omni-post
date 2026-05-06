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
from datetime import datetime
from pathlib import Path
from typing import Callable


LOG_PATH = Path(".claude/hooks.log")

# Regex compartida entre pre-bash y post-bash. Matchea 'git' y 'push' como
# tokens separados aunque haya flags intermedias (-C /path, --git-dir=...).
# Limitación: no detecta composición con && (cd /path && ...).
GIT_PUSH_RE = re.compile(r"\bgit\b\s.*\bpush\b")


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


def current_branch() -> str:
    """Devuelve el nombre de la branch actual, o '' si falla."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return ""
