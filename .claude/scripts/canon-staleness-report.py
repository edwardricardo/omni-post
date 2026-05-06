#!/usr/bin/env python3
"""Canon staleness report — Batch 7.

Lista entries de canon-index.json con `synthesizedAt` mayor a 90 días o
`lastVerified` mayor a 180 días, agrupadas por área. Output markdown a
stdout (redirigible a archivo).

Uso:
    python3 .claude/scripts/canon-staleness-report.py [--out <path>]
    python3 .claude/scripts/canon-staleness-report.py --synth-days 90 --verify-days 180

Cadencia recomendada: trimestral. Edward revisa el output, decide qué
entries refrescar (re-research o re-validación), y actualiza el .md.
Re-correr migrate-canon-index.py regenera el .json.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


CANON_JSON = Path(
    "/home/edward/.claude/projects/-home-edward-projects-omni-post/memory/canon-index.json"
)


def parse_date(date_str: str) -> datetime | None:
    """Acepta ISO 8601 con tz o `YYYY-MM-DD` simple."""
    if not date_str:
        return None
    try:
        d = datetime.fromisoformat(date_str)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except ValueError:
        return None


def days_since(date_str: str) -> int | None:
    d = parse_date(date_str)
    if d is None:
        return None
    return (datetime.now(timezone.utc) - d).days


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--synth-days", type=int, default=90, help="threshold synthesizedAt")
    parser.add_argument("--verify-days", type=int, default=180, help="threshold lastVerified")
    parser.add_argument("--out", type=Path, default=None, help="archivo de salida (default stdout)")
    args = parser.parse_args()

    if not CANON_JSON.exists():
        print(f"ERROR: {CANON_JSON} no existe. Corre migrate-canon-index.py primero.", file=sys.stderr)
        sys.exit(1)

    with CANON_JSON.open("r", encoding="utf-8") as f:
        data = json.load(f)

    stale_synth: list[tuple[int, dict]] = []
    stale_verify: list[tuple[int, dict]] = []
    undated: list[dict] = []

    for entry in data.get("entries", {}).values():
        synth_age = days_since(entry.get("date") or "")  # date del .md = synth aproximado
        verify_age = days_since(entry.get("lastVerified") or "")

        if synth_age is None and verify_age is None:
            undated.append(entry)
            continue
        if synth_age is not None and synth_age > args.synth_days:
            stale_synth.append((synth_age, entry))
        if verify_age is not None and verify_age > args.verify_days:
            stale_verify.append((verify_age, entry))

    # Sort por edad descendente.
    stale_synth.sort(key=lambda t: -t[0])
    stale_verify.sort(key=lambda t: -t[0])

    lines: list[str] = []
    lines.append("# Canon Staleness Report")
    lines.append(f"_Generado: {datetime.now(timezone.utc).isoformat()}_")
    lines.append(f"_Source: {CANON_JSON}_")
    lines.append("")
    lines.append(f"**Thresholds**: synthesizedAt > {args.synth_days}d, lastVerified > {args.verify_days}d")
    lines.append("")
    lines.append(
        f"**Total entries**: {len(data.get('entries', {}))} | "
        f"**Stale synth**: {len(stale_synth)} | "
        f"**Stale verify**: {len(stale_verify)} | "
        f"**Undated**: {len(undated)}"
    )
    lines.append("")

    if stale_synth:
        lines.append(f"## Stale por `synthesizedAt` (> {args.synth_days} días)")
        lines.append("")
        lines.append("| Edad (d) | Topic | Área | URL principal |")
        lines.append("|----------|-------|------|---------------|")
        for age, entry in stale_synth:
            url = ""
            sources = entry.get("sources") or []
            if sources:
                url = sources[0].get("url", "")
            lines.append(f"| {age} | {entry.get('topic','')} | {entry.get('area','')} | {url} |")
        lines.append("")

    if stale_verify:
        lines.append(f"## Stale por `lastVerified` (> {args.verify_days} días)")
        lines.append("")
        lines.append("| Edad (d) | Topic | Área | URL principal |")
        lines.append("|----------|-------|------|---------------|")
        for age, entry in stale_verify:
            url = ""
            sources = entry.get("sources") or []
            if sources:
                url = sources[0].get("url", "")
            lines.append(f"| {age} | {entry.get('topic','')} | {entry.get('area','')} | {url} |")
        lines.append("")

    if undated:
        lines.append("## Sin fecha (revisar manualmente)")
        lines.append("")
        for entry in undated:
            lines.append(f"- {entry.get('topic','')} (área: {entry.get('area','')})")
        lines.append("")

    if not stale_synth and not stale_verify and not undated:
        lines.append("Todos los entries están dentro de los thresholds. Sin acción requerida.")

    output = "\n".join(lines) + "\n"

    if args.out:
        args.out.write_text(output, encoding="utf-8")
        print(f"Report escrito a {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(output)


if __name__ == "__main__":
    main()
