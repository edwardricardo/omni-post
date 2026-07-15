# Archive Report — recurring-post-tracked-link-tenant-guard

> Closure record for the `recurring-post-tracked-link-tenant-guard` SDD change
> (Slice 3 of the `project-scoped-tenant-guard` rollout).
> Archived 2026-07-14. Store: hybrid (openspec files + engram mirror).

## Outcome

`RecurringPost` and `TrackedLink` are now isolated by construction under the
two-layer tenant guard (Prisma `$extends` + PostgreSQL RLS), closing TWO LIVE
IDOR chains (CWE-639) and, for the first time in the rollout, shipping a
DELIBERATE guard bypass under compensating controls:

- `RecurringPost`: five id-only/client-`projectId` routes (get/list/patch/
  deactivate/create) had zero ownership checks. The most severe escalation —
  a foreign `templatePostId` or foreign `channels[]` entry on create/repoint —
  is closed: the scheduler's system-context sweep can no longer clone tenant
  B's post CONTENT into tenant A's account or publish it to B's channels,
  because all three parent refs (`projectId`, `templatePostId`, `channels[]`)
  now resolve to NOT_FOUND before persist (TRIPLE ownership, D3).
- `TrackedLink`: seven routes across `linkRoutes.ts` + `utmRoutes.ts` (get/
  delete/utm-generate/utm-url/stats/create + the public redirect) had zero
  ownership checks (the app-level `trackedlink-idor-fix`, PR #109, is NOT on
  this branch — confirmed absent at source, D9). The `stats` route traverses
  the `linkClick` CHILD table (`getClickStats` → `linkClick.findMany`) —
  closed transitively via the upstream guarded `findById`, pinned by a
  positive exfil-sentinel test (D5).
- **Public link redirect (`GET /r/:shortCode`) — the rollout's FIRST
  deliberate, signed guard bypass.** Wrapped in
  `withSystemContext("public-link-redirect")` as a capability-URL exemption
  (W3C TAG Capability URLs + OWASP public-resource exemption), a FINAL signed
  product/security decision (engram obs 297, 2026-07-14) — NOT gated on
  further approval. Shipped WITH three mandatory, normative compensating
  controls: (1) the redirect leaks NO tenant-identifying data — 302-only
  response; (2) the `/r/:shortCode` namespace is rate-limited via a dedicated
  `redirect:{clientIp}` bucket (NOT the global limiter's `ip:url` key, which
  gives every shortCode a fresh bucket and does not resist enumeration); (3)
  the exemption is read-path only — the management surface (create/get/
  update/delete/stats/utm) stays 100% tenant-scoped. Two further out-of-
  context callers were wrapped as the same precedent: the recurrence-sweep
  scheduler tick (`withSystemContext("recurrence-sweep")`) and the short-code
  uniqueness probe (`withSystemContext("shortcode-uniqueness-probe")`,
  boolean-only, restores global uniqueness semantics under the public
  namespace).

Both models' create paths also carried the Slice-1/2-shaped gap: client-
supplied parent refs were validated for shape only, never ownership. Closed
by injecting `ProjectRepositoryPort` into `CreateTrackedLinkUseCase` (single
ref) and `ProjectRepositoryPort` + `PostRepository` + `ChannelRepository`
into `CreateRecurringPostUseCase` (triple ref) — all returning NOT_FOUND
(404, never 403/500) before the transactional write.

Full SDD cycle: proposal → spec → design → tasks → apply → verify → archive,
on branch `workstream/cluster-c-recurringpost-trackedlink-guard`, stacked on
the Slice 2 branch @ base `e506fea1`.

- **Apply**: Strict TDD (RED unit → GREEN → REFACTOR per file). 34/34 tasks
  complete, self-reported apply numbers (`sdd/recurring-post-tracked-link-
tenant-guard/apply-progress`, engram obs #301).
- **Design adversarial gate**: PASSED, 0 CRITICAL, with 3 gate-confirmed
  fixes applied before apply started (engram obs #299): **FIX 1 — a
  threading-completeness defect** (the first design draft threaded
  `accountId` into `RecurringPost`'s round-trip sites but MISSED the
  create-factory surface — `RecurringPostCreateProps` and the internal
  `create()` literal — which would have left `new RecurringPost({...})`
  unable to type-check and no path for `project.accountId` to reach a
  newly-created recurrence; rewritten to cover all 4 save-literal sites + 3
  `fromPersistence` sites + the create factory); FIX 2 (vanitySlug security
  nuance — entropy/capability argument scoped to auto-generated shortCodes
  only, vanity-slug collision risk documented as pre-existing and backlogged
  as SMELL-57, not fixed in this slice); FIX 3 (stale artifact — proposal
  Open Question + spec redirect requirement updated to record the FINAL
  signed decision citing obs 297, removing a since-resolved approval gate).
- **Diff-gate (post-apply adversarial review)**: 0 findings on the
  implementation diff.
- **Verify**: independent `sdd-verify` **PASS — 0 CRITICAL / 0 WARNING / 0
  SUGGESTION** (full detail: `verify-report.md` in this folder; engram mirror
  `sdd/recurring-post-tracked-link-tenant-guard/verify-report`, observation
  #303). Every gate item was independently re-executed from scratch (tsc ×4,
  eslint --max-warnings 0, fitness #21/#23, both MERGE-BLOCKING integration
  suites, 8 unit suites) — self-reported numbers were not trusted and nothing
  needed fixing.
- **CI**: PR #116 (draft, stacked on #114) green on commit `a6a8a90f` — 5/5
  workflows passing.

## Delivered scope

- **Schema + migrations** (four, load-bearing order, all timestamps strictly
  greater than Slice 2's `20260714030300`): `add_recurring_post_account_id` →
  `add_rls_recurring_post` (+`down.sql`) → `add_tracked_link_account_id` →
  `add_rls_tracked_link` (+`down.sql`). At apply time the migration files
  were created in the order tracked-link-first/recurring-post-second
  (`20260714040000`/`040100` = tracked_link, `20260714040200`/`040300` =
  recurring_post) — a harmless deviation from the tasks-plan's stated
  filename order, noted non-blocking in verify (order-independent; all four
  apply cleanly, backfill asserts hold, row counts preserved on both
  tables). Each column migration copies the Slice-1 Recipe A verbatim
  (nullable `accountId` → backfill from `Project` over the NOT-NULL
  `projectId` FK → in-tx `RAISE EXCEPTION` on any residual NULL → `SET NOT
NULL` → FK to `Account` `ON DELETE CASCADE` → `@@index([accountId,
projectId])`); each RLS migration copies Recipe B verbatim (new forward
  `tenant_isolation` policy with `__system__` bypass, `20260527000000` never
  edited in place).
- **Guard flip**: `"recurringPost"` and `"trackedLink"` appended alphabetically
  to `TENANT_SCOPED_MODELS` in `infra/prisma/src/extensions/tenantGuard.ts`
  (header count 53 → 55). `LinkClick` stays OUT (no `accountId`; gated
  transitively via guarded parent lookups, same policy as `campaignPost`).
- **accountId threading (D2, diverges by persistence style)**: `TrackedLink`
  is entity-carried (D2a, Slice-2 style — props/create-factory/getter/
  `fromPersistence`, adapter `create` branch + `toDomain`). `RecurringPost`
  is DTO-carried with a full entity round-trip AND create-factory threading
  (D2b, the design-gate FIX 1 target) — `RecurringPostProps` +
  `RecurringPostCreateProps` + the internal `create()` literal + a getter +
  `fromPersistence`, plus `RecurringPostData` / `PrismaRecurringPostRow` /
  `toData` / the `upsert.create` branch, plus FOUR save-literal sites
  (`CreateRecurringPostUseCase`, `UpdateRecurringPostUseCase`,
  `ProcessRecurrenceUseCase`, `DeactivateRecurringPostUseCase`) and THREE
  `fromPersistence` round-trip sites (Update/Process/Deactivate). Never in
  `toJSON`/output DTOs on either model.
- **Create-path ownership + 404 conformance (D3)**: `CreateTrackedLinkUseCase`
  gained a `ProjectRepositoryPort` 2nd constructor param (single foreign-ref
  check). `CreateRecurringPostUseCase` gained THREE — `ProjectRepositoryPort`
  (guarded `findById(projectId)`, the actual guard-scoping step),
  `PostRepository` (template-post project-consistency), and
  `ChannelRepository` (per-channel project-consistency) — all resolving to
  `err(NOT_FOUND)` before `doWork`. `UpdateRecurringPostUseCase` applies the
  same channel-repoint consistency check on PATCH. `recurringPostRoutes.ts`'s
  create handler gained a `NOT_FOUND → 404` branch (the route previously only
  mapped `VALIDATION_FAILED`); `linkRoutes.createLink` already mapped it —
  no change needed there.
- **Implementation deviation from design, source-verified as semantically
  equivalent (recorded in apply-progress, engram obs #301)**: the design's
  per-channel check specified `channelRepository.findById` + a
  `channel.projectId === projectId` comparison; apply instead used
  `channelRepository.findIdsByProjectId` — a decryption-free membership
  check (the project's own documented saga-admission ownership method) —
  because per-channel `findById` decrypts provider credentials, which is
  fragile against test fixtures. Semantically identical (same NOT_FOUND
  outcome on any foreign channel id), avoids unnecessary crypto in the hot
  path and in fixtures.
- **System-context wraps — the rollout's FIRST three (D6, D7, D8)**: the
  public redirect route handler wraps the use-case call AND the fire-and-
  forget `recordClick` continuation (AsyncLocalStorage captured at call
  time propagates to the non-awaited continuation) in
  `withSystemContext("public-link-redirect")`, paired with a dedicated
  `REDIRECT` rate-limit preset (~60/min) resolved via `TOKENS.HttpRateLimiter`
  and a namespace-keyed `redirect:{clientIp}` preHandler attached ONLY to
  `/r/:shortCode`. `RecurrenceScheduler.tick()`'s body is wrapped in
  `withSystemContext("recurrence-sweep")` (the sweep's
  `findActiveByNextScheduled` is cross-account by design; the template-clone
  exfil is closed at CREATE, D3 — not by this wrap). `PrismaTrackedLink
Repository.isShortCodeAvailable` is wrapped in
  `withSystemContext("shortcode-uniqueness-probe")` (boolean-only, restores
  global uniqueness semantics the public namespace requires).
- **D9 invariant, source-verified at both design gate and verify**:
  `findByShortCode` MUST stay tenant-UNSCOPED — no `requireTenantContext`
  was added to it — so the system-context wrap on the redirect route is what
  resolves the public lookup. Confirmed by `rg` returning zero
  `requireTenantContext` occurrences in `PrismaTrackedLinkRepository.ts` at
  both gates.
- **DI**: `setupLinkUseCases.ts` injects `TOKENS.ProjectRepository` into
  Create; `setupRecurringPostUseCases.ts` injects `TOKENS.ProjectRepository`
  - `PostRepository` + `ChannelRepository` into Create (and
    `ChannelRepository` into Update).
- **Tests**: 8 unit suites (`CreateTrackedLinkUseCase` 6/6,
  `CreateRecurringPostUseCase` 9/9, `UpdateRecurringPostUseCase` 4/4,
  `tenantGuard.test.ts` 38/38 asserting `TENANT_SCOPED_MODELS` size 55,
  `linkTracking.test.ts` 24/24, `linkUseCases.test.ts` 14/14,
  `TrackedLinkRepository.test.ts` 23/23, `recurringPostUseCases.test.ts`
  9/9); the two MERGE-BLOCKING two-tenant real-DB integration suites —
  `apps/api/tests/integration/recurringPostTenantIsolation.test.ts` (14/14,
  all 5 routes incl. the content-exfil and channel-targeting closure
  assertions) and `apps/api/tests/integration/trackedLinkTenantIsolation.
test.ts` (13/13, all 7 routes incl. the redirect leaks-nothing, namespace
  rate-limit 429, and management-surface-scoped scenarios) — 0 cancelled in
  either.
- **Docs**: `docs/security/MULTI_TENANT_GUARDS.md` — both models promoted to
  tenant-scoped (count 53 → 55); the `withSystemContext` precedent
  (redirect / recurrence-sweep / shortcode-probe) and the redirect namespace
  rate-limit control documented. `docs/reports/roadmap-detected-smells-
backlog.md` — **SMELL-57** added: `vanitySlug` has no global `@@unique`
  constraint yet `findByShortCode`/`isShortCodeAvailable` match
  `OR:[{shortCode},{vanitySlug}]`, so two tenants can register the same
  vanity slug (nondeterministic public redirect via `findFirst`) and
  `isShortCodeAvailable` has a check-then-insert TOCTOU with no DB
  constraint; pre-existing, unrelated to and not worsened by the tenant
  guard; proper fix needs a global `@@unique` + a dedup migration; OUT of
  this slice's scope.
- **0-defect gate**: `tsc --noEmit` = 0 across `@apps/api`, `@core/recurring`,
  `@core/links`, `@core/domain`; `eslint --max-warnings 0` = 0 on all 27
  changed/new files; fitness #21 (no Prisma singleton outside composition
  roots) = 0; fitness #23 (no raw queries outside guard exceptions) = 0.
  Independently re-verified from scratch at the verify phase — every number
  above was re-measured, not trusted from the apply self-report.

## Capabilities / specs applied

- `multi-tenant-isolation` → `openspec/specs/multi-tenant-isolation/spec.md`
  (living capability, EXTENDED — not created). This archive phase:
  - Confirmed the Requirement 1 "Enrolled models" table and Requirement 3
    "Applied so far" table already carried both models' rows (appended
    during apply).
  - Added the two model-scoped Requirement-2-shaped IDOR-closure blocks —
    `RecurringPost — the live IDOR routes are closed, and the template-clone
content-exfil vector is closed` and `TrackedLink — the live IDOR routes
are closed, including the child-table stats traversal` — copied from
    the delta spec's ADDED Requirements, positioned after Slice 2's
    `Campaign` block per the living spec's model-scoped-by-design extension
    contract.
  - Added a THIRD, capability-scoped requirement — `Public link redirect is
a capability-URL exemption with mandatory compensating controls` — the
    rollout's first requirement of this shape, capturing the deliberate
    guard bypass and its three normative compensating controls
    (leaks-nothing, namespace rate limiting, read-path-only scope) with
    their three integration scenarios.
  - MODIFIED the "Create paths validate parent ownership" requirement: added
    "and never 500" to the normative text (matching the delta's stricter
    404-conformance wording), added the model-specific concretization
    sentence (`TrackedLink` single ref vs `RecurringPost` triple ref), and
    added a NEW scenario — "create against multiple parent refs rejects any
    foreign ref" — the first scenario in the living spec covering a model
    with more than one client-supplied parent reference.
  - MODIFIED the "No caller regression from the guard flip" requirement:
    added the "the three out-of-context callers declare their context
    explicitly" integration scenario, concretizing the model-agnostic
    invariant for Slice 3's three `withSystemContext` wraps — the first
    time this requirement gets an integration scenario beyond the static
    "no out-of-context caller exists" check, since Slices 1–2 were zero-wrap.
  - Extended the living spec's header with an "Extended by Slice 3"
    paragraph recording the capability-URL exemption pattern and the
    multi-parent-ref create-path pattern as durable, self-contained rules
    for Slices 4–8.
  - The living spec is now self-contained for this slice: a reader does NOT
    need the archived change delta to understand RecurringPost/TrackedLink's
    IDOR closure or the public-redirect bypass and its compensating
    controls — every requirement and scenario lives in the living spec.

## Canon basis for the deliberate guard bypass

The public-redirect capability-URL exemption is grounded in W3C TAG
Capability URLs (a `shortCode` is an unguessable bearer token, not an
identity claim — possessing it IS the authorization) and OWASP's
public-resource exemption from deny-by-default access control (a route
serving anonymous, public-by-design content is not itself an IDOR surface
provided it leaks no tenant-identifying data). This canon research is
recorded in engram **obs 297** (2026-07-14, Edward's signed decision) and is
FINAL — the slice was explicitly NOT gated on further product/security
approval. The rejected alternative (pre-resolving `accountId` via a narrow
raw/system read and binding a real `TenantContext` for the redirect) was
assessed and declined: it added ceremony with zero additional isolation
value for an endpoint that is anonymous and public by design, while the
chosen approach ships with three concrete, testable compensating controls
that a synthetic-context approach would not have forced into existence
(namespace rate limiting in particular — the global limiter's `ip:url`
keying was independently found to NOT resist shortCode enumeration, D7).

## Residual (on the record, non-blocking)

Carried forward (unchanged status, not worsened by this slice): the
per-slice integration test remains the ONLY enforcement of `accountId ==
<parent>.accountId` on write paths; no static/fitness guard exists yet.

New from this slice, backlogged as **SMELL-57** (next id after SMELL-53..56):
`TrackedLink.vanitySlug` has no global `@@unique` constraint, yet both
`findByShortCode` (used by the public redirect) and `isShortCodeAvailable`
resolve `OR:[{shortCode},{vanitySlug}]`. Two tenants can register the same
vanity slug — the public redirect then resolves nondeterministically
(`findFirst` picks whichever row postgres returns first), and
`isShortCodeAvailable` has a check-then-insert TOCTOU with no DB constraint
to catch a vanity collision at insert time. The guard flip does NOT worsen
this — it is pre-existing and unrelated to tenant isolation (the redirect
already leaks nothing regardless of which tenant's link is served, per D6).
A proper fix needs a global `@@unique` on `vanitySlug` plus a dedup
migration for any pre-existing collisions; explicitly OUT of this slice's
tenant-guard scope.

## Task completion

All 34 checkboxes across 8 phases in `tasks.md` are `[x]`. No stale-checkbox
reconciliation was needed — apply-progress and the independent verify
re-run agree on every gate number.

## Verification status

`sdd-verify` PASS — **0 CRITICAL / 0 WARNING / 0 SUGGESTION** (see
`verify-report.md`), an independent re-run of every mechanical gate from
scratch. A prior design-phase adversarial gate found 0 CRITICAL and 3
gate-confirmed fixes (one a real threading-completeness defect — the
create-factory surface for `RecurringPost.accountId` — caught and fixed
before apply started); a post-apply diff-gate adversarial review found 0
findings on the implementation diff.

## Merge reference

- PR: **#116** (draft, stacked on #114)
- CI: green on commit `a6a8a90f` — 5/5 workflows
- Branch: `workstream/cluster-c-recurringpost-trackedlink-guard`
- Date archived: **2026-07-14**

## Rollout continuation

This is **Slice 3 of 9** in the `project-scoped-tenant-guard` rollout
(Slice 1: `external-notification-tenant-guard`, PR #113, archived; Slice 2:
`scheduled-report-campaign-tenant-guard`, PR #114, archived). Next: **Slice
4**, applying the reference recipe (Slice 1, 7 points) plus Slice 2's two
generalizations (join/child-table gap class covers reads too; all-routes
coverage; full reference-invariant copy) plus this slice's two new
generalizations — now embedded in the living spec's header extension
contract:

1. **Deliberate guard bypasses need a capability-URL-shaped requirement, not
   an ad hoc exception.** When a route has a genuine out-of-tenant-context
   caller that cannot be closed (a public, anonymous, capability-token-gated
   endpoint), model it as its own `[MERGE-BLOCKING]` requirement with
   explicit NORMATIVE compensating controls (leaks-nothing response,
   namespace-scoped rate limiting, read-path-only scope) — each with its own
   integration scenario — rather than silently wrapping in
   `withSystemContext` and hoping the "no caller regression" static scenario
   covers it. A signed, dated decision citation (engram observation) is
   REQUIRED in the requirement text for any such bypass.
2. **Multi-parent-ref create paths need their own scenario.** A model whose
   create/repoint path accepts MORE than one client-supplied parent
   reference (like `RecurringPost`'s `projectId` + `templatePostId` +
   `channels[]`) needs an explicit "any foreign ref rejects" scenario beyond
   the single-parent-ref reference scenario, and the design must trace the
   FULL compile-time threading surface (entity props, create-factory props,
   the `create()` literal, every save site, every `fromPersistence` site) —
   the design-gate FIX 1 in this slice was exactly a design draft that
   missed the create-factory half of that surface.

## Traceability — Engram observations

| Artifact                             | Topic key                                                     | Observation           |
| ------------------------------------ | ------------------------------------------------------------- | --------------------- |
| Proposal                             | `sdd/recurring-post-tracked-link-tenant-guard/proposal`       | #295                  |
| Spec (delta)                         | `sdd/recurring-post-tracked-link-tenant-guard/spec`           | #298                  |
| Design (incl. design-gate FIX 1/2/3) | `sdd/recurring-post-tracked-link-tenant-guard/design`         | #299                  |
| Tasks                                | `sdd/recurring-post-tracked-link-tenant-guard/tasks`          | #300                  |
| Apply progress                       | `sdd/recurring-post-tracked-link-tenant-guard/apply-progress` | #301                  |
| Canon basis for the redirect bypass  | (cited within design/spec/archive; Edward's signed decision)  | #297                  |
| Verify report                        | `sdd/recurring-post-tracked-link-tenant-guard/verify-report`  | #303                  |
| Archive report (this document)       | `sdd/recurring-post-tracked-link-tenant-guard/archive-report` | (saved by this phase) |
