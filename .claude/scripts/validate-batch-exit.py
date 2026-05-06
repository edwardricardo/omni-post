#!/usr/bin/env python3
"""Validate batch exit — Phase 4.2 del meta-plan.

CLI advisory que valida si un batch cumple su nivel de exit criteria
(L1 / L2 / L3 — definido en `REMEDIATION_ROADMAP.md` §10.6).

NO bloquea commits ni se wirea como hook. Edward lo corre manualmente
para validar batches al cerrarse, o retroactivamente para auditoría.

Uso:
    python3 .claude/scripts/validate-batch-exit.py T4-K
    python3 .claude/scripts/validate-batch-exit.py T1-A --verbose
    python3 .claude/scripts/validate-batch-exit.py T5-A --run-tests

Heurística:
1. Lee REMEDIATION_ROADMAP.md, encuentra la sección del batch.
2. Detecta override de nivel L# en notas (`L1`, `L2`, `L3` literal).
3. Si no hay override, infiere por tier:
     T0 → L3
     T1 → L1 (excepto T1-F → L2)
     T2 → L2 (excepto T2-G → L1)
     T3 → L2 (excepto T3-A → L3)
     T4 → L3 (excepto T4-P → L1)
     T5 → L3
     T6 → L3 (excepto T6-D, T6-I, T6-H → L2)
4. Busca commits del batch via `git log --grep=\\b<batch-id>\\b`.
5. Para cada nivel, valida:
     L1 → batch tiene exit criteria bash en la sección + count cerrado
     L2 → L1 + ≥1 archivo `*.test.ts` en commits del batch
     L3 → L2 + ≥1 file en `apps/api/tests/integration/` O `packages/ports/`
6. Si --run-tests, corre `pnpm --filter @apps/api test --run` sobre los
   test files detectados.
7. Reporta exit 0 si pasa, exit 1 con detalles si no. Como es advisory,
   exit 1 NO bloquea nada — es para que vos veas el output.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path


ROADMAP_MD = Path("docs/audits/REMEDIATION_ROADMAP.md")

BATCH_HEADING_RE = re.compile(
    r"^####\s+(?P<id>T\d+-[A-Z](?:\.\d+)?)\s+—.*$",
    re.MULTILINE,
)
LEVEL_OVERRIDE_RE = re.compile(r"\bL([123])\b")
TIER_RE = re.compile(r"^T(\d+)-")

# Overrides explícitos del roadmap §10.6.
TIER_DEFAULTS = {
    "T0": "L3",
    "T1": "L1",
    "T2": "L2",
    "T3": "L2",
    "T4": "L3",
    "T5": "L3",
    "T6": "L3",
}
BATCH_OVERRIDES = {
    "T1-F": "L2",
    "T2-G": "L1",
    "T3-A": "L3",
    "T4-P": "L1",
    "T6-D": "L2",
    "T6-I": "L2",
    "T6-H": "L2",
}


def run(args: list[str], default: str = "") -> str:
    try:
        r = subprocess.run(
            args, capture_output=True, text=True, timeout=10, check=False
        )
        return r.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return default


def find_batch_section(md: str, batch_id: str) -> tuple[str, str] | None:
    """Devuelve (heading, body) del batch o None si no se encuentra."""
    matches = list(BATCH_HEADING_RE.finditer(md))
    for i, m in enumerate(matches):
        if m.group("id") == batch_id:
            heading = m.group(0).strip()
            next_start = matches[i + 1].start() if i + 1 < len(matches) else len(md)
            body = md[m.end():next_start]
            return heading, body
    return None


def detect_level(batch_id: str, body: str) -> str:
    """Detecta nivel L# por override declarado en body, BATCH_OVERRIDES, o tier default."""
    # Override explícito en el body (más específico gana).
    body_match = LEVEL_OVERRIDE_RE.search(body)
    if body_match:
        return f"L{body_match.group(1)}"
    # Override por batch ID conocido.
    if batch_id in BATCH_OVERRIDES:
        return BATCH_OVERRIDES[batch_id]
    # Default por tier.
    tier_match = TIER_RE.match(batch_id)
    if tier_match:
        tier = f"T{tier_match.group(1)}"
        return TIER_DEFAULTS.get(tier, "L2")
    return "L2"


def is_closed(heading: str) -> bool:
    return "✅" in heading


def find_commits(batch_id: str) -> list[str]:
    out = run(
        [
            "git",
            "log",
            "--all",
            "--format=%H",
            f"--grep=\\b{re.escape(batch_id)}\\b",
            "--extended-regexp",
        ]
    )
    return [s for s in out.split("\n") if s] if out else []


def files_in_commits(shas: list[str]) -> list[str]:
    if not shas:
        return []
    files: set[str] = set()
    for sha in shas:
        out = run(["git", "show", "--name-only", "--format=", sha])
        for line in out.split("\n"):
            line = line.strip()
            if line:
                files.add(line)
    return sorted(files)


def has_unit_test(files: list[str]) -> list[str]:
    return [f for f in files if "/tests/unit/" in f or f.endswith(".test.ts") or f.endswith(".test.tsx")]


def has_integration_test(files: list[str]) -> list[str]:
    return [f for f in files if "/tests/integration/" in f]


def has_port_file(files: list[str]) -> list[str]:
    """Detecta nuevos ports — sea en packages/ports/ (cross-app) o en
    apps/*/src/domain/repositories/ (port-by-bounded-context)."""
    return [
        f
        for f in files
        if "packages/ports/" in f
        or "/domain/repositories/" in f
        or "/domain/ports/" in f
    ]


def has_exit_criteria_bash(body: str) -> bool:
    """Busca un bloque ```bash con los exit criteria del batch."""
    return "```bash" in body and ("→" in body or "wc -l" in body or "| wc" in body)


def validate_l1(body: str, files: list[str]) -> tuple[bool, list[str]]:
    notes = []
    if not has_exit_criteria_bash(body):
        notes.append("⚠️ falta bloque ```bash``` con exit criteria en la sección del batch")
        return False, notes
    notes.append("✓ exit criteria bash presente en la sección")
    return True, notes


def validate_l2(body: str, files: list[str]) -> tuple[bool, list[str]]:
    ok_l1, notes_l1 = validate_l1(body, files)
    notes = notes_l1
    unit_tests = has_unit_test(files)
    if not unit_tests:
        notes.append("⚠️ ningún archivo .test.* o /tests/unit/ encontrado en commits del batch")
        return False, notes
    notes.append(f"✓ {len(unit_tests)} test file(s) detectado(s):")
    for t in unit_tests[:5]:
        notes.append(f"    - {t}")
    if len(unit_tests) > 5:
        notes.append(f"    - ... y {len(unit_tests) - 5} más")
    return ok_l1 and bool(unit_tests), notes


def validate_l3(body: str, files: list[str]) -> tuple[bool, list[str]]:
    ok_l2, notes_l2 = validate_l2(body, files)
    notes = notes_l2
    integration_tests = has_integration_test(files)
    port_files = has_port_file(files)
    if not integration_tests and not port_files:
        notes.append(
            "⚠️ ni integration tests ni nuevos ports detectados — L3 requiere uno de los dos"
        )
        return False, notes
    if integration_tests:
        notes.append(f"✓ {len(integration_tests)} integration test(s):")
        for t in integration_tests[:3]:
            notes.append(f"    - {t}")
    if port_files:
        notes.append(f"✓ {len(port_files)} port file(s) (packages/ports/ o domain/repositories/):")
        for p in port_files[:3]:
            notes.append(f"    - {p}")
    return ok_l2, notes


def run_tests_for_files(files: list[str]) -> tuple[bool, str]:
    """Ejecuta `pnpm --filter @apps/api test --run` sobre patterns derivados."""
    test_files = [f for f in files if ".test." in f]
    if not test_files:
        return True, "(sin test files para correr)"
    patterns = [Path(f).stem for f in test_files]
    cmd = ["pnpm", "--filter", "@apps/api", "test", "--run"] + patterns
    print(f"Running: {' '.join(cmd)}", file=sys.stderr)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, check=False)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return False, f"ERROR ejecutando tests: {e}"
    output = (r.stdout + r.stderr)[-2000:]
    return r.returncode == 0, output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("batch_id", help="ID del batch (ej. T4-K, T0-A, T2-D.5)")
    parser.add_argument("--verbose", action="store_true", help="muestra commits + files detectados")
    parser.add_argument("--run-tests", action="store_true", help="ejecuta `pnpm test` sobre los tests detectados")
    args = parser.parse_args()

    if not ROADMAP_MD.exists():
        print(f"ERROR: {ROADMAP_MD} no existe", file=sys.stderr)
        sys.exit(1)

    md_text = ROADMAP_MD.read_text(encoding="utf-8")
    section = find_batch_section(md_text, args.batch_id)
    if not section:
        print(f"ERROR: batch {args.batch_id} no encontrado en {ROADMAP_MD}", file=sys.stderr)
        sys.exit(1)
    heading, body = section

    closed = is_closed(heading)
    level = detect_level(args.batch_id, body)
    commits = find_commits(args.batch_id)
    files = files_in_commits(commits)

    print(f"Batch: {args.batch_id}")
    print(f"Heading: {heading[:120]}")
    print(f"Status: {'✅ CLOSED' if closed else '📋 OPEN'}")
    print(f"Level requerido: {level}")
    print(f"Commits asociados: {len(commits)}")
    print(f"Files tocados: {len(files)}")
    if args.verbose:
        print("\nCommits:")
        for sha in commits[:10]:
            print(f"  - {sha}")
        print("\nFiles (primeros 20):")
        for f in files[:20]:
            print(f"  - {f}")
    print()

    if not closed:
        print(f"Batch abierto — validación de exit criteria no aplica.")
        sys.exit(0)

    if level == "L1":
        ok, notes = validate_l1(body, files)
    elif level == "L2":
        ok, notes = validate_l2(body, files)
    elif level == "L3":
        ok, notes = validate_l3(body, files)
    else:
        print(f"ERROR: nivel desconocido {level}", file=sys.stderr)
        sys.exit(1)

    print(f"--- {level} validation ---")
    for n in notes:
        print(n)
    print()

    if args.run_tests:
        print("--- Running detected tests ---")
        tests_ok, test_output = run_tests_for_files(files)
        print(test_output)
        ok = ok and tests_ok

    if ok:
        print(f"✅ {args.batch_id} cumple {level}")
        sys.exit(0)
    else:
        print(f"❌ {args.batch_id} NO cumple {level} — ver warnings arriba")
        sys.exit(1)


if __name__ == "__main__":
    main()
