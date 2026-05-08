# Canon Candidate — Prisma bulk operations with affected IDs

## Metadata

- **Task surfacing this gap**: PR-44 (Wave 3.3 — cross-tenant mass force-reauth) + reusable in 43-A/43-B repos
- **Specific decision**: how to bulk-update rows AND get back the affected IDs in a single atomic operation? Currently: `findMany select id` + `updateMany where id in [...]` (2 SQL roundtrips, race window between them). Is there a canonical 1-query alternative?
- **Decision date**: 2026-05-07
- **Synthesized by**: claude-opus-4-7
- **Status**: approved (2026-05-07)

## Why this gap exists

- **Existing canon adjacent**:
  - `cockburn-hexagonal-architecture` — covers structure of repo methods, not the SQL pattern
  - No canon entry on Prisma bulk operations or PostgreSQL `RETURNING`
- **What's missing in those entries**: nothing prescribes "1 SQL roundtrip with RETURNING" vs "2 SQL roundtrips findMany+updateMany". The prior canon assumed Prisma's `updateMany` could not return data.
- **Why default heuristic is insufficient**: I picked `findMany select { id } + updateMany where { id: { in: ids } }` as the bulk pattern because that's what I knew. But this assumption is **stale** — Prisma 6.2.0 (2025-01) introduced `updateManyAndReturn` which uses RETURNING under the hood. Workspace runs Prisma 7.6.0, so the feature is available.

## Research scope

- **Search keywords**: `Prisma updateMany returning affected rows`, `RETURNING clause Postgres bulk update`, `prisma updateManyAndReturn`
- **Sources targeted**: Prisma official docs + release notes (primary authority — they own the API), the canonical GitHub issue tracking the feature request, PostgreSQL docs (for the underlying SQL semantics).
- **Sources excluded**: third-party blog posts comparing ORMs — useful color but not authoritative for our Prisma-specific decision.

## Sources consulted

### [1] Prisma 6.2.0 release notes — [github.com/prisma/prisma/releases/tag/6.2.0](https://github.com/prisma/prisma/releases/tag/6.2.0)

- **Fetched**: 2026-05-07
- **Authority**: official Prisma release notes — primary source for API additions.
- **Key claims**:
  - "New batch function: `updateManyAndReturn`" introduced in Prisma 6.2.0 (released 2025-01-07).
  - "`updateMany` allows you to update many records ... but it only returns the count of the affected rows, not the resulting rows themselves. With `updateManyAndReturn` you are now able to achieve this."
  - Returns "the actual records that have been updated in the query" — full row data, not just IDs.
  - "Like `createManyAndReturn`, `updateManyAndReturn` is only supported in PostgreSQL, CockroachDB, and SQLite."
- **My reading**: this is the canonical 1-query replacement for our 2-query pattern. Workspace uses Prisma 7.6.0 — feature available.

### [2] Prisma docs — CRUD reference — [www.prisma.io](https://www.prisma.io/docs/orm/prisma-client/queries/crud)

- **Fetched**: 2026-05-07
- **Authority**: official Prisma documentation — current API surface.
- **Key claims**:
  - Confirms `updateManyAndReturn` syntax: `prisma.user.updateManyAndReturn({ where: { ... }, data: { ... } })`.
  - "Supported by PostgreSQL, CockroachDB, and SQLite."
  - Returns array of full updated records.
- **My reading**: docs page does not yet (per our fetch) document `select`/`omit` options on `updateManyAndReturn`. May or may not support — verify in implementation by attempting `select: { id: true }`.

### [3] GitHub Issue #5019 — Implement RETURNING on updateMany — [github.com/prisma/prisma/issues/5019](https://github.com/prisma/prisma/issues/5019)

- **Fetched**: 2026-05-07 via gh CLI
- **Authority**: canonical issue tracking the 5-year community demand for this feature. State: CLOSED, closedAt 2025-01-02 (5 days before 6.2.0 release).
- **Key claims**:
  - Issue opened 2020-01-10. Closed 2025-01-02. ~5 years of community demand.
  - Community workaround during the wait: `prisma.$transaction([findMany select id, updateMany])` to get IDs atomically (Kris-Pelteshki, 2023-09-21, 14 thumbs up).
  - Multiple commenters called out the race-condition risk of non-transactional findMany+updateMany.
- **My reading**: confirms our current code (`findMany` then `updateMany` without transaction wrapping) has an actual documented race condition that the community recognized. `updateManyAndReturn` solves both perf AND correctness.

### [4] PostgreSQL UPDATE — RETURNING clause — [postgresql.org](https://www.postgresql.org/docs/current/sql-update.html)

- **Fetched**: 2026-05-07
- **Authority**: PostgreSQL official documentation — the SQL substrate.
- **Key claims**:
  - "The optional `RETURNING` clause causes `UPDATE` to compute and return value(s) based on each row actually updated."
  - "PostgreSQL extension" to the SQL standard. Implies portability concern (works on Postgres + CockroachDB; SQLite has its own version, MySQL doesn't have it).
  - Default returns NEW (post-update) values; can request OLD via `OLD.col` qualifier.
  - Atomicity: "Any expression using the table's columns ... can be computed" against the row being updated — single statement, single transaction context.
- **My reading**: RETURNING is atomic by construction — there's no race window because the SELECT-equivalent happens within the same UPDATE statement. Eliminates the lost-update class of bug that Prisma issue #8612 also flagged.

## Synthesis

### Recommendation: USE

- **`prisma.<model>.updateManyAndReturn({ where, data, select })`** — the canonical Prisma-native 1-query replacement.
- **Atomic semantics by construction** — RETURNING is part of the same UPDATE statement; no race window between "find which rows match" and "update them".
- **Narrow `select` to only needed fields** (likely `{ id: true }` for our audit pattern) — minimizes payload + matches Prisma's recommendation.
- **PostgreSQL-targeted code** can rely on this freely. Workspace is Postgres-only.

### Recommendation: AVOID

- **`findMany` + `updateMany` 2-query pattern WITHOUT a transaction** — has a documented race window (referenced in Prisma issue #8612 "lost-updates"). Our PR-44 code does exactly this.
- **`findMany` + `updateMany` inside `$transaction`** — was the community workaround pre-6.2.0. Atomic, but still 2 SQL roundtrips (slower than RETURNING). Acceptable as fallback when target DB doesn't support `updateManyAndReturn` (MySQL).
- **Raw `$executeRaw` UPDATE...RETURNING** — works but bypasses Prisma's typed surface. Reserve for queries Prisma cannot express.
- **`updateMany` followed by `findMany` (without transaction)** — non-atomic AND non-correct. Two findMany invocations against the same `where` clause may return DIFFERENT row sets if concurrent writes touch the table.

### Tradeoffs / decision tree

- **If on PostgreSQL/CockroachDB/SQLite + Prisma ≥6.2.0**: use `updateManyAndReturn`. No reason to fall back.
- **If on MySQL**: stuck with `$transaction([findMany select id, updateMany])`. MySQL has `RETURNING` since 8.0.21 but Prisma doesn't expose it as `updateManyAndReturn` for that engine.
- **If field selection beyond `id` is needed**: `select` parameter behavior is undocumented in our fetch — implementation may need to test. Worst case: returns full rows + we project in-memory.
- **Bulk DELETE with returning IDs**: NOT covered by this canon entry. Prisma offers `deleteMany` (count only). For DELETE...RETURNING, drop to `$queryRaw` or use community workaround. Out of scope for our PR-44 soft-delete (we set `deletedAt`, which is an UPDATE — covered by this canon).

### Pinned values / flags

- **Prisma version floor**: `>= 6.2.0` for `updateManyAndReturn`. Workspace uses `7.6.0`. ✓
- **Database engine**: PostgreSQL (workspace) — fully supported. ✓
- **Default `select`**: `{ id: true }` for audit-trail use cases — narrow projection.

## Proposed canon-index.json entry

```json
{
  "key": "prisma-updatemanyandreturn-bulk-ops-returning",
  "topic": "Prisma updateManyAndReturn — bulk operations with affected IDs in 1 SQL roundtrip",
  "area": "Database · PostgreSQL · Prisma schema decisions",
  "summary": "Prisma 6.2.0 (2025-01) introduced `updateManyAndReturn` which uses Postgres `RETURNING` under the hood, replacing the 5-year-old workaround of `findMany select id` + `updateMany where id in [...]`. Single SQL roundtrip + atomic semantics (no race window between SELECT and UPDATE). Supported on PostgreSQL, CockroachDB, SQLite. Workspace uses Prisma 7.6.0 — feature available. Replaces the 2-query pattern in any code that needs both 'update many' AND 'know which IDs were affected'.",
  "keyTakeaway": "Use `prisma.<model>.updateManyAndReturn({ where, data, select: { id: true } })` for any bulk update that needs affected-row identifiers. Avoid the legacy `findMany + updateMany` pattern — non-atomic without `$transaction`, 2 roundtrips even with `$transaction`. Atomicity is by SQL construction, not by transaction wrapping.",
  "patternAdopted": "Repository methods that need 'bulk-update + return affected IDs' use `prisma.<model>.updateManyAndReturn({ where: <criteria>, data: <updates>, select: { id: true } })` returning the array of `{ id }` records. The repo wraps this into the port shape `{ count: number; <entityName>Ids: string[] }` for downstream audit consumers. Wired in `apps/api/src/infrastructure/repositories/PrismaChannelRepository.ts` (bulkMarkForReauthByProvider, bulkSoftDeleteByProvider) + `apps/api/src/infrastructure/repositories/PrismaProviderConnectionRepository.ts` (bulkDisableByProvider). Anti-pattern explicitly avoided: pre-fetch via findMany then updateMany (race window + double roundtrip).",
  "usedIn": "PR-44 (Wave 3.3 — cross-tenant mass force-reauth bulk repos)",
  "date": "2026-05-07",
  "sources": [
    {
      "url": "https://github.com/prisma/prisma/releases/tag/6.2.0",
      "fetchedAt": "2026-05-07",
      "title": "Prisma 6.2.0 release notes (introduces updateManyAndReturn)"
    },
    {
      "url": "https://www.prisma.io/docs/orm/prisma-client/queries/crud",
      "fetchedAt": "2026-05-07",
      "title": "Prisma — CRUD reference (updateManyAndReturn syntax)"
    },
    {
      "url": "https://github.com/prisma/prisma/issues/5019",
      "fetchedAt": "2026-05-07",
      "title": "Prisma issue #5019 — RETURNING on updateMany (5-year history; closed 2025-01-02)"
    },
    {
      "url": "https://www.postgresql.org/docs/current/sql-update.html",
      "fetchedAt": "2026-05-07",
      "title": "PostgreSQL — UPDATE...RETURNING clause"
    }
  ],
  "synthesizedBy": "claude-opus-4-7",
  "confidence": "high",
  "lastVerified": "2026-05-07",
  "version": 1,
  "appliesTo": ["apps/api/src/infrastructure/repositories/", "apps/api/src/domain/repositories/"]
}
```

## Impact on existing code

- **Files that should change** (research surfaced different optimal pattern):
  - `apps/api/src/infrastructure/repositories/PrismaChannelRepository.ts` — `bulkMarkForReauthByProvider` (lines ~286-308): replace `findMany select id` + `updateMany where id in` with single `updateManyAndReturn({ where, data, select: { id: true } })`. Same for `bulkSoftDeleteByProvider` (~314-330). Estimated effort: ~15 min + tests update.
  - `apps/api/src/infrastructure/repositories/PrismaProviderConnectionRepository.ts` — `bulkDisableByProvider` (lines ~17-32): same refactor. ~10 min.
  - `apps/api/tests/unit/infrastructure/repositories/PrismaProviderConnectionRepository.test.ts` — replace stub of `findMany + updateMany` with stub of `updateManyAndReturn`. ~10 min.
  - **Net win**: 2 SQL roundtrips → 1 per bulk operation, eliminates race window, simpler stubs in tests.
- **Files that already align with this canon**:
  - None — this is a refactor of existing 2-query patterns to the canonical 1-query.

## Edward's review

- [x] Sources are sufficient (4 from official Prisma docs + Postgres docs + GitHub canonical issue)
- [x] Recommendations match project values
- [x] Pinned values reasonable for our scale + threat model
- [x] Approve append to `canon_research_index.md`
- [x] Trigger refactor commit on the 3 repo methods + tests
- Notes: Edward approved on 2026-05-07. Refactor applied (3 repo methods + tests); canon entry appended; canon-index.json regenerated (127 → 128 entries).
