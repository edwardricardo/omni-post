# Testing Re-foundation — Fixed plan

The plan the tracker [TESTING_REFOUNDATION.md](TESTING_REFOUNDATION.md) measures progress against.

**Owner:** Platform engineering

## Plan (fixed)

Phases 0–9 and their work units, rendered from the approved plan (held outside the repository,
read-only). This section is FIXED: it is not edited to match what happened. A change to it is a
re-plan, and a re-plan is recorded in [§Decisions log](#decisions-log) with its date and its reason.

### What was signed, and is not re-discussed

1. **Confidence** = the code passes a STRICT and exhaustive battery, not an accommodating one. Every
   layer with its honest gate, and the merge blocked by ALL of them.
2. **A test proves in BOTH directions**: it fails when the behaviour is not met, and it passes when
   the code meets it. It is the same principle as "a gate is born with its demonstrated red",
   applied to each test — the criterion for demolishing AND for building.
3. **Decorative-test criterion** (any of the four, proven per file and LISTED before deleting):
   (a) it does not restrict behaviour — it only asserts existence; (b) it points at something that
   does not exist; (c) it skips itself under the conditions CI provides; (d) it cannot fail by
   construction. The hard probe settles doubt: delete the implementation — if it stays green, it is
   decorative.
4. **The decorative is deleted FIRST** and the count may fall. **The frameworks are NOT deleted**:
   they are re-founded afterwards.
5. **Sequence**: the re-foundation goes BEFORE everything else, against what is already done
   (`main`). What is open, green and reviewed merges first; what is red merges when it closes its own
   red; what is UNWRITTEN is measured at the end of the queue.
6. **Which framework for what**: decided by the BOUNDARY the code crosses, one test per boundary at
   the lowest layer that can see the defect. A framework stays only if it is the only tool that sees
   a class of defect; two for the same class → one is redundant.
7. **Mutation testing is NOT installed before starting**: it enters once the tests are worth
   measuring (after coverage in all 86), as the tool that verifies rule 2 at scale.
8. **ALL the tests are reviewed** (942 + 8): the machine first, the hand after; every file ends with
   a verdict in a ledger — keep / rewrite / delete — with evidence. Nothing survives by default.
9. Executed as **SDD**, with receipt-driven review per pull request and the two-tier review budget
   (CODE 400 hard / EVIDENCE pre-approved).
10. **How the frameworks compose into one unit**: not by calling each other, but through three shared
    contracts — reach, environment, verdict — and shared tooling. **The unit is the composition of
    the merge gate, not a runner.**
11. **Which frameworks are really needed** is decided by the boundaries the system has, not by what
    is installed. Verdicts to confirm with evidence: vitest, React Testing Library and coverage stay;
    Playwright stays; MSW stays as the ONLY HTTP double; k6 stays only if load blocks merges,
    otherwise it goes; **node:test is the uncomfortable case** (two runners for one class — measured
    against whether vitest can own the tier with real services; if there is no difference, one is
    redundant, 108 files); Jest is out (it arrives by rebound through the Storybook test runner,
    which also has to justify itself); mutation testing returns because it is the only thing that
    verifies rule 2 at scale.
12. **Signed diagnosis, framework by framework**: vitest is the only thing that works as a unit, but
    50 packages holding one four-test file is scaffolding; node:test is the most honest layer (it
    names what fails, it has tiers, it punishes the skip) but with 20 unwired suites and hand-written
    lists; Playwright is decorative (0 CI runs, specs without their page objects, admin without a
    script); MSW is installed and unwired; k6 and perf never ran and cannot fail; `security/tests` is
    fiction; real coverage is around 50 % against a document that says 95 %; Jest is in the tree
    against the canon. As a unit: **it is not a unit** — layers that do not talk to each other, two
    collectors with disjoint lists, unreddenable gates, a nightly with 31 unread alarms, four
    contradictory documents. The only thing that protects a merge today: the api vitest suite plus
    the integration tier.
13. **Where to start**: at the floor — reach → demolition → gates that can fail → the integration
    tier → coverage in all 86 → re-found the decorative → mutation → the queue. Starting at E2E
    would be building the bedroom on the roof again.
14. **Objections**: when I think otherwise, I argue why and nothing more.

### The three contracts that make five frameworks one unit

| Contract        | What it fixes                                                                                                                                                                                                                                | How it is verified                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reach**       | Every test file has exactly ONE collector, decided by name/path convention (`*.test.ts` vitest · `*.integration.test.ts` node:test tier · `*.live.test.ts` live tier · `*.spec.ts` Playwright · `*.k6.js` k6). The convention IS the router. | Gate: `disk − union(collectors) = 0`, with no hand-written lists. Closes SMELL-74/75/79; #30 stops being a ratchet.                                            |
| **Environment** | ONE script brings up the same services (Postgres, Redis, API, workers) for local and CI, with both URLs (app role / owner) and the `development` condition. Integration, E2E and perf all consume it.                                        | The same command in `ci.yml`, `performance.yml`, Playwright's `webServer` and locally; readiness PROVEN, not assumed.                                          |
| **Verdict**     | Every layer emits an exit code plus a report readable by machine and human; the merge gate COMPOSES them: all required, no `needs:` that dodges, no swallowed exit, each with a demonstrated red.                                            | Fitness #34 (`::error` paired with an exit) plus a new gate over implicit `needs` / `if: success()`, plus the required-check list versioned in the repository. |

Plus a shared tooling package — factories, fixtures and MSW handlers in one place, so the five layers
talk about the same `Post`.

### The convention (the router)

| Name                                 | Collector                                  | Environment profile                                                              | Where it may live               |
| ------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------- |
| `*.test.ts(x)` (and not a row below) | the package's vitest config                | `hermetic`: no network; Postgres/Redis URLs point at `127.0.0.1:1` (unreachable) | anywhere a vitest config covers |
| `*.integration.test.ts`              | the integration collector (`run-tests.sh`) | `services`: Postgres + Redis, owner URL and app-role URL                         | `apps/api/tests/**` only        |
| `*.live.test.ts`                     | the integration collector, live phase      | `services` plus API and workers booted and ready                                 | `apps/api/tests/**` only        |
| `*.spec.ts`                          | Playwright (per-app config, `testMatch`)   | full stack via `test-env.sh serve`                                               | `apps/{client,admin}/**/e2e/**` |
| `*.k6.js`                            | k6 (performance workflow)                  | full stack                                                                       | `performance/k6/scenarios/`     |
| `*.fixture.ts`, `*.test-helpers.ts`  | none, by design                            | n/a                                                                              | anywhere                        |

"Test-shaped" = a basename matching `/\.(test|spec)\.[cm]?[jt]sx?(\..+)?$/` or `/\.k6\.js$/` (it
catches `.test.ts.disabled` and `.old`, and excludes `.env.test.example`). The disk set is
`git ls-files` over the WHOLE repository, so `security/`, `performance/`, `quality/` and any new
directory are in scope with nothing to configure. **The suffix names the TIER, not the runner**, so
the router survives node:test being consolidated into vitest.

### Budget convention (D1)

**CODE** (hard limit 400 per pull request): production, scripts and tooling, workflows and config,
the test-utils packages, ESLint rules, canon and docs prose, test lines added or modified, and block
deletions inside files that are kept. **EVIDENCE** (pre-approved per slice): generated artefacts
(ledger JSON and Markdown, `probes.json`, `eslint-suppressions.json`), whole-file deletions backed by
an approved ledger row, `git mv` at ≥ 90 % similarity, and the mechanical output of a codemod whose
own code counted as CODE. Every new file carries `@file/@description/@layer`; no comment mentions a
development timeline.

### What reading the code changed (design findings, 2026-09-27)

1. **F-6 is a class, not a test**: `bulkScheduleRelayRetry.integration.test.ts:95` and
   `bulkScheduleMediaPath.integration.test.ts:97` also build their own `OutboxRelay` through
   `bulkScheduleHarness.makeRelay` — wired into `integration:outbox` under `full-integration` they
   would run against the real relay (`src/index.ts:866`) exactly as the smoke does. **F-6 is fixed
   BEFORE they are wired.**
2. **The sentinel does not help the smoke**: `OutboxRelay.integration.test.ts` seeds its own rows and
   pre-claims them; in the smoke the use case writes the outbox row inside its own transaction, so
   the race window stays open.
3. **k6 cannot run even with the variable corrected**: `performance/k6/utils/auth-helpers.js`
   registers users through `POST /api/auth/register` (which does not exist) and imports from
   `https://jslib.k6.io`.
4. **"Schedule → the worker publishes" would be red today because of N-COR-9**, not because of the
   tests: nothing promotes a scheduled post except the webhook clobber. The first green E2E uses
   publish-now; schedule → published is the acceptance test of N-COR-8/9.
5. **Demolition lowers `apps/api`'s coverage floors** (coverage counts execution, not assertion).
   Fitness #37 accepts a descent only with a `canon-exception:<scenario>` marker and the scenario
   table has none → new scenario plus an ADR (WU-2.0).
6. **The regex undercounts; the AST is the tool**: `rg -U` finds 30 files with a multi-line
   `stubGlobal("fetch")` against 26 on one line → every new gate is an ESLint rule.
7. **ESLint 9.36 has bulk suppressions** (`eslint-suppressions.json`): a ratchet per file and per
   rule, and an obsolete suppression is **exit 2** → demolition pull requests are obliged to prune.
8. **`@vitest/eslint-plugin` recommended includes `no-import-node-test: error`** → it must be scoped
   to the files vitest collects, or it flags the 108 node:test files.
9. **`settingsRoutes.test.ts` is behavioural** (it exercises the real schemas' `safeParse`); its
   defect is the promise in its header → it is renamed, not deleted.
10. **`universal-client-dashboard.live.test.ts` adds nothing**: every endpoint it touches is
    already covered by `providerRegistry.live.test.ts:64-358`, which authenticates and asserts 11
    providers.
11. **The client E2E login fixtures are false**: `fixtures/test-user-auth.json` stores a fake JWT in
    `localStorage`; the client authenticates with httpOnly cookies
    (`lib/auth/sessionCookie.ts`).
12. **The Prisma double can never fail on raw SQL**: `createMockPrismaModule` answers `$queryRaw*`
    with `[]`, so every raw path passes by construction.
13. **A single test-utils package would couple and slow the whole core**: no core or provider package
    depends on `@infra/prisma` today; one package with Prisma inside it puts `prisma generate` into
    everyone's `^build` graph → three packages.
14. **The SSRF case in `security/tests` is probably a genuine red**: the external notification sinks
    validate HTTPS only (`ConfigureExternalNotificationUseCase.ts:74-76`) and
    `secureSchemas.ts:129` blocks `localhost` by substring.
15. **`createTestApp` cannot live in a shared package**: only `apps/api` uses Fastify and the builder
    needs `errorPlugin`, `setupContainer` and the Zod compilers → `apps/api/tests/support/`.

### Phase 0 — Baseline and tracking (Track T)

**Closed 2026-10-06** ([D51](#decisions-log)). WU-T.1 to WU-T.3 landed on 2026-09-27 (#316, #317), and
WU-T.4 closed with every Phase 0 slice of `openspec/changes/testing-refoundation/tasks.md` but `0.16`,
the last of them `0.22` (#445, #447); [§Work units](#work-units) names each with its pull request.
Slice `0.16`, the move to Node 26, stayed a dated unit for 2026-10-28 ([D46](#decisions-log)) until the
owner moved it to 2026-10-15 ([D52](#decisions-log)). The text below is the plan as signed.

- **WU-T.1** Create `docs/development/TESTING_REFOUNDATION.md` (structure in §Medidor) with the
  baseline measured at the base SHA; row in `docs/README.md`. Acceptance: every metric with a
  baseline, a re-derivation command and "Moved by: —". CODE ~180. PR `refound/0-tracker`.
- **WU-T.2** `scripts/testing/metrics.mjs`: prints the metric table from `git ls-files`, the reach
  module, `ledger.json`, `eslint-suppressions.json` per rule, and a pasted vitest/TAP summary.
  Acceptance: at the base SHA it reproduces the Baseline column byte for byte. CODE ~150.
- **WU-T.3** Ficha `N-TEST-1` in `MASTER_PLAN_ES.md §1 N.C` (plus notes on N-CI-2/N-CI-3 and the
  dashboard) and `NORMALIZATION_ROADMAP.md §2.3` subsuming §2.2.b, §3.2.b, §4.1.b/c (texts in
  §Medidor). Acceptance: fitness #24 green, links resolve. CODE ~70.
- **WU-T.4** Testing-toolchain alignment BEFORE the reach contract (signed 2026-09-27, D20):
  (a) measure with `pnpm outdated -r --format json` plus `pnpm view <pkg> time --json` the date of
  each version → table in the tracker: dep · installed · **latest mature** (≥ 7 days, ADR-0018) ·
  documented hold (yes/no, where) · CVE floor; (b) per family, raise to the **latest mature** unless
  a documented hold says otherwise, each bump validated empirically (green tests of the affected
  packages, `tsc -b --force`, `format:check`) and one pull request per family ≤ 400 CODE: `vitest` +
  `@vitest/coverage-v8` + `@vitest/ui`, `@playwright/test` (plus `playwright install` of the
  version), `msw`, `@testing-library/react` + `jest-dom` + `user-event`, `jsdom`, `tsx`;
  (c) **`@types/node` aligns DOWN to the runtime major (24)**, and `engines.node` is added (0 of 98
  manifests declare it) so drift becomes a gate; (d) the Storybook family keeps its hold (10.4.6,
  documented) and `@storybook/test-runner` is adjudicated: if no workflow or script runs it, it is
  removed and Jest 30 leaves the tree with it; if it is used, it is documented as the only carrier of
  Jest; (e) the 86 dead `vite` shims: clean reinstall and verification that `node_modules/.bin/vite`
  points at the single `vite` 8; (f) every direct testing dependency left below latest mature has its
  reason in the holds table of `docs/security/SECURITY_CANON.md` §"Build-tool version holds" — a gate
  in `Dependency Consistency` compares the holds table against `pnpm outdated` and fails on a lag
  with no row. Acceptance: 0 lags without a reason; `@types/node` major = runtime; 12,623 tests green
  after each bump. Gate red: lower a pin without adding a hold row → exit 1. CODE ~60 per family plus
  ~80 for the gate. PRs `refound/0-toolchain-<family>`.
  **Measured 2026-09-27**: (1) the gate's comparator is **"latest MATURE"**, not `latest` — today
  `latest` is not mature for vitest (5.0.2, 1.8 days → target 5.0.1), `@types/node` (mature 24.x =
  24.13.6), jsdom (30.1.0), vite (8.3.0), turbo (2.11.2), `@typescript-eslint` (8.70.0), tsx
  (4.23.13/15), k6 (v2.2.0); (2) undocumented majors the gate would flag: TypeScript 6→7 (7.0.2,
  mature 81 days; the real blocker is the peer `@typescript-eslint <6.1.0` → a new hold with that
  reason, or a bump of the family), `@vitejs/plugin-react` 5→6, jsdom 29→30, `@eslint/js` 9→10,
  vitest 4→5; (3) **jsdom 30 is not a test-only bump**: it requires Node `^24.15.0`, depends on
  `undici ^8` (the CVE override `undici >=7 <7.29` stops applying to that chain → re-audit) and jsdom
  29.1.1 is ALSO a production transitive through `isomorphic-dompurify@3.19.0` (4.4.0 wants jsdom
  ^30 → a production major) → its own decision inside T.4, with `engines.node >=24.15.0`; (4) the
  Storybook hold looks expired (10.6.0, 25 days, peers accept next ^16) → a validated family bump or
  a hold rewritten with a measured reason; (5) `@storybook/test-runner` is declared only by admin, no
  workflow runs it, and it is the ONLY source of jest 30.4.2, nyc 15.1.0, `@types/node@26.0.0`,
  `jest-process-manager` and `wait-on` → removing it removes them all (and `apps/client:30` has a
  `storybook:test` script without declaring the package); (6) the eslint hold only explains "<10",
  not staying at 9.36 while 9.39.5 is mature; (7) **`SECURITY_CANON.md:254` has the GHSA-q7cg chain
  wrong**: `request` arrives through `jq → jsdom@0.2.19`, not through `wait-on` → its remove-when can
  never fire (corrected in the same slice); (8) the catalog's "latest stable (taze)" comments are
  stale for typescript, `@types/node`, jsdom and msw.
  **Research verdicts that change T.4**: (a) **vitest stays at 4.1.11** as a documented HOLD with a
  measured reason: `@stryker-mutator/vitest-runner` 10.0.0 (the only stable one) is broken on vitest
  5 — stryker-js#6210 open, fix #6220 unmerged, every mutant silently "Survived" (47.36 → 2.96,
  7 min → 37 s), a peer `vitest >=2.0.0` that does not warn; the 4→5 migration is a 573-file project
  with behaviour changes (unawaited async assertions fail, `clearMocks` true, `-t` with `' > '`,
  removed entry points, outputs moved to `.vitest/`); and 5.0.2 is not mature. Remove-when: a stable
  stryker runner with #6220 plus re-measured maturity → its own migration change. (`@storybook/addon-vitest`
  is NOT installed: that reason does not apply.) (b) eslint 9.36.0 → 9.39.5 (in-major, end of the 9
  line, EOL) and the hold is rewritten with a date and a new remove-when (the react and jsx-a11y
  plugins still peer on ^9). (c) `@types/node` → the 24 line (24.13.6 mature today); pnpm enforces
  `engines.node` only for the project (no `engine-strict`). (d) tsx → 4.23.13. (e) Playwright 1.63.0,
  msw 2.15.0, `@axe-core/playwright` 4.13.0, `@vitest/eslint-plugin` 1.6.27: mature, they enter.
  (f) Confirmed: the `mergeConfig` shape for coverage is valid on 4 and 5; reporters come from
  `vitest/node` (never `vitest/reporters`); `vitest list --filesOnly` is a reach surface;
  `getResponse` from msw is a documented public export; the rules endpoint reads without a token but
  rulesets in evaluate mode are NOT returned → the gate fails closed on an empty array and paginates;
  merge queue exists only on organisation repositories → `strict` only (D5).

### Phase 1 — Reach contract

Design decisions: tier by suffix, **one execution unit per file** (one `node --test` per file: the
verdict names the file and the zero-test guard applies per file), concurrency 1 across the tier (as
it already is), **timeout declared in the test** (`describe(name, { timeout })`), and the two
ordering hacks become: the test that contaminates shared state restores it, and the runner verifies
API and worker readiness before EACH live file (naming the file that left the environment broken).
Rejected: directory-per-batch (it moves 98 files and ties the layout to the scheduler) and a manifest
with existence checks (still a hand-written list). Cost: about one extra node boot per file (~15–30 s
per run), measured as an acceptance criterion. The gate: **#30 becomes dynamic** — it asks each
runner what it collects and verifies that a required job runs each collector
(`disk − ⋃ collected-by-required-job = ∅`, exactly one collector per file); it needs dependencies
installed → a new `Test Contracts` job in `fitness.yml`.

- **WU-1.1** Free the `.integration` suffix and name the k6 scenarios: `git mv` of the 24
  `apps/client/tests/integration/*.integration.test.tsx`, the 2 under `apps/api/tests/unit`, the 4
  provider stubs → `*.test.ts(x)`; `performance/k6/scenarios/*.js` → `*.k6.js`;
  `performance.yml:224` → `${SCENARIO}.k6.js`; root `perf:api`; `run-performance-tests.sh`.
  Acceptance: `git ls-files '*.integration.test.*'` lists only node:test files under
  `apps/api/tests`; `vitest list --filesOnly` per package identical before and after (832). CODE ~10.
  PR R1.
- **WU-1.2** Reserve the suffixes inside each collector: `packages/vitest-shared/src/index.ts:132-156`
  exports `RESERVED_TIER_EXCLUDES` and the factory sets `test.exclude: [...configDefaults.exclude,
...RESERVED_TIER_EXCLUDES]` (`mergeConfig` concatenates arrays); `apps/api/vitest.config.ts:44`,
  `apps/workers:59`, `apps/admin:51-57`, `apps/client:55` spread it; admin and client gain an explicit
  `include: ["**/*.test.{ts,tsx}"]` (today they use the default, which also matches `*.spec.*`); both
  Playwright configs get `testMatch: "**/*.spec.ts"`; convention table into
  `CODING_STANDARDS.md §Test Framework Rules`. Red: plant
  `apps/api/tests/unit/x.integration.test.ts` with a vitest test → `vitest list` does NOT list it →
  restore. CODE ~40. PR R2.
- **WU-1.3** Remove double collection and subset entrypoints: delete `eval.yml` (`tests/eval/**` is
  already in api's include and runs in the shards); delete the `custom-security-tests` job
  (`security-testing.yml:78-282`, header :3-21) — `tests/{auth,security}.test.ts` run in
  `integration:flows` and `{mfa,rbac}` in `remaining` as the app role with rate limiting, STRICTER
  than that job's owner; the 2 of `test:ratelimit` are under `tests/unit`; delete the 26 node:test
  subset scripts of `apps/api/package.json` (lines 21-25 and 27-47 when this was planned), `test:eval` and
  `test:ratelimit`.
  Acceptance: the subset-script grep returns 0; the "files with >1 collector" metric goes 10 → 0.
  CODE ~250 (deletions). PR R3. _(Absorbs WU-4.8.)_ Landed 2026-10-09: the workflow, the job, 22 of
  the 26 node:test scripts, `test:eval` and `test:ratelimit` left, and the metric went 10 → 0.
  Closed 2026-10-10 (PR R3b, the owner's option A, CODE 1486: 1485 deleted lines and the `knip.json` entry): the last four subset
  scripts, `test:{auth,rbac,security,mfa}`, left with their two callers, `security-scan.sh` and
  `vulnerability-report.ts` under `security/scripts` (its renderer and types module too), and the
  two `apps/api` scripts that ran them, so the node:test subset grep (`--test` in
  `apps/api/package.json`) returns 0. `docs/security/SECURITY_TESTING_FRAMEWORK.md` §"Where each
  check runs" maps every check the scripts ran to its CI gate. The removed job's per-suite
  guards (zero passed, any skipped or cancelled case) live on in `run-tests.sh` per batch under `TIER`;
  a single file collecting zero tests inside a batch that runs others is caught only by the per-file
  verdicts of WU-1.7, which owns that residual.
- **WU-1.4** Move the timing needs into the tests: the four `TIMEOUT=` prefixes of `run-tests.sh`
  (:245, :336, :398, :401) left, and each suite they served declares one `TIMING = { timeout }` and
  passes it to every test and hook: `hardDeleteSerializableRace`, `sagaCrashRecovery`,
  `sagaCompensationRecovery`, `sagaPublishNowPromotion` (120_000), `sagaCustomerFlow` (180_000),
  `publish`/`analytics`/`media`/`schedule.flow` (60_000), 83 tests and 26 hooks. Not on the top
  `describe`, as first planned: on Node 24.15.0 the runner's `--test-timeout` binds every test and
  every hook, and a `describe` option does not raise that limit; it caps the suite's total instead,
  a limit nothing has today. In `tests/security.test.ts` an `after()` in "Advanced Rate Limiting"
  sleeps until the full bucket the limiter announces in `X-RateLimit-Reset` (epoch milliseconds;
  `Retry-After`, whole seconds to a single permit, is the fallback), then polls `${BASE_URL}/health`
  until 200, deadline that instant plus 5 s (cap 90 s), and throws naming its last answer; it adds
  about 60 s to the batch. Measured, the limiter is a token bucket keyed by client IP and the
  request's resource path (120 per 60 s on `/health`), so a poll that gets 200 spends the permit it
  finds: polling while the bucket refills hands the next caller an empty one. Acceptance, met
  2026-10-09: the full-integration tier ran 939 tests before and after, every batch with the same
  count, 0 skipped, 0 cancelled. Reds as run: (a) a planted `sleep(45_000)` passes with `TIMING`
  under `--test-timeout=30000`, and is cancelled with `testTimeoutFailure` without it and with the
  option on the `describe` only; (b) a planted probe asserting the next `/health` caller gets 200
  fails with 429 without the `after()` and passes with it; (c) the poll pointed at a path that never
  answers 200 fails the hook with its message. The planned red, "`production` right after
  `integration:flows` fails with 429 without the `after()`", does not hold: measured, it passes 81
  of 81 with no 429 either way, because the bucket refills about 2 permits a second while the next
  files start; WU-1.8's red (a) rests on the same premise. CODE ~35 planned, 314 measured (one
  argument per call, and the 19 long-named tests that prettier then breaks out). PR R4.
- **WU-1.5** Rename the node:test population by MEASURED tier: run each of the 98 files (under
  `apps/api/tests` outside unit/eval, the 2 under `tests/chaos` included; the earlier 100 double-counted
  chaos or counted the two tracked non-test files `.disabled` and `.old`) alone, with Postgres and Redis up and
  API and workers down — passes with 0 skips → `.integration.test.ts`; otherwise → `.live.test.ts`;
  also record which pass with services down (hermetic; they feed the ledger and the experiment).
  The measurement is the U5a section above (2026-10-08): 80 → `.integration.test.ts`, 18 →
  `.live.test.ts`, 8 of the 80 hermetic; U5 renames by that table.
  Starting point: `run-tests.sh` puts 52 on the database and 26 in live; a grep heuristic puts 10 of
  the 20 dark ones in live — the measurement decides. `git mv` of the 98; paths in `run-tests.sh`
  (:221-445), constants in `sagaContextInvariants.static.test.ts:1638-1641`,
  `sagaLiveSuitePrecondition.static.test.ts:21`, the RLS table in `CLAUDE.md:1737`, about 28 documents
  (link check); re-key `apps/api/tests-typecheck-baseline.json` with `typecheck-tests-ratchet.mjs
--write` (the "new key" rule of #289 would flag every rename). Acceptance: Integration Tests green
  with the same per-batch counts; the typecheck ledger diff is a pure rename (same `TScode` multiset
  per path); the old #30 stays at 20. CODE ~110. PR R5.
- **WU-1.6** `run-tests.sh` becomes the integration collector only: delete :18-23 (the `.env`
  sourcing, which could send integration at the dev database, DEF-67); delete :159-207 (the vitest
  phase); `run_vitest_phase` :48-51; the vitest cases of `runTestsGate.static.test.ts:289-333`;
  the `test:all` script of `apps/api/package.json` = `pnpm test && pnpm test:integration`. As built
  (2026-10-09): an empty or unset `DATABASE_URL` exits 2 before anything starts, with `TIER` set
  or unset (no caller legitimately runs the suites on a guessed database), and stderr names the
  variable and the remedy that exists: export the root `.env.test`
  (`set -a; . ./.env.test; set +a`), created from `.env.test.example` or written by
  `scripts/ci-setup-test-env.sh` from an exported `DATABASE_URL` and `REDIS_URL`; the
  `scripts/test-env.sh run` this bullet first named does not exist. The runner suites pin it.
  Five static cases check that the refusal precedes the first banner and `run_batch`, nests in no
  branch, and exits 2 on stderr naming the variable and `.env.test`; that no environment file is
  read; and that nothing starts vitest. Two behaviour cases run the script, once with `TIER` set
  and `DATABASE_URL` empty and once with both unset, and assert exit 2, an empty stdout, and that
  no `node`, `npx` or `curl` process starts. Red: empty
  `DATABASE_URL` plus `TIER=full-integration` → exit 2 without running anything. CODE ~110
  planned, 157 measured (the two behaviour cases and their recorders). PR R6.
- **WU-1.7** Collect the services tier by convention: `collect <suffix>` (a `find` over `tests`
  excluding `tests/unit`, `LC_ALL=C sort`, reversible with `TEST_ORDER=reverse`); quarantine
  `packages/test-contracts/quarantine.json` (`{ "entries": [{ path, reason, owner, since }] }`, read
  with `jq`; each
  entry printed `QUARANTINED (not run): <path> — <reason>`); `run_file` = `run_batch` (:63-157) per
  file, keeping EXACTLY `[ "$tests" -eq 0 ]` and `[ "$TOTAL_TESTS" -eq 0 ]` (#31 B intact) and every
  guard; `--list` prints `integration\t<path>` / `live\t<path>` / `quarantined\t<path>`; delete the
  DB batch section (:214-341); `runTestsGate.behavior.test.ts` (the `node` stub receives one file per
  call; "batches printed failed" → "units"); **interim #30**: `fitness.yml:754-757` and
  `CLAUDE.md:713-716` move from `grep -qF "$path" run-tests.sh` to membership in
  `run-tests.sh --list | cut -f2` (the baseline falls from 20 to the dark-live count plus quarantine);
  seed `quarantine.json` with every dark DB suite that fails in CI as the app role, with its reason.
  Acceptance: CI green; tests ≥ baseline plus the dark DB suites; 0 skips; job ≤ 15 min
  (`ci.yml:315`); per-file overhead ≤ 60 s over the base run. Red (complete step, byte-exact
  restore): (a) an empty `tests/integration/empty.integration.test.ts` → exit 1 for zero tests;
  (b) a `before` that throws → exit 1 for a cancel; (c) `t.skip()` → exit 1 under TIER; (d) interim
  #30: `tests/integration/orphan.test.ts` with no suffix → above baseline → exit 1. CODE ~290. PR R7.
  R7a (2026-10-10) landed the per-file verdict, reds (a)–(c) proven end to end. R7b1 (2026-10-10)
  landed `--list` and the quarantine over the hand-written lists; the collection by convention, the
  interim #30 and `TEST_ORDER=reverse` follow in the next stacked pull requests. R7b2 (2026-10-10)
  moved the runner suites off the batch layout: failures are accounted by file, and the saga reach
  check reads `run-tests.sh --list`. R7b3 (2026-10-10) landed the collection, red (d) proven on the
  COMPLETE `#30` step. Measured outcome: the collection runs 62 files; the 18 `*.integration.test.ts`
  suites the live-API batches name stay in those batches until WU-1.8, read from the runner's text
  and left out of the collection so no file runs twice. The quarantine seed is empty: the 10 dark DB
  suites pass as the CI app role, 3 of 3 runs each with the API and workers up (the three
  `bulkSchedule*` suites 10 of 10), so none entered it. The interim #30 baseline is 10, the dark live
  suites plus 0 quarantine entries: U5a's 18 is the whole live tier, and the live batches run 8 of
  those. `TIER=pr-integration` ran 572 tests in 62 files in 83 s (the base runner 541 in 52 files,
  73 s, the same day), 0 skipped or cancelled. R7b4 (2026-10-10) landed `TEST_ORDER=reverse` (572
  tests in 62 files in 81 s reversed) and the stale-comment alignment, and closed WU-1.7: R7b counts
  386 + 247 + 383 + 131 = 1147 CODE, the workflow YAML of its two patches included.
  **Owner decision (d), 2026-10-09 — the interim #30 is accepted, with its exit written down.**
  _Where it lives:_ the `#30` step of `fitness.yml` and the `# 30.` block of CLAUDE.md §Automated
  Compliance Checks, both rewritten by this unit, plus this paragraph. Its count is the files that
  `run-tests.sh --list` collects and that do not run green yet — the dark-live files (18 measured by
  U5a on 2026-10-08) plus every `quarantine.json` entry, each with its reason and owner — and it is a
  ratchet: it may fall and must never rise. The `# 30.` block states that it is interim and names
  WU-1.10 as its retirement. _When it is retired:_ by WU-1.10 (PR R10), which lands after WU-1.9
  (the reach engine, PRs R9a/R9b) and WU-1.8 (the live collector, PR R8); no later. _How:_ WU-1.10
  adds the `test-contracts` job, whose `#30` step derives reach from the collectors themselves —
  every test file has exactly one collector and the unreached files outside the quarantine are 0, a
  hard zero — and deletes the interim step, its baseline and the interim wording of the `# 30.` block
  in the same PR; its five reds (`:1266-1270`) prove the new gate before the old one leaves.
  _Retired 2026-10-14_ by PR R10, as written: the interim step, its baseline of 3 and the interim
  wording of the `# 30.` block left in the pull request that added the `test-contracts` job, whose
  five reds are in the [§Gates](#gates) row; the interim gate's row stays in that table as history.
  U7b, which edits `fitness.yml` under its own token, also aligns two protected comments with the
  paths WU-1.5 renamed, because the rename unit held no token: the `#40` step comment at
  `fitness.yml:1455`, still naming `tenantGucTransactionBinding.test.ts` (now
  `tenantGucTransactionBinding.integration.test.ts`, the name `CLAUDE.md:1475` already carries), and
  the comment at `.env.test.example:28`, still naming `tests/cache.test.ts` (now
  `tests/cache.integration.test.ts`). It also rewrites two protected comments WU-1.6 left
  describing a fallback that no longer exists, because that unit held no token either:
  `ci.yml:537-538` and `chaos.yml:121-122` give their explicit DB/Redis env "so run-tests.sh never
  falls back to sourcing the repo .env", while since WU-1.6 the runner reads no env file and exits 2
  when `DATABASE_URL` is empty, so the env block is what lets the step run at all.
- **WU-1.8** Collect the live tier by convention: loop over `collect live`; `probe_live` before each
  file (`curl -fsS "$TEST_API_URL/health"` and `"$TEST_WORKERS_READY_URL"` — workers ready only with
  the publish consumer registered, `ci.yml:498-504`); on failure it records
  `env-unready-before: <file> (last ran: <previous>)` and stops the tier; delete :343-455
  (`assert_publish_consumers`, `wait_for_api`); path filters `bash run-tests.sh <path>...` (replacing
  the deleted scripts); rewrite `sagaLiveSuitePrecondition.static.test.ts` ("the runner verifies
  readiness before each live file") and `sagaContextInvariants.static.test.ts:1617-1651` (it asserts
  that the saga suites carry a tier suffix; reach belongs to #30); quarantine the dark live suites
  that fail: `trendRadarRoutes` (F-9, `dayKey`) and `universal-client-dashboard` (to be deleted).
  Acceptance: CI green including the dark live suites that pass; 0 skips; ≤ 15 min;
  `TEST_ORDER=reverse` green once, evidence in the pull request. Red: (a) remove WU-1.4's `after()` →
  the probe fails before the next live file naming `security.live.test.ts` → exit 1; (b) kill the
  workers mid-run → exit 1 naming the file. Dep: WU-1.7, WU-4b.3. CODE ~200. PR R8. Measured in
  WU-1.4 (2026-10-09): red (a) holds only for a probe that runs right after the security file. A
  `/health` call right after the block gets 429 without the `after()`, while `production`, run after
  the rest of `integration:flows`, passes 81/81 without it, because the bucket refills at about two
  permits a second in between.
  R8a (2026-10-10) landed the readiness probe before each file of the existing live-API batches, the
  URL refusal and the two job-level URLs of `ci.yml` (owner decision (a)), and deleted
  `assert_publish_consumers` and `wait_for_api`.
  R8b (2026-10-10) landed the collection by suffix, deleted the hand-written live-API batches,
  seeded the quarantine with `trendRadarRoutes`, `universal-client-dashboard` and
  `aiLocalizedRoutes` (DEF-81, found by the live run: 2 of its 6 cases fail, cause not measured),
  and took the interim #30 to 3, the three entries; the other seven dark live suites run in the live
  tier, 34 tests, all passing on 2026-10-10.
  R8c (2026-10-10) moved the saga suites' contract from reach to naming: each carries its tier
  suffix.
  R8d (2026-10-10) landed the path filters and closed WU-1.8: R8a–R8d count 390 + 394 + 48 + 127 =
  959 CODE, the workflow YAML of their patches included, because the runner alone loses 235 lines of
  hand-written batches, between-batch checks and the reader of its own text. Residual, named: the
  live suites read their API address from `BASE_URL` (default `http://localhost:3000`,
  `tests/testUtils.ts:14`) while the probe reads `TEST_API_URL`; CI sets the same address for both,
  and the environment contract (E3, WU-4b.3) is where they become one variable.
- **WU-1.9** `packages/test-contracts`: the reach engine with self-tests (not yet wired).
  `package.json` (private; `vitest`, `yaml`, `typescript` from the catalog), `vitest.config.ts` from
  the factory, `src/reach.ts`, `src/lib/{disk,vitest-collector,node-collector,playwright-collector,
registry}.ts`, `collectors.json`, `quarantine.json`, `tests/*.test.ts` with fixture trees. Engine:
  (1) disk = `git ls-files` filtered to test-shaped (fail-closed under 800); (2) vitest = for each
  tracked `vitest.config.*` (fail-closed under 80) `createVitest("test", { root, config, watch:
false })` plus `globTestSpecifications()`, falling back to `vitest list --filesOnly --json`, at
  least 1 per config; (3) node = `run-tests.sh --list`, at least 1; (4) playwright =
  `playwright test --list --reporter=json -c <cfg>`; (5) k6 = glob `*.k6.js`; (6) registry
  `collectors.json` maps collector → `executedBy: [{workflow, jobId, entrypoint, packages|exclude}]`;
  (7) rules: R1 each collected file exactly once or quarantined; R2 the `executedBy` job exists,
  contains the entrypoint in a `run`, and its rendered name is a required context in
  `.github/rulesets/main.json`; R3 quarantine: every entry exists, none is collected, head ⊆ base.
  Acceptance: self-tests green in Package Tests; against the real tree it prints the unreached set as
  the quarantine seed. Red: each rule is a self-test that plants its violation in a fixture and
  asserts a non-zero exit naming it (continuous red), plus one manual run over the real tree.
  CODE ~380 (engine ~230, tests ~150). PR R9.
- **WU-1.10** Wire the new #30 and retire the grep ratchet: job `test-contracts` "Test Contracts" in
  `fitness.yml` (checkout `fetch-depth: 0`, the shared node/pnpm cache action, `DATABASE_URL` = the
  canonical hermetic URL for Prisma's postinstall), step
  `"#30 Every test file has exactly one collector run by a required check"` with `if: always()` →
  `pnpm --filter @packages/test-contracts reach`; delete the old step (:733-768);
  `CLAUDE.md:699-716` rewritten as a script-backed check (description, invocation, limits); `:304`
  and `fitness.yml:9-11` stop saying baseline; a new `.github/rulesets/main.json` (mirroring the 19
  contexts, `strict: false`) as the source for R2 before WU-3.11 changes it; seed the full
  quarantine: 9 Playwright specs (no job yet), 7 `security/tests`, `postgres-stress.test.ts`, 2 admin
  fetch scripts, `_template/.../sandbox.template.test.ts`, `.disabled`, `.old`, 6 `*.k6.js`, the 2
  dark failures — each with a reason and an owning work unit; `CLAUDE.md §Extending the suite` step 2
  allows script-backed checks (the workflow and `CLAUDE.md` call the same command; the script is the
  single source with self-tests). Acceptance: Test Contracts green in ≤ 6 min; "test-shaped
  unreached outside quarantine" = 0. Red (complete step): (1) `orphan.test.ts` → "unreached";
  (2) `../client/lib/**/*.test.ts` in admin's include → "collected twice"; (3) a collected file added
  to quarantine → exit 1; (4) delete a quarantined file without removing its entry → exit 1;
  (5) `collectors.json` pointing at a non-existent job → exit 1; restore (`sha256sum`). Dep: WU-1.9,
  WU-3.1. CODE ~90 plus docs. PR R10.
  R10 (2026-10-14) landed it, measured. The `test-contracts` job copies the install steps of
  `dependency-consistency`, the same file with the same pins (`actions/checkout@v7`,
  `pnpm/action-setup@v6`, `actions/setup-node@v7`), instead of the shared
  `setup-node-pnpm-cache` action, which pins older majors (`@v4` of all three). Its `DATABASE_URL` is
  the design's canonical hermetic URL, `postgresql://hermetic:hermetic@127.0.0.1:1/hermetic?schema=public`
  (`openspec/changes/testing-refoundation/design.md` §2c), the literal WU-4b.1's `test-env.sh env hermetic` writes and WU-4b.7's identity gate
  then holds every workflow to; measured, `prisma generate` connects to nothing and its config falls
  back to an empty URL without it. The step runs `reach --quarantine quarantine.json`: without the
  flag the engine reads an empty quarantine. The quarantine holds 29 entries, the three of R8b and the
  26 files the engine reported unreached over the real tree once the ruleset existed, each with its
  reason, owner and `since`: 9 Playwright specs (WU-6.E8), 7 `security/tests` suites (WU-6.S2), 6
  `*.k6.js` scenarios (WU-6.K1), `postgres-stress.test.ts` (WU-6.P2), and the 2 admin fetch scripts
  and the template sandbox test (WU-2.6a). The `.disabled` and `.old` files need no entry: the
  test-shaped name is anchored at the end, so neither is on the disk side. Each owner removes its
  entry in the pull request that ends the quarantine, because R3 fails on an entry whose file is gone
  or collected. `.github/rulesets/main.json` mirrors the 19 classic required contexts as read from
  GitHub on 2026-10-14T01:02Z (`strict: false`, every one `integration_id` 15368) and adds
  `Test Contracts` as a 20th, so the mirror lists 20 while the classic protection lists 19 until the
  owner adds `Test Contracts` there (DD-12). Not wired here, and wired by R11 (WU-1.11, below):
  `--base <file>`, R3's shrink-only clause, whose base quarantine the full-history checkout makes
  readable; on this pull request it would have refused the 26 new entries as absent from the base,
  and SB-116 closed with that wiring. Acceptance: test-shaped unreached outside the quarantine = 0
  (`reach: PASS`, 0 violations, 0 errors, about 3 s locally); the job's time is its first CI run on
  the pull request, held to 6 minutes by `timeout-minutes`. The five reds are in the
  [§Gates](#gates) row. It retires the interim
  #30 (owner decision (d)), moves M7 `31/31` → `32/32`, and closes WU-1.9, whose real-tree run
  waited for this ruleset. CODE 322, over the ~90 planned: the quarantine's 26 new entries are 156 of
  it (data the spec asks for), the ruleset 44 and `fitness.yml` 122 (the new job, the deleted step
  and the header).
  R10b (2026-10-14, `workstream/refound-1-metrics-m5`, stacked on R10) makes M5 derivable:
  `metrics.mjs --m5` runs the `#30` step's command with `--json` and reads the quarantine, and the
  script computes only the selected metrics, so `--m8` alone no longer runs the engine; the pin suite
  runs `--all` once, in `beforeAll`, under a 60 s budget. It moves M5 `23 · 0` → `29 · 0`. CODE 232:
  `metrics.mjs` 175 and its pin 57, split from R10 to keep each under the 400 budget.
- **WU-1.11** Script contract (reach part C) plus #31 A widened: `reach.ts` part C — every package
  with a vitest config has `scripts.test === "vitest run"` (Phase 5 extends it to `test:coverage`);
  `apps/client/package.json:11` `"vitest"` → `"vitest run"` (F-16); `ci.yml:773` →
  `pnpm --filter @apps/client test`; delete the watch justification at `ci.yml:705-710`; #31 A's
  scope becomes `git ls-files '*.json' '*.ts' '*.mts' '*.yml'` repository-wide (today only
  apps/packages/infra) in `CLAUDE.md:728-730` and in fitness. Red: (a) revert the script → part C
  exits 1; (b) `script -qc "pnpm --filter @apps/client test"` with a 60 s timeout: before it never
  ends, after it does; (c) a planted `--passWithNoTests` in a `ci.yml` step → #31 exits 1. CODE ~40.
  PR R11.
  R11 (2026-10-14, `workstream/refound-1-script-contract`) landed it, measured. Part C is rule C1,
  `packages/test-contracts/src/lib/script-contract.ts`, run by `reach.ts` beside R1 to R3: each
  directory that holds a tracked `vitest.config.*` (93, the vitest collector's own set and floor)
  has a tracked `package.json` whose `scripts.test` is exactly `vitest run`. A directory with no
  tracked manifest breaks C1, since no package script runs its config; a manifest that cannot be read
  or does not parse is an error. Over the tree C1 named one package, `apps/client` (`"vitest"` at
  `package.json:14`), now `vitest run`; Frontend Tests runs `pnpm --filter @apps/client test`, and the
  registry entrypoint moved with it, because R2 finds an entrypoint by substring and the old one
  would have matched no step. Package Tests keeps `--filter=!@apps/client`, its comment now saying
  only that Frontend Tests runs the client. #31 Part A is
  `git grep -nE 'pass[W]ithNoTests' -- '*.json' '*.ts' '*.mts' '*.yml'` over 3113 tracked files,
  held to a floor of 2500 and failing closed on a `git grep` exit above 1. The bracket class keeps
  the step's own text, itself a tracked `.yml`, from matching (the plain pattern matched it 3 times);
  `*.yaml`, `*.js`, `*.mjs` and `*.cjs` stay out, measured free of the flag, and the canon block says
  so. Found while proving it: GitHub runs a step under `bash -e`, so a first form,
  `A=$(git grep …)`, ended the step silently on `git grep`'s exit 1 (no match); every status is now
  captured with `||`. R10's deferred `--base` is wired: the `#30` step sets `FITNESS_BASE_REF` to the
  pull request's base sha or, on a push, `HEAD~1`, reads `packages/test-contracts/quarantine.json`
  at that commit with `git show` into `$RUNNER_TEMP/base-quarantine.json` (absolute, because
  `pnpm --filter` runs the engine in the package directory), stops with an `::error` of its own
  when the base ref names no commit (a parentless push has no `HEAD~1`) and another when the base
  holds no such file, and passes it as `--base`. The defect behind SB-116 is fixed with it: an
  unreadable base printed `error: quarantine <file> cannot be read` and a summary of
  `not run: no --base given`; it now prints `error: base quarantine <file> …` and
  `not run: base unreadable`. The JSON report's `baseChecked` became `shrinkCheck`, and it gained
  `packages`. Touching `reach.ts` and `rules.ts` brought them under fitness #47, where `main`,
  `parseQuarantine` and `evaluate` had no `@description`; all three have it now. Deferred, measured,
  then retired: the design's second clause of part C (no package config sets a key the factory owns,
  in either `mergeConfig` argument, DD-20) had nothing to hold, since none of the 93 configs calls
  `mergeConfig`; the owner retired it on 2026-10-14 and R17 replaced it with rule C2, which holds
  every config's resolved `exclude` to `RESERVED_TIER_EXCLUDES` (`design.md` §2a, the DD-20 note in
  `design-decisions.md`, `tasks-part-2.md` 1.2.2 and 1.17.2; the refusal of the coverage keys moves
  to WU-5.1). The reds are in the
  [§Gates](#gates) rows of `#30`, part C and #31 A. It moves M7 `32/32` → `34/34`; M1 stays
  `998 + 14`, the C1 and base cases extending `reach.test.ts`. CODE 450, over the ~40 planned:
  `reach.test.ts` 123 (the C1 and base cases), `script-contract.ts` 95, `reach.ts` 123 (the base
  status, the manifest reader, the header and the `@description` tags), `fitness.yml` 67, `rules.ts`
  31; 111 of the 375 added lines are comments and JSDoc.
- **WU-1.12** #36 over resolved configs, in all 86: `packages/test-contracts/src/scopes.ts` resolves
  each config and verifies that every positive glob of `test.include` matches at least one file
  (`coverage.include` enters in WU-5.1; Playwright projects need at least one test when the E2E
  reconstruction lands); the #36 step (fitness :972-1069) moves to Test Contracts;
  `CLAUDE.md:868-971` rewritten, keeping fail-closed (0 resolved configs, or one that does not
  resolve → exit 1). Red: (a) `@core/posts`'s include → `"testz/**/*.test.ts"` → exit 1; (b) break a
  config's syntax → exit 1. CODE ~120. PR R12.
  R12a and R12b (2026-10-14, `workstream/refound-1-scopes` and `workstream/refound-1-scopes-wire`)
  landed it, measured. `src/scopes.ts` is the command
  line and `src/lib/scopes.ts` the rule, S1: each tracked `vitest.config.*` (93, held to the vitest
  collector's floor of 80) is resolved with `createVitest` through `withVitest`, now exported from
  `src/lib/vitest-collector.ts` and shared with the collector's node listing, so the globs are the
  ones a run applies. Each project's `test.include` is read relative to its `dir` or root, and the
  root config's `coverage.include` relative to its root wherever a config sets one, which on this
  tree is `apps/api` alone: the guard the textual check gave it stays until WU-5.1 brings coverage to
  every package. A glob is a negation the way tinyglobby reads one, a leading `!` not followed by
  `(`, and is never checked; a positive glob is normalised as tinyglobby normalises it and matched
  with Node's `path.matchesGlob` against the tracked files below its directory, or against every
  tracked file when it names `..`. It fails closed below the floor, on a config that does not
  resolve (its error printed), on a scope with no positive glob and on a listing that fails. Over
  the tree it found one dead glob, `tests/**/*.test.tsx` at `packages/query-client/vitest.config.ts:14`
  (the package holds one `.ts` test and no `.tsx` one), deleted on the owner's decision; green is 93
  of 93 configs and 97 positive globs, in 2.2 s beside `reach`'s 3.2 s. The step moved from the
  Fitness Functions job to `test-contracts`; that job's setup-node comment, which named #36's
  fs.glob, now names #37, #41 and #44, and the references to "the #36 slicer" and "the #36
  quarantine rule" in #38, #39, #41 and #42 name their own referents. Not read, stated in the canon
  block: Playwright projects (the E2E reconstruction), and whether an `exclude` removes every file a
  glob names (#30's part). The duplicate-code gate found the run-when-invoked tail of `scopes.ts`
  a clone of `reach.ts`'s, so both now call `runIfInvoked` from a new `src/lib/cli.ts`, pinned by
  `tests/cli.test.ts`. It shipped as two stacked pull requests so the workflow file, which needs the
  owner's token, did not hold the code back: R12a the rule, its suites, the command and the
  query-client glob; R12b the step, the canon block and this tracker's state. The reds are in the
  [§Gates](#gates) row of #36. R12a moved M1 `999 + 14` → `1001 + 14` (`scopes.test.ts`,
  `cli.test.ts`) and R12b M7 `35/35` → `36/36`. CODE 870 + 149 = 1019, over the ~120 planned. R12a:
  `scopes.test.ts` 330, `lib/scopes.ts` 263, `scopes.ts` 109, `cli.test.ts` 60,
  `vitest-collector.ts` 51, `lib/cli.ts` 35, `reach.ts` 17, and 5 lines in `knip.json`, the package
  manifest and the query-client config; 185 of its 838 added lines are comments and JSDoc. R12b:
  `fitness.yml` 149, 113 of them the old step's deletion; 26 of its 36 added lines are comments.
- **WU-1.13** #32 over the syntax tree, in every test-shaped file:
  `packages/test-contracts/src/skips.ts` parses the disk set with the TypeScript compiler
  (`createSourceFile`, no typecheck) and flags: member access
  `.(skip|only|fixme|todo|skipIf|runIf)` (called or merely referenced) on
  `it|test|describe|suite|test.describe`; a `skip|only|todo` property in the options object (2nd
  argument); Playwright `test.skip(` / `test.fixme(` in any position. #32 (fitness :807-838) moves to
  Test Contracts; `CLAUDE.md:740-758` rewritten, removing the false claim "5 of 83 forbidOnly" and
  the `.todo` exemption. Precondition: demolition removes the 6 `test.skip(` in specs, the
  `describeIf` at `authContext.test.tsx:54`, `{ skip: USE_REAL_ADAPTERS }`
  (`providerRegistry.test.ts:386`) and the 43 `it.todo`. Red: plant (a) `test.fixme(` in a spec,
  (b) `const d = describe.skip;`, (c) `it("x", { skip: true }, …)`, (d) `{ skip: 2 }` inside a Prisma
  call — (a)–(c) exit 1, (d) green (proving it does not flag Prisma's `skip`). Dep: WU-1.10, Phase 2.
  CODE ~160. PR R13. _(Complements WU-2.4's ESLint rules: ESLint gives IDE feedback and a per-file
  ratchet on the vitest files; #32 is the gate over EVERY test-shaped file.)_
- **WU-1.14** Workflows only call registered entrypoints (reach part B): `reach.ts` part B reads the
  workflow files with `yaml`: (B1) no `vitest`, `node --test`, `playwright test` or `k6 run`
  invocation with a positional path except the forms registered in `collectors.json`
  (`vitest run --shard=`, `--mergeReports`); (B2) every `pnpm … <script>` / `turbo run <task>` that
  starts with `test` is one of `test`, `test:coverage`, `test:integration`, `test:e2e`. These must go
  first: `nightly.yml:95` (WU-3.12), `production-ci.yml:149` (WU-3.5),
  `dependency-updates.yml:193,270` (root `pnpm run test` → `turbo run test:coverage`, or removed);
  `eval.yml` and the custom security job, once on this list, left with PR R3 (WU-1.3). Red: plant
  `run: pnpm --filter @apps/api exec vitest run tests/unit/foo` → exit 1. Dep: WU-1.10, 3.5, 3.12.
  CODE ~110. PR R14.
- **WU-1.15** Retire the quarantine: delete `quarantine.json` and its handling in `run-tests.sh` and
  `reach.ts`; #30 says hard-zero. Acceptance: quarantine empty on base. Red: plant an unreached file
  → exit 1 with no quarantine path. Dep: Phases 2, 4, 6 empty it. CODE ~−60. PR R15.
- **WU-1.2b** vitest ignores `--conditions development` (it honours only `import`/`default`); the
  factory resolves through aliases derived from `tsconfig.base.json`, but **18 workspace packages have
  no alias** (`@packages/{i18n,api-common,query-client,ui,vitest-shared}`,
  `@adapters/{storage-cloudinary,storage-azure,storage-gcs,storage-do-spaces,crm-hubspot,
crm-salesforce}`, `@observability/{background-scheduler,browser-logger}`, `@providers/_template`,
  the 4 apps) → a bare import under vitest resolves through `exports` to `dist` (the class of #27, in
  the runner #27 does not cover). Measure which vitest-collected tests import those bare names; set
  `ssr.resolve.conditions: ["development", …]` in the factory (verifying the spelling on vitest
  4.1.11) and add an assertion in `packages/test-contracts`: every workspace package imported by a
  test resolves to `src/`. Red: delete an alias or the condition → the test resolves to a
  non-existent `dist` and fails naming the package. CODE ~80. PR R2b.
  As built (2026-10-10), measured on vitest 4.1.11: the premise held only under
  `NODE_ENV=production`. vitest's default `ssr` conditions carry `development|production`, which is
  `development` in any other mode, and the `ssr` environment ignores top-level `resolve.conditions`,
  so the factory's old `["node"]` never reached a node test. 19 packages have no alias, not 18
  (`@adapters/storage-do-spaces` gained one; `@packages/eslint-plugin-testing` and
  `@packages/test-contracts` were not counted), and 41 collected test files import 5 of them, all in
  `apps/api`, `apps/workers` and `apps/client`. Under `NODE_ENV=production` 32 imports fell to `dist`:
  18 in `apps/api` (`@observability/background-scheduler` 17, `@packages/api-common` 1) and 14 in
  `apps/workers`, whose own alias map lacks the 11 `@providers/*` and `@adapters/db-prisma`.
  `SOURCE_CONDITIONS` (`development`, `node`) now sits on `resolve.conditions` and
  `ssr.resolve.conditions` in the factory and in both app configs (R2b1, CODE 63). The gate,
  `packages/test-contracts/src/lib/source-resolution.ts`, resolves each direct workspace import of
  each collected test through its config and vite environment, under `NODE_ENV=test` and
  `production`, and requires `<package>/src/`: its import reader landed in R2b2 (CODE 149) and the
  check, its command line and the real-tree cases in R2b3 (CODE 385). `@packages/i18n` resolves to
  `dist` in every mode, and no collected test imports it. Residual: direct imports only, not the
  import graph. CODE 597 measured over the three pull requests.
- **WU-1.16** Node declares its reporter output unstable; the collector migrates from parsing TAP to
  a custom reporter over the documented `TestsStream` events, keeping EXACTLY the four guards
  (fail/cancel/skip/zero) and updating #31 B's pins in the same pull request; the red re-demonstrated
  for each guard. After R7/R8. CODE ~120. PR R16. _(This bullet named `--test-reporter=json` until
  R16: no Node release ships a JSON reporter — Node 24.15.0 has `dot`, `junit`, `spec`, `tap` and
  `lcov` — and design decision DD-7 of the openspec change settled the custom reporter over the
  programmatic `run()` API.)_
  As built (2026-10-14, Node 24.15.0): `scripts/testing/node-summary-reporter.mjs` prints every
  failure with its detail and one anchored line,
  `@@SUMMARY tests=N pass=N fail=N cancelled=N skipped=N todo=N`, which is all `run_file` reads,
  matched whole; a file whose run prints none fails (`no @@SUMMARY line`), where the TAP parser
  read a missing summary as zeros. The counts come from the cumulative `test:summary` event, the
  one without a `file` (Node emits one per file before it), cross-checked against a tally
  classified as Node's own file runner counts: suites apart, a skip or todo directive first, then
  the three failure types Node counts as cancelled (`cancelledByParent`, `testTimeoutFailure`,
  `testAborted`; DD-7 named only the first, and a timeout would then have printed a mismatch on
  every run). A mismatch prints both and takes the larger fail, cancelled, skipped and todo counts
  and the smaller tests and pass counts. Node's stand-in pass for a file that registers no test
  (named by the file's path, at its line 1, column 1) is left out of both, so the zero-collection
  guard sees an emptied suite without the `ok 1 - <file>` grep. The reporter relays
  what suites print behind `# `, so no printed line can pass for the summary, and the failure
  section of a red prints every line without that mark. #31 B pins the reporter's assignment and
  forbids `--test-reporter=tap`. CODE 739 + 259 measured over the two pull requests, additions plus
  deletions over the code, test and workflow files: R16a lands the reporter (370 lines, 155 of them
  comments), its suite (368) and the knip entry, which land together as the behaviour and its proof;
  R16b lands the collector switch (82), its two suites (150) and the #31 B pins (27). 263 of the 929
  added lines are comments.

### U5a — measured tier of the node:test population (2026-10-08)

Data section: the measurement WU-1.5 renames by. It adds no file and no gate, so it moves no metric.

**Method.** Measured on 2026-10-08T18:00Z on `main` `4c76d66a`. Population: the 98 `*.test.ts` files
under `apps/api/tests` outside `tests/unit` and `tests/eval` (the 2 `tests/chaos` files are among
them). Each file ran alone, the way `run-tests.sh` runs one (`node --conditions development --import
tsx --test --test-force-exit` with the batch's concurrency and timeout, `.env.test` sourced,
`NODE_ENV=test`, `TIER=full-integration`), with Postgres 15.19 and Redis 7 up on localhost and the
API (:3000) and workers (:3300) down. Two channels, with identical status for all 98 files: **owner**
(`DATABASE_URL` = the owner) and **app-role** (`DATABASE_URL` = `omnipost_app`, `MIGRATE_DATABASE_URL` =
the owner, the split `.env.test` and CI already use). A third, **hermetic** probe ran each file under
`unshare -n` (loopback only) with every database and Redis URL on a closed port. The owner pass ran
three times; the four `*.flow` files ran 8 more. Redis was the native localhost one, not the one
`.env.test` names (see DEF-63).

**Tier rule as applied.** `integration` when the owner pass has 0 fail, 0 cancelled, 0 skipped and exit
0; `live` otherwise. A file that also passes with services down is noted as hermetic (it feeds the
ledger and the experiment; it does not change the tier).

**Result.** integration 80, live 18, hermetic 8 (the 2 `chaos` files, `integration/publishing/failedWrite.smoke`,
`planPublication`, `schemaUtils` and the three `threading.*`). The 18 `live` files all stop on the API: 11
through a `before` hook that throws "API not reachable at http://localhost:3000" (every test
cancelled), 7 through `t.skip("API not available")`. None of the 80 `integration` files references
the live API, so none passes by silently skipping work. The "100" in WU-1.5 was wrong: the population is
98; the 100 double-counts `tests/chaos` or counts the two tracked non-test files
`tests/analytics-ml-integration.test.ts.disabled` and `tests/threading.flow.test.ts.old`.

**Runner batch vs measured tier (38 disagreements).** 18 files sit in `run-tests.sh` batches that the
runner treats as live-API and measured `integration` (the hermetic ones among them); 20 files are in no
batch at all.

- Runner batch `remaining` (10):
  - `tests/accountLifecycle.test.ts` → integration
  - `tests/adapters.test.ts` → integration
  - `tests/mfa.test.ts` → integration
  - `tests/planPublication.test.ts` → integration (hermetic)
  - `tests/rbac.test.ts` → integration
  - `tests/schemaUtils.test.ts` → integration (hermetic)
  - `tests/threading.canonical.test.ts` → integration (hermetic)
  - `tests/threading.planner.test.ts` → integration (hermetic)
  - `tests/threading.xprovider.test.ts` → integration (hermetic)
  - `tests/trialPeriod.test.ts` → integration
- Runner batch `flow` (4):
  - `tests/analytics.flow.test.ts` → integration
  - `tests/media.flow.test.ts` → integration
  - `tests/publish.flow.test.ts` → integration
  - `tests/schedule.flow.test.ts` → integration
- Runner batch `integration:flows` (4):
  - `tests/audit.test.ts` → integration
  - `tests/auth.test.ts` → integration
  - `tests/cache.test.ts` → integration
  - `tests/integration/publishing/failedWrite.smoke.test.ts` → integration (hermetic)
- Runner batch `(none)` (20):
  - `tests/integration/aiLocalizedRoutes.test.ts` → live
  - `tests/integration/analyticsPremiumRoutes.test.ts` → live
  - `tests/integration/analyticsStreamRoutes.test.ts` → live
  - `tests/integration/auditActorPolymorphism.integration.test.ts` → integration
  - `tests/integration/bulkScheduleMediaPath.integration.test.ts` → integration
  - `tests/integration/bulkScheduleReconciliation.integration.test.ts` → integration
  - `tests/integration/bulkScheduleRelayRetry.integration.test.ts` → integration
  - `tests/integration/customerLoginMfa.integration.test.ts` → integration
  - `tests/integration/customerLoginMfaE2e.integration.test.ts` → live
  - `tests/integration/data-retention.integration.test.ts` → integration
  - `tests/integration/inboxRoutes.test.ts` → live
  - `tests/integration/mentionIngest.test.ts` → integration
  - `tests/integration/mfaCustomer.integration.test.ts` → live
  - `tests/integration/mfaTotpSingleUse.integration.test.ts` → integration
  - `tests/integration/redisTokenBucketRateLimiter.test.ts` → integration
  - `tests/integration/repurposeRoutes.test.ts` → live
  - `tests/integration/sendReplyGuardrail.integration.test.ts` → live
  - `tests/integration/shareOfVoice.test.ts` → integration
  - `tests/integration/trendRadarRoutes.test.ts` → live
  - `tests/universal-client-dashboard.integration.test.ts` → live

**Flaky and nondeterministic.**

- `tests/publish.flow.test.ts` passed 7 of 10 clean owner runs and `tests/schedule.flow.test.ts` 9 of 10. A failing run ends in `uncaughtException: Unable to deserialize cloned data due to invalid or
unsupported version`, raised by the node:test runner itself on Node v24.15.0 after tests had
  passed. Independent of services; cause not established (DEF-64). By the rule both stay `integration`.
- `tests/providerRegistry.test.ts` collects 24 to 36 tests per run (5 or 10 suites), all skipped
  (DEF-65).
- `tests/cache.test.ts` timed out at 120 s only in the hermetic pass.
- The 4 `syncEngine.*` files (`integration`) skip themselves when the services are down instead of
  failing (6 to 11 skips each in the hermetic pass).

**Per-file table** (98 rows; `FAIL f<n> c<n>` = failed and cancelled test counts; hermetic is the
status under `unshare -n`; seconds = wall time of the owner pass, node start included).

| file                                                               | owner      | app-role   | hermetic    | measured tier       | seconds | note                                                              |
| ------------------------------------------------------------------ | ---------- | ---------- | ----------- | ------------------- | ------- | ----------------------------------------------------------------- |
| ---                                                                | ---        | ---        | ---         | ---                 | ---     |                                                                   |
| accountLifecycle.test.ts                                           | pass 15/15 | pass 15/15 | FAIL c15    | integration         | 1.4     |                                                                   |
| adapters.test.ts                                                   | pass 14/14 | pass 14/14 | FAIL f7     | integration         | 1.2     |                                                                   |
| analytics.flow.test.ts                                             | pass 12/12 | pass 12/12 | FAIL f7     | integration         | 1.2     |                                                                   |
| audit.test.ts                                                      | pass 7/7   | pass 7/7   | FAIL f7     | integration         | 1.3     |                                                                   |
| auth.test.ts                                                       | pass 15/15 | pass 15/15 | FAIL f7 c8  | integration         | 2.1     |                                                                   |
| cache.test.ts                                                      | pass 27/27 | pass 27/27 | TIMEOUT     | integration         | 8.1     | hermetic pass timed out at 120 s; FLUSHDB per test                |
| chaos/saga-step-retry-recovery.test.ts                             | pass 1/1   | pass 1/1   | pass 1/1    | integration         | 1.2     | passes with services down                                         |
| chaos/sagaWaitAmplification.test.ts                                | pass 2/2   | pass 2/2   | pass 2/2    | integration         | 1.3     | passes with services down                                         |
| integration/adminPasswordResetClaim.integration.test.ts            | pass 11/11 | pass 11/11 | FAIL c11    | integration         | 2.1     |                                                                   |
| integration/adminRefreshRotationClaim.integration.test.ts          | pass 5/5   | pass 5/5   | FAIL c5     | integration         | 1.6     |                                                                   |
| integration/aiLocalizedRoutes.test.ts                              | FAIL c6    | FAIL c6    | FAIL c6     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/analyticsPremiumRoutes.test.ts                         | FAIL c8    | FAIL c8    | FAIL c8     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/analyticsStreamRoutes.test.ts                          | FAIL c3    | FAIL c3    | FAIL c3     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/auditActorPolymorphism.integration.test.ts             | pass 6/6   | pass 6/6   | FAIL c6     | integration         | 1.1     |                                                                   |
| integration/backfillAdminMfaBackupCodes.integration.test.ts        | pass 7/7   | pass 7/7   | FAIL c7     | integration         | 0.4     |                                                                   |
| integration/bulkScheduleMediaPath.integration.test.ts              | pass 1/1   | pass 1/1   | FAIL c1     | integration         | 1.1     |                                                                   |
| integration/bulkScheduleOutboxSmoke.test.ts                        | pass 3/3   | pass 3/3   | FAIL c3     | integration         | 1.1     |                                                                   |
| integration/bulkScheduleReconciliation.integration.test.ts         | pass 2/2   | pass 2/2   | FAIL f2     | integration         | 1.1     |                                                                   |
| integration/bulkScheduleRelayRetry.integration.test.ts             | pass 1/1   | pass 1/1   | FAIL c1     | integration         | 1.1     |                                                                   |
| integration/bulkScheduling.test.ts                                 | pass 3/3   | pass 3/3   | FAIL c3     | integration         | 1.1     |                                                                   |
| integration/campaignTenantIsolation.test.ts                        | pass 13/13 | pass 13/13 | FAIL c13    | integration         | 1.2     |                                                                   |
| integration/channelTenantIsolation.test.ts                         | pass 19/19 | pass 19/19 | FAIL c19    | integration         | 1.4     |                                                                   |
| integration/compositionRootTenantBinding.test.ts                   | pass 2/2   | pass 2/2   | FAIL c2     | integration         | 1.0     |                                                                   |
| integration/consumers/workerConnection.integration.test.ts         | pass 3/3   | pass 3/3   | FAIL c2     | integration         | 0.9     |                                                                   |
| integration/crisisRoutes.test.ts                                   | skip 10/10 | skip 10/10 | skip 10/10  | live                | 0.9     | t.skip: API not available                                         |
| integration/customerLoginMfa.integration.test.ts                   | pass 3/3   | pass 3/3   | FAIL f3     | integration         | 2.1     |                                                                   |
| integration/customerLoginMfaE2e.integration.test.ts                | FAIL c3    | FAIL c3    | FAIL c3     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/customerPasswordReset.integration.test.ts              | pass 13/13 | pass 13/13 | FAIL c13    | integration         | 2.8     |                                                                   |
| integration/data-retention.integration.test.ts                     | pass 2/2   | pass 2/2   | FAIL c2     | integration         | 1.0     |                                                                   |
| integration/deletionRecordDegradation.test.ts                      | pass 5/5   | pass 5/5   | FAIL f5     | integration         | 0.4     |                                                                   |
| integration/deletionRecordRetentionFloor.test.ts                   | pass 5/5   | pass 5/5   | FAIL f5     | integration         | 0.4     |                                                                   |
| integration/externalNotificationTenantIsolation.test.ts            | pass 10/10 | pass 10/10 | FAIL c10    | integration         | 1.3     |                                                                   |
| integration/generatedImageTenantIsolation.test.ts                  | pass 8/8   | pass 8/8   | FAIL c8     | integration         | 1.3     |                                                                   |
| integration/hardDeleteSerializableRace.test.ts                     | pass 2/2   | pass 2/2   | FAIL f2     | integration         | 1.4     |                                                                   |
| integration/inboxRoutes.test.ts                                    | FAIL c5    | FAIL c5    | FAIL c5     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/linkRoutes.test.ts                                     | skip 12/12 | skip 12/12 | skip 12/12  | live                | 0.9     | t.skip: API not available                                         |
| integration/mentionIngest.test.ts                                  | pass 4/4   | pass 4/4   | FAIL c4     | integration         | 0.4     |                                                                   |
| integration/mfaBackupCodeSingleUse.integration.test.ts             | pass 4/4   | pass 4/4   | FAIL c4     | integration         | 2.0     |                                                                   |
| integration/mfaCustomer.integration.test.ts                        | FAIL c8    | FAIL c8    | FAIL c8     | live                | 1.0     | before hook: API not reachable at :3000                           |
| integration/mfaTotpSingleUse.integration.test.ts                   | pass 4/4   | pass 4/4   | FAIL c4     | integration         | 1.1     |                                                                   |
| integration/outbox/OutboxRelay.integration.test.ts                 | pass 1/1   | pass 1/1   | FAIL c1     | integration         | 0.4     |                                                                   |
| integration/post-trio-tenant-isolation.test.ts                     | pass 32/32 | pass 32/32 | FAIL f1 c31 | integration         | 3.7     |                                                                   |
| integration/postDeleteOwnership.test.ts                            | pass 4/4   | pass 4/4   | FAIL c4     | integration         | 3.6     |                                                                   |
| integration/postHardDeleteCascade.test.ts                          | pass 3/3   | pass 3/3   | FAIL f3     | integration         | 0.4     |                                                                   |
| integration/postReadOwnership.test.ts                              | pass 6/6   | pass 6/6   | FAIL c6     | integration         | 3.6     |                                                                   |
| integration/preAuthBillingTenantIsolation.test.ts                  | pass 1/1   | pass 1/1   | FAIL f1     | integration         | 0.5     |                                                                   |
| integration/preAuthInboundWebhookTenantIsolation.test.ts           | pass 1/1   | pass 1/1   | FAIL f1     | integration         | 1.1     |                                                                   |
| integration/preAuthIntegrationTenantIsolation.test.ts              | pass 3/3   | pass 3/3   | FAIL c3     | integration         | 1.2     |                                                                   |
| integration/preAuthSsoTenantIsolation.test.ts                      | pass 12/12 | pass 12/12 | FAIL c12    | integration         | 1.1     |                                                                   |
| integration/projectMemberTenantIsolation.test.ts                   | pass 7/7   | pass 7/7   | FAIL c7     | integration         | 1.1     |                                                                   |
| integration/publishWorkerTenantIsolation.test.ts                   | pass 9/9   | pass 9/9   | FAIL c9     | integration         | 1.2     |                                                                   |
| integration/publishing/failedWrite.smoke.test.ts                   | pass 2/2   | pass 2/2   | pass 2/2    | integration         | 5.0     | passes with services down                                         |
| integration/recurringPostTenantIsolation.test.ts                   | pass 14/14 | pass 14/14 | FAIL c14    | integration         | 1.3     |                                                                   |
| integration/redisTokenBucketRateLimiter.test.ts                    | pass 4/4   | pass 4/4   | FAIL f4     | integration         | 0.2     |                                                                   |
| integration/repositories/AccountQueryRepository.test.ts            | pass 24/24 | pass 24/24 | FAIL c23    | integration         | 1.1     |                                                                   |
| integration/repositories/AnalyticsRepository.basic.test.ts         | pass 17/17 | pass 17/17 | FAIL c16    | integration         | 0.5     |                                                                   |
| integration/repositories/AnalyticsRepository.channel.test.ts       | pass 10/10 | pass 10/10 | FAIL c10    | integration         | 0.5     |                                                                   |
| integration/repositories/AnalyticsRepository.timeseries.test.ts    | pass 14/14 | pass 14/14 | FAIL c14    | integration         | 0.5     |                                                                   |
| integration/repositories/ConversionRepository.test.ts              | pass 6/6   | pass 6/6   | FAIL c6     | integration         | 1.1     |                                                                   |
| integration/repositories/PrismaPostRepository.test.ts              | pass 22/22 | pass 22/22 | FAIL c17    | integration         | 1.2     |                                                                   |
| integration/repositories/ProjectRepository.test.ts                 | pass 21/21 | pass 21/21 | FAIL c20    | integration         | 0.6     |                                                                   |
| integration/repositories/UserRepository.test.ts                    | pass 39/39 | pass 39/39 | FAIL c38    | integration         | 1.2     |                                                                   |
| integration/repositories/sagaAccountIdBackfill.integration.test.ts | pass 10/10 | pass 10/10 | FAIL f9     | integration         | 0.4     |                                                                   |
| integration/repurposeRoutes.test.ts                                | FAIL c5    | FAIL c5    | FAIL c5     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/rls-tenant-isolation.test.ts                           | pass 31/31 | pass 31/31 | FAIL c31    | integration         | 0.5     |                                                                   |
| integration/sagaCompensationRecovery.test.ts                       | pass 2/2   | pass 2/2   | FAIL c2     | integration         | 1.8     |                                                                   |
| integration/sagaCrashRecovery.test.ts                              | pass 17/17 | pass 17/17 | FAIL c17    | integration         | 4.9     |                                                                   |
| integration/sagaCustomerFlow.test.ts                               | FAIL c14   | FAIL c14   | FAIL c14    | live                | 1.4     | before hook: API not reachable at :3000                           |
| integration/sagaPublishNowPromotion.test.ts                        | pass 14/14 | pass 14/14 | FAIL c14    | integration         | 2.1     |                                                                   |
| integration/sagaTenantIsolation.test.ts                            | pass 20/20 | pass 20/20 | FAIL c20    | integration         | 1.6     |                                                                   |
| integration/scheduledReportTenantIsolation.test.ts                 | pass 11/11 | pass 11/11 | FAIL c11    | integration         | 1.3     |                                                                   |
| integration/security-endpoints.test.ts                             | skip 11/11 | skip 11/11 | skip 11/11  | live                | 0.9     | t.skip: API not available                                         |
| integration/sendReplyGuardrail.integration.test.ts                 | FAIL c2    | FAIL c2    | FAIL c2     | live                | 1.0     | before hook: API not reachable at :3000                           |
| integration/shareOfVoice.test.ts                                   | pass 4/4   | pass 4/4   | FAIL c4     | integration         | 0.4     |                                                                   |
| integration/syncEngine/syncEngine.conflicts.test.ts                | pass 6/6   | pass 6/6   | skip 6/6    | integration         | 1.4     | self-skips without services                                       |
| integration/syncEngine/syncEngine.init.test.ts                     | pass 10/10 | pass 10/10 | skip 10/10  | integration         | 1.4     | self-skips without services                                       |
| integration/syncEngine/syncEngine.monitoring.test.ts               | pass 11/11 | pass 11/11 | skip 11/11  | integration         | 1.4     | self-skips without services                                       |
| integration/syncEngine/syncEngine.sync.test.ts                     | pass 9/9   | pass 9/9   | skip 9/9    | integration         | 1.4     | self-skips without services                                       |
| integration/tenant-composite-fk.test.ts                            | pass 18/18 | pass 18/18 | FAIL c18    | integration         | 0.4     |                                                                   |
| integration/tenantGucTransactionBinding.test.ts                    | pass 7/7   | pass 7/7   | FAIL c6     | integration         | 1.3     |                                                                   |
| integration/trackedLinkTenantIsolation.test.ts                     | pass 13/13 | pass 13/13 | FAIL c13    | integration         | 1.4     |                                                                   |
| integration/trendRadarRoutes.test.ts                               | FAIL c5    | FAIL c5    | FAIL c5     | live                | 0.9     | before hook: API not reachable at :3000                           |
| media.flow.test.ts                                                 | pass 7/7   | pass 7/7   | FAIL f5     | integration         | 1.2     |                                                                   |
| mfa.test.ts                                                        | pass 21/21 | pass 21/21 | FAIL f18 c3 | integration         | 7.4     |                                                                   |
| multiproject.flow.test.ts                                          | skip 20/20 | skip 20/20 | skip 20/20  | live                | 1.0     | t.skip: API not available                                         |
| planPublication.test.ts                                            | pass 12/12 | pass 12/12 | pass 12/12  | integration         | 1.0     | passes with services down                                         |
| production.integration.test.ts                                     | skip 25/25 | skip 25/25 | skip 25/25  | live                | 1.0     | t.skip: API not available; Workers metrics not available          |
| providerRegistry.test.ts                                           | skip 36/36 | skip 33/33 | skip 24/24  | live                | 1.0     | 24-36 tests per run, all skipped                                  |
| publish.flow.test.ts                                               | pass 5/5   | pass 5/5   | FAIL f5     | integration (flaky) | 1.2     | flaky 7/10 owner runs clean; runner "Unable to deserialize" crash |
| rbac.test.ts                                                       | pass 23/23 | pass 23/23 | FAIL f8 c12 | integration         | 1.7     |                                                                   |
| schedule.flow.test.ts                                              | pass 10/10 | pass 10/10 | FAIL f7     | integration (flaky) | 1.2     | flaky 9/10 owner runs clean; runner "Unable to deserialize" crash |
| schemaUtils.test.ts                                                | pass 22/22 | pass 22/22 | pass 22/22  | integration         | 0.2     | passes with services down                                         |
| security.test.ts                                                   | FAIL c18   | FAIL c18   | FAIL c18    | live                | 1.0     | before hook: no API answering at :3000                            |
| threading.canonical.test.ts                                        | pass 10/10 | pass 10/10 | pass 10/10  | integration         | 1.1     | passes with services down                                         |
| threading.planner.test.ts                                          | pass 15/15 | pass 15/15 | pass 15/15  | integration         | 0.8     | passes with services down                                         |
| threading.xprovider.test.ts                                        | pass 26/26 | pass 26/26 | pass 26/26  | integration         | 1.0     | passes with services down                                         |
| trialPeriod.test.ts                                                | pass 9/9   | pass 9/9   | FAIL c9     | integration         | 1.3     |                                                                   |
| universal-client-dashboard.integration.test.ts                     | skip 9/9   | skip 9/9   | skip 9/9    | live                | 1.0     | t.skip: API not available; Client not available                   |

### Phase 2 — Demolition

**2.A Instruments**

- **WU-2.0** Scenario `decorative-demolition` in `CLAUDE.md §Pragmatic Exceptions` (marker
  `// canon-exception: decorative-demolition:<ledger-slice>`) plus an ADR (first free number: 0025;
  0024 is reserved by N-COR-8) and #37's scenario matcher if it hardcodes them. Red: lower a floor
  without the marker → #37 exits non-zero → restore; with the marker → green. Dep: the coverage
  decision, and a `sensitive-edit` token. CODE ~40. PR `refound/2-coverage-exception`.
- **WU-2.1** The assertion classifier as a **workspace package with tests**
  `packages/eslint-plugin-testing/` (`src/assertions.js`, `src/blocks.js`, ESM `// @ts-check`,
  loadable by jiti and by node; tests with `RuleTester` plus fixtures). The package already exists:
  contract slice `0.20` creates it with `testing/no-unowned-handle-unref` ([D48](#decisions-log)),
  and this work unit extends it. It parses with
  `ts.createSourceFile` (syntactic). Blocks: `describe/it/test/suite`
  (plus `.each/.concurrent/.skip/.only/.todo/.skipIf/.runIf`), `t.test`, `{ skip: expr }`.
  Assertions: `expect(...)` chains (including `.not/.resolves/.rejects`), `assert.*`, `t.assert.*`,
  same-file helpers inlined one level, imported helpers matching `^(expect|assert|verify|check)`
  marked **opaque** → human review. Classes: TAUTOLOGY (literal against literal; `>= 0` over
  length/size/count) · EXISTENCE (`toBeDefined`, `not.toBeUndefined/Null`, `toBeTruthy`/`assert.ok`
  over an identifier, member or call, `toBeInstanceOf`, one-argument `toHaveProperty`,
  `typeof`/`Array.isArray`/`toBeTypeOf`, `toBeInTheDocument()` over `querySelector` or a tag) ·
  SNAPSHOT · BEHAVIOURAL. Flags: CONDITIONAL, GUARDED-RETURN. Block classes: EMPTY · TAUTOLOGY-ONLY ·
  EXISTENCE-ONLY · CONDITIONAL-ONLY · SELF-SKIP · PRINTS-SUCCESS (a `console.*` matching
  /pass|success|✅|🎉|operational|fully functional|all tests/i with no assertion after it) ·
  TITLE-CONTRADICTION (a title "returns undefined|null" with a positive existence matcher;
  "throws|rejects" without `toThrow`/`rejects`; an HTTP status in the title that no assertion names;
  "does not|never|should not" with only positive existence) · BEHAVIOURAL. Criterion map:
  (a) = EMPTY/EXISTENCE/TYPE · (c) = SELF-SKIP/todo ·
  (d) = TAUTOLOGY/CONDITIONAL-ONLY/PRINTS-SUCCESS. Acceptance: fixtures with a positive and a
  negative case per class in both frameworks (including `auditMiddleware.test.ts:274`,
  `webhookHandler.stats.test.ts:355`). CODE ~230, EVIDENCE ~250. PR `refound/2-classifier`.
- **WU-2.2** Ledger `scripts/testing/ledger.mjs` (plus `lib/*.mjs`): discovery by `git ls-files`
  (workspaces plus `security/` and `performance/`; suffixes `.disabled/.old/.bak`; runners
  `tests/run*.ts`; candidate helpers); reach through `collectorOf(path)` (`null` = orphan); classified
  blocks; SUBJECT-NOT-IMPORTED (b) (the stem resolves to a module the test never imports); duplicates
  by a multiset of normalised titles (EXACT-DUPLICATE; DUPLICATE-UNION when ≥ 5 titles are contained
  in the union of same-package siblings — the `trendAnalysisService` case), confirmed by an AST hash
  of the body; dead helper (0 importers resolving `.js`→`.ts`, index, subpaths); stale. Machine
  verdict: DELETE (all decorative, stale, dead helper, exact duplicate) · REWRITE (some decorative
  blocks, or self-skip / print-success alongside behavioural ones) · KEEP · ADJUDICATE (opaque or
  mixed signals). Human overlay
  `docs/development/testing-refoundation/adjudications.json` (path → verdict, criteria, blocks,
  evidence, status confirmed, reviewer, date); the status column shows machine versus confirmed.
  Outputs: `ledger.json` (deterministic, no timestamps) plus `LEDGER.md`. Modes: write · `--check`
  (exit 1 on drift) · `--area <glob>` (exact `file:line:title` list plus the expected drop).
  Acceptance: it reproduces Appendix C (105 files / 272 blocks as an upper bound, or an explained
  difference) and the whole-file list; under 60 s. CODE ~380 across 2.2a (scan + reach + JSON ~200)
  and 2.2b (duplicates, dead code, overlay, Markdown, `--area` ~180). PRs `refound/2-ledger-{a,b}`.
- **WU-2.3** Hard probe `scripts/testing/hard-probe.mjs`: one detached worktree (`git worktree add
--detach` plus `pnpm install --offline --frozen-lockfile`); subject = the test's first-party imports
  into `src/`; gutting with `ts.transform` (the body of every exported function or method →
  `throw new Error("__HARD_PROBE__")`, top level intact); runs only the block
  (`vitest run <file> -t "<title>" --reporter=json` / `--test-name-pattern`); GREEN = decorative (d) ·
  RED = restricts (weak signal) · LOAD-ERROR = inconclusive; restores (`git checkout -- .` plus an
  empty porcelain; the main tree is never touched). Output `probes.json` (`path::title` → hashes of
  the test and the subject, command, outcome, SHA). Sampling: every
  EXISTENCE-ONLY/CONDITIONAL-ONLY/TITLE-CONTRADICTION block in ADJUDICATE files plus a seeded random
  5 % of BEHAVIOURAL (false-negative rate). A class becomes a lint rule when ≥ 90 % of its probes are
  GREEN. CODE ~200. PR `refound/2-probe`.
- **WU-2.4** Durable form: ESLint rules plus bulk suppressions. `eslint.config.ts` (new blocks after
  the tests override ~:410-425), catalog `@vitest/eslint-plugin`, generated
  `eslint-suppressions.json`. Only files collected by vitest: `vitest/expect-expect` with
  `assertFunctionNames: ["expect","expect*","assert","assert.*","expectTypeOf"]`,
  `no-conditional-expect`, `valid-expect`, `no-standalone-expect`, `no-identical-title`,
  `no-commented-out-tests`, `no-disabled-tests: error`, `no-focused-tests: error`. Both frameworks
  (`@packages/eslint-plugin-testing`): `testing/no-empty-test`,
  `testing/no-tautological-assertion`, `testing/no-existence-only-test` (calibrated classes only);
  TITLE-CONTRADICTION stays in the ledger alone. Test globs: `no-console: error` (today `off`; the
  canon already says zero `console.log`). Current violations captured with `eslint --suppress-rule`.
  Bidirectional red: (1) plant an existence block in vitest and in node:test → lint exits 1 → restore
  (`cmp`); (2) delete a suppressed block without pruning → exit 2. A fitness pin verifies each rule
  stays at `error` (the #31 B shape). CODE ~120. PR `refound/2-lint-rules`.
- **WU-2.5** List before deleting: commit `ledger.json`, `LEDGER.md`, `probes.json` and
  `adjudications.json` seeded with every ADJUDICATE row. Edward approves the unambiguous DELETE set in
  one pass, and the ADJUDICATE rows slice by slice. M6 shows machine/confirmed/total. CODE 0.
  PR `refound/2-ledger-listing`.

**2.B Demolition slices** — each one: ledger `--check` green · `eslint --prune-suppressions` ·
tracker updated (files, tests, decorative blocks deleted, expected versus real drop) · the
`decorative-demolition` marker if an api floor drops · lint 0/0, `tsc`, `format:check` · the full
vitest run of the touched packages, or `run-tests.sh` for node:test.

- **WU-2.6a** Whole files (a)(b)(d): `apps/client/tests/components/ListeningCharts.test.tsx`
  (35 lines, −2 tests) · `apps/api/tests/unit/trendAnalysisService.test.ts` (731, −45; its
  `.test-helpers.ts` is kept, 4 importers) ·
  `apps/api/tests/universal-client-dashboard.live.test.ts` (336) ·
  `packages/providers/_template/tests/integration/sandbox.template.test.ts` (62; the
  fate of the `_template` package stays in SMELL-132) ·
  `apps/admin/tests/{apiClient.smoke,posts.flow}.test.ts` (59) plus removing their excludes in
  `apps/admin/vitest.config.ts:54-56`; the last four are `quarantine.json` entries since R10, and each
  entry leaves with its file, or #30's R3 fails on it. Acceptance: vitest −47 tests, M5 orphans −4
  (the four quarantined files). CODE ~6,
  EVIDENCE ~1,223. PR `refound/2-whole-files`.
- **WU-2.6b** The four `describe.todo` stubs (D3 — delete; the gap is already declared as roadmap
  §3.2.c and is counted in [§Declared gaps](#declared-gaps); afterwards every run can assert an
  absolute 0 todo and 0 skipped). Acceptance: todo 43 → 0, skipped files 4 → 0. EVIDENCE 116.
  PR `refound/2-todo-stubs`.
- **WU-2.7** Helpers, runners and dead files (0 importers re-verified): `apps/api/tests/setup/*`
  (755, imported only by each other), `coverage-utils.ts` (299), `tests/run.ts` (175),
  `run-with-coverage.ts` (440), `analytics-ml-integration.test.ts.disabled` (768),
  `threading.flow.test.ts.old` (316), `unit/helpers/InMemoryBruteForceAdapter.ts` (125),
  `PlatformContentAdapter.test-helpers.ts`, `auditService.test-helpers.ts`,
  `cqrsIntegration.test-helpers.ts`, `providers/instagram/tests/mediaProcessor.test-helpers.ts`.
  NOT here: `apps/api/scripts/seed-demo-data.ts`, `seed-large-dataset.ts` (CLI; 0 importers is normal
  → D17's product classification). CODE ~5, EVIDENCE ~3,000. PR `refound/2-dead-helpers`.
- **WU-2.8.x** Block deletion by `--area` (an emptied `describe` is removed; an emptied file is
  deleted whole; unused imports are caught by lint). 2.8.1a `rateLimitingDashboard.test.ts` (18) plus
  `logger.test.ts` (11) ~320 · 2.8.1b `auditMiddleware` (10, including :274) plus
  `webhookHandler.stats` (9, including the `>= 0` at :355/:379) plus `healthMetrics` (8 plus 9
  tautologies) ~350 · 2.8.2a/b the flat root of `apps/api/tests/unit` (196 files, alphabetical chunks
  ≤ 350; including `providerConstraintValidator`, 2 tautologies) · 2.8.3
  `{application,infrastructure,domain}` · 2.8.4 `{security,ai,webhooks,saga,auth,admin,…}` (including
  `enhancedValidator.mutations-request`, 4 tautologies) · 2.8.5 node:test
  (`syncEngine.monitoring` 5, `threading.canonical` 1, `security-endpoints` 1, the existence lines of
  `planPublication`; no batch may reach zero) · 2.8.6 packages (cloudinary 8 blocks, logger 1,
  fallback-strategies 1 tautology, the rest per ledger) · 2.8.7 client, admin, workers. Acceptance per
  slice: the real drop equals the `--area` prediction; the suppressions of the touched files are 0;
  every DELETE has a GREEN probe or Edward's confirmation. CODE 300–380 each, about 9 pull requests.
- **WU-2.9** `git mv settingsRoutes.test.ts settingsSchemas.test.ts` plus its header; "settings route
  contract untested" into [§Declared gaps](#declared-gaps) (owner: the Phase 9 queue). CODE ~6, inside
  2.8.4.
- **WU-2.10** Weak but not decorative (REWRITE): `@core/webhooks` (activate `rotateFails` and assert
  the failure), `@core/compliance` (assert values in the 2 happy paths), `@core/settings` (assert the
  exact masked shape). Acceptance: a RED probe on each. CODE ~60. PR `refound/2-rewrites`.
