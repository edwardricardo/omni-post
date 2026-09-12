# Tasks: analytics-route-port-integrity (SMELL-98)

> Materialized from Engram `sdd/analytics-route-port-integrity/tasks` (obs 685, rev 2 —
> checkboxes reflect the completed apply batch).

Carries the design-gate verdict (obs 684, PASS-with-findings): C1-C3, W1-W6, S1-S7 land here as explicit tasks. No design re-run.

**APPLY STATUS (2026-09-12, batch 1):** implementation COMPLETE and green (568 test files / 8834 tests, eslint 0, tsc 0, fitness #8/#9/#10/#22/#38 at threshold). Two items were open at apply time (**4.3 BLOCKED** on the SMELL-98 row landing, and **1.13** pending an orchestrator commit) — both RECONCILED at archive: PR #249 merged to main `f16b8c43` (five commits: `27f54cb3` planning, `8d512dd6` WU1, `62f48504` WU2, `9c93a9cd` WU3, `a9f6ba01` WU4/backlog). The EVIDENCE tier breached its declared hard stop (measured 1019 vs stop 770) — reported, NOT trimmed, per the overrun rule, and **ratified by Edward** (see archive-report).

## Review Workload Forecast

| Field                   | Value                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| Estimated changed lines | CODE ~160-215 · EVIDENCE ~520-670 (hard writer stop 770)                                           |
| MEASURED changed lines  | **CODE 289** (cap 400 — within) · **EVIDENCE 1019** (stop 770 — BREACHED, needs ratification)      |
| 400-line budget risk    | Medium (CODE tier safe; EVIDENCE is the declared tier)                                             |
| Chained PRs recommended | No                                                                                                 |
| Suggested split         | Single PR, 4 work-unit commits                                                                     |
| Delivery strategy       | single-pr                                                                                          |
| Chain strategy          | size-exception (expressed as the two-tier EVIDENCE declaration in the PR body, not a per-PR label) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

**Two-tier declaration (W6 — one decision for the whole change).** CODE hard-capped at 400, measured **289**. EVIDENCE declared 520-670 with hard writer stop 770, measured **1019**. The overrun is reported rather than absorbed: no coverage was trimmed to reach the number. Drivers are itemised in apply-progress.

### Suggested Work Units

| Unit | Goal                                                 | PR   | Focused test command                                                                                                                             | Runtime harness                                              | Rollback boundary                                                  |
| ---- | ---------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1    | Characterization suite + Layer-B goldens, red-proven | PR 1 | `pnpm --filter @apps/api exec vitest run tests/unit/analytics/analyticsRoutes.characterization.test.ts`                                          | N/A — unit-only; no service, no DB (mockPrisma + app.inject) | Delete the new test file; zero production files touched            |
| 2    | 4 port methods + 4 adapter impls + adapter units     | PR 1 | `pnpm --filter @apps/api exec vitest run tests/unit/infrastructure/repositories/Prisma{ProjectQuery,ThreadRead,AnalyticsRead}Repository.test.ts` | N/A — same reason                                            | Additive only, no consumer yet; revert leaves tree compiling       |
| 3    | The swap: 10 sites, ctor, plugin, imports, JSDoc     | PR 1 | `pnpm --filter @apps/api exec vitest run tests/unit/analytics/`                                                                                  | N/A — same reason                                            | Revert restores the client-taking ctor; WU1/WU2 survive harmlessly |
| 4    | Golden-layer deletion + backlog rows + gate          | PR 1 | full unit tier + fitness                                                                                                                         | N/A                                                          | Docs + test-only                                                   |

## Phase 0: Preflight (no edits yet)

- [x] 0.1 Branch `workstream/analytics-route-port-integrity` from **`origin/main`** — VERIFIED: branch tip == origin/main == `fdda5d25`, working tree clean at start.
- [x] 0.2 **C3 sequencing.** VERIFIED and ENFORCED: `rg "SMELL-98"` returns nothing on this branch, and `git show origin/main:docs/reports/roadmap-detected-smells-backlog.md` also lacks it (highest present = SMELL-97). Per the standing instruction the row was NOT synthesized; Phase 4.3 is left BLOCKED and its exact text is handed to the orchestrator in apply-progress.
- [x] 0.3 **S7.** No tripwire-7 block was encountered during this run; every edit proceeded.
- [x] 0.4 **run_batch wiring is N/A.** VERIFIED read-only: `apps/api/vitest.config.ts` line 46 `include: ["tests/unit/**/*.test.ts", "tests/eval/**/*.test.ts"]` collects the new `tests/unit/analytics/` directory by construction. No `run-tests.sh` entry added.
- [x] 0.5 Writers never run git. Honoured — zero git mutations. Only read-only `git diff/status/show` inspection was used.

## Phase 1: WU1 — characterization harness (RED first, strict TDD)

- [x] 1.1 Created `apps/api/tests/unit/analytics/analyticsRoutes.characterization.test.ts` importing `../../../src/analytics/analyticsRoutes.js` (the CUSTOMER file). Canon header present.
- [x] 1.2 **C1a CONFIRMED and handled.** `post`/`channel`/`analytics`/`thread` are all absent from the shared helper. Bolted on in-suite via `buildModelMock(createStore())` + `Object.assign`, named one by one. Shared helper NOT edited.
- [x] 1.3 **C1b.** `storeBackedFindMany` implements the nested to-one relation filter against the post store (inner-join semantics: a null FK can never satisfy it), plus `capturedAt: {gte}`, `orderBy` and `take`.
- [x] 1.4 **C1c.** `applyScalarSelect` implements real scalar-select projection for channel/post/analytics/thread reads.
- [x] 1.5 **W5.** 30s poll killed via `container.registerInstance(TOKENS.BackgroundTaskScheduler, new NoopBackgroundTaskScheduler())` before plugin registration. **ADDITION:** `TOKENS.CachePort` also overridden with `InMemoryCacheAdapter` — resolving RealtimeAnalyticsService reaches CachePort → RedisCacheManager, which opens a real Redis socket. Same open-handle class as the timer.
- [x] 1.6 Harness: real plugin + real `setupContainer(mockPrisma)` + `app.inject`; `requireClientAuth` mocked to a fixed principal; logger mocked via `importOriginal` spread so no named export goes missing.
- [x] 1.7 Fixtures: fixed-date seeds under a FROZEN clock (`vi.useFakeTimers({toFake:["Date"]})`); 2 channels on ONE provider + 1 on another; analytics rows incl. `postId: null`; soft-deleted project/post/channel/thread-via-post rows; capturedAt inside and outside the 7-day window; channel rows carrying the four credential columns.
- [x] 1.8 Distinct projectId per test (8 slots) and distinct projectId+timeRange per repeated request.
- [x] 1.9 Layer A shape pins for dashboard, export json x2 branches, export csv x2 branches, project-analytics, and the export's absent/soft-deleted paths. SHAPE rule honoured — no arithmetic value asserted anywhere.
- [x] 1.10 **C2.** Layer B implemented as `toMatchSnapshot()` over the RAW `res.body` STRING after deterministic regex normalization of `exportedAt`. No object snapshots, no property matchers.
- [x] 1.11 Credential assertion at the hazard site: every export `channels[]` element carries no `credential*` key, plus a whole-body `not.toMatch(/ciphertext/i)`.
- [x] 1.12 **RED proof DEMONSTRATED (3/3, real non-zero exits, byte-exact restores).** See apply-progress for verbatim output.
- [x] 1.13 WU1 commit — **orchestrator's step** (writers never run git). **BLOCKER FOUND:** `.gitignore:24` ignores `**/__snapshots__/`, so the goldens cannot be committed without `git add -f`. Byte-identity was proven by a pinned sha256 pair instead; see apply-progress. **RECONCILED at archive**: committed as `8d512dd6` ("characterization net, red-proven") in PR #249, merged to main `f16b8c43`.

## Phase 2: WU2 — ports, adapters, adapter units (additive)

- [x] 2.1 **RED first, CONFIRMED:** 10 new tests failed with `TypeError: repo.<method> is not a function` before any implementation existed.
- [x] 2.2 **W4.** Call-args pins on ALL FOUR methods: exact `where` (incl. inline `deletedAt: null`), `select`, `orderBy`, `take`, and explicit absence of `include`.
- [x] 2.3 Credential proof on `listChannelRefsByProject`: (a) call-args pin; (b) returned key-set === `["handle","id","provider"]`, labelled in-comment as a property of the test's own projection stub, with (a) named as the load-bearing proof.
- [x] 2.4 `ProjectQueryRepository.ts`: added `ChannelRefDto` + `PostExportRowDto` + the two methods. **S2 done** — `ProviderKind` added to the import list.
- [x] 2.5 `ThreadReadRepository.ts`: added `ThreadRefDto` + `listThreadRefsByProject`; JSDoc states the unordered-take contract.
- [x] 2.6 `AnalyticsReadRepository.ts`: added `ProjectEntriesOptions` + `listProjectEntries`. **S6 done** — JSDoc justifies its narrowness beside `AnalyticsQueryOptions` and its existence beside `getByProjectId`.
- [x] 2.7 `PrismaProjectQueryRepository`: both methods implemented, `deletedAt: null` INLINE in each call's own where.
- [x] 2.8 `PrismaThreadReadRepository.listThreadRefsByProject`: 4-field select + take, deliberately NO orderBy (pinned by a test).
- [x] 2.9 `PrismaAnalyticsReadRepository.listProjectEntries`: single nested-join findMany, conditional spread on `since`, capturedAt desc, caller's take.
- [x] 2.10 **W1 — explicit select restored** naming the nine AnalyticsDto columns in ReadModelDtos order, with the rationale in JSDoc.
- [x] 2.11 Enum casts follow the files' `as unknown as` convention. `tsc -b apps/api packages/core` EXIT 0 with no consumer yet. (WU2 commit = orchestrator's.)

## Phase 3: WU3 — the swap

- [x] 3.1 Ctor param 1 dropped; `analyticsRepository` + `threadRepository` inserted after `projectRepository` per D3.
- [x] 3.2 All ten reads rewired. `getChannelsByProject` appears ZERO times in the file.
- [x] 3.3 Plugin: `TOKENS.PrismaClient` resolve deleted; the two port resolves added; arg list updated. ZERO container additions.
- [x] 3.4 `import type { PrismaClient }` deleted; the two port type imports added.
- [x] 3.5 **S3.** Plugin JSDoc rewritten; the in-handler comment naming `findFirst` reworded.
- [x] 3.6 **W2 honoured.** No call-args assertions in the characterization suite; those live only in the adapter units.
- [x] 3.7 Suite run against the WU1 goldens **unchanged, never `-u`** — sha256 IDENTICAL before and after the swap (`2755c242…`). **W3(a) SUPERSEDED** (goldens are gitignored, so the git-diff form is vacuous); the sha256 pair is the substitute and is stronger. Additionally, a planted mutation in the NEW adapter turns the pre-swap golden RED, proving the net is live on the new seam.
- [x] 3.8 `rg -ic prisma apps/api/src/analytics/analyticsRoutes.ts` → **0** (no match, exit 1).

## Phase 4: WU4 — golden deletion, backlog, gate

- [x] 4.1 Layer-B `toMatchSnapshot` assertions and the generated snapshot file deleted. Layer A shape pins remain; the two refusal tests gained a verbatim body pin so they did not lose their assertion with the golden.
- [x] 4.2 **W3(b) run — and the gate as written is DEFECTIVE.** `fd -e snap apps/api/tests` treats the path as a pattern (dead scope), and even the path-corrected form is blind because `fd` honours `.gitignore` and `**/__snapshots__/` is ignored. PROVEN by planting a `.snap`: both forms report 0, `fd -u -e snap . apps/api/tests` reports 1. Working gate: `fd -u -e snap . apps/api/tests | wc -l` → 0 and `rg -uu -c "toMatchSnapshot" apps/api/tests | wc -l` → 0. Both pass.
- [x] 4.3 **BLOCKED on 0.2** — the SMELL-98 row does not exist on this branch or origin/main. Not synthesized. Exact drafted text for closing 98 and adding SMELL-99/100/101/102 is in apply-progress for the orchestrator to apply after sequencing lands. **RECONCILED at archive**: applied and committed as `a9f6ba01` ("backlog: SMELL-98 DONE, rows 99-103 born") in PR #249, merged to main `f16b8c43` — SMELL-98 closed, rows 99-103 born (101 absorbed the export's dead-404 branch; 103 is the untypechecked-`implements` gap named separately per verify S-2).
- [x] 4.4 **No SMELL-101 defect repaired.** Responses exhibit all four exactly as before — the goldens recorded the per-channel double count verbatim (two same-provider channels each reporting the whole provider's totals).
- [x] 4.5 Gate: eslint `--max-warnings 0` EXIT 0 · `tsc -b --force apps/api packages/core` EXIT 0 · full unit tier 568 files / 8834 tests PASS, 0 skipped, 0 cancelled, 0 snapshots · fitness #8=0 #9=0 #10=0 #22=0 · #38 swept-tree 0 with db-prisma ratchet UNCHANGED at 11 and no name added to the exception list · zero files under `packages/adapters/db-prisma` · tokenless honoured.
- [x] 4.6 PR body drafted in full (measured two-tier split, EVIDENCE ratification note, the three red-proof demonstrations, the new-seam mutation proof, SMELL filings, W1 select decision, rollback).

## Requirement → task traceability (8 requirements / 26 scenarios)

| Req                               | Scenarios | Tasks                          | Apply outcome                                                                                                                                                         |
| --------------------------------- | --------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 Ports-only construction [MB]   | 4         | 3.1, 3.3, 3.4+3.5+3.8, 3.2     | MET — 0 prisma references                                                                                                                                             |
| R2 Characterization net [MB]      | 4         | 1.1-1.9, 1.12, 1.9, 1.8        | MET — 3/3 red proofs                                                                                                                                                  |
| R3 Response equivalence [MB]      | 4         | 1.10 + 3.7                     | MET — sha256 identical. NOTE: the spec's "404 body" is unreachable; reality is 403 from the ownership gate, characterized as such (spec corrected at materialization) |
| R4 Narrow channel projection [MB] | 4         | 2.7, 2.3 + 1.11, 3.2, 1.9/1.10 | MET                                                                                                                                                                   |
| R5 Query-shape preservation       | 4         | 2.9+2.10, 2.8, 2.7, 2.2, 3.2   | MET                                                                                                                                                                   |
| R6 Soft-delete posture            | 3         | 2.7+2.8, 4.5, 4.5              | MET — and PROVEN non-vacuous (removing one inline filter moves #38 from 0 to 1)                                                                                       |
| R7 Debt filed, not absorbed       | 2         | 4.3, 4.4                       | MET — 4.4 met; 4.3 RECONCILED at archive via `a9f6ba01` (PR #249, merged `f16b8c43`)                                                                                  |
| R8 Zero-defect gate               | 1         | 4.5                            | MET on every gate; EVIDENCE budget breached and reported                                                                                                              |

## Threat matrix

N/A per design — no routing-behaviour, shell, subprocess, VCS/PR-automation, executable-classification or process-integration boundary. Route registrations are untouched; only the data-access seam behind existing handlers moved.
