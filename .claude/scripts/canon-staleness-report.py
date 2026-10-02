#!/usr/bin/env python3
"""Canon staleness report.

Lists the canon-index.json entries whose `date` is older than 90 days or whose
`lastVerified` is older than 180 days. Markdown output to stdout (or to a file
with --out).

Usage:
    python3 .claude/scripts/canon-staleness-report.py [--out <path>]
    python3 .claude/scripts/canon-staleness-report.py --synth-days 90 --verify-days 180

Recommended cadence: quarterly. Edward reviews the output, decides which
entries to refresh (new research or re-validation), and updates the .md.
Running migrate-canon-index.py again regenerates the .json.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# The index path comes from the same resolver the hooks use: the repository's
# auto-memory directory, never a machine-specific literal path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "hooks-py"))
from _common import canon_index_path  # noqa: E402

CANON_JSON = canon_index_path()


def parse_date(date_str: str) -> datetime | None:
    """Accepts ISO 8601 with a zone, or a plain `YYYY-MM-DD`."""
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
    parser.add_argument("--synth-days", type=int, default=90, help="maximum age in days of an entry's date (default 90)")
    parser.add_argument("--verify-days", type=int, default=180, help="maximum age in days of lastVerified (default 180)")
    parser.add_argument("--out", type=Path, default=None, help="output file (default stdout)")
    args = parser.parse_args()

    if not CANON_JSON.exists():
        print(f"ERROR: {CANON_JSON} does not exist. Run migrate-canon-index.py first.", file=sys.stderr)
        sys.exit(1)

    with CANON_JSON.open("r", encoding="utf-8") as f:
        data = json.load(f)

    stale_synth: list[tuple[int, dict]] = []
    stale_verify: list[tuple[int, dict]] = []
    undated: list[dict] = []

    for entry in data.get("entries", {}).values():
        synth_age = days_since(entry.get("date") or "")  # the .md date approximates the synthesis
        verify_age = days_since(entry.get("lastVerified") or "")

        if synth_age is None and verify_age is None:
            undated.append(entry)
            continue
        if synth_age is not None and synth_age > args.synth_days:
            stale_synth.append((synth_age, entry))
        if verify_age is not None and verify_age > args.verify_days:
            stale_verify.append((verify_age, entry))

    # Oldest first.
    stale_synth.sort(key=lambda t: -t[0])
    stale_verify.sort(key=lambda t: -t[0])

    lines: list[str] = []
    lines.append("# Canon Staleness Report")
    lines.append(f"_Generated: {datetime.now(timezone.utc).isoformat()}_")
    lines.append(f"_Source: {CANON_JSON}_")
    lines.append("")
    lines.append(f"**Thresholds**: date > {args.synth_days}d, lastVerified > {args.verify_days}d")
    lines.append("")
    lines.append(
        f"**Total entries**: {len(data.get('entries', {}))} | "
        f"**Stale synth**: {len(stale_synth)} | "
        f"**Stale verify**: {len(stale_verify)} | "
        f"**Undated**: {len(undated)}"
    )
    lines.append("")

    if stale_synth:
        lines.append(f"## Entries stale by `date` (> {args.synth_days} days)")
        lines.append("")
        lines.append("| Age (d) | Topic | Area | Main URL |")
        lines.append("|---------|-------|------|----------|")
        for age, entry in stale_synth:
            url = ""
            sources = entry.get("sources") or []
            if sources:
                url = sources[0].get("url", "")
            lines.append(f"| {age} | {entry.get('topic','')} | {entry.get('area','')} | {url} |")
        lines.append("")

    if stale_verify:
        lines.append(f"## Entries stale by `lastVerified` (> {args.verify_days} days)")
        lines.append("")
        lines.append("| Age (d) | Topic | Area | Main URL |")
        lines.append("|---------|-------|------|----------|")
        for age, entry in stale_verify:
            url = ""
            sources = entry.get("sources") or []
            if sources:
                url = sources[0].get("url", "")
            lines.append(f"| {age} | {entry.get('topic','')} | {entry.get('area','')} | {url} |")
        lines.append("")

    if undated:
        lines.append("## Undated (review by hand)")
        lines.append("")
        for entry in undated:
            lines.append(f"- {entry.get('topic','')} (area: {entry.get('area','')})")
        lines.append("")

    if not stale_synth and not stale_verify and not undated:
        lines.append("Every entry is within the thresholds. No action required.")

    output = "\n".join(lines) + "\n"

    if args.out:
        args.out.write_text(output, encoding="utf-8")
        print(f"Report written to {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(output)


if __name__ == "__main__":
    main()
