#!/usr/bin/env python3
"""Post-edit hook — corre secretlint sobre el archivo recién tocado.

Defensa en profundidad sobre Ring 2 (lint-staged). Atrapa pegas accidentales
de credenciales/keys/tokens en cuanto el archivo se guarda en disco, sin
esperar a `git add`. Single-file scope para mantener latencia <1s.

Por contrato CC, PostToolUse solo dispara en éxito de la operación; los
fallos van a PostToolUseFailure (evento aparte). No chequeamos si el Edit
funcionó — si este hook corre, el archivo se escribió.
"""

import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import PROJECT_ROOT, make_logger, read_hook_input  # noqa: E402

HOOK_NAME = "post-edit"
log, block, _allow = make_logger(HOOK_NAME)

# Mismos exclusions que .secretlintignore para evitar costo redundante.
SKIP_SUBSTRINGS = (
    "node_modules/",
    "/dist/",
    "/.next/",
    "/coverage/",
    "/reports/",
    "/.test.",
    ".test.ts",
    ".test.tsx",
    "pnpm-lock.yaml",
)

SECRETLINT_TIMEOUT_SEC = 10

# secretlint treats its file argument as a glob. Next.js route filenames contain
# glob metacharacters — dynamic `[id]`, catch-all `[...path]`, route groups
# `(group)` — which a glob parser reads as character classes / extglob, so the
# literal file is never matched ("Not found target files") and the scan silently
# never runs. Escaping these makes secretlint scan the actual file.
_GLOB_MAGIC = re.compile(r"([\[\]()?*!{}@+])")


def escape_glob(path: str) -> str:
    """Backslash-escape glob metacharacters so a literal path matches itself."""
    return _GLOB_MAGIC.sub(r"\\\1", path)


def should_skip(file_path: str) -> bool:
    if not file_path:
        return True
    if not Path(file_path).exists():
        return True
    for substr in SKIP_SUBSTRINGS:
        if substr in file_path:
            return True
    return False


def main() -> None:
    data = read_hook_input(log)

    tool_name = data.get("tool_name", "")
    file_path = data.get("tool_input", {}).get("file_path", "")

    log(f"invoked: tool={tool_name}, path={file_path}")

    if tool_name not in ("Edit", "Write", "MultiEdit"):
        sys.exit(0)

    if should_skip(file_path):
        sys.exit(0)

    try:
        result = subprocess.run(
            [
                "pnpm",
                "exec",
                "secretlint",
                "--secretlintrc",
                ".secretlintrc.json",
                "--secretlintignore",
                ".secretlintignore",
                "--format",
                "compact",
                escape_glob(file_path),
            ],
            capture_output=True,
            text=True,
            timeout=SECRETLINT_TIMEOUT_SEC,
            # Desde la raíz del repo, siempre: el parche @secretlint/node fija
            # node_moduleDir a "<cwd>/node_modules" y el preset de reglas vive
            # solo en el node_modules de la raíz; desde apps/* (sin @secretlint
            # local) el loader no encuentra el preset y aborta con un falso
            # positivo. Es como ya lo invocan lint-staged y el script secret:scan.
            cwd=str(PROJECT_ROOT),
        )
    except subprocess.TimeoutExpired:
        log(f"secretlint timeout en {file_path} ({SECRETLINT_TIMEOUT_SEC}s) — allow")
        sys.exit(0)
    except FileNotFoundError:
        log("pnpm/secretlint no encontrado en PATH — allow")
        sys.exit(0)

    if result.returncode != 0:
        report = (result.stdout + result.stderr).strip() or "<sin output>"
        block(
            f"secretlint detectó posible leak en {file_path}:\n{report}\n\n"
            "Revisá el archivo y remové el secret antes de continuar. "
            "Si es un falso positivo, ajustá .secretlintignore o .secretlintrc.json."
        )

    log(f"secretlint OK en {file_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
