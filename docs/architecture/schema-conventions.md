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

When in doubt, prefer an FK over a loose string — losing the audit trail to a missing FK is rare; allowing dangling string IDs is a common source of bugs.

### Choosing the `ON DELETE` action

Nullability tells you what the database _can_ do; it does not tell you what the deletion _means_. Pick the action from **ownership** — is the child part of the parent's aggregate, or does it merely reference it?

| The child…                                                                                                  | Action                             | Why                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **is owned by** the parent — it is meaningless on its own and nobody would expect it to outlive the parent  | `ON DELETE CASCADE`                | Deleting the aggregate root deletes the aggregate. Encoded in the FK, not in a hand-written delete order. |
| **references** the parent but has its own lifetime and its own owner (typically a different aggregate root) | `ON DELETE SET NULL` (nullable FK) | The child survives, having lost an optional association. Required for audit, report, and ledger records.  |
| **must block** the delete — the reference is a guard against destroying something still in use              | `ON DELETE RESTRICT`               | Protects against _accidental_ referential damage. This is a safety interlock, not an ownership statement. |

A **required (`NOT NULL`) FK is the schema author's own ownership signal** — it declares the child cannot exist without that parent. That is evidence for Cascade, not against it. A **nullable FK is the opposite signal**: the author has already said the child is valid without the parent, so `SET NULL` preserves exactly that.

**Exception — nullable-as-variant FKs.** Sometimes `NULL` is not "detached reference" but a _discriminator_: the null and non-null forms are two different kinds of row. There the nullable-FK heuristic misreads, because `SET NULL` would not detach the row — it would silently _mutate it into the other variant_. Adjudicate these by ownership of the non-null variant (usually Cascade) and never `SET NULL`. The three live cases:

- `AIPromptTemplate.accountId` — `null` = global system template. `SET NULL` on account deletion would promote a tenant's private prompts into system templates: a cross-tenant content leak. Cascade.
- `BundleFeatureFlag.bundleId` — `null` = platform-default flag. `SET NULL` on bundle deletion would promote bundle overrides into platform defaults (and `@@unique([bundleId, featureKey])` does not deduplicate NULLs). Cascade.
- `WebhookSubscription.projectId` — `null` = account-level subscription (`@@unique([accountId, provider, projectId])`). `SET NULL` on project deletion would mutate a project-scoped subscription into an account-level one that keeps receiving provider events routed at nothing. Cascade. (Deleting the row does not unsubscribe at the provider — that cleanup belongs to the delete use case, not the FK.)

When adding a nullable FK, state in a JSDoc above the field whether null means "no association" (SetNull territory) or "other variant" (this exception).

The two situations this section exists to keep apart:

- **Accidental referential integrity → `RESTRICT`.** Someone deletes a row that other rows still depend on, by mistake. Blocking is right: nothing is lost and the caller gets a clear error.
- **Deliberate destruction of an aggregate root → `CASCADE`.** An operator has decided this project (and everything it owns) must go. Here `RESTRICT` is not a safety feature; it just forces the delete order into application code, where it drifts out of sync with the schema and runs without the database's guarantees.

Worked example — the `Project` aggregate. `Post.projectId`, `Channel.projectId`, `PostContent.postId` and `PostMedia.postId` are all required FKs to owned children, so they cascade. `Task.projectId`, `CustomReport.projectId` and `MediaAsset.projectId` are nullable, account-scoped, and outlive the project, so they stay `SET NULL` — a report that vanished with its project would be exactly the audit-trail loss the loose-string note above warns about.

**Why Cascade is safe here: H12, Soft Delete Universal** (`docs/architecture/README.md`). Soft delete (`deletedAt`) is the _normal_ deletion path for `Account`, `Project`, `Channel` and `Post` — an `UPDATE`, which never touches an FK and never fires a referential action. `ON DELETE CASCADE` can only fire on the exceptional, admin-only **hard-delete** path. So Cascade describes what a deliberate aggregate destruction does; it is not what happens when a user deletes something in the product. Do not reach for Cascade on a model that has no soft-delete path unless the child is genuinely disposable.

### Changing an existing `ON DELETE` action

PostgreSQL has no `ALTER CONSTRAINT` for referential actions (`ALTER CONSTRAINT` only covers deferrability), so the change is a `DROP` + `ADD`. Use the same two-phase split as CHECK constraints, for the same reason and with the same shape — squawk enforces it (`constraint-missing-not-valid`, `adding-foreign-key-constraint`), and both rules are active:

```sql
-- Migration A: swap the action without a table scan
ALTER TABLE "Child" DROP CONSTRAINT "Child_parentId_fkey";
ALTER TABLE "Child" ADD CONSTRAINT "Child_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Parent"("id")
    ON UPDATE CASCADE ON DELETE CASCADE NOT VALID;

-- Migration B (separate file = separate transaction): validate under a weak lock
ALTER TABLE "Child" VALIDATE CONSTRAINT "Child_parentId_fkey";
```

Three things worth knowing before you copy this:

- **`NOT VALID` still cascades.** It only means existing rows were not re-verified; the constraint is fully live for new writes and referential actions from the moment it is added. There is no window in which deletes behave the old way.
- **No data audit is needed between A and B**, unlike the CHECK-constraint case. The constraint _predicate_ is unchanged — same columns, same referenced table — so every row that satisfied the old constraint satisfies the new one by construction.
- **The split must be two files.** Prisma wraps each migration file in one transaction, and `VALIDATE` only takes the weaker `SHARE UPDATE EXCLUSIVE` (which does not block reads or writes) when it runs in its _own_ transaction. In the same file it would just extend the previous `ACCESS EXCLUSIVE` window across a full table scan.

Set `lock_timeout` and `statement_timeout` in both (squawk's `require-timeout-settings` is active and will fail CI without them). `lock_timeout` makes the migration fail fast instead of queueing behind a long reader and blocking every request stacked behind it.

---

## Migration naming

Migration directories follow the format `{timestamp}_{snake_case_name}`. Names should describe intent, not mechanism:

- `t4t_unique_nulls_not_distinct` ✓
- `t4t_check_constraints_not_valid` ✓
- `t4t_validate_check_constraints` ✓ (separate migration after data audit)
- `add_indexes` ✗ (too vague)

Use the batch prefix (e.g., `t4t_`) when the migration is part of a numbered remediation batch — makes git archaeology easier.
