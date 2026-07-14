# Verification Report — post-delete-ownership-gate

- **Change**: `post-delete-ownership-gate`
- **Branch**: `workstream/cluster-c-post-delete-gate`
- **Artifact store**: openspec (files) + engram mirror
- **Mode**: Full spec-driven verification (proposal/spec/design/tasks all present)
- **Strict TDD**: active — runtime evidence re-run independently
- **Verdict**: **PASS WITH WARNINGS**
- **Issue counts**: CRITICAL 0 · WARNING 1 · SUGGESTION 3

## 1. Completeness — tasks

All 13 tasks are `[x]` and spot-checked against code:

| Task    | Claim                                                          | Verified                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1/1.2 | RED integration test created                                   | `apps/api/tests/integration/postDeleteOwnership.test.ts` exists, 4 cases                                                                                                                       |
| 2.1     | Required `caller` union + exhaustive switch + gate-before-load | `DeletePostUseCase.ts:21-96` — union, `switch`, `never` default throw, `findOwnerAccountId` before `findById`                                                                                  |
| 2.2     | Route passes customer caller + defensive 401                   | `postRoutes.ts:360-368`                                                                                                                                                                        |
| 2.3     | Bus passes system caller                                       | `PostCommandHandlers.ts:508-511`                                                                                                                                                               |
| 2.4     | Integration GREEN                                              | Re-run 4/4 pass (below)                                                                                                                                                                        |
| 3.1     | Affected tests updated                                         | 3 files touched; broader "known set" (cqrsIntegration*, *test-helpers) needed no change — they build the bus command (`aggregateId`), not the use-case `caller`; tsc 0 confirms nothing missed |
| 3.2     | Gate unit tests                                                | `postUseCases.test.ts` new "ownership gate (CWE-639)" block, 5 tests                                                                                                                           |
| 3.3     | System-caller-forwarded assertion                              | `PostCommandHandlers.delete.test.ts` new test, `toEqual` exact caller                                                                                                                          |
| 3.4/4.x | Full affected set green + 0/0 gate                             | Re-run below                                                                                                                                                                                   |

## 2. Runtime evidence (re-run independently)

- **Integration** (`node --import tsx --conditions development --test`, real two-tenant DB):
  `tests 4 · pass 4 · fail 0 · cancelled 0`. Redis `commandTimeout` noise is the known homelab F-1 (ioredis), not a test failure — all 4 asserted.
- **Unit** (`pnpm --filter @apps/api test` — the script runs the whole vitest suite; positional filters ignored):
  `Test Files 505 passed · Tests 7964 passed · 0 failed · 0 cancelled`, exit 0. The `API Error`/`redis down`/`DB exploded`/`boom` log lines are asserted negative-path fixtures.
- **Type check**: `@core/posts tsc --noEmit` exit 0; `@apps/api tsc --noEmit` exit 0 (needed `--max-old-space-size=6144` — LXC heap, first run OOM'd then passed clean).
- **Lint**: `eslint --max-warnings 0` on all 7 touched files (6 apps/api + `DeletePostUseCase.ts`) exit 0.

**Gate: 0/0 confirmed.**

## 3. Spec compliance matrix

| #   | Requirement                                           | MB  | Status         | Evidence                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------- | --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ownership-scoped deletion                             | ✅  | PASS           | Integration case 2: A→B's post = 404 AND `deletedAt===null` on a fresh foreign post; owner case 1 = 200 + soft-deleted                                                                                                                             |
| 2   | Anti-enumeration parity (404 not 403, byte-identical) | ✅  | PASS (see W-1) | Case 3 deep-equals foreign 404 body to nonexistent 404 body = `{ ok:false, error:"Post not found" }`; route `messageMap` strips the id; `mapUseCaseError` proves NOT_FOUND→404, FORBIDDEN→403 are distinct paths and the gate only emits NOT_FOUND |
| 3   | Gate precedes any mutation                            | ✅  | PASS           | `DeletePostUseCase.ts:72-96` gate before `findById`/status/`delete`; unit test asserts `findById` and `delete` NOT called on foreign id                                                                                                            |
| 4   | Account from authenticated principal                  | —   | PASS           | Route reads `request.customerUser.accountId` (`requireClientAuth`); `PostParamsSchema` has only `id` — no account param to override                                                                                                                |
| 5   | Caller context explicit and required                  | —   | PASS           | `DeletePostInput.caller` non-optional union; omission = compile error (tsc 0); unit test coerces `{type:"intruder"}` and asserts throw + `delete` not called                                                                                       |

## 4. Design coherence

Matches design.md exactly: required discriminated `caller`; NOT_FOUND (never FORBIDDEN) for mismatch/null; gate after `PostId` validation and before `findById`; both call sites wired as specified. Dispatch graph re-verified independently — exactly two production `.execute` sites (`postRoutes.ts:365` customer, `PostCommandHandlers.ts:508` system); `post.delete` command emitted only by `saga.ts:537` (compensation on the saga's own post); `CQRSIntegration` is not instantiated in production wiring (dead code confirmed) — no arbitrary-command HTTP surface.

## 5. Adversarial results

- **Bypass / cross-path**: none found. Customer input cannot select the `system` variant (route hardcodes `type:"customer"`; `caller` is not in any request schema). No third dispatch path. Account/project cascade `post.deleteMany` (`accountRoutes`, `projectRoutes`, `PrismaAccount/ProjectRepository`) are owner-scoped cascades on a different operation, out of scope for `DELETE /posts/:id`.
- **Weakened assertions**: none. New unit tests strengthen coverage (assert `findById`/`delete` not called; exact `toEqual` system caller; throw on unknown variant). Pre-existing `as any`/`repo as any` are test-fixture casts, unchanged.
- **Sibling regression**: none. Update/Archive/HardDelete/Duplicate untouched; still forward optional `callerAccountId` and compile/pass. Full suite green.

### Concern A — test isolation / false-green → **WARNING (W-1)**

Runtime trace confirms case 2 and case 3 BOTH target the same foreign post (`132b95a1…`). The load-bearing case (case 2) is sound and independent: it asserts BOTH `statusCode===404` AND `deletedAt===null` on a fresh foreign post nothing touches earlier — without the gate it returns 200 + soft-delete and fails on both assertions, and a `return 403` mutation also fails its `===404`. So the gate-removal and 403-leak regressions ARE caught. The residual: case 3 (the dedicated anti-enumeration parity scenario) reuses case 2's post, so under a hypothetical gate removal it would false-green (case 2 already soft-deleted the shared post → case 3's foreign delete 404s because it is gone, not because of the gate). In the current GREEN implementation the parity assertion is valid (two real gate 404s). Not CRITICAL because no requirement is left unproven and the realistic mutation space is covered by case 2. **Recommend**: case 3 seed its own fresh foreign post (or `beforeEach` reseed) so each MERGE-BLOCKING scenario is independently regression-robust.

> **POST-VERIFY UPDATE (archive time):** W-1 was FIXED after this verify run. `apps/api/tests/integration/postDeleteOwnership.test.ts` case 3 now seeds its own untouched foreign post (`antiEnumTargetPostId`, distinct from case 2's `foreignTargetPostId`) and asserts it survives (`row?.deletedAt === null`) after the 404, pinning that the 404 came from the ownership gate rather than from a prior delete. Re-run after the fix: 4 pass / 0 fail; eslint clean on the touched file. **W-1 is CLOSED as of archive**, not outstanding.

### Concern B — `never`-default throw vs zero-throw-in-application canon → **KEEP**

`DeletePostUseCase` is `@layer application`; CODING_STANDARDS says "Zero throw in domain/application — use Result for all fallible operations." The `never` default is an `assertNever`-style exhaustiveness guard — the only `: never =` site in the repo — unreachable by construction (union has exactly two handled members). It is a bug-assertion, NOT a fallible business operation, so it is outside the spirit of the Result rule (which targets I/O, validation, invariants). Precedent exists for throws in `packages/core` application services (`GatewayBillingService`, `TrialManagementService`, `ComplianceService`) and a `: never` throwing helper in `config/env.ts`. Fitness #4 does not scan `packages/core`, so no CI conflict, and the design + tasks explicitly specified this pattern (it passed the design adversarial gate). The unit test proves it fails CLOSED (throws → no delete; route `catch` → 500, no mutation). Rewriting to `return err(NOT_FOUND)` would be marginally more canon-literal but strictly WORSE engineering: it would MASK a genuine programming bug (a future unhandled caller variant) as a benign 404 instead of surfacing it loudly. **KEEP** — idiomatic, unreachable, fail-closed, and the louder failure mode is the correct one for an exhaustiveness assertion.

**Archive-time confirmation:** verdict unchanged. KEEP.

## 6. Issues

- **CRITICAL**: none.
- **WARNING W-1**: anti-enumeration parity test (integration case 3) shares its foreign post with case 2 → not independently regression-robust (false-green under a hypothetical gate removal; the removal is still caught by case 2). Fix: fresh per-case foreign fixture. **STATUS: FIXED post-verify, before archive** (see Concern A update above).
- **SUGGESTION S-1**: sibling use cases (Update/Archive/HardDelete/Duplicate) still use the fail-open optional `callerAccountId?`. Documented Slice-6 follow-up in design; unchanged here (correct scope), but the IDOR-shaped gap persists on those routes until migrated. **STATUS: open, tracked as archive follow-up.**
- **SUGGESTION S-2**: `pnpm --filter @apps/api test` ignores positional file filters and runs the entire suite; documenting a single-file unit command (e.g. `pnpm --filter @apps/api exec vitest run <path>`) in tasks would make focused re-runs cheaper on the LXC. **STATUS: not applied; low-cost documentation improvement, not blocking.**
- **SUGGESTION S-3**: `@apps/api tsc --noEmit` OOMs at the default 2 GB heap on this LXC; the 0/0 gate command should carry `NODE_OPTIONS=--max-old-space-size=6144` so CI/local runs don't read a memory abort as a type failure. **STATUS: not applied; tooling ergonomics, not blocking.**

## Verdict

**PASS WITH WARNINGS** — all 5 requirements (3 MERGE-BLOCKING) proven by real-DB runtime evidence; 0/0 gate green (tsc @core/posts + @apps/api, eslint on touched files, integration 4/4, full unit suite 7964/0). One WARNING (test-hygiene on the anti-enumeration case, FIXED post-verify) and three SUGGESTIONS (S-1 tracked as follow-up, S-2/S-3 tooling ergonomics); none block archive. `never`-throw: **KEEP**.

**Next recommended**: `sdd-archive` (WARNING W-1 is a test-robustness improvement, not a blocker; addressed before archive — see update above).
