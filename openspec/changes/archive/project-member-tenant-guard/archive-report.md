# Archive Report — project-member-tenant-guard

> Closure record for the `project-member-tenant-guard` SDD change (Slice 5
> of the `project-scoped-tenant-guard` rollout, N-SEC-3). Archived 2026-07-16.
> Store: hybrid (openspec files + engram mirror). Branch:
> `workstream/cluster-c-projectmember-guard`, PR #119 (draft, stacked on #118).

## Outcome

`ProjectMember` is now isolated by construction under the two-layer tenant
guard (Prisma `$extends` + PostgreSQL RLS), closing a LATENT cross-tenant
exposure in a SIGNED forgotten-feature (engram obs 321/322): a designed but
UNWIRED per-project membership layer — zero HTTP routes, one DEAD reader
(`findByProjectId`, zero production callers), seed-only writer. The model
is enrolled DEFENSIVELY so it is born tenant-safe when the feature is wired
(backlog SMELL-59); this slice does NOT delete the model and does NOT build
the feature.

- **Guard-layer closure of the dead reader**: `findByProjectId` is now
  AND-scoped by the guard — a foreign `projectId` returns `[]` instead of
  relying on the absence of a caller to stay safe. No signature change
  (D5); the port JSDoc gained one contract-descriptive sentence with no
  wiring-status/timeline commentary.
- **FIRST enrolled model with TWO `accountId`-bearing parents**:
  `ProjectMember` is scoped by BOTH `Project` (via `projectId`) and
  `CustomerUser` (via `memberId`). The backfill migration derives
  `accountId` from `Project.accountId` and asserts EQUALITY against
  `CustomerUser.accountId` for every row in a `DO $$` block placed BEFORE
  the backfill UPDATE — any mismatch is corrupt cross-tenant membership and
  HALTS the migration with a `RAISE EXCEPTION` (deploy-time enforcement,
  not integration-tested per design D7 — replaying the DO block from a
  test would drift from the real migration file).
- **FIRST enrolled model with a structurally EMPTY HTTP surface**: the
  living spec's all-routes HTTP proof rule is VACUOUSLY satisfied, so the
  MERGE-BLOCKING isolation proof runs at the repository/guarded-client
  layer instead of over HTTP — production guard composition
  (`prisma.$extends(tenantGuardExtension(provider))` + the real ALS
  provider + the real `PrismaCustomerUserRepository`) exercised directly
  in a real-DB, two-tenant `node:test` suite.
- **Create-path parent-ownership check is a DEFERRED obligation**: there is
  NO production create path today (seed-only writer). The spec's added
  Requirement block pins that when SMELL-59 wires a write path, it SHALL
  add a create-path assertion validating BOTH `projectId` → `Project` AND
  `memberId` → `CustomerUser` before persist — documented now, not
  implemented in this slice.
- **Two rollout-wide fixes, beyond this model's own enrollment**:
  - **W1 — batch wiring**: the 6 prior slices' MERGE-BLOCKING
    `*TenantIsolation.test.ts` suites were never listed in any
    `run-tests.sh` batch, so their proofs never actually executed under
    `test:all`/`test:integration` since Slice 1. This slice adds a new
    `integration:tenant-isolation` batch wiring all 7 suites (6 prior +
    `projectMember`) plus `rls-tenant-isolation.test.ts`, closing a
    rollout-wide CI enforcement gap.
  - **W2 — derived RLS policy count**: `rls-tenant-isolation.test.ts` hard-
    asserted the base-migration literal `51`, stale since Slice 1 and a
    guaranteed failure once the batch above actually ran. Converted to a
    count derived from `getTenantScopedModels().size` with a bidirectional
    1:1 mapping assertion — no new literal.

Full SDD cycle: proposal → spec → design → tasks → apply → verify → archive,
on branch `workstream/cluster-c-projectmember-guard`, stacked on `69dd4cf2`
(pnpm 11 migration + Slices 0–4, guard = 56). PR #119 (draft, stacked under
PR #118).

- **Apply**: Strict TDD, single-pr delivery (measured well under the 400
  authored-line budget). All 18 tasks across 7 phases complete
  (`sdd/project-member-tenant-guard/apply-progress`, engram obs #327).
  Foundation (schema + 2 migrations + guard flip, Phases 2–3, 4 files) was
  [SENSITIVE — orchestrator]-owned under the `omnipost-allow sensitive-edit`
  token; every other file was apply-agent-owned.
- **Verify**: PASS WITH WARNINGS — **0 CRITICAL**, 2 WARNING, 1 SUGGESTION
  (`sdd/project-member-tenant-guard/verify-report`, engram obs #328).
  Independent re-run reported:
  - MERGE-BLOCKING `integration:tenant-isolation` batch: **88/88 pass, 0
    fail, 0 cancelled, 0 skip** (8 files).
  - Affected unit set (`tenantGuard.test.ts`): **52/52 pass** (size
    assertion 57 green).
  - Full unit regression: **505 files / 8000 tests pass / 0 fail**.
  - `tsc --noEmit` = 0 across `@apps/api` and `@core/domain`; `@infra/prisma`
    build (`prisma generate && tsc -p tsconfig.build.json`) = 0.
  - `eslint --max-warnings 0` = 0 on the 6 changed TS files.
  - Fitness #8/#10/#21/#23 = 0; fitness #9 (`@file` header) = 0 in scope
    (`seed.ts` is pre-existing header-less infra, out of fitness #9 scope).
  - `prisma migrate status`: up to date (62 migrations).
  - **DB ground truth (psql)**: `tenant_isolation` policies = **57** on
    **57** distinct tables (1:1); `ProjectMember.accountId` `is_nullable` =
    **NO**; `ProjectMember` rows = **50**, NULL `accountId` = **0**,
    double-parent mismatch = **0**.
- **CI**: green — **27 pass / 2 scheduled-only skips** on PR #119 (draft,
  stacked on #118).

## Delivered scope

- **Schema + migration pair** (`20260716000000_add_project_member_account_id`
  → `20260716000100_add_rls_project_member` + `down.sql`, both strictly
  greater than `20260715000100`, column-before-RLS asserted). Column
  migration: nullable `accountId` ADD → **D2 double-parent `DO $$` RAISE**
  (asserts `Project.accountId == CustomerUser.accountId` for every row,
  BEFORE the backfill) → `UPDATE … FROM "Project"` over the NOT-NULL
  `projectId` FK → in-tx `RAISE EXCEPTION` on residual NULL → `SET NOT
NULL` → FK `Account` `ON DELETE CASCADE` → `CREATE INDEX
  (accountId, projectId)`, keeping `@@unique([projectId, memberId])` and
  `@@index([memberId])` untouched. RLS migration copies the Slice-4
  single-table shape verbatim (`tenant_isolation` policy, `app.account_id`
  GUC + `__system__` bypass, `DROP POLICY IF EXISTS` idempotence;
  `20260527000000` untouched). `Account` gains the `projectMembers`
  back-relation.
- **Guard flip**: `"projectMember"` inserted between `"project"`
  (`tenantGuard.ts:126`) and `"recurringPost"` (`:127`); header JSDoc count
  56 → 57.
- **Defensive threading on the dead reader (D5)**: `findByProjectId`
  (`PrismaCustomerUserRepository.ts:118-128`) keeps its signature and body
  unchanged — the guard AND-injects `accountId` into the query; a foreign
  `projectId` returns `[]`. Port JSDoc
  (`CustomerUserRepository.ts:44-48`) gained one contract sentence:
  "Tenant-scoped: the guarded client restricts results to the bound tenant
  context; a foreign projectId yields an empty list."
- **Seed fix (D6)**: `seed.ts:1112` create branch gained
  `accountId: account.id` (one line) — required because the seed's raw
  `@infra/prisma` client is unguarded and runs as superuser (BYPASSRLS),
  so the DB itself would reject the create post-`NOT NULL`.
- **Test harness wiring (gate-mandated, W1/W2)**: new `run_batch`
  `integration:tenant-isolation` in `apps/api/scripts/run-tests.sh` wiring
  all 7 `*TenantIsolation.test.ts` suites (6 previously never-wired +
  `projectMember`) plus `rls-tenant-isolation.test.ts`;
  `rls-tenant-isolation.test.ts`'s policy-count assertion converted from
  the literal `51` to a derived count via `getTenantScopedModels().size`
  with a bidirectional 1:1 mapping check.
- **New MERGE-BLOCKING two-tenant integration suite**
  (`apps/api/tests/integration/projectMemberTenantIsolation.test.ts`,
  node:test, real DB): builds the production guard composition in-test
  (`prisma.$extends(tenantGuardExtension(provider))` + real ALS provider +
  real `PrismaCustomerUserRepository`). `seedTenant` creates ONE membership
  row PER tenant so the foreign-read `[]` assertion is non-vacuous.
  Covers: (a) A-ctx `findByProjectId(B.projectId)` → `[]`; (b) A-ctx own
  projectId → own members only; (c) no-context read →
  `TenantContextMissingError`; (d) A-ctx guarded create WITHOUT
  `accountId` → row `accountId == Project.accountId == CustomerUser.accountId`;
  (e) create with an explicit FOREIGN `accountId` → mismatch throw. 7/7,
  0 cancelled — 88/88 across the full new batch.
- **Docs**: `docs/security/MULTI_TENANT_GUARDS.md` — `ProjectMember`
  enrolled (3-step canon checklist), guard count 56 → 57 + RLS counts, and
  the double-parent RAISE + no-HTTP-surface facts noted, with SMELL-59
  cited as the deferred create-ownership owner.

## Capabilities / specs applied

- `multi-tenant-isolation` → `openspec/specs/multi-tenant-isolation/spec.md`
  (living capability, EXTENDED — not created). This archive phase:
  - Confirmed the Requirement 1 "Enrolled models" table and Requirement 3
    "Applied so far" table already carried `ProjectMember`'s row (appended
    during apply, task 7.3) — not duplicated.
  - Added the model-scoped Requirement-2-shaped block "ProjectMember — a
    forgotten feature enrolled defensively; cross-tenant membership is
    unresolvable at the guarded-client layer, and double-parent accountId
    consistency holds", copied VERBATIM from the delta's ADDED
    Requirements (including its "Deferred obligation" clause), positioned
    after Slice 4's `GeneratedImage usage billing` requirement and before
    the model-agnostic `Create paths validate parent ownership` requirement
    (Req 3), per the living spec's model-scoped-by-design extension
    contract.
  - Applied the delta's MODIFIED "Backfill integrity — zero NULL
    accountId" requirement: appended the double-parent equality invariant
    sentence to the requirement body and added the new
    `[deploy-time]`-tagged scenario "a double-parent mismatch halts the
    migration". The existing single-parent invariant text and its
    `[integration]` scenario were left unchanged.
  - Extended the tag taxonomy paragraph (in the living spec's header) with
    a minimal definition of the new `[deploy-time]` tag: enforced by a
    migration-time assertion (a `RAISE`) that halts the deploy on
    violation, checkable by inspecting the migration SQL rather than by
    test execution.
  - Extended the living spec's header with an "Extended by Slice 5"
    paragraph recording the two "FIRST" facts (double-parent parent, empty
    HTTP surface), the deferred create-ownership obligation, and the two
    rollout-wide fixes (W1 batch wiring, W2 derived policy count) as
    durable context for readers who only see the living spec.
  - No requirement blocks were duplicated; each requirement heading appears
    exactly once in the merged spec.

## Residual (on the record, non-blocking)

**Deferred obligation (documented in the spec, not a gap in this slice)**:
`ProjectMember`'s create-path parent-ownership check is N/A today — there
is no production create path (seed-only writer). When backlog SMELL-59
wires a route or use case that writes `ProjectMember`, that write path
SHALL add a create-path assertion validating BOTH `projectId` → `Project`
AND `memberId` → `CustomerUser` before persist. This is the FIRST enrolled
model whose create-path obligation requires validating TWO parent refs
simultaneously (composite-FK hardening) — a durable pattern for any future
model with more than one `accountId`-bearing parent.

**Design-acknowledged coverage gap (verify-report WARNING W-2, non-blocking)**:
the spec scenario "a double-parent mismatch halts the migration" is tagged
`[deploy-time]` and enforced by the migration's `RAISE` (verified present
and correct at `migration.sql:19-30`), not by a runtime test — per design
decision D7, replaying the `DO $$` block from a test would drift from the
real migration file. The requirement's normative RAISE-halt behavior IS
satisfied structurally, and the real-DB invariant holds (0 mismatches on
50 rows).

Carried forward (unchanged status): the per-slice integration test remains
the ONLY enforcement of `accountId == <parent>.accountId` on write paths;
no static/fitness guard exists yet (same residual noted in Slices 1–4).
SMELL-58 (GenerateImageUseCase lacking a UnitOfWork, from Slice 4) is
unaffected by this slice — `ProjectMember` has no production writer to
audit for UoW membership.

## Task completion

All 18 checkboxes across 7 phases in `tasks.md` are `[x]`. The independent
verify-report (engram obs #328) flagged a transient WARNING (W-1) that
tasks 2.1/2.2/2.3/3.1 (the [SENSITIVE — orchestrator]-owned schema +
migration + guard-flip tasks) appeared unchecked at verify time even
though their deliverables were VERIFIED present on disk
(`schema.prisma:370-385`; both migrations; guard Set + header count 57).
This archive phase re-read `tasks.md` directly and confirms all four boxes
are now `[x]` — no reconciliation action was needed at archive time; the
checkboxes were updated between verify and archive, and the archived
`tasks.md` carries no stale unchecked items.

## Verification status

Independent verify (`sdd/project-member-tenant-guard/verify-report`,
engram obs #328) reported **PASS WITH WARNINGS — 0 CRITICAL, 2 WARNING, 1
SUGGESTION**. All MERGE-BLOCKING scenarios in the spec compliance matrix
are PASS (7 of 8 rows) with one WARNING row (the deploy-time double-parent
scenario, W-2 above, structurally satisfied but not runtime-tested by
design). Full evidence: MERGE-BLOCKING batch 88/88 (0 cancelled), affected
unit set 52/52, full unit regression 8000/0, `tsc` = 0 across
`@apps/api`/`@core/domain`/`@infra/prisma`, `eslint --max-warnings 0` = 0,
fitness #8/#10/#21/#23 = 0, DB ground truth exact (57 policies on 57
tables, 0 NULL, 0 mismatch on 50 rows).

## Merge reference

- PR: **#119** (draft, stacked on **#118** — pnpm 10→11 migration)
- CI: green — **27 pass / 2 scheduled-only skips**
- Branch: `workstream/cluster-c-projectmember-guard`
- Date archived: **2026-07-16**

## Rollout continuation

This is **Slice 5 of 9** in the `project-scoped-tenant-guard` rollout
(N-SEC-3) (Slice 1: `external-notification-tenant-guard`, PR #113,
archived; Slice 2: `scheduled-report-campaign-tenant-guard`, PR #114,
archived; Slice 3: `recurring-post-tracked-link-tenant-guard`, PR #116,
archived; Slice 4: `generated-image-tenant-guard`, PR #117/#118,
archived). This slice's `ProjectMember` model is now closed under N-SEC-3.
Slices 6–9 inherit two new generalizations, now embedded in the living
spec's header extension contract:

1. **A composite/double-parent model requires an equality assertion
   BEFORE the backfill, not a single-parent derivation with a post-hoc
   check.** When a future model has TWO (or more) `accountId`-bearing
   parents, the migration MUST assert cross-parent equality in a
   dedicated pre-backfill step and RAISE-and-halt on mismatch — silently
   picking one parent's value is the corruption the two-layer guard exists
   to prevent.
2. **A structurally EMPTY HTTP surface is a legitimate, provable outcome
   for the MERGE-BLOCKING proof layer — not a shortcut.** When a model
   genuinely has zero live routes (verified by route-table grep, not
   assumed), the requirement text should say so explicitly and the
   integration proof should run at the repository/guarded-client layer,
   exercising the EXACT guard composition future route wiring will use.
3. **Rollout-wide CI enforcement gaps are fair game for any slice to
   close, not just the model-scoped enrollment.** This slice discovered
   and fixed that 6 prior MERGE-BLOCKING suites had never been wired into
   any `run-tests.sh` batch and that the RLS policy-count assertion had
   been silently stale since Slice 1 — both fixed here rather than
   deferred, because a slice cannot honestly claim MERGE-BLOCKING status
   for its own suite while the rollout's existing proofs sit unexecuted.

## Traceability — Engram observations

| Artifact                                | Topic key                                        | Observation           |
| --------------------------------------- | ------------------------------------------------ | --------------------- |
| Proposal (refreshed, forgotten-feature) | `sdd/project-member-tenant-guard/proposal`       | #319                  |
| Spec (delta)                            | `sdd/project-member-tenant-guard/spec`           | #325                  |
| Design (incl. D1–D9)                    | `sdd/project-member-tenant-guard/design`         | #324                  |
| Tasks                                   | `sdd/project-member-tenant-guard/tasks`          | #326                  |
| Apply progress                          | `sdd/project-member-tenant-guard/apply-progress` | #327                  |
| Verify report                           | `sdd/project-member-tenant-guard/verify-report`  | #328                  |
| Archive report (this document)          | `sdd/project-member-tenant-guard/archive-report` | (saved by this phase) |
