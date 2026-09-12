# Archive Report — analytics-route-port-integrity

> Closure record for the SDD change (SMELL-98; branch `workstream/analytics-route-port-integrity`
> off `origin/main` @ `fdda5d25`; 44/44 tasks after archive-time reconciliation; verify-report
> verdict `pass-with-warnings`, 0 CRITICAL, 8/8 requirements at final state, 26/26 scenarios).
> Semantic content authored by the archive executor (Engram
> `sdd/analytics-route-port-integrity/archive-report`); the mechanical steps this executor's
> toolset cannot perform (the NEW-capability spec copy, this folder's move) are handed to the
> orchestrator below as byte-identical `cp`/`git mv` + diff-verified steps.

## Shipped — one PR, five commits, fresh-gated + RDD-reviewed once

| PR   | Commits                                                                                                                                                                                                                                                                                    | Merged (main tip) | Fresh gate                                                                                                                                                        | RDD (burned)                                                                     | CODE (measured)                 | EVIDENCE (measured)                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| #249 | `27f54cb3` (SDD planning record) · `8d512dd6` (characterization net, red-proven — WU1) · `62f48504` (four narrow port methods + adapters — WU2) · `9c93a9cd` (the swap: handler receives ports, not a database client — WU3) · `a9f6ba01` (backlog: SMELL-98 DONE, rows 99-103 born — WU4) | `f16b8c43`        | PASS-WITH-WARNINGS, 0 CRITICAL — 7/8 requirements at verify time (8th unblocked by sequencing, MET at archive), 25/26 scenarios at verify time (26/26 at archive) | `review-3b1dda8f7de095f7` (consolidated single-lens, 6 informational advisories) | **289** — hard budget 400, PASS | **1019** — declared band 520-670, hard writer stop 770 BREACHED (+249, 132% of stop), **RATIFIED** (Edward) |

Work-unit map (all four landed in one PR behind a fifth planning commit, per-commit for
traceability, never split into chained PRs — the tasks-phase forecast called
`Chained PRs recommended: No` and the ledger held):

- **WU1** (`8d512dd6`) — characterization suite for the three customer-facing analytics
  handlers, built from zero against a shared Prisma test mock that had no `post`/`channel`/
  `analytics`/`thread` models at all; RED-proven three times against the untouched tree
  (renamed a response key, renamed a CSV header, dropped a field — each a real non-zero
  vitest exit, each restored byte-exact).
- **WU2** (`62f48504`) — four narrow read-model port methods (`listChannelRefsByProject`,
  `listPostExportRows`, `listThreadRefsByProject`, `listProjectEntries`) added to three
  EXISTING ports, plus their Prisma adapters, all TDD'd RED-first against `TypeError: repo.*
is not a function`. Call-args pins on all four (`where`, `select`, `orderBy`, `take`,
  explicit absence of `include`) are the load-bearing proof, not the double's own semantics.
- **WU3** (`9c93a9cd`) — the swap itself: all 10 direct `this.prisma.*` reads rewired to
  port calls, constructor loses `PrismaClient`, plugin registration drops the client-token
  resolve and adds the two new port resolves, stale JSDoc corrected. The WU1 goldens ran
  UNCHANGED against this commit — never `-u` — and matched byte-for-byte.
- **WU4** (`a9f6ba01`) — the transient byte-identity golden layer deleted (shape-only Layer A
  pins remain permanently); backlog rows applied: SMELL-98 closed, SMELL-99 through SMELL-103
  born with owners.

## What the swap retired: the paradox anti-pattern, invisible to fitness #1/#21

`AnalyticsRouteHandler` took `PrismaClient` as constructor parameter 1 _alongside_ an
already-injected `ProjectQueryRepositoryPort`, then ran 10 direct `this.prisma.*` reads
across its three handlers — ARCHITECTURE_CANON's named "paradox anti-pattern": _a class
that already receives a port must use that port_. Fitness #1 (`no Prisma singleton import
in routes`) and #21 (`no Prisma singleton import outside composition roots`) both grep for
`import { prisma } from "@infra/prisma"`; this file imported `type PrismaClient` and
resolved the instance from DI, a shape neither grep can see. The route file gated nothing,
compiled clean, and had run this way undetected until SMELL-98 named it.

The fix (Approach A, signed at proposal) is a pure port-only swap: two exact reuses
(`countPosts`, `findById` — already on the port the handler had) and four new narrow
methods on three existing ports. Zero new ports, zero schema/migration, zero behaviour
change claimed beyond response bytes — and the security posture quietly improves as a
side-effect: the analytics scoping step now runs through the tenant-guard-covered port
layer instead of a bare Prisma call.

`rg -ic prisma apps/api/src/analytics/analyticsRoutes.ts` → **0** is the mechanical proof
this closed; a companion fitness gate for "routes never receive a database client" (closing
the blind spot at the _grep_ level, not just this one file) is explicitly out of scope —
named as a future tokened change in the proposal's non-goals, not silently dropped.

## The characterization-net story: the declared net was fiction

The backlog's SMELL-98 filing assumed a characterization net already existed for these
handlers. It did not. Design-gate finding **C3** verified that `apps/api/tests/unit/
analyticsRoutes.test.ts` — the file whose basename implies "the customer analytics routes"
— imports `../../src/admin/analyticsRoutes.js`: a _different class_, the admin file, at the
same basename. The customer handlers this change touches had **zero** unit coverage before
this PR.

Worse, design-gate's **C1** found the harness the design proposed could not run at all:
the shared `mockPrisma` helper declares exactly 11 models (none of them `post`, `channel`,
`analytics`, or `thread`) with **no Proxy catch-all** — the first call from any of the ten
moved reads would throw `TypeError`. Building the real net meant writing, from zero, a
working miniature of Prisma's own semantics inside the test: scalar-`select` projection,
single-field `orderBy`, and a to-one relation filter with correct inner-join null handling
— not test data, but a small query engine, because that is what characterizing ten raw
Prisma calls against a semantics-free mock actually requires.

The net was proven able to fail three separate times against the untouched pre-swap tree
(rename a JSON key, rename a CSV header, drop a field — each produced a real non-zero
vitest exit; each restore verified byte-exact via checksum), then it ran **unmodified,
never with `-u`**, against the post-swap tree: `sha256 2755c242…` before, `2755c242…`
after — byte-identical. A fourth planted mutation, this time in the _new_ adapter rather
than the old handler code, also turned the same pre-swap golden red — proving the net was
live on the new seam, not merely surviving the old one by accident.

Verify independently re-ran this proof set (its own mutations M-A/M-B/M-C, not a rerun of
the writer's) and reached the same verdict, with one honest downgrade: because
`.gitignore` ignores `**/__snapshots__/`, the goldens were never committable, so the
byte-identity claim rests on a testimonial sha256 pair rather than a reproducible, CI-
visible artifact. Verify additionally re-established Requirement 3 (response equivalence)
_structurally_ — independent of the sha256 testimony — by tracing every moved read's column
order end to end, so the property holds even discounting the golden entirely. Recorded as
**not-applicable-with-reason** rather than silently dropped: force-adding the golden was
the recommended alternative and was not taken, because the transient layer is deliberately
deleted in the same PR (WU4) so the tree carries no arithmetic pin long-term.

## Honest numbers, not smoothed

- CODE: **289** vs the 400 hard budget — PASS, no ruling needed.
- EVIDENCE: **1019** vs the declared 520-670 band and the 770 hard stop — **BREACHED by
  249 (132% of stop)**. Apply reported this rather than trimming assertions to fit; nothing
  was deleted to reach the number. **Ratified by Edward.**
- Breakdown (measured, `git diff --numstat`): `analyticsRoutes.ts` +32/-73 (CODE 105) ·
  three Prisma adapters +40/+37/+19-1 (CODE 96) · three port interface files +27/+39/+21
  (CODE 87) · characterization suite +787 (new) · three adapter unit suites +112/+82/+24 ·
  one port-double conformance fix +13/-1.
- Why it overran, itemised honestly (per apply-progress): (1) design-gate's C1 already
  flagged the mock-gap risk, but its forecast (~250-400 for the characterization suite)
  priced it as "two semantic patches"; the real gap needed a four-model mini-Prisma
  (scalar-select projection, orderBy, to-one relation filtering with inner-join null
  semantics) — realized at ~787 lines. (2) Byte identity itself demands explicit,
  column-ordered, fixed-date fixture literals across 4 channels + 3 posts + 6 analytics
  rows + 2 threads, times 8 distinct-projectId test slots (task 1.8's own cache-safety
  rule) — a parameterized builder, still bulky. (3) 144 of the 787 characterization lines
  (18%) are comment-only: canon JSDoc plus this repo's explain-the-why discipline. (4) Two
  tests beyond plan, forced by a live defect (`z.coerce.boolean()`, SMELL-102) the spec did
  not know about. A mechanical compaction could plausibly recover 60-100 lines by tabling
  the fixture seeds, but that would hide the column ORDER that byte identity depends on —
  not done unilaterally, per the report-never-trim rule.
- Re-run at verify, independently: unit `568 files / 8834 tests` PASS, 0 skipped, 0
  cancelled, 0 snapshots (reproduced twice, identical counts); `tsc -b --force apps/api
packages/core` exit 0; `eslint --max-warnings 0` exit 0; fitness #1/#8/#9/#10/#21/#22/#30
  /#32 all clean; fitness #38 swept-tree 0 (proven non-vacuous: removing one inline
  `deletedAt` filter moves it to exactly 1), db-prisma ratchet unchanged at baseline 11,
  zero files touched under `packages/adapters/db-prisma`.
- **Forecast recalibration (the lesson for the next change).** The measured EVIDENCE:CODE
  ratio is ≈3.53× (1019/289) — inside the standing ~2.5-3× empirical band's high end, not
  wildly outside it. The actual miscalibration was narrower: when a characterization net
  must be built essentially from zero against a shared test mock that has no semantic
  support for the models under test (not missing _data_, missing _projection/filter/order
  behaviour_), that harness-construction work is engineering effort with its own cost curve
  and belongs in the tasks-phase forecast as **its own budgeted line item**, separate from
  "characterization assertions." Folding it into a single characterization-suite estimate
  is what left the declared band roughly half the measured result even after design-gate's
  own W6 finding had already flagged the risk and forced one re-declaration.

## Requirement disposition (8 requirements / 26 scenarios, final state)

All eight requirements are **MET** at archive. Seven were MET at verify time (R1 ports-only
construction, R2 characterization net, R3 response equivalence, R4 narrow channel
projection, R5 query-shape preservation, R6 soft-delete posture, R8 zero-defect gate); the
eighth (R7, debt filed not absorbed) was **PARTIAL** at verify — its S1 scenario (backlog
rows landed with owners) could not be met on a branch whose base lacked the SMELL-98 row to
close, a premise verify confirmed rather than disputed. WU4 (`a9f6ba01`) applied the
pre-drafted backlog edit after the row existed on `main`, closing SMELL-98 and adding
SMELL-99 through SMELL-103. R7 is MET at archive.

## Spec correction, materialized before archive

The persisted spec (`specs/analytics-read-port-boundary/spec.md`) carries two corrections
verify's ruling 4.2 mandated, applied at materialization rather than left as an open verify
warning:

1. **403, not 404.** The export's not-found branch (spec's original Scenario:
   "the export still answers with today's 404 body and status") is dead code through this
   route: `getProjectAccess` applies `{id, accountId, deletedAt: null}` — strictly narrower
   than the project re-read's `{id, deletedAt: null}` — so an access pass implies the
   re-read always finds. Absent and soft-deleted projects both answer **403**. Pinning the
   spec's stated 404 would have made the characterization suite red against the untouched
   pre-swap tree — a broken net, not a faithful one. This also sharpens SMELL-101: the
   export's redundant project re-read is not merely redundant, its failure branch is
   unreachable.
2. **`GET /analytics/export` with `projectId` as a query parameter**, not a path segment —
   the spec's original path/parameter shape did not match the actual route registration.

Both are recorded as defects in the **spec artifact**, not in the apply: the spec is the
[MB] contract, and an uncorrected spec would misdescribe the shipped system for any future
re-verification.

## Residuals carried forward (filed with owners, not absorbed)

- **SMELL-99** — `ProjectQueryRepositoryPort.getChannelsByProject` (the pre-existing WIDE
  channel read) runs `findMany` with no `select` and casts rows `as unknown as ChannelDto[]`
  over a table carrying four credential columns; `ChannelDto.credentials` is additionally a
  **phantom field** — it no longer exists on the schema (drifted). This change's export path
  no longer calls it (that hazard is closed — see narrow-projection proof below), but its
  remaining callers still receive wide rows. Owner: platform engineering. Close phase: give
  it an explicit select or split it per consumer.
- **SMELL-100** — the pre-existing basename mismatch: `apps/api/tests/unit/
analyticsRoutes.test.ts` imports the ADMIN routes file while its name implies the customer
  one, leaving the customer handlers with zero coverage until this PR. Owner: platform
  engineering. Close phase: rename the admin-subject suite to disambiguate.
- **SMELL-101** — four live reporting defects in the customer analytics handlers,
  reproduced verbatim by the new goldens and repaired by **none** of this change: (a)
  per-channel double count (analytics are grouped by provider, then mapped per channel, so
  two channels on one provider each report the whole provider's totals); (b) bounded reads
  (`take` 500/5000/100) reported as unqualified `summary.total*`/`dataPoints` totals; (c)
  CSV `postStatus`/`publishedAt` columns permanently blank when the post section is off; (d)
  hard-coded zero fields (`totalClicks`, `followerCount`, `growthRate`, `growthThisWeek`) —
  plus the export's redundant project re-read, whose 404 branch is now confirmed unreachable
  (see spec correction above). Close phase: the CQRS query extraction named as **Approach B**
  in the design, gated on this row landing first, so the goldens can be re-authored against
  corrected arithmetic rather than against today's defects.
- **SMELL-102** — `z.coerce.boolean()` on export/ROI/cross-platform query flags
  (`includePosts`, `includeThreads`, `includeAnalytics`, `byChannel`, `includeCompetitive`)
  is a silent no-op for the value callers actually send: coercion is `Boolean(raw)`, so
  `includePosts=false` arrives as **true**, and only an _empty_ value reaches the false
  branch — found during apply, not previously known. Owner: platform engineering. Close
  phase: its own slice (a string-literal enum with an explicit transform), deliberately not
  bundled here because changing query-flag semantics is a behaviour change on a public API
  and must not ride a zero-behaviour-change refactor.
- **SMELL-103** — a declared `implements <Port>` inside `apps/api/tests/**` is **not
  typechecked** by `tsc -b apps/api` (that project excludes `tests`), which is how
  `InMemoryThreadReadRepository` silently stopped conforming to `ThreadReadRepositoryPort`
  when this change widened the port — fixed in place here (13 lines, test-only) because
  leaving it would have shipped a type declaration asserting a conformance the compiler
  never checks, but the general gap survives this change untouched. Owner: platform
  engineering. Close phase: add a tests-covering typecheck project so port doubles are
  gated going forward.

## Named successor — Approach B, gated

The design names a CQRS query extraction (`packages/core/analytics`) as **Approach B**, the
deliberate next step for this analytics surface — explicitly **out of scope** until
SMELL-101 lands, so the arithmetic defects are fixed once, in the extraction, rather than
patched in place and then re-fixed during the extraction.

## Narrow channel projection — the hazard this change closed

The export path spreads its channel list into a tenant-downloadable payload. Before this
change, doing so via the wide `getChannelsByProject` would have shipped four real credential
columns (SECURITY_CANON admits no exception marker for this). The swap routes the export's
channel read exclusively through the new `listChannelRefsByProject`, whose adapter carries
an explicit `select: {id, provider, handle}`; `getChannelsByProject` appears **zero** times
in the route file after the swap. Pinned two ways: an exhaustive call-args assertion on the
adapter (the load-bearing proof — it fails if the select is dropped, widened, or moved
post-query) and a characterization assertion that no exported channel entry carries any
`credential*` key, plus a whole-body negative match on the ciphertext column name.

## Verification integrity

Three mutations were independently planted and restored byte-exact during verify (distinct
from the writer's own three RED-proof mutations during apply): M-A (renamed a dashboard
response key) → real exit 1, restored, 12/12 sha256 checks OK; M-B (dropped the new
adapter's `since` conditional spread) → the _adapter unit_ went red while the merged
characterization suite stayed green (an accurate, stated limit — the net's liveness on the
new seam is held by the adapter call-args pins alone in the final tree, not by the deleted
golden layer); M-C (dropped an inline `deletedAt` filter) → fitness #38 moved from 0 to
exactly 1, proving the gate is non-vacuous. No repository file was left modified after
verify; `git status` was byte-identical to its start.

## Spec merges (the living-spec state after this archive)

- `openspec/specs/analytics-read-port-boundary/spec.md` — **NEW** capability, byte-identical
  copy of the delta (8 ADDED requirements, 26 scenarios, 6 merge-blocking) — mechanical, see
  the orchestrator TODO below. The persisted delta already carries both spec corrections
  (403-not-404; `GET /analytics/export` query-param shape), so the promoted copy needs no
  further edit.

---

## Orchestrator TODO — mechanical steps (byte-identical copy / move only)

1. **Copy (NEW capability, byte-identical):**
   `openspec/changes/analytics-route-port-integrity/specs/analytics-read-port-boundary/spec.md`
   → `openspec/specs/analytics-read-port-boundary/spec.md`
   Verify: diff empty / checksum match.
2. **Move (after step 1 and after this report + the Master Plan edit land):**
   `openspec/changes/analytics-route-port-integrity/` → `openspec/changes/archive/analytics-route-port-integrity/`
   Verify: `openspec/changes/analytics-route-port-integrity/` no longer exists; the archived
   folder contains all original files plus this report, unmodified in content.
