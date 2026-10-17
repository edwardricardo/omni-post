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
