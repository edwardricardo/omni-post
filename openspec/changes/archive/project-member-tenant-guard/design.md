# Design: ProjectMember Tenant Guard (Slice 5)

## Technical Approach

Approach-A recipe (Slices 0–4) applied to `ProjectMember` (`schema.prisma:369-381`), minus everything the proposal verified doesn't exist: no routes, no use cases, no entity/DTO, no out-of-context callers, no `withSystemContext()` wraps. Two slice-specific deltas: (1) a double-parent RAISE assertion in the backfill — first enrolled model with TWO `accountId`-bearing parents (`Project.accountId:613`, `CustomerUser.accountId:321`); (2) the merge-blocking proof runs at the repository/guarded-client level because the HTTP surface is empty. Stacked on `69dd4cf2` (guard = 56, migrations through `20260715000100_add_rls_generated_image` — verified on disk).

## Architecture Decisions

### D1 — Migration sequence (same as Slice 4, one inserted step)

`add_project_member_account_id` copies `20260715000000` step-for-step: nullable ADD → **double-parent assert (D2, inserted before the backfill)** → `UPDATE … FROM "Project"` over the NOT-NULL `projectId` FK → RAISE-on-residual-NULL → `SET NOT NULL` → FK `Account` Cascade (`ProjectMember_accountId_fkey`) → `CREATE INDEX "ProjectMember_accountId_projectId_idx"`. Backfill source is `Project.accountId` — membership is scoped by the project (`Project.members:631`), matching every prior slice's projectId-FK derivation; after D2 both parents are provably equal, so the choice loses nothing. Schema deltas: `accountId String` + `account Account @relation(..., onDelete: Cascade)` + `@@index([accountId, projectId])`; keep `@@unique([projectId, memberId])` and `@@index([memberId])` untouched; `Account` gains back-relation `projectMembers`.

### D2 — Double-parent invariant: assert-first, RAISE, never skip/log

```sql
-- Pre-check (operator, documented in the migration header):
--   SELECT pm."id" FROM "ProjectMember" pm
--   JOIN "Project" p ON p."id" = pm."projectId"
--   JOIN "CustomerUser" cu ON cu."id" = pm."memberId"
--   WHERE p."accountId" <> cu."accountId";
DO $$
DECLARE mismatched INTEGER;
BEGIN
  SELECT COUNT(*) INTO mismatched
  FROM "ProjectMember" pm
  JOIN "Project" p ON p."id" = pm."projectId"
  JOIN "CustomerUser" cu ON cu."id" = pm."memberId"
  WHERE p."accountId" <> cu."accountId";
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'ProjectMember double-parent mismatch: % row(s) where Project.accountId <> CustomerUser.accountId — corrupt cross-tenant membership; run the pre-check query and remediate before enrolling', mismatched;
  END IF;
END $$;
```

Inner joins cover every row (both FKs NOT NULL, Cascade → orphan-free). Placed BEFORE the backfill: assert preconditions, then act (transactionally equivalent inside Prisma's per-migration tx, but fail-before-write is the cleaner semantics). **RAISE over alternatives**: silent-skip leaves NULLs that hit the later assert with a less diagnostic error; backfilling from Project anyway would mint a "legitimate" `accountId` for a cross-tenant membership (exactly the corruption layer 1/2 exist to prevent); a migration log line is invisible in deploys. Impossible for seeded data (seed derives both parents from one account).

### D3 — RLS pair (same as Slice 4)

New forward pair `add_rls_project_member` + `down.sql`, copying the Slice-4 single-table shape verbatim (`tenant_isolation` policy, `app.account_id` GUC, `__system__` bypass, `DROP POLICY IF EXISTS` idempotence). `20260527000000` is never edited. Honest-layering note carries over: no writer runs under UoW today (only the superuser seed), so runtime protection is layer 1; RLS is structural depth for future wired writes.

Per-slice policy-count drift: each enrollment migration adds one `tenant_isolation` policy, but `rls-tenant-isolation.test.ts:137-141` still hard-asserts the base-migration literal (51) — stale since the first slice and a guaranteed failure once the suite is wired to run. This slice converts the assertion to a derived expected count: query `pg_policies` for `tenant_isolation` rows and compare against the enrollment source of truth (`getTenantScopedModels()` plus the empirically verified base delta between RLS-protected tables and guard-enrolled models — the base pair was 51 policies / 50 models; apply MUST verify the actual relationship against the migrated DB rather than assume size parity). No new literal.

### D4 — Guard flip 56 → 57

Insert `"projectMember"` between `project` (`tenantGuard.ts:126`) and `recurringPost` (`:127`); header JSDoc count 56 → 57 (`:82`).

### D5 — Dead reader: guard-natural, no signature change; port JSDoc states contract only

`findByProjectId` (`PrismaCustomerUserRepository.ts:118-128`, zero prod callers) keeps its body and signature: once enrolled, the guard AND-injects `accountId` into the `projectMember.findMany` where; a foreign `projectId` returns `[]`. Explicit `where.accountId` rejected: it would need an ALS read (`requireTenantContext()`) inside a repository — a pattern no enrolled sibling adapter uses (Slice-4 D8 precedent: guard-natural) — and duplicates a mechanism the guard already injects AND validates. The nested `include: { member }` is safe by construction post-D2: the reachable membership rows are tenant-filtered and `pm.accountId == member.accountId`. Port JSDoc (`packages/core/domain/src/repositories/CustomerUserRepository.ts:44-48`): append one contract-descriptive sentence — "Tenant-scoped: the guarded client restricts results to the bound tenant context; a foreign projectId yields an empty list." No wiring-status/"unwired" commentary (timeline talk rots; SMELL-59 is the paper trail).

### D6 — Seed fix (minimal)

`seed.ts:1112` create branch gains `accountId: account.id` (one line). Required because the seed's raw `@infra/prisma` client is unguarded (no injection) and runs as superuser (BYPASSRLS) — after the NOT NULL flip the DB itself rejects the create. `update: {}` branch unchanged (existing rows backfilled).

### D7 — Proof at the guarded-client/repository level; no migration-replay test

Suite builds the production guard composition in-test: `prisma.$extends(tenantGuardExtension(provider))` (`tenantGuard.ts:254`) with the real ALS provider (`apps/api/src/security/tenantContext.ts` — `withTenantContext`, `withSystemContext`), and instantiates the real `PrismaCustomerUserRepository` over the guarded client — exercising the exact object future wiring will use. **Double-parent RAISE is NOT integration-tested**: the migration already ran against the test DB; replaying its DO block verbatim from a test duplicates one-shot deploy logic that drifts from the real file. The deploy-time RAISE IS the enforcement point (Slice-4 treated migration asserts the same way); the suite instead pins the runtime equality invariant on the create path (scenario 3). Forward-looking mismatch prevention on writes belongs to SMELL-59's ownership assertions (Requirement-3 N/A note).

### D8 — No entity/DTO threading (verified non-task)

No domain entity or DTO exists (proposal, repo-wide grep); the adapter maps memberships straight to `CustomerUser` domain objects. Nothing to thread — leaner than Slice-4 D3.

### D9 — Rollback

Pre-merge: revert branch. Post-merge: `down.sql` (drop policy + disable RLS, Slice-4 shape); remove `projectMember` from the guard Set; `accountId` column additive/removable by a later down migration. Expand/contract caveat (SMELL-56): NOT NULL flip in one migration is safe here — single deployable, and the only writer (seed) is fixed in the same PR.

## Data Flow

    [tenant A ctx] repository.findByProjectId(projectId_B)
      → guard: projectMember tenant-scoped → inject where.accountId = A
      → 0 membership rows → []            [no context → TenantContextMissingError]
    [tenant A ctx] guardedClient.projectMember.create({projectId_A, memberId_A})
      → guard injects data.accountId = A  → row where A == Project.accountId == CustomerUser.accountId

## File Changes

| File                                                                            | Action                 | Description                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/prisma/schema.prisma`                                                    | Modify — **SENSITIVE** | D1 schema deltas + `Account.projectMembers`                                                                                                                                                                                                                                                     |
| `infra/prisma/migrations/20260716…_add_project_member_account_id/migration.sql` | Create — **SENSITIVE** | D1 + D2                                                                                                                                                                                                                                                                                         |
| `infra/prisma/migrations/20260716…_add_rls_project_member/{migration,down}.sql` | Create — **SENSITIVE** | D3                                                                                                                                                                                                                                                                                              |
| `infra/prisma/src/extensions/tenantGuard.ts`                                    | Modify — **SENSITIVE** | D4                                                                                                                                                                                                                                                                                              |
| `infra/prisma/seed.ts`                                                          | Modify                 | D6                                                                                                                                                                                                                                                                                              |
| `packages/core/domain/src/repositories/CustomerUserRepository.ts`               | Modify                 | D5 JSDoc sentence                                                                                                                                                                                                                                                                               |
| `apps/api/tests/unit/security/tenantGuard.test.ts`                              | Modify                 | `projectMember` enrollment + inject/validate/missing matrix; update `getTenantScopedModels` size assertion 56 → 57 (`tenantGuard.test.ts:663-664`)                                                                                                                                              |
| `apps/api/tests/integration/projectMemberTenantIsolation.test.ts`               | Create                 | D7 suite (standard `@file`/`@description`/`@layer infrastructure` header — fitness #9/#10)                                                                                                                                                                                                      |
| `apps/api/scripts/run-tests.sh`                                                 | Modify                 | New `run_batch` `integration:tenant-isolation` (DB-only tier) wiring ALL 7 `*TenantIsolation.test.ts` suites + `rls-tenant-isolation.test.ts` — the existing 6 suites were never listed in any batch, so the rollout's MERGE-BLOCKING proofs never executed under `test:all`/`test:integration` |
| `apps/api/tests/integration/rls-tenant-isolation.test.ts`                       | Modify                 | D3: policy-count assertion 51 → derived expected count (no new literal)                                                                                                                                                                                                                         |
| `openspec/specs/multi-tenant-isolation/spec.md`                                 | Modify                 | Req-1 row; Req-2 block (no-HTTP-surface pin + double-parent invariant); Req-3 N/A note                                                                                                                                                                                                          |
| `docs/security/MULTI_TENANT_GUARDS.md`                                          | Modify                 | 3-step enrollment + counts                                                                                                                                                                                                                                                                      |

`PrismaCustomerUserRepository.ts` needs NO change (D5).

## Interfaces / Contracts

None new. `findByProjectId(projectId: string): Promise<CustomerUser[]>` signature unchanged (D5).

## Testing Strategy

| Layer                                                         | What to Test                                                                                                                                                                                                                                                                                      | Approach                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (vitest)                                                 | Guard matrix for `projectMember`: membership, where-injection, create-injection, mismatch throw, missing-context throw                                                                                                                                                                            | `tenantGuardCheck` pure fn, no Prisma                                                                                                                                                                                                                                                                                                                                                                                                    |
| Integration (MERGE-BLOCKING, node:test, real DB, two tenants) | A-ctx `findByProjectId(B.projectId)` → `[]`; A-ctx own projectId → own members only; no-context → `TenantContextMissingError`; A-ctx guarded create without `accountId` → row `accountId == Project.accountId == CustomerUser.accountId`; explicit foreign `accountId` on create → mismatch throw | Guarded client + real repository (D7); seed as superuser client. Harness copied from `recurringPostTenantIsolation.test.ts`; `seedTenant` creates one membership row PER tenant (B's project HAS members) so the foreign-read `[]` is non-vacuous. MERGE-BLOCKING is enforced by the new `integration:tenant-isolation` batch in `run-tests.sh` (File Changes) — without that wiring no tenant-isolation suite executes under `test:all` |
| Migration                                                     | Double-parent mismatch = 0; zero NULL post-backfill; row count preserved                                                                                                                                                                                                                          | In-tx RAISE (fails the deploy) — D2/D1                                                                                                                                                                                                                                                                                                                                                                                                   |
| Gate                                                          | 0-defect                                                                                                                                                                                                                                                                                          | tsc, eslint --max-warnings 0, fitness #21/#23, LXC-safe regression                                                                                                                                                                                                                                                                                                                                                                       |

## Threat Matrix

N/A — data-layer authorization only; no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Single atomic PR on stacked branch `workstream/cluster-c-projectmember-guard` off `69dd4cf2`. Timestamps assigned at apply (`--create-only`), both > `20260715000100`, column-before-RLS asserted. `pnpm db:up` + `omnipost-allow sensitive-edit` at apply. Expected under the 400-line budget (smallest slice). Rollback per D9.

## Open Questions

- [ ] None blocking. If the real DB ever trips the D2 RAISE, remediation is manual (pre-check query in the migration header) — by design, not a gap.
