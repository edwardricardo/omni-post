# Archive Report — external-notification-tenant-guard

> Closure record for the `external-notification-tenant-guard` SDD change
> (Slice 1 of the `project-scoped-tenant-guard` rollout — REFERENCE IMPLEMENTATION).
> Archived 2026-07-14. Store: hybrid (openspec files + engram mirror).

## Outcome

`ExternalNotificationConfig` is now isolated by construction under the two-layer
tenant guard (Prisma `$extends` + PostgreSQL RLS), closing a LIVE credential-bearing
IDOR (CWE-639): three authenticated routes previously read/deleted/test-fired
DECRYPTED Slack/Teams webhook secrets for a foreign `projectId`/`id`, and a fourth
route (create) persisted a foreign `projectId` with no ownership check. All four
paths are closed. The change is the REFERENCE IMPLEMENTATION for Slices 2–8 of the
`project-scoped-tenant-guard` rollout — its recipe (below) is the copy/adapt template
the remaining 7 models follow.

Full SDD cycle: proposal → spec → design → tasks → apply → verify → archive, on
branch `workstream/cluster-c-extnotif-guard`.

- **Design gate**: adversarial review PASSED with **0 CRITICAL / 0 WARNING** across
  4 lenses; 7 suggestions were hardened into the design before apply (D1 migration
  order + index-rule correction, D2 explicit accountId threading, D3 list-stays-200
  argued-against-the-lean decision, D3a create-path 404-not-500 conformance trap,
  D4 no-shared-helper rationale + residual on the record).
- **Apply**: token-split pattern (the 15-minute `omnipost-allow sensitive-edit` TTL
  does not cover a full delegated apply). The orchestrator prep-read every sensitive
  file's exact target content BEFORE requesting the token, then wrote
  `schema.prisma`, `tenantGuard.ts`, and the two migrations (+`down.sql`) INLINE the
  instant the token arrived, verified with the token still active (`prisma format`
  / `validate` / `generate`, `pnpm db:migrate`, zero-NULL check), and only then
  delegated the non-sensitive remainder (accountId threading through
  use case/data/adapter, the route's `NOT_FOUND → 404` branch, DI wiring, and the
  full test set) to an agent explicitly told not to touch `infra/prisma`.
- **Verify**: independent re-verification (`sdd-verify`) **PASS — 0 CRITICAL / 0
  WARNING / 3 SUGGESTION**, all non-blocking. Re-ran every test suite from source
  (not trusted from apply-progress) and confirmed DB state directly via `pg_catalog`
  introspection (NOT NULL column, FK `ON DELETE CASCADE`, accountId-led index, RLS
  policy byte-identical in shape to `20260527000000`, zero NULL/divergent
  `accountId` rows, 51 `tenant_isolation` policies DB-wide).
- **CI**: PR #113 green — 32 checks passing (Squawk, Integration, Test-Suite among
  them). The only reds are the 4 pre-existing Container Security Docker jobs, which
  are red on every PR in this repo and are not part of this change's scope.

## Delivered scope

- **Schema + migrations** (two, load-bearing order): Migration A
  (`20260714020035_..._account_id`) — nullable `accountId` → backfill from
  `Project` over the `projectId` FK → in-tx zero-NULL assert (`RAISE EXCEPTION`) →
  `SET NOT NULL` → FK to `Account` (`ON DELETE CASCADE`) → accountId-led
  `CREATE INDEX`. Migration B (`20260714020135_..._add_rls_...` + `down.sql`) — new
  forward RLS migration copying the `tenant_isolation` policy shape from
  `20260527000000` (never edited in place). Ordering asserted:
  `A(020035) < B(020135)`.
- **Guard flip**: `externalNotificationConfig` appended to `TENANT_SCOPED_MODELS`
  in `infra/prisma/src/extensions/tenantGuard.ts` (header count 50 → 51).
- **accountId threading (D2)**: `ExternalNotificationConfigData` gains a required
  `accountId: string`; `ConfigureExternalNotificationUseCase` resolves the parent
  project via the guard-scoped `ProjectRepositoryPort` BEFORE `doWork` and threads
  `project.accountId` explicitly into the create payload — no ambient
  `requireTenantContext()` read inside the adapter.
- **Create-path ownership + 404 conformance (D3a)**: foreign/missing project
  resolves to `err(USE_CASE_ERRORS.NOT_FOUND)` returned BEFORE `doWork`, so the
  use case's catch-all never flattens it to `INTERNAL_ERROR`; the create route
  gained a `NOT_FOUND → 404` branch (previously `VALIDATION_FAILED ? 400 : 500`
  only, which would have 500'd a foreign-project probe).
- **List stays 200 + `[]` for a foreign `projectId` (D3, argued)**: no 404
  reintroduced on the read path — guard-natural empty result is
  security-equivalent and avoids reintroducing per-route ownership probes across
  Slices 2–8.
- **Tests**: guard unit tests (`tenantGuard.test.ts`, 24/24 incl. the new
  membership/injection/mismatch/no-context cases for this model), use-case unit
  tests (api + core, 12/12 + 8/8), repository unit test (4/4), DI wiring test
  (2/2), and the MERGE-BLOCKING two-tenant real-DB integration suite
  `apps/api/tests/integration/externalNotificationTenantIsolation.test.ts`
  (10/10, 0 cancelled) — the sole enforcement for the List and Test-fire routes,
  which run outside a UoW so RLS (layer 2) is inert for them at runtime; List and
  Test-fire are guarded by layer 1 (the Prisma `$extends` guard) alone.
- **Regression sweep (SMELL-53)**: full affected set re-run green — `@apps/api`
  vitest 55/55 (tenantGuard + externalNotificationUseCase +
  PrismaExternalNotificationConfigRepository + setupExternalNotificationUseCases +
  Slack + Teams adapters), `@core/external-notifications` vitest 8/8, INT
  externalNotificationTenantIsolation 10/10, INT rls-tenant-isolation 11/11 (policy
  count 51 unaffected — the PublishingQueue drop netted out this migration's
  addition).
- **Docs**: `docs/security/MULTI_TENANT_GUARDS.md` — `ExternalNotificationConfig`
  promoted from transitively-scoped to tenant-scoped; stale "50 models"/"51
  tables" counts corrected; a create-path parent-ownership recipe section added.
- **0-defect gate**: `tsc --noEmit` = 0 across `@apps/api`, `@core/external-notifications`,
  `@core/domain`; `eslint --max-warnings 0` = 0 on all 11 touched files; fitness
  #21 (no Prisma singleton outside composition roots) = 0; fitness #23 (no raw
  queries outside guard exceptions) = 0.

## Capabilities / specs applied

The change's delta spec is the FOUNDING instance of a new, shared, extensible
capability — folded into a living specification structured for extension, not a
one-shot closed spec:

- `multi-tenant-isolation` → `openspec/specs/multi-tenant-isolation/spec.md`
  (**NEW capability** — created at archive time; no prior main spec existed).
  Requirements 1 (structural isolation, 3 legs), 3 (create-path parent ownership),
  4 (backfill integrity), and 5 (no caller regression) are **model-agnostic
  invariants**, stated once, extended by Slices 2–8 via the "Enrolled models" /
  "Applied so far" tables and additional scenario instances — WITHOUT restating
  the invariant text. Requirement 2 ("the live IDOR routes are closed") is
  **model-scoped by design** — this archive renamed it to
  `ExternalNotificationConfig — the three live IDOR routes are closed...` so each
  future slice ADDS its own Requirement-2-shaped block (named after its model)
  instead of colliding with or overwriting this one.
  This capability is explicitly distinct from the per-model APP-LEVEL ownership
  specs archived separately (`trackedlink-tenant-isolation`, `post-tenant-isolation`),
  which gate at the route/use-case layer rather than the data layer.

## Reference-implementation recipe (Slices 2–8 inherit)

Recorded in `design.md §Recipe for Slices 2–8` and reproduced here for archive
traceability:

1. **Two migrations, mandated order** — column/backfill migration FIRST (nullable
   → backfill → in-tx zero-NULL assert → `SET NOT NULL` → FK → index), forward RLS
   migration SECOND, with its own `down.sql`. Never edit `20260527000000` in
   place. Assert `A.timestamp < B.timestamp`.
2. **Guard-list append** — the new model's lowerCamel name into
   `TENANT_SCOPED_MODELS`; bump the header count comment.
3. **Index rule** — accountId-led at minimum (`@@index([accountId])`); prefer the
   composite `@@index([accountId, <parentId>])` when the guarded read is
   parent-filtered (corrected from an earlier false claim that a sibling model,
   `SchedulingRule`, used a plain single-column index — it in fact uses the
   composite).
4. **Explicit accountId threading** — use case → data → adapter; no ambient
   `requireTenantContext()` read inside an adapter. The parent's guard-scoped
   `findById` IS the ownership check.
5. **404-not-500 conformance** — any write-path ownership probe MUST verify its
   error survives as `NOT_FOUND` through BOTH the use case's catch-all AND the
   route's status map. A probe that 500s is a conformance failure, not a pass.
6. **Two-tenant integration test as the enforcement mechanism** — real DB, through
   HTTP, asserting foreign list/delete/test-fire/create behavior AND that no
   sensitive field crosses the tenant boundary. This is the ONLY enforcement for
   any route that runs outside a UoW (RLS/layer 2 is inert there).
7. **Expand/contract caveat** — the `nullable → backfill → SET NOT NULL` shape is
   downtime-safe only for a single-deployable target. On a rolling deploy, a slice
   MUST keep the column nullable-writable through the rollout and tighten to NOT
   NULL in a follow-up migration, to avoid an old pod's create violating the new
   constraint before every pod carries the guard-list + threading change.

## Residual (on the record, non-blocking)

**SUGGESTION S1** (design D4 residual, confirmed at verify): the per-slice
integration test is the ONLY enforcement of `accountId == <parent>.accountId` on
write paths. There is no static/fitness guard, so a FUTURE divergent write path
(a bulk `createMany`, or a route that repoints a model's `projectId`) could persist
an inconsistent row with no test catching it. A grep-based fitness function
("create/upsert on a `projectId`-bearing model without a preceding guarded parent
resolution") is a backlog candidate if drift appears across Slices 2–8 — not
introduced in this change.

Two further non-blocking suggestions from `verify-report.md` (S2: cosmetic task
count mismatch — launch prompt said "21", the artifact has 20, all `[x]`; S3: a
minor test-style inconsistency between an api-side `as never` cast and a
structurally-typed core mock) carry no functional impact and require no follow-up.

## Task completion

All 20 tasks across 6 phases in `tasks.md` are `[x]`. No stale-checkbox
reconciliation was needed — the tasks artifact already reflected final state at
archive time.

## Verification status

`sdd-verify` PASS — **0 CRITICAL / 0 WARNING / 3 SUGGESTION** (see above). Full
detail: `verify-report.md` in this folder; engram mirror `sdd/external-notification-tenant-guard/verify-report`
(observation #280).

## Merge reference

- PR: **#113** — CI green (32 checks passing; the 4 Container Security Docker job
  reds are pre-existing on every PR in this repo and out of this change's scope)
- Branch: `workstream/cluster-c-extnotif-guard`
- Date archived: **2026-07-14**

## Rollout continuation

This is **Slice 1 of 9** in the `project-scoped-tenant-guard` rollout. Next:
**Slice 2 — ScheduledReport**, followed by **Slice 3 — Campaign**, each copying
this reference recipe and adapting the per-model deltas called out in
`design.md §Recipe` (backfill join source, soft-delete semantics, guarded parent
model, out-of-context callers, `@@unique` interplay, nested-write threading).

## Traceability — Engram observations

| Artifact                                              | Topic key                                               | Observation           |
| ----------------------------------------------------- | ------------------------------------------------------- | --------------------- |
| Proposal                                              | `sdd/external-notification-tenant-guard/proposal`       | #272                  |
| Spec (delta)                                          | `sdd/external-notification-tenant-guard/spec`           | #274                  |
| Design                                                | `sdd/external-notification-tenant-guard/design`         | #275                  |
| Tasks                                                 | `sdd/external-notification-tenant-guard/tasks`          | #276                  |
| Verify report                                         | `sdd/external-notification-tenant-guard/verify-report`  | #280                  |
| Apply pattern (token-split, cross-slice)              | `process/sensitive-edit-token-apply-pattern`            | #278                  |
| Create-path ownership pattern (cross-model discovery) | `security/create-path-projectid-ownership-gap`          | #273                  |
| Archive report (this document)                        | `sdd/external-notification-tenant-guard/archive-report` | (saved by this phase) |
