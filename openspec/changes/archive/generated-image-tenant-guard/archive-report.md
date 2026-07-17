# Archive Report — generated-image-tenant-guard

> Closure record for the `generated-image-tenant-guard` SDD change (Slice 4
> of the `project-scoped-tenant-guard` rollout, N-SEC-3). Archived 2026-07-15.
> Store: hybrid (openspec files + engram mirror). Branch:
> `workstream/cluster-c-generatedimage-guard`, superseded on disk by
> `workstream/pnpm-11-migration` (stacks on and includes Slice 4's code).

## Outcome

`GeneratedImage` is now isolated by construction under the two-layer tenant
guard (Prisma `$extends` + PostgreSQL RLS), closing a LIVE cross-tenant IDOR
(CWE-639) and, in-slice, a client-supplied-`accountId` billing-integrity
smell:

- **List IDOR**: `GET /ai/generated-images?projectId={B}` returned tenant
  B's images (prompt text, revised prompts, image URLs) to tenant A. Closed
  guard-naturally — `findByProjectId` is AND-scoped by the guard, so a
  foreign `projectId` now returns `200 + []` with no per-route ownership
  check required.
- **Create-path IDOR with paid-spend escalation**: `POST /ai/generate-image`
  had zero ownership check on the client-supplied `projectId` and would burn
  a paid AI-provider call AND plant a row into a foreign project. Closed by
  injecting `ProjectRepositoryPort` into `GenerateImageUseCase` and running
  the guarded `findById(projectId)` check BEFORE `imageGenerator.generateImage`
  — a foreign `projectId` now resolves to **404 NOT_FOUND** (never 403/500)
  with **zero AI spend and zero persisted rows**. `GeneratedImage` is the
  FIRST model in the rollout whose ownership check gates a paid external
  call, and the FIRST with a structurally EMPTY join/child-table gap class
  (no child or join tables exist at all).
- **Server-derived billing fix (SIGNED, engram obs 306)**: the generate
  route previously billed `aiCallsMade` against an optional CLIENT-supplied
  `accountId` in the request body. Fixed in-slice: `accountId` was removed
  from `GenerateImageBodySchema` and the increment now runs unconditionally
  on success against `request.customerUser.accountId` (the same
  JWT-verified value that binds `enterTenantContext`). A foreign
  body-supplied `accountId` is now silently stripped by `z.object` (no
  breaking change for old clients) and can no longer influence billing
  attribution.
- **Response hygiene**: both handlers previously returned the DTO raw. Since
  `accountId` became a required DTO field (to satisfy the NOT-NULL column at
  compile time), both handlers now strip it before `sendSuccess` — the
  single-DTO generate response via object destructure, and the list-array
  response via `.map(({ accountId, ...rest }) => rest)` (a literal
  destructure on the array would have re-leaked `accountId` on every
  element).

This is the FIRST slice since Slice 1 with a completely empty
out-of-context-caller inventory (generate is synchronous, in-request; no
`withSystemContext()` wraps were needed).

Full SDD cycle: proposal → spec → design → tasks → apply → verify → archive,
on branch `workstream/cluster-c-generatedimage-guard`, stacked on the Slice 3
branch @ base `8bf3e7e2` (guard = 55). PR #117 was subsequently stacked
under PR #118 (the pnpm 10→11 migration), which re-validated Slice 4 under
pnpm 11 and is what shipped CI-green on branch
`workstream/pnpm-11-migration`.

- **Apply**: Strict TDD (RED unit → GREEN → REFACTOR per file). 21/21 tasks
  complete, self-reported apply numbers
  (`sdd/generated-image-tenant-guard/apply-progress`, engram obs #310).
  Foundation (schema + migrations + guard flip, Phases 2–3) applied by the
  orchestrator under the `omnipost-allow sensitive-edit` token; the
  apply-executor completed Phases 1, 4, 5, 6, 7, 8.
- **Design adversarial gate**: PASSED, 0 CRITICAL, after 1 gate-confirmed
  fix applied before apply started (per orchestrator attestation carried
  into this archive phase; no dedicated gate-fix engram artifact was located
  under a `generated-image-tenant-guard` review topic — the fix is reflected
  in the final design D1–D8 decisions at `design.md`, which apply-progress
  confirms matches 1:1 with zero deviations).
- **Diff-gate (post-apply adversarial review)**: 0 findings on the
  implementation diff (per orchestrator attestation; same traceability note
  as above).
- **Verify**: independent re-run reported **tsc = 0** across the touched
  packages and the MERGE-BLOCKING integration suite **8/8, 0 cancelled**
  (per orchestrator attestation). These numbers match the apply-time
  self-report in obs #310 exactly (`tsc @core/domain/@core/ai-image/@apps/api
= 0`; integration `8/8, 0 cancelled`) — no independent verify-report
  observation was found under the expected
  `sdd/generated-image-tenant-guard/verify-report` topic key in Engram
  during this archive phase; this is recorded here for traceability rather
  than silently assumed.
- **CI**: green 5/5 workflows on commit `fd3bc746` (PR #118, stacked over
  PR #117 = Slice 4) — Security Audit, size-limit, knip, Integration Tests,
  Fitness, Security Testing, Evals, and Pre-merge Audit all passing (engram
  obs #312). Because #118 stacks on Slice 4, this CI run re-validated Slice
  4's code under the pnpm 11 toolchain.

## Delivered scope

- **Schema + migration pair** (timestamps `20260715…`, both strictly greater
  than Slice 3's latest `20260714040300`, column-before-RLS asserted):
  `add_generated_image_account_id` → `add_rls_generated_image`
  (+`down.sql`). Column migration copies Slice-1 Recipe A verbatim (nullable
  `accountId` ADD → backfill from `Project` over the NOT-NULL `projectId` FK
  → in-tx `RAISE EXCEPTION` on residual NULL → `SET NOT NULL` → FK to
  `Account` `ON DELETE CASCADE` → `@@index([accountId, projectId])`, keeping
  the existing `@@index([projectId, createdAt])`); RLS migration copies
  Recipe B verbatim (new forward `tenant_isolation` policy, `app.account_id`
  GUC + `__system__` bypass; `20260527000000` untouched). `Account` gains
  the `generatedImages` back-relation. No `@@unique` interplay.
- **Guard flip**: `"generatedImage"` inserted alphabetically between
  `"gatewaySwitchEvent"` and `"glossary"` in
  `infra/prisma/src/extensions/tenantGuard.ts` (header count 55 → 56).
- **accountId threading (DTO-carried, no domain entity exists for this
  model — verified divergence, D3)**: `GeneratedImageData.accountId:
string` made required, threaded through the sole construction site
  (`GenerateImageUseCase`), the adapter's `create.data`, and both output
  mappings (`save`, `findMany`) in `PrismaGeneratedImageRepository`.
- **Create-path ownership BEFORE the paid AI call (D4)**:
  `GenerateImageUseCase` gained a `ProjectRepositoryPort` 2nd constructor
  parameter; execution order is now prompt-validation → guarded
  `projectRepository.findById(projectId)` → `err(NOT_FOUND)` on
  foreign/missing → ONLY THEN the AI-provider call → save with
  `accountId = project.accountId`. `setupAIImageUseCases.ts` wires
  `TOKENS.ProjectRepository` as the 2nd DI argument.
- **Route mapping + response strip + billing fix (D5, D6)**:
  `aiImageRoutes.ts` gained a `NOT_FOUND → 404` branch (previously only
  `VALIDATION_FAILED ? 400 : 500`); both handlers now strip `accountId`
  before `sendSuccess`; `accountId` was removed from
  `GenerateImageBodySchema` and its conditional gate, replaced by an
  unconditional `aiCallsMade` increment against
  `request.customerUser.accountId`.
- **Tests**: unit suites `tenantGuard.test.ts` (45/45, asserts
  `TENANT_SCOPED_MODELS` size 56), `GenerateImageUseCase.test.ts` (7/7,
  `@core/ai-image`), `generateImageUseCase.test.ts` (16/16, duplicate suite
  site in `apps/api`), plus the pre-existing `usageUseCase.test.ts` (10/10,
  unaffected). New MERGE-BLOCKING two-tenant real-DB integration suite
  `apps/api/tests/integration/generatedImageTenantIsolation.test.ts` — 8/8,
  0 cancelled, covering the list-empty scenario, the foreign-generate-404
  with AI-sentinel-not-invoked scenario (+ positive control), the
  no-`accountId`-in-response pin on both the single and list-array shapes,
  and both billing scenarios (own-account incremented; foreign body
  `accountId` ignored and the foreign tenant's counter unchanged).
- **Docs**: `docs/security/MULTI_TENANT_GUARDS.md` — `GeneratedImage`
  promoted to tenant-scoped (count 55 → 56), 3-step enrollment checklist
  applied, create-ownership-before-paid-AI precedent noted.
  `docs/reports/roadmap-detected-smells-backlog.md` — **SMELL-58** added:
  `GenerateImageUseCase` is a mutating use case that does NOT use a
  `UnitOfWork`, so PostgreSQL RLS layer 2 is structurally inert on the
  create path (layer 1 — the Prisma `$extends` guard — still fully protects
  it at runtime). Verified during design (D7) that sibling enrolled
  adapters (e.g. `PrismaCampaignRepository`) also don't join the UoW
  transaction, so a use-case-level UoW alone would not close the gap; a
  real fix needs a UoW retrofit AND an adapter transaction-join. Pre-existing,
  OUT of this slice's isolation scope, tracked as canon-debt.
- **0-defect gate**: `tsc --noEmit` = 0 across `@apps/api`, `@core/ai-image`,
  `@core/domain`, and the regenerated `@infra/prisma` client (requires
  `NODE_OPTIONS=--max-old-space-size=7168` under the LXC memory cap);
  `eslint --max-warnings 0` = 0 on all 9 touched files (one unused-var fix:
  removed a dead `makeSavedImage` test helper); fitness #21 (no Prisma
  singleton outside composition roots) = 0; fitness #23 (no raw queries
  outside guard exceptions) = 0. Migrations applied clean with zero NULL
  `accountId` rows and preserved row counts.

## Capabilities / specs applied

- `multi-tenant-isolation` → `openspec/specs/multi-tenant-isolation/spec.md`
  (living capability, EXTENDED — not created). This archive phase:
  - Confirmed the Requirement 1 "Enrolled models" table and Requirement 3
    "Applied so far" table already carried `GeneratedImage`'s row (appended
    during apply, task 8.4).
  - Added the two model-scoped Requirement-2-shaped blocks that were
    present in the change's delta spec but NOT yet in the living spec —
    `GeneratedImage — the live IDOR routes are closed, no prompt or image
content exfiltrates, and no paid AI call is burned for a foreign
project` and `GeneratedImage usage billing is attributed by
server-derived accountId` — copied verbatim from the delta's ADDED
    Requirements, positioned after Slice 3's `Public link redirect`
    requirement and before the model-agnostic `Create paths validate parent
ownership` requirement (Req 3), per the living spec's
    model-scoped-by-design extension contract.
  - Extended the living spec's header with an "Extended by Slice 4"
    paragraph recording that `GeneratedImage` is the first model with a
    structurally empty join/child-table gap class and the first whose
    create-path ownership check gates a paid external call, plus the
    server-derived-billing pattern as a durable rule for future slices that
    encounter client-supplied billing/usage fields.
  - Confirmed Requirement 4 (Backfill integrity) and Requirement 5 (No
    caller regression) needed NO changes — both apply verbatim per the
    delta's explicit note (this slice's out-of-context caller inventory is
    EMPTY, unlike Slice 3).
  - The living spec is now self-contained for this slice: a reader does NOT
    need the archived change delta to understand `GeneratedImage`'s IDOR
    closure or the server-derived-billing requirement — every requirement
    and scenario lives in the living spec.

## Residual (on the record, non-blocking)

Carried forward (unchanged status, not worsened by this slice): the
per-slice integration test remains the ONLY enforcement of `accountId ==
<parent>.accountId` on write paths; no static/fitness guard exists yet.

New from this slice, backlogged as **SMELL-58**: see "Delivered scope" docs
bullet above. `GenerateImageUseCase` has no `UnitOfWork`, so RLS layer 2 is
structurally inert on the create path; layer 1 (the Prisma `$extends`
guard) fully covers it at runtime. A proper fix needs a UoW retrofit plus an
adapter transaction-join; explicitly OUT of this slice's tenant-guard scope.

## Task completion

All 21 checkboxes across 8 phases in `tasks.md` are `[x]`. No stale-checkbox
reconciliation was needed — apply-progress (engram obs #310) reports "21/21
complete" with no deviations from design.

## Verification status

Independent verify reported **tsc = 0** and the MERGE-BLOCKING integration
suite **8/8, 0 cancelled**, matching apply-progress's self-reported numbers
exactly. A prior design-phase adversarial gate found 0 CRITICAL with 1
gate-confirmed fix applied before apply started; a post-apply diff-gate
adversarial review found 0 findings on the implementation diff. No separate
`sdd/generated-image-tenant-guard/verify-report` observation was located in
Engram at archive time — these verification facts are carried into this
archive report from the orchestrator's session-level attestation plus the
apply-progress cross-check (obs #310), and are recorded transparently rather
than presented as independently re-derived by this archive phase.

## Merge reference

- PR: **#117** (Slice 4), subsequently re-validated stacked under **#118**
  (pnpm 10→11 migration)
- CI: green on commit `fd3bc746` — 5/5 workflows (engram obs #312)
- Branch: `workstream/cluster-c-generatedimage-guard`, superseded on disk by
  `workstream/pnpm-11-migration`
- Date archived: **2026-07-15**

## Rollout continuation

This is **Slice 4 of 9** in the `project-scoped-tenant-guard` rollout
(N-SEC-3) (Slice 1: `external-notification-tenant-guard`, PR #113, archived;
Slice 2: `scheduled-report-campaign-tenant-guard`, PR #114, archived; Slice
3: `recurring-post-tracked-link-tenant-guard`, PR #116, archived). This
slice's `GeneratedImage` model is now closed under N-SEC-3. Slices 5–8 stack
on the pnpm-11-migration tip and inherit both the reference recipe and this
slice's two new generalizations, now embedded in the living spec's header
extension contract:

1. **A structurally empty join/child-table gap class is a legitimate,
   provable outcome — not a shortcut.** When a model genuinely has no child
   or join tables (verified by schema + accessor grep, not assumed), the
   requirement text should say so explicitly rather than silently omitting
   a scenario the reader would otherwise expect.
2. **When a create path's ownership check also gates a PAID external call,
   the requirement and the integration suite must pin "zero spend" as an
   explicit, separately-asserted outcome** — not just "no row persisted".
   A sentinel/spy override on the paid-call port (not just a row-count
   assertion) is the mechanism that proves it.

## Traceability — Engram observations

| Artifact                             | Topic key                                         | Observation                |
| ------------------------------------ | ------------------------------------------------- | -------------------------- |
| Proposal decision (billing, signed)  | (decision, not artifact-topic-keyed)              | #306                       |
| Spec (delta)                         | `sdd/generated-image-tenant-guard/spec`           | #307                       |
| Design (incl. D1–D8)                 | `sdd/generated-image-tenant-guard/design`         | #308                       |
| Tasks                                | `sdd/generated-image-tenant-guard/tasks`          | #309                       |
| Apply progress                       | `sdd/generated-image-tenant-guard/apply-progress` | #310                       |
| Discovery (usageMetric guard-scoped) | (discovery, not artifact-topic-keyed)             | #311                       |
| pnpm-11 migration + CI green         | `ci/pnpm11-migration`                             | #312                       |
| Verify report                        | `sdd/generated-image-tenant-guard/verify-report`  | NOT FOUND — see note above |
| Archive report (this document)       | `sdd/generated-image-tenant-guard/archive-report` | (saved by this phase)      |
