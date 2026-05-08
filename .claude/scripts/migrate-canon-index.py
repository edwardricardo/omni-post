#!/usr/bin/env python3
"""Migrate canon_research_index.md → canon-index.json.

One-shot script idempotente. Source of truth queda el .md; .json es vista
derivada para hooks. Re-correr el script regenera el .json desde cero.

Schema target (ver plan Batch 5pre):
{
  "version": 1,
  "synthesizedAt": "...",
  "source": "canon_research_index.md",
  "entryCount": N,
  "entries": {
    "<key>": {
      "key": "...",
      "topic": "...",
      "area": "...",
      "summary": "...",
      "keyTakeaway": "...",
      "patternAdopted": "...",
      "usedIn": "...",
      "date": "...",
      "sources": [{"url": "...", "fetchedAt": "...", "title": "..."}],
      "synthesizedBy": "manual-migration-from-md",
      "confidence": "high",
      "lastVerified": "...",
      "version": 1,
      "appliesTo": ["apps/api/src/...", ...]
    }
  }
}
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


CANON_MD = Path(
    "/home/edward/.claude/projects/-home-edward-projects-omni-post/memory/canon_research_index.md"
)
CANON_JSON = Path(
    "/home/edward/.claude/projects/-home-edward-projects-omni-post/memory/canon-index.json"
)


# ── appliesTo heuristics ────────────────────────────────────────────
# Mapeo de keywords (lowercase) en el área a paths del repo. Edward puede
# curar manualmente después editando el .json o el .md y re-corriendo.
AREA_TO_PATHS = {
    "architecture": ["apps/api/src/", "packages/ports/", "packages/adapters/"],
    "hexagonal": ["apps/api/src/", "packages/ports/", "packages/adapters/"],
    "ports & adapters": ["packages/ports/", "packages/adapters/"],
    "caching": ["packages/observability/", "packages/adapters/cache-redis/"],
    "llm": ["apps/api/src/services/", "packages/providers/"],
    "ai-specific": ["apps/api/src/services/"],
    "testing": ["apps/api/tests/", "apps/admin/tests/", "apps/client/tests/"],
    "mutation": ["apps/api/tests/"],
    "logging": ["apps/api/src/lib/logger.ts", "packages/observability/"],
    "observability": ["packages/observability/"],
    "security": ["apps/api/src/auth/", "apps/api/src/encryption/"],
    "auth": ["apps/api/src/auth/"],
    "oauth": ["apps/api/src/auth/"],
    "fastify": ["apps/api/src/", "apps/api/src/routes/"],
    "next": ["apps/admin/", "apps/client/"],
    "next.js": ["apps/admin/", "apps/client/"],
    "react": ["apps/admin/components/", "apps/client/components/", "packages/ui/"],
    "prisma": ["infra/prisma/", "apps/api/src/infrastructure/repositories/"],
    "cqrs": ["apps/api/src/cqrs/"],
    "saga": ["apps/api/src/saga/"],
    "event": ["apps/api/src/events/"],
    "outbox": ["apps/api/src/events/outbox/"],
    "uow": ["apps/api/src/infrastructure/uow/", "apps/api/src/application/"],
    "unit-of-work": ["apps/api/src/infrastructure/uow/", "apps/api/src/application/"],
    "secret": ["apps/api/src/config/env.ts"],
    "env": ["apps/api/src/config/env.ts"],
    "validation": ["apps/api/src/validation/"],
    "ddd": ["apps/api/src/domain/", "apps/api/src/application/"],
    "domain": ["apps/api/src/domain/"],
    "result": ["packages/shared/", "apps/api/src/"],
    "error": ["apps/api/src/domain/errors/"],
    "circuit": ["packages/monitoring/"],
    "rate": ["apps/api/src/middleware/"],
    "queue": ["packages/adapters/queue-bullmq/"],
    "bullmq": ["packages/adapters/queue-bullmq/", "apps/workers/"],
    "background": ["packages/observability/background-scheduler/"],
    "scheduler": ["packages/observability/background-scheduler/"],
    "http": ["apps/api/src/", "packages/adapters/"],
    "provider": ["packages/providers/"],
    "social": ["packages/providers/"],
    "billing": ["apps/api/src/billing/"],
    "stripe": ["apps/api/src/billing/", "apps/api/src/settings/"],
    "ui": ["apps/admin/components/", "apps/client/components/", "packages/ui/"],
    "accessibility": ["apps/admin/", "apps/client/", "packages/ui/"],
    "a11y": ["apps/admin/", "apps/client/", "packages/ui/"],
    "i18n": ["apps/admin/lib/i18n/", "apps/client/lib/i18n/"],
    "telemetry": ["packages/observability/"],
    "tracing": ["packages/observability/"],
    "metrics": ["packages/observability/"],
    "redis": ["packages/adapters/cache-redis/"],
    "encryption": ["apps/api/src/encryption/"],
    "rbac": ["apps/api/src/auth/rbac/"],
    "permission": ["apps/api/src/auth/rbac/"],
    "tanstack": [
        "apps/admin/hooks/api/",
        "apps/admin/lib/api/",
        "apps/client/hooks/api/",
        "apps/client/lib/api/",
        "packages/query-client/",
    ],
    "data fetching": [
        "apps/admin/hooks/api/",
        "apps/admin/lib/api/",
        "apps/client/hooks/api/",
        "apps/client/lib/api/",
    ],
    "frontend": ["apps/admin/", "apps/client/", "packages/ui/"],
}


# ── Parser ──────────────────────────────────────────────────────────
def slugify(text: str) -> str:
    """Convert title to kebab-case key (ASCII-safe)."""
    text = re.sub(r"[—–·/]", "-", text)
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE).lower()
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def extract_fields(body: str) -> dict:
    """Extract `- **FieldName**: value` pairs from entry body.

    Handles multi-line values that continue until next field or blank line.
    """
    fields = {}
    pattern = re.compile(
        r"^-\s+\*\*([^*]+)\*\*:\s*(.*?)(?=\n-\s+\*\*|\n\n|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    for m in pattern.finditer(body):
        name = m.group(1).strip()
        value = m.group(2).strip()
        value = re.sub(r"\n\s+", " ", value)  # collapse line continuations
        fields[name] = value
    return fields


def guess_paths(area: str) -> list[str]:
    """Heuristic mapping from area name to repo paths."""
    area_lower = area.lower()
    paths = set()
    for keyword, candidate_paths in AREA_TO_PATHS.items():
        if keyword in area_lower:
            paths.update(candidate_paths)
    return sorted(paths)


def parse_applies_to(raw: str) -> list[str]:
    """Parse the optional `**Applies to**:` field into a list of paths.

    Accepts comma-separated paths, optionally wrapped in backticks. Empty
    tokens are dropped. Returns the input order preserved (no dedup beyond
    skipping blanks) so the canon author controls the path-specificity
    ranking that `pre_edit_canon.py` consumes.
    """
    paths: list[str] = []
    if not raw:
        return paths
    for token in raw.split(","):
        token = token.strip().strip("`")
        if token:
            paths.append(token)
    return paths


def parse_entry(title: str, body: str, area: str) -> dict:
    """Extract structured fields from an entry's body."""
    fields = extract_fields(body)

    # Acepta variantes del nombre del campo URL (singular, plural).
    urls_raw = fields.get("URL") or fields.get("URLs") or fields.get("Url") or ""
    urls = []
    if urls_raw:
        for u in re.split(r"\s+·\s+", urls_raw):
            u = u.strip()
            # Strip markdown auto-link wrappers <...>
            u = re.sub(r"^<(.+)>$", r"\1", u)
            if u:
                urls.append(u)

    date = (
        fields.get("Date")
        or fields.get("Date first cited")
        or fields.get("Date added")
        or ""
    )

    used_in = (
        fields.get("Used in")
        or fields.get("Used in (batch)")
        or fields.get("Used")
        or ""
    )

    sources = [
        {
            "url": url,
            "fetchedAt": date,
            "title": title,
        }
        for url in urls
    ]

    # Authored override of the area-keyword heuristic. When present, the
    # candidate author has declared the exact paths this canon applies to
    # (e.g. PR-51 entry maps to apps/<app>/hooks/api/, lib/api/queries/, etc.).
    # `pre_edit_canon.py` uses this list for path-substring matching to
    # decide whether to inject the canon for a given file edit, so leaving
    # it to the area-keyword heuristic alone produces silent gaps for any
    # area the heuristic doesn't cover.
    declared_paths = parse_applies_to(fields.get("Applies to", ""))
    applies_to = declared_paths if declared_paths else guess_paths(area)

    return {
        "key": slugify(title),
        "topic": title,
        "area": area,
        "summary": fields.get("Summary", ""),
        "keyTakeaway": fields.get("Key takeaway", ""),
        "patternAdopted": fields.get("Pattern adopted", ""),
        "usedIn": used_in,
        "date": date,
        "sources": sources,
        "synthesizedBy": "manual-migration-from-md",
        "confidence": "high",
        "lastVerified": date,
        "version": 1,
        "appliesTo": applies_to,
    }


def parse_canon(md_text: str) -> tuple[dict, list[str]]:
    """Parse canon .md into entries dict + list of warnings (unparseable sections)."""
    entries: dict[str, dict] = {}
    warnings: list[str] = []

    sections = re.split(r"^## (.+)$", md_text, flags=re.MULTILINE)
    for i in range(1, len(sections), 2):
        area_title = sections[i].strip()
        area_content = sections[i + 1] if i + 1 < len(sections) else ""

        subs = re.split(r"^### (.+)$", area_content, flags=re.MULTILINE)
        for j in range(1, len(subs), 2):
            entry_title = subs[j].strip()
            entry_body = subs[j + 1] if j + 1 < len(subs) else ""

            entry = parse_entry(entry_title, entry_body, area_title)
            key = entry["key"]
            if not key:
                warnings.append(f"empty key for entry '{entry_title}' in area '{area_title}'")
                continue
            if key in entries:
                # Collisión de slug: agregar sufijo numérico para no perder.
                suffix = 2
                while f"{key}-{suffix}" in entries:
                    suffix += 1
                warnings.append(
                    f"slug collision '{key}' (entry '{entry_title}' in '{area_title}'); "
                    f"renamed to '{key}-{suffix}'"
                )
                entry["key"] = f"{key}-{suffix}"
                entries[entry["key"]] = entry
            else:
                entries[key] = entry

    return entries, warnings


def main() -> None:
    if not CANON_MD.exists():
        print(f"ERROR: canon .md not found at {CANON_MD}", file=sys.stderr)
        sys.exit(1)

    md_text = CANON_MD.read_text(encoding="utf-8")
    entries, warnings = parse_canon(md_text)

    output = {
        "version": 1,
        "synthesizedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(CANON_MD),
        "entryCount": len(entries),
        "entries": entries,
    }

    CANON_JSON.write_text(
        json.dumps(output, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(entries)} entries to {CANON_JSON}")
    if warnings:
        print(f"\n{len(warnings)} warning(s):", file=sys.stderr)
        for w in warnings:
            print(f"  - {w}", file=sys.stderr)


if __name__ == "__main__":
    main()
