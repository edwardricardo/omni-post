#!/usr/bin/env python3
"""Finalize an approved canon candidate into the canonical index.

Mechanical post-approval pipeline:

  1. Parse the candidate .md to extract the JSON block under
     "## Proposed canon-index.json entry".
  2. Validate required fields are present.
  3. Append a new subsection to canon_research_index.md (idempotent —
     refuses if the topic already exists).
  4. Regenerate canon-index.json via migrate-canon-index.py.
  5. Move the candidate file from its current location into
     `.claude/canon-candidates/approved/` (no-op if already there).

Usage:

    canon-finalize.py <candidate.md>                # apply
    canon-finalize.py <candidate.md> --dry-run      # preview (no writes)

Returns non-zero on any validation failure or write conflict.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
CANON_MD = Path(
    "/home/edward/.claude/projects/-home-edward-projects-omni-post/memory/canon_research_index.md"
)
CANON_JSON = Path(
    "/home/edward/.claude/projects/-home-edward-projects-omni-post/memory/canon-index.json"
)
APPROVED_DIR = REPO_ROOT / ".claude" / "canon-candidates" / "approved"
MIGRATE_SCRIPT = REPO_ROOT / ".claude" / "scripts" / "migrate-canon-index.py"

# The Stamps section is the conventional sentinel — new areas insert before it.
STAMPS_HEADER = "## Stamps & Conventions for new entries"

REQUIRED_FIELDS = (
    "key",
    "topic",
    "area",
    "summary",
    "keyTakeaway",
    "patternAdopted",
    "usedIn",
    "date",
    "sources",
)


class FinalizeError(Exception):
    """Raised on any validation or conflict failure during finalize."""


def slugify(text: str) -> str:
    """Mirror of `slugify` in migrate-canon-index.py.

    Kept in lockstep so we can predict the actual key that will end up in
    canon-index.json from the candidate's topic. Any change to the migrate
    script's slug rules MUST be reflected here.
    """
    text = re.sub(r"[—–·/]", "-", text)
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE).lower()
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def extract_proposed_entry(md_text: str) -> dict:
    """Extract the fenced JSON block under "## Proposed canon-index.json entry"."""
    section = re.search(
        r"^##\s+Proposed canon-index\.json entry\s*\n(.*?)(?=^##\s+|\Z)",
        md_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    if not section:
        raise FinalizeError(
            "No '## Proposed canon-index.json entry' section found in the candidate."
        )

    fenced = re.search(r"```json\s*\n(.*?)\n```", section.group(1), flags=re.DOTALL)
    if not fenced:
        raise FinalizeError(
            "No ```json fenced block under 'Proposed canon-index.json entry'."
        )

    try:
        return json.loads(fenced.group(1))
    except json.JSONDecodeError as e:
        raise FinalizeError(f"Proposed entry JSON is invalid: {e}") from e


def validate_entry(entry: dict) -> None:
    missing = [f for f in REQUIRED_FIELDS if not entry.get(f)]
    if missing:
        raise FinalizeError(f"Proposed entry is missing required fields: {missing}")

    sources = entry.get("sources") or []
    if not isinstance(sources, list) or not sources:
        raise FinalizeError("Proposed entry 'sources' must be a non-empty list.")
    for i, src in enumerate(sources):
        if not src.get("url"):
            raise FinalizeError(f"Source #{i + 1} is missing 'url'.")


def render_markdown_section(entry: dict) -> str:
    """Render the entry as a `### Topic` subsection in canon-index .md style."""
    urls = " · ".join(f"<{s['url']}>" for s in entry["sources"])
    lines = [
        f"### {entry['topic']}",
        "",
        f"- **URL**: {urls}",
        f"- **Used in**: {entry['usedIn']}",
        f"- **Date**: {entry['date']}",
        f"- **Summary**: {entry['summary']}",
        f"- **Key takeaway**: {entry['keyTakeaway']}",
        f"- **Pattern adopted**: {entry['patternAdopted']}",
    ]
    # Optional: emit `Applies to` when the candidate declares paths. Persisting
    # them into the .md guarantees migrate-canon-index.py's heuristic doesn't
    # silently override the author's intent (the heuristic only covers areas
    # whose name contains specific keywords like "redis", "rbac", etc.).
    applies_to = entry.get("appliesTo") or []
    if applies_to:
        joined = ", ".join(f"`{p}`" for p in applies_to)
        lines.append(f"- **Applies to**: {joined}")
    lines.append("")
    return "\n".join(lines)


def find_area_block(md_text: str, area: str) -> tuple[int, int] | None:
    """Return (start, end) byte offsets of the `## <area>` block, or None.

    `start` points at the `## ...` header line. `end` points at the start of
    the next `## ` header (or the document end). Trailing horizontal-rule
    `---` separators are excluded from `end` so insertions land cleanly above
    them.
    """
    pattern = re.compile(
        r"(^##\s+" + re.escape(area) + r"\s*$)",
        flags=re.MULTILINE,
    )
    m = pattern.search(md_text)
    if not m:
        return None

    start = m.start()
    next_header = re.search(r"^##\s+", md_text[m.end():], flags=re.MULTILINE)
    end = m.end() + next_header.start() if next_header else len(md_text)

    # Trim trailing whitespace + an optional `---` separator so the new
    # subsection lands above it.
    block = md_text[start:end]
    trim_match = re.search(r"\n+(---\s*\n+)?\s*$", block)
    if trim_match:
        end = start + trim_match.start()
    return start, end


def topic_already_present(md_text: str, topic: str) -> bool:
    return bool(
        re.search(
            r"^###\s+" + re.escape(topic) + r"\s*$",
            md_text,
            flags=re.MULTILINE,
        )
    )


def append_to_canon_md(entry: dict, *, dry_run: bool) -> str:
    """Insert the rendered subsection into canon_research_index.md.

    Returns a one-line description of what was done (or would be done).
    """
    md_text = CANON_MD.read_text(encoding="utf-8")

    if topic_already_present(md_text, entry["topic"]):
        raise FinalizeError(
            f"Topic '{entry['topic']}' already present in canon_research_index.md "
            "(refusing to double-write)."
        )

    section = render_markdown_section(entry)
    area = entry["area"]
    block = find_area_block(md_text, area)

    if block is not None:
        # Append subsection at the end of the existing area block.
        start, end = block
        new_text = (
            md_text[:end].rstrip() + "\n\n" + section + "\n" + md_text[end:].lstrip("\n")
        )
        action = f"appended subsection to existing area '{area}'"
    else:
        # Create a new `## <area>` section, inserted before the Stamps section.
        new_section = f"## {area}\n\n{section}\n---\n\n"
        stamps_idx = md_text.find(STAMPS_HEADER)
        if stamps_idx == -1:
            new_text = md_text.rstrip() + "\n\n" + new_section
        else:
            new_text = (
                md_text[:stamps_idx].rstrip()
                + "\n\n"
                + new_section
                + md_text[stamps_idx:]
            )
        action = f"created new area '{area}'"

    if dry_run:
        return f"[dry-run] would have {action}"

    CANON_MD.write_text(new_text, encoding="utf-8")
    return action


def regenerate_json(*, dry_run: bool) -> str:
    if dry_run:
        return "[dry-run] would regenerate canon-index.json"

    if not MIGRATE_SCRIPT.exists():
        raise FinalizeError(f"migrate script not found: {MIGRATE_SCRIPT}")

    proc = subprocess.run(
        ["python3", str(MIGRATE_SCRIPT)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise FinalizeError(
            "migrate-canon-index.py failed:\n"
            f"stdout: {proc.stdout}\nstderr: {proc.stderr}"
        )
    return proc.stdout.strip() or "regenerated canon-index.json"


def move_to_approved(candidate: Path, *, dry_run: bool) -> str:
    target = APPROVED_DIR / candidate.name
    if candidate.resolve() == target.resolve():
        return f"already at {target.relative_to(REPO_ROOT)}"
    if target.exists():
        raise FinalizeError(f"target already exists: {target}")

    if dry_run:
        return f"[dry-run] would move to {target.relative_to(REPO_ROOT)}"

    APPROVED_DIR.mkdir(parents=True, exist_ok=True)
    shutil.move(str(candidate), str(target))
    return f"moved to {target.relative_to(REPO_ROOT)}"


def count_entries() -> int | None:
    if not CANON_JSON.exists():
        return None
    try:
        return json.loads(CANON_JSON.read_text(encoding="utf-8")).get("entryCount")
    except (json.JSONDecodeError, OSError):
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("candidate", type=Path, help="Path to the candidate .md file")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen without writing anything.",
    )
    args = parser.parse_args()

    candidate: Path = args.candidate
    if not candidate.exists():
        print(f"ERROR: candidate not found: {candidate}", file=sys.stderr)
        return 1
    if candidate.suffix != ".md":
        print(f"ERROR: expected .md file, got: {candidate}", file=sys.stderr)
        return 1

    try:
        md_text = candidate.read_text(encoding="utf-8")
        entry = extract_proposed_entry(md_text)
        validate_entry(entry)

        actual_key = slugify(entry["topic"])
        key_drift = entry["key"] != actual_key

        before = count_entries()
        action_md = append_to_canon_md(entry, dry_run=args.dry_run)
        action_json = regenerate_json(dry_run=args.dry_run)
        action_mv = move_to_approved(candidate, dry_run=args.dry_run)
        after = count_entries()
    except FinalizeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    print(f"candidate:   {candidate.name}")
    print(f"area:        {entry['area']}")
    print(f"topic:       {entry['topic']}")
    print(f"actual key:  {actual_key}  (use this in code comments)")
    if key_drift:
        print(
            f"  warning: declared 'key': '{entry['key']}' "
            "differs from the slug computed by migrate-canon-index.py — "
            "the migrate script always wins. Update the candidate's declared "
            "key to match if it matters elsewhere."
        )
    print(f"  - {action_md}")
    print(f"  - {action_json}")
    print(f"  - {action_mv}")
    if before is not None and after is not None and not args.dry_run:
        print(f"entryCount:  {before} → {after}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
