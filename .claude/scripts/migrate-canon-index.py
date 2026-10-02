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

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# The index paths come from the same resolver the hooks use: the repository's
# auto-memory directory, never a machine-specific literal path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "hooks-py"))
from _common import (  # noqa: E402
    PROJECT_ROOT,
    canon_index_path,
    canon_research_index_path,
    dead_applies_to_patterns,
)


# ── appliesTo heuristics ────────────────────────────────────────────
# Maps keywords (lowercase) found in the area title to repository paths. Every
# path must exist in the tree: the generator fails when one does not (see
# find_offenders), so a moved directory breaks the generation instead of
# leaving silent entries. The domain and application layers live in
# packages/core since apps/api/src/{domain,application} were deleted
# (6ef962c5, fe710c48).
CORE_LAYERS = ["packages/core/domain/", "packages/core/application/"]
UNIT_OF_WORK_PATHS = [
    "apps/api/src/infrastructure/unitofwork/",
    "packages/adapters/db-prisma/src/unitofwork/",
    "packages/core/application/",
]
SECURITY_CRYPTO_PATHS = ["apps/api/src/security/"]
CI_PATHS = [".github/workflows/"]
I18N_PATHS = ["apps/admin/i18n/", "apps/client/i18n/", "packages/i18n/"]
AREA_TO_PATHS = {
    "architecture": ["apps/api/src/", "packages/ports/", "packages/adapters/", *CORE_LAYERS],
    "hexagonal": ["apps/api/src/", "packages/ports/", "packages/adapters/", *CORE_LAYERS],
    "ports & adapters": ["packages/ports/", "packages/adapters/"],
    "caching": ["packages/observability/", "packages/adapters/cache-redis/", "packages/ports/src/CachePort.ts"],
    "llm": ["apps/api/src/services/", "packages/providers/"],
    "ai-specific": ["apps/api/src/services/"],
    "ai": ["apps/api/src/ai/", "packages/core/ai/", "packages/ports/src/AgentOrchestrationPort.ts"],
    # The realtime metrics delta buffer (keyed state on top of CachePort).
    "stream processing": ["apps/api/src/analytics/realtimeAnalytics.ts", "packages/ports/src/CachePort.ts"],
    # The async/promise entries settle CachePort's async-only API.
    "promise": ["packages/ports/src/CachePort.ts", "packages/adapters/cache-redis/"],
    "testing": ["apps/api/tests/", "apps/admin/tests/", "apps/client/tests/"],
    "mutation": ["apps/api/tests/"],
    "logging": ["apps/api/src/lib/logger.ts", "packages/observability/"],
    "audit logging": ["apps/api/src/audit/"],
    "observability": ["packages/observability/"],
    "prometheus": ["packages/observability/", "apps/api/src/metrics/"],
    "security": ["apps/api/src/auth/", *SECURITY_CRYPTO_PATHS],
    "cryptography": SECURITY_CRYPTO_PATHS,
    "encryption": SECURITY_CRYPTO_PATHS,
    "crypto": SECURITY_CRYPTO_PATHS,
    "kms": SECURITY_CRYPTO_PATHS,
    "byok": SECURITY_CRYPTO_PATHS,
    "auth": ["apps/api/src/auth/"],
    "authentication": ["apps/api/src/auth/"],
    "oauth": ["apps/api/src/auth/"],
    "oidc": ["apps/api/src/auth/"],
    "jwt": ["apps/api/src/auth/"],
    "password": ["apps/api/src/auth/passwordHashing.ts"],
    "webhook": ["apps/api/src/webhooks/", "packages/core/webhooks/"],
    "fastify": ["apps/api/src/"],
    "next": ["apps/admin/", "apps/client/"],
    "next.js": ["apps/admin/", "apps/client/"],
    "react": ["apps/admin/components/", "apps/client/components/", "packages/ui/"],
    "prisma": ["infra/prisma/", "apps/api/src/infrastructure/repositories/", "packages/adapters/db-prisma/"],
    "postgresql": ["infra/prisma/"],
    "cqrs": ["apps/api/src/cqrs/", "packages/core/application/"],
    "saga": ["apps/api/src/saga/", "apps/api/src/infrastructure/saga/", "packages/shared/src/saga.ts", "packages/core/application/"],
    "event": ["apps/api/src/events/", "packages/core/domain/src/events/"],
    "outbox": ["apps/api/src/outbox/", "apps/api/src/infrastructure/outbox/", "packages/adapters/db-prisma/src/outbox/"],
    "uow": UNIT_OF_WORK_PATHS,
    "unit-of-work": UNIT_OF_WORK_PATHS,
    "unit of work": UNIT_OF_WORK_PATHS,
    "use case": ["packages/core/application/"],
    "secret": ["apps/api/src/config/env.ts"],
    "env": ["apps/api/src/config/env.ts"],
    "validation": ["apps/api/src/validation/"],
    "ddd": CORE_LAYERS,
    "domain": ["packages/core/domain/"],
    "aggregate": ["packages/core/domain/"],
    "result": ["packages/shared/", "apps/api/src/"],
    "error": ["packages/core/domain/src/errors/", "apps/api/src/lib/errors/"],
    "circuit": ["packages/monitoring/"],
    "resilience": ["packages/monitoring/"],
    "fitness": CI_PATHS,
    "ci": CI_PATHS,
    "github actions": CI_PATHS,
    "pre-merge audit": [*CI_PATHS, "scripts/"],
    "eslint": ["eslint.config.ts"],
    "linting": ["eslint.config.ts"],
    "git hygiene": [".gitattributes", ".gitignore"],
    "tsdoc": ["apps/api/src/", "packages/core/"],
    "jsdoc": ["apps/api/src/", "packages/core/"],
    "dead code": ["knip.json", "scripts/knip-ratchet.mjs"],
    "documentation": ["docs/"],
    "bundling": ["apps/api/Dockerfile", "apps/workers/Dockerfile"],
    "container": ["apps/api/Dockerfile", "apps/workers/Dockerfile"],
    "analytics": ["apps/api/src/analytics/", "packages/core/analytics/"],
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
    "i18n": I18N_PATHS,
    "internationalization": I18N_PATHS,
    "telemetry": ["packages/observability/"],
    "tracing": ["packages/observability/"],
    "metrics": ["packages/observability/"],
    "redis": ["packages/adapters/cache-redis/"],
    "rbac": ["apps/api/src/auth/"],
    "permission": ["apps/api/src/auth/"],
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

# Areas with no code location: their entries may keep an empty `appliesTo`.
# Any other empty entry fails the generation — an entry that cannot fire has
# to be a decision written here, not an oversight.
PATHLESS_AREAS = {
    "Stamps & Conventions for new entries": "conventions for writing the markdown index itself, which lives outside the repository",
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


def keyword_in_area(keyword: str, area_lower: str) -> bool:
    """True when `keyword` appears in the area as a whole word (plural included).

    As a substring, `ui` matched "build", `ci` matched "circuit" and `rate`
    matched any word containing it: an area inherited paths from a word it
    does not name.
    """
    return re.search(rf"(?<![a-z0-9]){re.escape(keyword)}(?:e?s)?(?![a-z0-9])", area_lower) is not None


def guess_paths(area: str) -> list[str]:
    """Heuristic mapping from area name to repo paths."""
    area_lower = area.lower()
    paths = set()
    for keyword, candidate_paths in AREA_TO_PATHS.items():
        if keyword_in_area(keyword, area_lower):
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


def find_offenders(entries: dict, root: Path = PROJECT_ROOT) -> list[str]:
    """One line per offender: each dead pattern with the entries that carry
    it, and each entry with an empty `appliesTo` outside PATHLESS_AREAS.

    Both shapes produce an entry that never fires in pre_edit_canon, which
    matches `appliesTo` as a substring of the edited path.
    """
    offenders = [
        f"dead appliesTo pattern {pattern!r} -> entries: {', '.join(keys)}"
        for pattern, keys in dead_applies_to_patterns({"entries": entries}, root).items()
    ]
    offenders.extend(
        f"empty appliesTo: {key} -> area {entry['area']!r} (not in PATHLESS_AREAS)"
        for key, entry in sorted(entries.items())
        if not entry["appliesTo"] and entry["area"] not in PATHLESS_AREAS
    )
    return offenders


def generate(source: Path, out: Path, root: Path = PROJECT_ROOT) -> int:
    """Regenerates `out` from `source`; 0 when written, 1 when refused.

    Fails closed: on any offender from `find_offenders` it names them all on
    stderr and writes NOTHING, so an index that cannot fire never silently
    replaces the previous one.
    """
    if not source.exists():
        print(f"ERROR: canon .md not found at {source}", file=sys.stderr)
        return 1

    entries, warnings = parse_canon(source.read_text(encoding="utf-8"))
    if warnings:
        print(f"{len(warnings)} warning(s):", file=sys.stderr)
        for w in warnings:
            print(f"  - {w}", file=sys.stderr)

    offenders = find_offenders(entries, root)
    if offenders:
        print(f"ERROR: {len(offenders)} appliesTo offender(s); {out} not written:", file=sys.stderr)
        for offender in offenders:
            print(f"  - {offender}", file=sys.stderr)
        return 1

    output = {
        "version": 1,
        "synthesizedAt": datetime.now(timezone.utc).isoformat(),
        "source": source.name,
        "entryCount": len(entries),
        "entries": entries,
    }
    # Atomic write: a concurrent reader (a hook) sees the old index or the new
    # one, never a half-written file.
    staging = out.with_name(out.name + ".tmp")
    staging.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(staging, out)

    print(f"Wrote {len(entries)} entries to {out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, help="canon markdown (default: the project's memory dir)")
    parser.add_argument("--out", type=Path, help="index JSON to write (default: the project's memory dir)")
    args = parser.parse_args(argv)
    return generate(args.source or canon_research_index_path(), args.out or canon_index_path())


if __name__ == "__main__":
    sys.exit(main())
