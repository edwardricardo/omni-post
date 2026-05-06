#!/usr/bin/env python3
"""Batch status report — Phase 1.1 del meta-plan.

Parsea `docs/audits/REMEDIATION_ROADMAP.md` y clasifica cada batch CERRADO en
uno de 5 buckets (architectural / refactor / mechanical / verification-only /
partial / unknown) para dar visibilidad real del progreso vs el % engañoso de
"batches cerrados".

Heurísticas:
- architectural   → notas mencionan ports/DI/integration tests + commits con
                    files en packages/ports/ o apps/api/tests/integration/
- refactor        → commits añaden archivos en apps/*/tests/unit/
- mechanical      → < 5 archivos modificados en commits del batch, sin tests
- verification-only → notas contienen "verificación", "no código",
                      "ya cerrado en", "PASS clean total, 0 cambios"
- partial         → notas contienen "Grupo A", "deferred to PR-", "diferido"
- unknown         → fallback

Cross-reference con git: `git log --grep=<batch-id> --all` para identificar
commits asociados y los archivos que tocaron.

Uso:
    python3 .claude/scripts/batch-status-report.py [--out path] [--tier T0,T1]
    python3 .claude/scripts/batch-status-report.py --raw   # JSON output
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROADMAP_MD = Path("docs/audits/REMEDIATION_ROADMAP.md")

# Heading: "#### T<n>-<letter[.digit]> — <title> [emojis] [✅ <date>] [(notes)]"
BATCH_HEADING_RE = re.compile(
    r"^####\s+(?P<id>T\d+-[A-Z](?:\.\d+)?)\s+—\s+(?P<rest>.+)$",
    re.MULTILINE,
)
CLOSED_DATE_RE = re.compile(r"✅\s+(?P<date>\d{4}-\d{2}-\d{2})")
TIER_RE = re.compile(r"^T(\d+)-")

# Bucketing keyword sets (case-insensitive substring matching).
KW_VERIFICATION = [
    "verificación-only",
    "verificación + documentación",
    "ya cerrado en",
    "ya resuelto en",
    "no código ejecutado",
    "pass clean total, 0 cambios",
    "revisitado: ya wireado",
]
KW_PARTIAL = [
    "grupo a",
    "deferred to pr-",
    "diferido a",
    "deferido a",
    "scope parcial",
    "ejecutado parcial",
]
KW_ARCHITECTURAL = [
    "/integration/",
    "packages/ports/",
    "port + di",
    "boundary fix",
    "hexagonal",
    "uow + ",
    "cqrs",
]


def run(args: list[str], default: str = "") -> str:
    try:
        r = subprocess.run(
            args, capture_output=True, text=True, timeout=10, check=False
        )
        return r.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return default


def find_commits_for_batch(batch_id: str) -> list[str]:
    """SHAs de commits cuyo mensaje menciona el batch_id como token completo.

    Usa --grep con regex y word-boundary para evitar false positives de
    substring matching (T1-F matcheando T1-FOO/T1-FX).
    """
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
    if not out:
        return []
    return [s for s in out.split("\n") if s]


def files_in_commits(shas: list[str]) -> list[str]:
    """Files tocados (path normalizado) en una lista de commits."""
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


def has_test_paths(files: list[str], pattern: str) -> bool:
    return any(pattern in f for f in files)


def classify(notes: str, files: list[str]) -> str:
    notes_lower = notes.lower()

    # Order matters — most specific first.
    if any(kw in notes_lower for kw in KW_VERIFICATION):
        return "verification-only"
    if any(kw in notes_lower for kw in KW_PARTIAL):
        return "partial"

    # Architectural via files OR notes
    if any(kw in notes_lower for kw in KW_ARCHITECTURAL):
        return "architectural"
    if has_test_paths(files, "apps/api/tests/integration/") or has_test_paths(
        files, "packages/ports/"
    ):
        return "architectural"

    # Refactor via test files
    if has_test_paths(files, "/tests/unit/") or any(".test." in f for f in files):
        return "refactor"

    # Mechanical: small change, no tests
    code_files = [
        f for f in files if not f.endswith((".md", ".yml", ".yaml", ".json"))
    ]
    if len(code_files) < 5 and not any(".test." in f for f in files):
        return "mechanical"

    return "unknown"


def parse_batch_section(md: str, start: int, next_start: int | None) -> dict:
    """Extrae body entre dos batch headings."""
    end = next_start if next_start is not None else len(md)
    body = md[start:end]
    return {"body": body}


def parse_roadmap(md_text: str) -> list[dict]:
    """Lista de batches con metadata + bucket."""
    batches: list[dict] = []
    matches = list(BATCH_HEADING_RE.finditer(md_text))
    for i, m in enumerate(matches):
        batch_id = m.group("id")
        rest = m.group("rest")
        next_start = matches[i + 1].start() if i + 1 < len(matches) else None
        section = parse_batch_section(md_text, m.end(), next_start)
        body = section["body"]

        closed_match = CLOSED_DATE_RE.search(rest)
        is_closed = closed_match is not None
        closed_date = closed_match.group("date") if closed_match else ""

        tier_match = TIER_RE.match(batch_id)
        tier = f"T{tier_match.group(1)}" if tier_match else "?"

        title = re.split(r"[✅⚡🔒🔗📋]", rest, maxsplit=1)[0].strip()

        # Para bucketing usamos el heading + el body completo como "notes"
        notes = rest + "\n" + body

        commits = find_commits_for_batch(batch_id) if is_closed else []
        files = files_in_commits(commits) if commits else []

        bucket = classify(notes, files) if is_closed else "open"

        batches.append(
            {
                "id": batch_id,
                "tier": tier,
                "title": title,
                "is_closed": is_closed,
                "closed_date": closed_date,
                "commits": commits,
                "file_count": len(files),
                "tests_added": any(".test." in f for f in files),
                "bucket": bucket,
            }
        )
    return batches


def render_markdown(batches: list[dict], filter_tiers: set[str] | None) -> str:
    if filter_tiers:
        batches = [b for b in batches if b["tier"] in filter_tiers]

    closed = [b for b in batches if b["is_closed"]]
    open_b = [b for b in batches if not b["is_closed"]]

    bucket_counts: dict[str, int] = {}
    for b in closed:
        bucket_counts[b["bucket"]] = bucket_counts.get(b["bucket"], 0) + 1

    lines: list[str] = []
    lines.append("# Batch Status Report")
    lines.append(f"_Generado: {datetime.now(timezone.utc).isoformat()}_")
    lines.append(f"_Source: {ROADMAP_MD}_")
    lines.append("")
    lines.append(
        f"**Total**: {len(batches)} | **Cerrados**: {len(closed)} | "
        f"**Abiertos**: {len(open_b)}"
    )
    lines.append("")

    lines.append("## Distribución por bucket (solo cerrados)")
    lines.append("")
    lines.append("| Bucket | Count | % |")
    lines.append("|--------|-------|---|")
    for bucket in [
        "architectural",
        "refactor",
        "mechanical",
        "verification-only",
        "partial",
        "unknown",
    ]:
        count = bucket_counts.get(bucket, 0)
        pct = (count / len(closed) * 100) if closed else 0
        lines.append(f"| {bucket} | {count} | {pct:.0f}% |")
    lines.append("")

    lines.append("## Detalle por batch")
    lines.append("")
    lines.append(
        "| Batch | Tier | Status | Closed | Bucket | Files | Tests |"
    )
    lines.append("|-------|------|--------|--------|--------|-------|-------|")
    for b in batches:
        status = "✅" if b["is_closed"] else "📋"
        tests = "✓" if b["tests_added"] else "—"
        lines.append(
            f"| {b['id']} | {b['tier']} | {status} | {b['closed_date'] or '—'} | "
            f"{b['bucket']} | {b['file_count']} | {tests} |"
        )
    lines.append("")

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, help="archivo de salida (default stdout)")
    parser.add_argument(
        "--tier",
        type=str,
        help="filtra tier(s) separados por coma. Ej: T0,T1,T4",
    )
    parser.add_argument(
        "--raw", action="store_true", help="output JSON crudo (no markdown)"
    )
    args = parser.parse_args()

    if not ROADMAP_MD.exists():
        print(f"ERROR: {ROADMAP_MD} no existe", file=sys.stderr)
        sys.exit(1)

    md_text = ROADMAP_MD.read_text(encoding="utf-8")
    batches = parse_roadmap(md_text)

    filter_tiers = set(args.tier.split(",")) if args.tier else None

    if args.raw:
        if filter_tiers:
            batches = [b for b in batches if b["tier"] in filter_tiers]
        output = json.dumps(batches, indent=2, ensure_ascii=False) + "\n"
    else:
        output = render_markdown(batches, filter_tiers)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output, encoding="utf-8")
        print(f"Report escrito a {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(output)


if __name__ == "__main__":
    main()
