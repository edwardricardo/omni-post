#!/usr/bin/env python3
"""Stop hook — auditoría de cierre de turno (Batch 6).

Antes de que CC cierre el turno, audita invariantes que el modelo olvida:
  1. Archivos .ts/.tsx nuevos en apps/api/src/ sin test correspondiente.
  2. Archivos nuevos en apps/ o packages/ sin @file y @layer headers.

Si encuentra issues, bloquea via stdout JSON {"decision":"block","reason":...}
para que CC inyecte la razón al modelo y le permita corregir antes de cerrar.

Anti-loop crítico: si stop_hook_active=true en el input, salimos limpios sin
re-bloquear (CC ya está re-stop después de un block previo).

Kill-switch global: EDWARD_DISABLE_STOP_HOOK=yes desactiva el hook por completo.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import make_logger, read_hook_input  # noqa: E402

HOOK_NAME = "stop"
log, _block, _allow = make_logger(HOOK_NAME)

KILL_SWITCH_ENV = "EDWARD_DISABLE_STOP_HOOK"


def get_new_files(extensions: list[str] | None = None) -> list[str]:
    """Untracked files (git ls-files --others --exclude-standard)."""
    try:
        out = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []
    files = [f for f in out.stdout.strip().split("\n") if f]
    if extensions:
        files = [f for f in files if any(f.endswith(e) for e in extensions)]
    return files


def guess_test_path(src_path: str) -> str:
    """apps/api/src/services/foo.ts → apps/api/tests/unit/services/foo.test.ts"""
    if not src_path.startswith("apps/api/src/"):
        return ""
    rel = src_path[len("apps/api/src/"):]
    p = Path(rel)
    base = p.stem
    parent = str(p.parent) if str(p.parent) != "." else ""
    test_dir = f"apps/api/tests/unit/{parent}".rstrip("/")
    return f"{test_dir}/{base}.test.ts"


def audit_missing_tests() -> list[str]:
    """Nuevos .ts/.tsx en apps/api/src/ deben tener test correspondiente."""
    issues = []
    for f in get_new_files([".ts", ".tsx"]):
        if not f.startswith("apps/api/src/"):
            continue
        if "/tests/" in f or f.endswith(".test.ts") or f.endswith(".test.tsx"):
            continue
        # Skip module-level files que típicamente no tienen test propio.
        base = Path(f).name
        if base in ("index.ts", "index.tsx", "types.ts"):
            continue
        test_path = guess_test_path(f)
        if test_path and not Path(test_path).exists():
            issues.append(
                f"Falta test para `{f}` — esperado en `{test_path}` "
                f"(CLAUDE.md: 'Tests are never deferred to a later sprint')"
            )
    return issues


def audit_missing_headers() -> list[str]:
    """Nuevos .ts/.tsx en apps/ o packages/ deben tener @file y @layer."""
    issues = []
    for f in get_new_files([".ts", ".tsx"]):
        if not (f.startswith("apps/") or f.startswith("packages/")):
            continue
        try:
            with open(f, encoding="utf-8") as fh:
                # 4096, not 1500: a file with a thorough doc header pushed
                # @layer past the old window and this hook reported the header
                # as MISSING while it was there (trustedProxy.ts, 2026-09-05) —
                # a false positive from a gate about honesty is the worst kind.
                # Still bounded on purpose: the header canon puts @file/@layer
                # at the TOP of the file, so a header past 4KB is its own
                # violation worth flagging, and an unbounded read would make
                # the hook's cost scale with file size.
                head = fh.read(4096)
        except OSError:
            continue
        missing = []
        if "@file" not in head:
            missing.append("@file")
        if "@layer" not in head:
            missing.append("@layer")
        if missing:
            issues.append(
                f"`{f}` falta {', '.join(missing)} en JSDoc header "
                f"(CLAUDE.md: 'Every file gets a JSDoc header — no exceptions')"
            )
    return issues


def main() -> None:
    data = read_hook_input(log)

    # Anti-loop: si CC ya está en un re-stop tras block previo, no re-bloqueamos.
    if data.get("stop_hook_active"):
        log("stop_hook_active=true, allow sin re-check")
        sys.exit(0)

    # Kill-switch global.
    if os.environ.get(KILL_SWITCH_ENV) == "yes":
        log(f"disabled via {KILL_SWITCH_ENV}=yes")
        sys.exit(0)

    log("running audits")

    issues: list[str] = []
    issues.extend(audit_missing_tests())
    issues.extend(audit_missing_headers())

    if not issues:
        log("ALLOW: all audits passed (0 issues)")
        sys.exit(0)

    reason_lines = [
        "Cierre bloqueado — pendientes para no diferir trabajo:",
        "",
    ]
    for i in issues:
        reason_lines.append(f"- {i}")
    reason_lines.extend(
        [
            "",
            f"Resolvé estos puntos antes de cerrar el turno, o seteá "
            f"{KILL_SWITCH_ENV}=yes en tu shell para saltear este hook puntualmente.",
        ]
    )
    reason = "\n".join(reason_lines)

    output = {"decision": "block", "reason": reason}
    print(json.dumps(output))
    log(f"BLOCK: {len(issues)} issue(s)")
    sys.exit(0)


if __name__ == "__main__":
    main()
