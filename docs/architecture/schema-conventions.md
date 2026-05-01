# Schema conventions

Database conventions for Prisma schema (`infra/prisma/schema.prisma`) and the underlying PostgreSQL migrations. Apply these defaults to every new model + migration.

---

## Decimal precision

| Use case                               | Precision            | Rationale                                                                                                  |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Money / currency amounts               | `@db.Decimal(19, 4)` | GAAP rounding tolerance + sub-cent precision for FX/Stripe minor-unit conversion. Max ~999 trillion units. |
| Rates / multipliers (FX, basis points) | `@db.Decimal(10, 6)` | Six decimal places for basis-point precision.                                                              |
| Percentages stored as `0–100`          | `@db.Decimal(5, 2)`  | Up to `100.00` with two decimal places.                                                                    |
| Bounded scores `0–1`                   | `@db.Decimal(4, 3)`  | Up to `9.999`; CHECK constraint advisable for the upper bound.                                             |

**Migration rule.** Widening (`Decimal(10,2)` → `Decimal(19,4)`) is safe — Postgres preserves data. Narrowing requires `USING value::numeric(X,Y)` and a data audit; never narrow money silently.

**Document precision rationale per field** with a JSDoc above the field declaration. The precision choice should be self-explanatory at the model.

---

## Composite unique constraints with NULL columns

PostgreSQL treats each `NULL` as distinct in unique-constraint comparisons (SQL standard). For composite uniques on nullable columns, choose by **business intent**:

| Intent                                                                                                                                  | Tool                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| "Two rows with the same combination — including matching NULLs — should collide" (e.g., one global permission per user/resource/action) | `UNIQUE NULLS NOT DISTINCT` (PG15+)          |
| "Uniqueness only matters when the column has a value; rows with NULL are exempt"                                                        | Partial unique index `WHERE col IS NOT NULL` |

`NULLS NOT DISTINCT` requires raw SQL — Prisma's schema language does not expose the modifier. Embed the migration:

```sql
DROP INDEX "Model_field_other_key";
CREATE UNIQUE INDEX "Model_field_other_key"
    ON "Model" ("field", "other")
    NULLS NOT DISTINCT;
```

---

## CHECK constraints

Prisma's schema language does **not** support CHECK constraints (issue #3388). Use `prisma migrate dev --create-only --name xxx` and append raw SQL.

**Two-phase migration on populated tables**:

```sql
-- Migration A: add NOT VALID (immediate, no full table scan)
ALTER TABLE "Model"
    ADD CONSTRAINT "Model_invariant_check"
    CHECK (...)
    NOT VALID;

-- Migration B: validate after data audit
ALTER TABLE "Model" VALIDATE CONSTRAINT "Model_invariant_check";
```

`NOT VALID` enforces on new writes immediately while exempting legacy rows. Run a data audit between migrations to identify any offending rows; fix data before VALIDATE.

**Use CHECK when** the invariant is intrinsic to the data shape (`startDate <= endDate`, `priceMin <= priceMax`) or when other writers (raw SQL admin scripts, replication) could bypass application-level validation.

**Skip CHECK when** the rule depends on external context (per-tenant config, current user role) or changes frequently.

**Cross-row uniqueness invariants** (e.g., "at most one row per parent has `isPrimary = true`") cannot be expressed in a CHECK (Postgres forbids subqueries in CHECK). Use a partial unique index instead:

```sql
CREATE UNIQUE INDEX "Foo_one_primary_per_parent"
    ON "Foo" ("parentId")
    WHERE "isPrimary" = true;
```

---

## Soft-delete partial indexes

Models with `deletedAt: DateTime?` for soft delete should have **partial indexes** that exclude soft-deleted rows for active-record query paths. The result is smaller indexes + planner picks them automatically for the common `WHERE deletedAt IS NULL` predicate.

**Enable the preview flag** in the generator block:

```prisma
generator client {
  provider        = "prisma-client"
  previewFeatures = ["partialIndexes"]
}
```

**Declare partial indexes** with the `where:` clause (object-literal form for simple equality):

```prisma
model Project {
  @@index([accountId], where: { deletedAt: null })
  @@index([createdAt], where: { deletedAt: null })
  @@index([deletedAt])  // KEEP non-partial: used to find soft-deleted rows
}
```

**Composite predicates** (multiple columns) use the same object-literal form:

```prisma
@@unique([projectId, provider], where: { isPrimary: true, deletedAt: null }, map: "Channel_projectId_provider_isPrimary_unique")
```

**Column-vs-column comparisons** require `raw()`:

```prisma
@@index([nextRetryAt, occurredAt], where: raw("\"publishedAt\" IS NULL AND \"retryCount\" < \"maxRetries\""), map: "idx_outbox_claim_hot")
```

**Rule of thumb**: every index on a soft-delete table becomes partial except the index on `deletedAt` itself (used by cleanup jobs to find soft-deleted rows).

---

## Foreign keys

Model relations are declared with `@relation`. Both sides should be present (back-relation field + `@relation` directive).

**Loose-string vs FK trade-off** for audit / breach / consent records: when the audit trail must survive deletion of the referenced row, loose strings (no FK) can be acceptable. Document the choice explicitly in a JSDoc above the field — readers should not have to guess whether the missing FK is intentional or an oversight.

When in doubt, prefer FK (`ON DELETE SET NULL` for nullable, `ON DELETE RESTRICT` for required) — losing the audit trail to a missing FK is rare; allowing dangling string IDs is a common source of bugs.

---

## Migration naming

Migration directories follow the format `{timestamp}_{snake_case_name}`. Names should describe intent, not mechanism:

- `t4t_unique_nulls_not_distinct` ✓
- `t4t_check_constraints_not_valid` ✓
- `t4t_validate_check_constraints` ✓ (separate migration after data audit)
- `add_indexes` ✗ (too vague)

Use the batch prefix (e.g., `t4t_`) when the migration is part of a numbered remediation batch — makes git archaeology easier.
