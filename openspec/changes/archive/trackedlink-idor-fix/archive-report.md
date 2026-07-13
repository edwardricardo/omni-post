# Archive Report — trackedlink-idor-fix

> Closure record for the `trackedlink-idor-fix` (N-SEC-3 primary) SDD change. Archived
> 2026-07-13. Store: openspec (mirrored to engram). Branch:
> `workstream/cluster-c-trackedlink-idor-security`.

## Outcome

The live CWE-639 IDOR on `TrackedLink` is closed. Before this change, an authenticated
tenant A could use A's own valid JWT to read (`GET /links/:id`, `GET /links/:id/stats`)
and destructively delete (`DELETE /links/:id`, cascading `LinkClick` rows) tenant B's
tracked links, because `PrismaTrackedLinkRepository.findById`/`.delete` used unscoped
`findUnique`/`findUnique`-then-`delete` with no ownership filter. The fix is **Seam A**
(adapter resolves the account internally): `findById`, `delete`, and (harden pass)
`getClickStats` now query `findFirst({ where: { id, project: { accountId:
requireTenantContext().accountId } } })`. Foreign and nonexistent ids both resolve to the
same `EntityNotFoundError` → 404 (anti-enumeration, no FORBIDDEN branch). The public
redirect (`GET /r/:shortCode`, `findByShortCode`/`recordClick`) is deliberately left
UNSCOPED — it has no bound TenantContext and must keep resolving for anonymous visitors.
The unwired `/api/cqrs/*` dead route (a latent cross-tenant PUBLISH primitive, zero
non-test wiring) was deleted alongside its 3 test files. A phantom-control claim in
`docs/security/MULTI_TENANT_GUARDS.md` (that fitness #23 scans typed-Prisma adapters for a
missing join) was corrected to state #23's real, narrower scope (raw-query blocking only).

## Verification

- **`sdd-verify` verdict**: **PASS** — 0 CRITICAL · 0 WARNING · 1 SUGGESTION
  (`sdd/trackedlink-idor-fix/verify-report`, engram obs #254). The single SUGGESTION is
  documentation-only line-ref drift in `design.md`'s caller-safety table (use-case symbol
  refs were exact; route-registration line numbers were 2-3 lines stale) — zero code or
  behavior impact, non-blocking.
- **Design-phase adversarial gate**: PASS — 0 CRITICAL, 0 confirmed WARNING, 4 real
  SUGGESTIONs. Per the "recommendations into the active plan" rule, all 4 were folded into
  slice 1 as **Phase 5 (harden pass)** rather than deferred:
  1. `getClickStats` scoped by construction (transitive `project.accountId` join, not
     merely safe-by-convention behind `findById`'s gate).
  2. Byte-identical anti-enumeration body assertions extended to `GET /links/:id/stats`
     and `GET /links/:id/utm-url` (previously status-only).
  3. Mutating UTM write-path regression guard added: `POST /links/{B_id}/utm` → 404 AND
     tenant B's UTM fields provably unchanged.
  4. `design.md` caller-safety table corrected (UTM route path + use-case import path).
- **All 18 tasks** (`tasks.md` Phase 0–5) `[x]` and independently confirmed implemented by
  `sdd-verify` — not merely checked.
- **3 MERGE-BLOCKING requirements** proven by a real-DB two-tenant integration test
  (`apps/api/tests/integration/trackedLinkTenantIsolation.integration.test.ts`, 8/8 green):
  ownership-scoped resolution, anti-enumeration, no destructive cross-tenant effect. The 3
  non-blocking requirements (account-from-context, CQRS removal, doc truth) confirmed at
  source.
- **0/0 gate**: `tsc --noEmit` (apps/api) = 0 errors; `eslint --max-warnings 0` on touched
  files = clean; fitness **#21** (no Prisma singleton outside composition root) = 0;
  fitness **#23** (no raw queries outside guard) = 0.

## Delivery

Delivered as **2 stacked PRs** (stacked-to-main chain strategy, per `tasks.md`'s Review
Workload Forecast — the raw diff was ~2340 lines, but ~2160 of that was pure dead-code
deletion with near-zero review load; splitting kept the MERGE-BLOCKING security review
focused):

- **PR #109** — security fix (~180 review-bearing lines): the adapter scoping (Seam A),
  the two-tenant integration test, the `MULTI_TENANT_GUARDS.md` correction, and the full
  Phase 5 harden pass.
- **PR #110** — CQRS dead-code purge (~2160 pure deletions): `CQRSIntegration.ts` + its 3
  unit test files, chained after PR #109.

**CI status**: green on both PRs, except the 4 pre-existing "Container Security" Docker
jobs, which are red on every PR in this repo regardless of change content — the
containerization workstream is paused (no Dockerfile has ever successfully built; tracked
separately, unrelated to this change).

**Post-verify CI finding (caught by PR #109's CI, fixed pre-merge)**: the preexisting unit
test `apps/api/tests/unit/infrastructure/TrackedLinkRepository.test.ts` called the
newly-scoped repository methods without a bound TenantContext and mocked `findUnique`
where the change moved to `findFirst` — 8 tests went red in CI Test Suite shard 2 (not
caught by the LXC-safe single-file local run, nor by `tsc` since `apps/api/tsconfig.json`
does not type-check `tests/`). Fixed by binding `withTenantContext` in all 8 cases,
updating the mocks to `findFirst`, and adding a scoped-`where` assertion — 23/23 green
after the fix, full shard 3921/3921 green. Recorded as process learning **SMELL-53**
(engram obs #255): a repository-method change must run every preexisting test that
exercises that method, not just the new integration file, before declaring a change ready.

## Capabilities / specs applied

The change's spec — a NEW capability, not a delta against a prior main spec — is now the
living specification:

- `trackedlink-tenant-isolation` → `openspec/specs/trackedlink-tenant-isolation/spec.md`
  (NEW capability — created at archive time; no prior main spec existed). Carries a
  `## Known follow-up` section documenting the deferred write-side IDOR (see below) so the
  living spec accurately reflects TrackedLink's current tenant-isolation posture.

## Task completion

All 18 tasks (`T0.1`–`T5.4`) are `[x]` in the persisted `tasks.md`, independently confirmed
implemented by `sdd-verify` (not stale checkboxes — no reconciliation was needed). The
post-merge SMELL-53 fix (CI-caught regression in a preexisting test) is not part of the
original 18-task plan; it is recorded in `tasks.md`'s `## Post-merge` note and in this
report's `## Delivery` section for audit completeness.

## Deferred item (explicit, tracked separately)

**One item is intentionally NOT closed by this change**, per the proposal's own `## Scope`
"Out of Scope" section: the **write-side IDOR on `POST /links`**. `CreateTrackedLinkUseCase`
(`packages/core/links/src/CreateTrackedLinkUseCase.ts:34`) takes `projectId` directly from
the request body (`linkRoutes.ts:63-81` → `CreateLinkBodySchema.projectId`) and never
verifies that project belongs to the caller's account — `TrackedLink` is not yet in
`TENANT_SCOPED_MODELS`, so the Prisma tenant-guard extension is inert on `create`. Impact:
tenant A can `POST /links` with a project UUID belonging to tenant B and persist a link
under B's project (attribution pollution, short links redirecting under B's namespace).
Lower severity than the read/delete hole this change closes (requires B's project UUID
out-of-band; A cannot read the write back, since `findById` is now scoped). This is real,
live debt, explicitly deferred by the original spec's scope boundary — not a regression
introduced or missed by this change.

**Tracked for**: the `project-scoped-tenant-guard` change (the structural `accountId`
denormalization across the 9 projectId-only models). Full detail in engram
`security/trackedlink-write-idor` (**observation #252**): recommends either (a) adding
`trackedLink` to `TENANT_SCOPED_MODELS` once `accountId` is denormalized onto the table, or
(b) validating project-ownership inside `CreateTrackedLinkUseCase` by injecting
`ProjectRepository` and checking `project.accountId` against the bound context.

## Traceability — Engram observation IDs

| Artifact        | Engram topic_key                                     | Observation ID |
| --------------- | ---------------------------------------------------- | -------------- |
| Proposal        | `sdd/trackedlink-idor-fix/proposal`                  | #245           |
| Spec            | `sdd/trackedlink-idor-fix/spec`                      | #246           |
| Design          | `sdd/trackedlink-idor-fix/design`                    | #247           |
| Tasks           | `sdd/trackedlink-idor-fix/tasks`                     | #249           |
| Apply progress  | `sdd/trackedlink-idor-fix/apply-progress`            | #250           |
| Verify report   | `sdd/trackedlink-idor-fix/verify-report`             | #254           |
| Deferred item   | `security/trackedlink-write-idor`                    | #252           |
| Process finding | `process/single-file-test-gap-regression` (SMELL-53) | #255           |

## Merge reference

- PRs: **#109** (security fix) → **#110** (CQRS dead-code purge), stacked-to-main
- Branch: `workstream/cluster-c-trackedlink-idor-security`
- Date archived: **2026-07-13**

## Follow-up

- **`project-scoped-tenant-guard`** — the structural `accountId` denormalization across the
  9 projectId-only models; MUST include the TrackedLink write-side IDOR (obs #252) as an
  explicit requirement when that change starts.
- **N-SEC-4** (AI response-cache cross-tenant leak) — separate, unrelated slice, still open.
