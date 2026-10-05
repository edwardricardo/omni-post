# Tasks: Testing Re-foundation (`testing-refoundation`) — part 3

> This checklist is split by size so each file stays under the reviewer context budget: [tasks.md](tasks.md) holds the forecast, the grammar, Phase 0 and Phase P; [tasks-part-2.md](tasks-part-2.md) holds Phase 1, Phase 2, Phase 3, Phase 4b, Phase S, Phase 4 and Phase X; this file holds Phase 5, Phase 6, Phase 6.N, Phase 7, Phase 8, Phase 9 and the slice index.

## Phase 5 — Coverage measured in all 86, with ratchet (design §7.10)

### 5.1 · `refound/5-coverage-defaults` (PR C1)

- [ ] 5.1.1 RED WU-5.1 · coverage-floor-ratchet › Coverage defaults live in the shared factory, and are inert without the flag · design §2e · CODE ~30 · slice `refound/5-coverage-defaults` — `pnpm --filter @core/posts exec vitest run --coverage` writes `coverage/coverage-summary.json`; a focused `vitest run <file>` **without** `--coverage` never trips a floor; pointing one `coverage.include` at `srcz/**` makes #36 exit 1.
- [ ] 5.1.2 GREEN WU-5.1 · coverage-floor-ratchet › Coverage defaults live in the shared factory, and are inert without the flag · CODE ~70 · slice `refound/5-coverage-defaults` — the factory's `test.coverage` defaults (`provider: "v8"`, `include: options.coverageInclude ?? ["src/**/*.{ts,tsx}"]`, `exclude: SHARED_COVERAGE_EXCLUDE`, `reporter: ["text-summary","json-summary"]`, `reportsDirectory: "./coverage"`, `reportOnFailure: true`), enabled only by `--coverage`; `coverage.include` joins #36's scope check; `turbo.json` `test:coverage` keeps `outputs: ["coverage/**"]` and gains the task-level `inputs` listing the by-path tooling files (`$TURBO_ROOT$/packages/vitest-shared/src/**`, the wire `server.ts` and `vitest-setup.ts`) — **never `globalDependencies`** (DD-6).
- [ ] 5.1.3 **Red proof** ×2 WU-5.1 · CODE ~0 · slice `refound/5-coverage-defaults` — the dead `coverage.include` glob → #36 exit 1; `turbo run test:coverage` twice → the second is not reported "cached" when a listed tooling input changed; restore.
- [ ] 5.1.4 Tracker: M8; Gates rows (turbo inputs, #36 extension) · CODE ~4 · slice `refound/5-coverage-defaults`.

### 5.2 · `refound/5-coverage-measure` (PR C2) — measure before fixing any floor

- [ ] 5.2.1 RED WU-5.2 · coverage-floor-ratchet › Every scope is measured BEFORE any floor is fixed · CODE ~15 · slice `refound/5-coverage-measure` — the "Every package produced a summary" step: a planted `coverage: { enabled: false }` in one config → `::error` + exit 1.
- [ ] 5.2.2 GREEN WU-5.2 · coverage-floor-ratchet › Every scope is measured BEFORE any floor is fixed · CODE ~40 · slice `refound/5-coverage-measure` — Package Tests and Frontend Tests run `turbo run test:coverage --continue` (the registered entrypoint); the summary-count step compares `**/coverage/coverage-summary.json` against the number of vitest packages; the table lands in the job summary and is uploaded.
- [ ] 5.2.3 **Measured** WU-5.2 · coverage-floor-ratchet › Every scope is measured BEFORE any floor is fixed · CODE ~0 · slice `refound/5-coverage-measure` — 86 rows × 4 metrics, CI and homelab, plus a drift column; the maximum local↔CI drift **decides** whether the ratchet is strict (≤ 0.1 pp, D14). EVIDENCE ~400.
- [ ] 5.2.4 Tracker: M8 (86 rows), the drift number and the strict-ratchet decision · CODE ~4 · slice `refound/5-coverage-measure`.

### 5.3–5.6 · `refound/5-floors-{core-a,core-b,packages,apps}` (PR C3–C6) — commit the measured floors

- [ ] 5.3.1 WU-5.3 · coverage-floor-ratchet › Floors are literal values per config, in a form the runner can rewrite · design §2e · CODE ~330 · slice `refound/5-floors-core-a` — the 26 `packages/core/*` configs take the `mergeConfig(defineWorkspaceVitestConfig(dir, overrides), defineConfig({ test: { coverage: { thresholds } } }))` shape with floors = `ratchetFloor(min(CI, local))` **from 5.2.3** and `autoUpdate: ratchetFloor`; each `package.json` gains `"test:coverage": "vitest run --coverage"` and loses `test:unit:coverage` and `test:unit`.
- [ ] 5.3.2 Acceptance + Tracker (M8) · CODE ~4 · slice `refound/5-floors-core-a` — in one package of the group, a test that raises coverage ≥ 0.2 pp makes vitest **rewrite** the literals (proving `autoUpdate` accepts the shape); deleting a test file makes `test:coverage` exit 1 on thresholds.
- [ ] 5.4.1 WU-5.4 · same requirement · CODE ~330 · slice `refound/5-floors-core-b` — the other 26 core packages plus the engine.
- [ ] 5.4.2 Acceptance + Tracker (M8) · CODE ~4 · slice `refound/5-floors-core-b`.
- [ ] 5.5.1 WU-5.5 · same requirement · CODE ~330 · slice `refound/5-floors-packages` — adapters, providers, observability, monitoring, api-*, i18n, query-client (~30 configs).
- [ ] 5.5.2 Acceptance + Tracker (M8) · CODE ~4 · slice `refound/5-floors-packages`.
- [ ] 5.6.1 WU-5.6 · same requirement · CODE ~330 · slice `refound/5-floors-apps` — `apps/admin`, `apps/client`, `apps/workers` (api already has its literals).
- [ ] 5.6.2 Acceptance + Tracker (M8) · CODE ~4 · slice `refound/5-floors-apps`.

### 5.7 · `refound/5-floor-ratchet` (PR C7) — #37 over every config, keyed by package name

- [ ] 5.7.1 RED WU-5.7 · coverage-floor-ratchet › The floor ratchet covers every config, keyed by package name, and fails closed · design §2i/DD-9 · CODE ~50 · slice `refound/5-floor-ratchet` — five REDs against `origin/main`: (1) lower one package's `lines` by 0.1 → exit 1; (2) delete a config's thresholds block → exit 1; (3) duplicate a metric at depth 1 → exit 1; (4) `git mv packages/core/posts posts2` **and** lower a floor → exit 1 (the floor follows the package name, not the path); (5) a valid `canon-exception: migration` line comment on the lowered line → exit 0 with the acceptance logged.
- [ ] 5.7.2 RED **threat matrix — git repository selection** WU-5.7 · coverage-floor-ratchet › The floor ratchet covers every config, keyed by package name, and fails closed · design §5 · CODE ~10 · slice `refound/5-floor-ratchet` — an unresolvable `FITNESS_BASE_REF` exits 1 after 3 bounded fetch attempts, naming the transient possibility.
- [ ] 5.7.3 GREEN WU-5.7 · coverage-floor-ratchet › The floor ratchet covers every config, keyed by package name, and fails closed · CODE ~180 · slice `refound/5-floor-ratchet` — `packages/test-contracts/src/floors.ts` (the `floorsOf` scanner moved out of `CLAUDE.md`), head map `packageName → config path` from the `package.json` files, base side via `git ls-tree` / `git show`; exactly one literal per metric at depth 1 of the global `thresholds:` block or fail closed; a package absent on base passes by metric; duplicate package names fail closed; the `canon-exception` scenario set includes `decorative-demolition`; the step moves to Test Contracts with `if: always() && github.event_name == 'pull_request'`.
- [ ] 5.7.4 **Red proof** ×6 WU-5.7 · CODE ~0 · slice `refound/5-floor-ratchet` — 5.7.1's five plus 5.7.2 through the complete step; restore.
- [ ] 5.7.5 Tracker: Gates row (#37 new form); M7, M14 · CODE ~4 · slice `refound/5-floor-ratchet`.

### 5.8 · `refound/5-floors-enforced` (PR C8)

- [ ] 5.8.1 GREEN WU-5.8 · coverage-floor-ratchet › A floor that could rise is committed in the same pull request · design §2i · CODE ~50 · slice `refound/5-floors-enforced` — generalise the risen-floor logic to `git diff --name-only -- '**/vitest.config.ts'` after every coverage job; **per 5.2.3's drift** it is red with "commit the new floors" and the exact diff (strict) or a warning; the api sharded flow is unchanged (`VITEST_SHARDED` neutralises per shard, Coverage Merge certifies).
- [ ] 5.8.2 **Red proof** ×2 WU-5.8 · CODE ~0 · slice `refound/5-floors-enforced` — a draft PR deleting a test → red in Package Tests; under strict, a draft PR that raises a floor by ≥ 0.2 pp without committing it → red with the diff; restore.
- [ ] 5.8.3 Tracker: M8; Gates row · CODE ~4 · slice `refound/5-floors-enforced`.

### 5.9 · `refound/5-denominator` (PR C9)

- [ ] 5.9.1 RED WU-5.9 · coverage-floor-ratchet › Every package is measured or listed with a reason, and the list only shrinks · design §2i · CODE ~40 · slice `refound/5-denominator` — three REDs: a package with `src/**/*.ts` and neither a config nor an entry → exit 1; adding an entry versus base → exit 1; marking `packages/ui` `types-only` → exit 1 (it has runtime).
- [ ] 5.9.2 GREEN WU-5.9 · coverage-floor-ratchet › Every package is measured or listed with a reason, and the list only shrinks · CODE ~130 · slice `refound/5-denominator` — `packages/test-contracts/src/denominator.ts` + `untested-packages.json` (`[{name, reason: "types-only"|"scaffold"|"pending-retirement:<ref>"|"pending-tests:<WU>", since}]`), `types-only` verified by `ts.transpileModule` emitting no runtime statement, the list only shrinking against base, seeded with the 11 measured packages.
- [ ] 5.9.3 **Red proof** ×3 WU-5.9 · CODE ~0 · slice `refound/5-denominator` — 5.9.1's three through the complete step; restore.
- [ ] 5.9.4 Tracker: M8 denominator; Declared gaps rows · CODE ~4 · slice `refound/5-denominator`.

### 5.10 · `refound/5-canon-floors` (PR C10 + WU-8.1b)

- [ ] 5.10.1 WU-5.10 + WU-8.1b · coverage-floor-ratchet › The canon states measured floors as the gate and layer targets as direction · design §DD-15 · CODE ~150 · slice `refound/5-canon-floors` — rewrite `docs/development/CODING_STANDARDS.md` §Coverage Targets: the per-package floors are measured values ratcheted by #37 (the gate), and the layer numbers are direction tracked in the tracker as distance to target, not a gate; "Running Tests" points at `scripts/test-env.sh`; write `docs/technical/ADR-0026-measured-coverage-floors-and-framework-boundaries.md`.
- [ ] 5.10.2 Tracker: Decisions log (ADR-0026); M8, M16 target columns · CODE ~4 · slice `refound/5-canon-floors`.

---

## Phase 6 — Re-found what was decorative (design §7.11)

### 6M.1 · `refound/6-msw-core` (WU-6.M1 + WU-6.M2)

- [ ] 6M.1.1 RED WU-6.M2 · msw-single-http-double › Network isolation is the default, and an unhandled request is an error · design §2f/DD-6 · CODE ~30 · slice `refound/6-msw-core` — plant `await fetch("https://example.com")` in any vitest test → it fails naming the request (`onUnhandledRequest: "error"`); and a node:test file using `useMswServer()` gets the same isolation.
- [ ] 6M.1.2 GREEN WU-6.M1 · msw-single-http-double › The lifecycle lives in setup, not in each file, and both frameworks are served · design §2f · CODE ~120 · slice `refound/6-msw-core` — `packages/test-utils/wire/src/server.ts` (the ONE `setupServer()` instance, importing only `msw/node`), `vitest-setup.ts` (importing only `msw/node` and `./server`: `beforeAll(listen({onUnhandledRequest:"error"}))`, `afterEach(resetHandlers)`, `afterAll(close)`), `useMswServer(handlers)` for node:test with its own test, `createTestServer(handlers?)` for node:test and the sidecar only, and re-exports of `http`, `HttpResponse`, `delay`; move `packages/providers/shared/src/test-utils/msw-helpers.ts` here and delete its subpath and the optional `msw` peer.
- [ ] 6M.1.3 GREEN WU-6.M2 · msw-single-http-double › Network isolation is the default, and an unhandled request is an error · design §DD-6 · CODE ~90 · slice `refound/6-msw-core` — the factory registers the wire setup file **by path** (`<root>/packages/test-utils/wire/src/vitest-setup.ts`) and asserts it exists — no manifest edge from the config factory into `@shared/types`'s graph; the 6 per-file `setupServer` calls become `server.use(...)`; the one `bypass` becomes `error` plus a handler.
- [ ] 6M.1.4 **Red proof** WU-6.M2 · CODE ~0 · slice `refound/6-msw-core` — 6M.1.1 through the complete command; restore.
- [ ] 6M.1.5 **Measured** WU-6.M2 · msw-single-http-double › Network isolation is the default, and an unhandled request is an error · design §9 risk 6 · CODE ~0 · slice `refound/6-msw-core` — measure the per-fork cost of importing `msw/node` everywhere, and confirm the task-level turbo `inputs` (task 5.1.2) make a wire-setup edit invalidate `test:coverage`.
- [ ] 6M.1.6 Tracker: M13 (fetch stubs) Baseline; Gates row (network isolation) · CODE ~4 · slice `refound/6-msw-core`.

### 6M.2 · `refound/6-msw-gate` (WU-6.M3 + WU-6.M4)

- [ ] 6M.2.1 GREEN WU-6.M3 · msw-single-http-double › The application handlers are typed by the published contract · CODE ~150 · slice `refound/6-msw-gate` — move the client's five handler modules to `packages/test-utils/wire/src/handlers/api/*`, typed with `@shared/types` so contract drift breaks `tsc`.
- [ ] 6M.2.2 RED WU-6.M4 · msw-single-http-double › A hand-written HTTP stub is a lint error, and the baseline reaches zero · CODE ~15 · slice `refound/6-msw-gate` — plant `vi.stubGlobal("fetch", vi.fn())` → lint exit 1; also `globalThis.fetch = …` and `vi.spyOn(globalThis, "fetch")`.
- [ ] 6M.2.3 GREEN WU-6.M4 · msw-single-http-double › A hand-written HTTP stub is a lint error, and the baseline reaches zero · CODE ~40 · slice `refound/6-msw-gate` — the three `no-restricted-syntax` selectors on test globs with suppressions as the measured baseline (30 AST + 11 + 3) and a fitness pin that the rule stays at `error`.
- [ ] 6M.2.4 **Red proof** WU-6.M4 · CODE ~0 · slice `refound/6-msw-gate` — 6M.2.2 through the complete step; restore.
- [ ] 6M.2.5 Tracker: M13 Baseline pinned; Gates row · CODE ~4 · slice `refound/6-msw-gate`.

### 6M.3–6M.9 · the MSW migrations (WU-6.M5–M8), each pruning its own suppressions

- [ ] 6M.3.1 WU-6.M5 · msw-single-http-double › A hand-written HTTP stub is a lint error, and the baseline reaches zero · CODE ~300 · slice `refound/6-msw-client-1` — `apps/client` batch 1 of 2 (13 files total); prune.
- [ ] 6M.4.1 WU-6.M5 · same requirement · CODE ~300 · slice `refound/6-msw-client-2` — `apps/client` batch 2; prune.
- [ ] 6M.5.1 WU-6.M6 · same requirement · CODE ~300 · slice `refound/6-msw-admin` — `apps/admin` (8 files); prune.
- [ ] 6M.6.1 WU-6.M7 · same requirement · CODE ~350 · slice `refound/6-msw-api` — `apps/api`: the five named suites; consolidate the duplicated `FetchHttpClient` pair using `delay("infinite")` and `HttpResponse.error()`; move the AI wire server to `handlers/ai/*`; delete the `USE_REAL_ADAPTERS` branch of the provider-registry test; prune.
- [ ] 6M.7.1 WU-6.M8 · msw-single-http-double › Every provider has handlers for its public write endpoints, and its write methods are tested through them · CODE ~350 · slice `refound/6-msw-providers-1` — family 1 of 4: handlers under `packages/test-utils/wire/src/handlers/providers/<p>.ts` plus an MSW test per write method; DoD per provider: a handler per public write endpoint, a test per write method, 0 stubs. Adapter tests that use a fake apiClient stay — that is their boundary.
- [ ] 6M.7.2 WU-6.M8 · same requirement · CODE ~350 · slice `refound/6-msw-providers-2` — family 2 of 4.
- [ ] 6M.7.3 WU-6.M8 · same requirement · CODE ~350 · slice `refound/6-msw-providers-3` — family 3 of 4.
- [ ] 6M.7.4 WU-6.M8 · same requirement · CODE ~350 · slice `refound/6-msw-providers-4` — family 4 of 4, including `crm-hubspot` and `crm-salesforce`; telegram is repointed at the shared handlers (they are the sidecar's source too).
- [ ] 6M.8.1 WU-6.M9 · msw-single-http-double › A hand-written HTTP stub is a lint error, and the baseline reaches zero · CODE ~20 · slice `refound/6-msw-close` — the rule's suppressions are empty and it goes hard-zero at `error`.
- [ ] 6M.8.2 Tracker: M13 first column reaches 0 (one tracker row per migration slice above) · CODE ~4 · slices `refound/6-msw-*`.

### 6E.1 · `refound/6-e2e-demolish` (WU-6.E1)

- [ ] 6E.1.1 WU-6.E1 · e2e-acceptance-path › The fiction is demolished before anything is rebuilt · CODE ~60 · slice `refound/6-e2e-demolish` — delete `apps/client/tests/e2e/pages/*` (5 page objects over 207 non-existent `data-testid`s), `utils/{assertions,helpers}.ts` (**keep `utils/a11y.ts`**, imported by `a11y.spec.ts`), `fixtures/test-data.ts`, the two fake-JWT auth fixtures, `config/test-setup.ts`, the four fiction specs and the 6 visual snapshots, and the test-seed HTTP-route code in `global-setup.ts`; drop the `accessibility`, `visual-regression`, `performance`, `firefox`, `webkit`, `mobile-safari` and `tablet` projects and the three dead scripts. EVIDENCE ~2,000.
- [ ] 6E.1.2 Acceptance WU-6.E1 · e2e-acceptance-path › The fiction is demolished before anything is rebuilt · CODE ~0 · slice `refound/6-e2e-demolish` — the client E2E suite is exactly `a11y.spec.ts` on chromium, 1 green test; the quarantine shrinks accordingly.
- [ ] 6E.1.3 Tracker: M1, M4, M10 · CODE ~4 · slice `refound/6-e2e-demolish`.

### 6E.2 · `refound/6-seed-e2e` (WU-6.E2)

- [ ] 6E.2.1 RED WU-6.E2 · e2e-acceptance-path › Seeding is idempotent, through the owner connection, and never a route in the production binary · design §2g · CODE ~40 · slice `refound/6-seed-e2e` — running `seed:e2e` without `MIGRATE_DATABASE_URL` exits ≠ 0 naming the key; running it twice leaves the same row set (idempotent upserts).
- [ ] 6E.2.2 GREEN WU-6.E2 · e2e-acceptance-path › Seeding is idempotent, through the owner connection, and never a route in the production binary · CODE ~150 · slice `refound/6-seed-e2e` — `infra/prisma/seed-e2e.ts` over the owner connection: `e2e-customer@omnipost.test` (+ account + project), one Telegram channel whose credentials are encrypted by `ChannelCredentialsCrypto` under the test `PLATFORM_ENCRYPTION_KEY`, `e2e-admin@omnipost.test` with its role, `e2e-admin-lockout@omnipost.test`, N perf users; passwords from the `E2E_*_PASSWORD` / `PERF_USER_PASSWORD` keys the env script derives; the `seed:e2e` script runs from `test-env.sh db` after seed.
- [ ] 6E.2.3 Tracker: M10; Gates row (owner-connection refusal) · CODE ~4 · slice `refound/6-seed-e2e`.

### 6E.3 · `refound/6-provider-seam` (WU-6.E3a + WU-6.E3b)

- [ ] 6E.3.1 RED WU-6.E3a · e2e-acceptance-path › The provider base-URL seam is injected and REFUSED under a production environment · design §2g · CODE ~50 · slice `refound/6-provider-seam` — in **both** apps: `buildEnv({ ...validTestEnv, NODE_ENV: "production", TELEGRAM_API_BASE_URL: "http://127.0.0.1:3410" })` throws with the issue path `["TELEGRAM_API_BASE_URL"]` and a "refused in production" message; the same input without the override constructs; deleting the `superRefine` makes both tests fail.
- [ ] 6E.3.2 GREEN WU-6.E3a · e2e-acceptance-path › The provider base-URL seam is injected and REFUSED under a production environment · CODE ~60 · slice `refound/6-provider-seam` — `packages/providers/telegram/src/apiClient.ts`'s module constant becomes `constructor(credentials, options: { baseUrl?: string } = {})` defaulting to `https://api.telegram.org`; `createTelegramAdapter` threads `apiBaseUrl`; the three composition roots pass it from their env; both env modules gain `TELEGRAM_API_BASE_URL: z.string().url().optional()` and an exported `buildEnv(runtimeEnv)` factory; **`apps/workers/src/config/env.ts` gains a `createFinalSchema` it does not have today**; fitness #19 still holds (no `process.env` in an `*Adapter.ts`).
- [ ] 6E.3.3 RED WU-6.E3b · e2e-acceptance-path › The fake-provider sidecar replays the recorded contract, and the call is asserted · design §2g · CODE ~40 · slice `refound/6-provider-seam` — the contract test: for every shared Telegram handler, `getResponse` in-process and an HTTP round trip through the sidecar yield identical status and body; the sidecar's calls route records method/path/body; its reset route empties it; an unmatched request returns 501 naming method+path.
- [ ] 6E.3.4 GREEN WU-6.E3b · e2e-acceptance-path › The fake-provider sidecar replays the recorded contract, and the call is asserted · CODE ~90 · slice `refound/6-provider-seam` — `packages/test-utils/wire/src/fakeProviderServer.ts` (`startFakeProviderServer({ port, handlers })` over `node:http`, answering with msw's public `getResponse` from the **same** shared handlers) and the CLI entry `scripts/testing/fake-provider.mjs` that `test-env.sh up|serve sidecar` starts.
- [ ] 6E.3.5 Tracker: Gates rows (production refusal, sidecar contract); Decisions log (D13, the one production change) · CODE ~4 · slice `refound/6-provider-seam`.

### 6E.4 · `refound/6-e2e-config` (WU-6.E4) — the client Playwright configuration (DD-18)

- [ ] 6E.4.1 GREEN WU-6.E4 · e2e-acceptance-path › The browser configuration cannot pass by retrying, and cannot skip · design §2g · CODE ~120 · slice `refound/6-e2e-config` — projects `setup` (UI login → `test-results/.auth/<role>.json`, already gitignored) and `chromium` (`dependencies: ["setup"]`, `storageState`); `testMatch: "**/*.spec.ts"`; `retries: isCI ? 1 : 0` **with** `failOnFlakyTests: true`; `forbidOnly: isCI`; trace `retain-on-failure`; reporters html, junit, list, github; `locale: "en-US"` plus a `t(key)` helper over `apps/client/messages/en.json` for accessible names; the `webServer` array from task 4b.3.1.
- [ ] 6E.4.2 **Red proof** WU-6.E4 · e2e-acceptance-path › The browser configuration cannot pass by retrying, and cannot skip · CODE ~0 · slice `refound/6-e2e-config` — a spec that passes only on the retry is reported as a failure (`failOnFlakyTests`); a committed `test.skip(` is caught by #32 (task 3.4.2) → restore.
- [ ] 6E.4.3 Tracker: M10; Gates row · CODE ~4 · slice `refound/6-e2e-config`.

### 6E.5 · `refound/6-e2e-specs-a` (WU-6.E5a) and 6E.6 · `refound/6-e2e-specs-b` (WU-6.E5b)

- [ ] 6E.5.1 RED WU-6.E5a · e2e-acceptance-path › Selectors are role- and label-based, never a mass-instrumented attribute · CODE ~150 · slice `refound/6-e2e-specs-a` — `auth.spec.ts` (valid login → dashboard heading; wrong password → a localized `role=alert`; logout clears the session) and `posts.spec.ts` (draft through the editor via `textbox` and the channel selector, "Save draft" → the list shows Draft) — written red-first against the real UI, selectors by role and label only.
- [ ] 6E.5.2 Tracker: M10 · CODE ~4 · slice `refound/6-e2e-specs-a`.
- [ ] 6E.6.1 RED WU-6.E5b · e2e-acceptance-path › The first green specs prove both directions over the real journeys · CODE ~110 · slice `refound/6-e2e-specs-b` — `publish-now.spec.ts`: a seeded draft → "Publish now" → the UI shows Published **and** the sidecar's recorded-calls route holds exactly one `sendMessage` with the body; `a11y.spec.ts` gains the dashboard (serious + critical = 0).
- [ ] 6E.6.2 **Red proof** WU-6.E5b · e2e-acceptance-path › The fake-provider sidecar replays the recorded contract, and the call is asserted · CODE ~0 · slice `refound/6-e2e-specs-b` — make the sidecar answer 500 → the spec goes red → restore. A red `a11y` assertion is a component finding, not a spec fix.
- [ ] 6E.6.3 Tracker: M10 · CODE ~4 · slice `refound/6-e2e-specs-b`.

### 6E.7 · `refound/6-admin-e2e` (WU-6.E6 + WU-6.E7)

- [ ] 6E.7.1 GREEN WU-6.E6 · e2e-acceptance-path › The administrative suite is re-measured, and every remaining failure is classified · CODE ~150 · slice `refound/6-admin-e2e` — the admin `test:e2e` script; the config with `setup` + `chromium` and the script-owned `webServer`; delete `resetTestAdmin`; `loginAs` throws instead of returning false; `[data-testid="login-error"]` → `getByRole("alert")`; credentials from the seeded env.
- [ ] 6E.7.2 **Measured** WU-6.E6 · e2e-acceptance-path › The administrative suite is re-measured, and every remaining failure is classified · CODE ~0 · slice `refound/6-admin-e2e` — re-measure the 37 specs: the 21 seed failures must disappear; classify every remaining failure (product defect → an owned finding; test defect → fix; decorative → a ledger row). EVIDENCE ~150.
- [ ] 6E.7.3 GREEN WU-6.E7 · e2e-acceptance-path › The administrative suite is re-measured, and every remaining failure is classified · CODE ~5 · slice `refound/6-admin-e2e` — fix the measured WCAG contrast defect in `apps/admin/app/globals.css` (`--accent: #3b82f6` under white text is 3.67:1) with an accessible filled-button background; the admin a11y spec is red before and green after.
- [ ] 6E.7.4 Tracker: M10; Declared gaps / findings rows for every classified failure · CODE ~4 · slice `refound/6-admin-e2e`.

### 6E.8 · `refound/6-e2e-ci` (WU-6.E8 + WU-6.E9) — the job, and the quarantine empties

- [ ] 6E.8.1 GREEN WU-6.E8 · e2e-acceptance-path › The end-to-end job is required, and the rebuilt tree is typechecked · design §2g · CODE ~90 · slice `refound/6-e2e-ci` — the `e2e` job "E2E (chromium)" in `ci.yml`: services by identity, `bash scripts/test-env.sh env services && bash scripts/test-env.sh db` (**no `up`, no `run`** — Playwright owns the processes, DD-18), `playwright install --with-deps chromium` cached by version, `@shared/types` dist then `next build` of both apps, then the client config run followed by the admin config run (sequential; a survivor is caught by the bound-port refusal); upload `playwright-report` and `test-results` always; junit to the step summary; `timeout-minutes: 20`.
- [ ] 6E.8.2 GREEN WU-6.E8 · build-pipeline › `@shared/types` dist is built before every `next build` (the Turbopack boundary) · CODE ~10 · slice `refound/6-e2e-ci` — the job builds `@shared/types` before the Next builds, and `serve client|admin` refuses without `.next/BUILD_ID`.
- [ ] 6E.8.3 GREEN WU-6.E8 · build-pipeline › The rebuilt end-to-end tree is typechecked, and only by the tests-typecheck programme · CODE ~30 · slice `refound/6-e2e-ci` — enrol the rebuilt `apps/client/tests/e2e/**` and `apps/admin/tests/e2e/**` in the tests-typecheck programme and its ratchet ledger, never in the app build graph; the app-build `tests/**/*` exclude stays.
- [ ] 6E.8.4 WU-6.E8 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · design §DD-21 · CODE ~15 · slice `refound/6-e2e-ci` — fill `playwright:client` and `playwright:admin` `executedBy` in `collectors.json` with this job and its two entrypoints, empty their quarantine entries, and add the "E2E (chromium)" context to the ruleset — **all in this same PR** (a job without its registry row, or a registry row without its job, fails the reach gate closed).
- [ ] 6E.8.5 **Red proof** ×2 WU-6.E8 · CODE ~0 · slice `refound/6-e2e-ci` — plant `await expect(page).toHaveTitle("__never__")` → the job exits 1; break the API env → `serve api` exits 6 inside its readiness window and Playwright fails before any test → restore both.
- [ ] 6E.8.6 WU-6.E9 · testing-canon-and-tracker › Every tracker metric is re-derivable by the command it names · CODE ~15 · slice `refound/6-e2e-ci` — admin `test:e2e` into turbo; remove the unused env; script cleanup.
- [ ] 6E.8.7 Tracker: M10 (specs in CI, required = yes); M5 (quarantine −9); Gates rows · CODE ~4 · slice `refound/6-e2e-ci`.

### 6E.9 · `refound/6-e2e-gap` (WU-6.E10) — a declared gap, never a skipped spec

- [ ] 6E.9.1 WU-6.E10 · e2e-acceptance-path › The scheduled-publication journey is a declared gap, never a skipped spec · CODE ~10 · slice `refound/6-e2e-gap` — record "schedule → worker publishes" in Declared gaps with owner N-COR-8/9, stating it will be written red-first inside that change; **no skipped spec is committed here**.
- [ ] 6E.9.2 Tracker: Declared gaps row · CODE ~4 · slice `refound/6-e2e-gap`.

### 6K.1 · `refound/6-k6-a` (WU-6.K1 + WU-6.K2)

- [ ] 6K.1.1 RED WU-6.K2 · k6-load-gate › The base URL is required, the image is digest-pinned, and results land where the upload reads · CODE ~20 · slice `refound/6-k6-a` — `k6 run` without `API_BASE_URL` exits ≠ 0 (`if (!__ENV.API_BASE_URL) throw`), never a localhost fallback; a threshold of `p(95)<1` makes k6 exit 99.
- [ ] 6K.1.2 GREEN WU-6.K1 · k6-load-gate › One real scenario, and its thresholds are assertions · CODE ~120 · slice `refound/6-k6-a` — delete the 5 fiction scenarios, `performance/k6/config/*` and `utils/auth-helpers.js`; write `performance/k6/api-smoke-load.k6.js` (login through the real customer route with the seeded perf users, list posts, create a draft; `constant-arrival-rate` 10 rps × 2 min; **thresholds are assertions**: `http_req_failed rate<0.01` and a p95 per endpoint tag).
- [ ] 6K.1.3 GREEN WU-6.K2 · k6-load-gate › The base URL is required, the image is digest-pinned, and results land where the upload reads · CODE ~40 · slice `refound/6-k6-a` — pin `grafana/k6:<version>@sha256:<digest>`; `handleSummary` writes JSON and text into the exact directory the upload reads; the `perf:report` script family leaves.
- [ ] 6K.1.4 Tracker: M11; Gates row · CODE ~4 · slice `refound/6-k6-a`.

### 6K.2 · `refound/6-k6-calibrate` (WU-6.K3) — **[HUMAN GATE H6]**

- [ ] 6K.2.1 **Measured** WU-6.K3 · k6-load-gate › Thresholds are calibrated over ten runs, and may only tighten · CODE ~5 · slice `refound/6-k6-calibrate` — 10 runs on `main`; thresholds = the worst observed p95 × 2; record every run in the tracker. EVIDENCE ~120.
- [ ] 6K.2.2 **[HUMAN GATE H6]** WU-6.K3 · k6-load-gate › The keep-or-delete decision follows a numeric criterion, either way with numbers · design §DD-24 · CODE ~0 · slice `refound/6-k6-calibrate` — apply the criterion: a CV above 50 % on any gated p95, **or** a non-zero failed-request rate on ≥ 3 of the 10 runs with no application defect → k6 is **deleted** (D11). Present the numbers to Edward either way and record the decision. STOP until it is recorded.
- [ ] 6K.2.3 Tracker: M11; Decisions log (D11 with the numbers) · CODE ~4 · slice `refound/6-k6-calibrate`.

### 6K.3 · `refound/6-k6-b` (WU-6.K4) — the job (DD-24), or its deletion

- [ ] 6K.3.1 GREEN WU-6.K4 · k6-load-gate › One real scenario, and its thresholds are assertions · design §DD-24 · CODE ~60 · slice `refound/6-k6-b` — **per H6 = keep**: in `performance.yml`, job id `k6` with the static name "k6 Load Test", `on: pull_request` with no `paths` (verdict rules V1/V7) plus `push: main`, **no `needs`** (the `db-stress` job leaves with `perf:db`), services by identity, the digest-pinned image, `bash scripts/test-env.sh run --with api,workers -- docker run … -e API_BASE_URL=$TEST_API_URL … k6 run /perf/api-smoke-load.k6.js`, `handleSummary` output uploaded, the scenario-chooser input removed (a dynamic name cannot be a required context). **Per H6 = delete**: remove the workflow, the scenarios and the `k6` collector, and leave the k6 quarantine entries deleted with their files.
- [ ] 6K.3.2 WU-6.K4 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · CODE ~15 · slice `refound/6-k6-b` — on the keep branch, fill the `k6` collector's `executedBy` and add "k6 Load Test" to the ruleset **in this same PR**, and empty the 6 k6 quarantine entries.
- [ ] 6K.3.3 **Red proof** WU-6.K4 · CODE ~0 · slice `refound/6-k6-b` — set a threshold to `p(95)<1` → k6 exits 99 and the job is red → restore.
- [ ] 6K.3.4 Tracker: M11 (runs in CI, required); M5 (quarantine −6); Gates row · CODE ~4 · slice `refound/6-k6-b`.

### 6P.1 · `refound/6-perf-retire` (WU-6.P1 + WU-6.P2)

- [ ] 6P.1.1 WU-6.P1 · k6-load-gate › The retired performance scripts leave with their files · design §3 D10 · CODE ~10 · slice `refound/6-perf-retire` — delete `performance/monitoring/memory-leak-detector.ts` (a synthetic function that leaks memory, never the application) and the duplicated root + api scripts.
- [ ] 6P.1.2 WU-6.P2 · k6-load-gate › The retired performance scripts leave with their files · CODE ~10 · slice `refound/6-perf-retire` — delete `performance/database/postgres-stress.test.ts` (624 lines, 0 assertions, always exit 0 — its class is now covered by k6 through the API) and `perf:baseline`, `perf:regression`, `perf:test` with their files, each backed by its ledger row. EVIDENCE ~2,100.
- [ ] 6P.1.3 Acceptance + Tracker (M1, M4, M5) · CODE ~4 · slice `refound/6-perf-retire` — the quarantine loses `postgres-stress.test.ts`; the #46 grep population drops by four of its five current hits.

### 6S.1 · `refound/6-security-fold` (WU-6.S1)

- [ ] 6S.1.1 **Measured** WU-6.S1 · http-security-posture-tier › The salvageable cases become one live-tier suite, measured before it is written · CODE ~0 · slice `refound/6-security-fold` — run the 12 salvageable cases against the live tier first and record the verdict of each **before** writing the suite. EVIDENCE ~150.
- [ ] 6S.1.2 RED WU-6.S1 · http-security-posture-tier › The salvageable cases become one live-tier suite, measured before it is written · CODE ~300 · slice `refound/6-security-fold` — write `apps/api/tests/integration/httpSecurityPosture.integration.test.ts` with the 12 cases: altered JWT signature → 401; `alg:none`, malformed or expired → 401; prototype pollution on a write route → 400 or stripped with no leak; **SSRF** on external notification sink URLs → rejected; `nosniff`, frame protection, no `X-Powered-By`; no stack or internals in 404/500; the login response carries no hash, secret or MFA material and does not echo the password; CORS (unknown origin not reflected with credentials, preflight rejected); a NoSQL operator in the login body → 400 not 500; an oversized body → 413; a dangerous file type on the real upload route → rejected; XXE on the SAML callback → rejected without expansion.
- [ ] 6S.1.3 WU-6.S1 · http-security-posture-tier › A case that comes back red opens an owned finding, and is never committed skipped · CODE ~10 · slice `refound/6-security-fold` — the SSRF case is **expected red**: open an owned SMELL/N-SEC row for it with a named owner; the case stays in the suite asserting the correct behaviour, never skipped, so the suite is red until the defect is fixed (or the row is the merge blocker Edward adjudicates).
- [ ] 6S.1.4 Tracker: Declared gaps / findings row for every red case; M2 · CODE ~4 · slice `refound/6-security-fold`.

### 6S.2 · `refound/6-security-delete` (WU-6.S2)

- [ ] 6S.2.1 WU-6.S2 · http-security-posture-tier › The old suite is deleted, and each case's destination is named · CODE ~5 · slice `refound/6-security-delete` — delete `security/tests/*` (7 suites, helpers, and the README that lives outside `docs/`) and any root script; SMELL-83 closes naming where each case went (folded, or discarded for having no surface or being already covered). EVIDENCE ~2,800.
- [ ] 6S.2.2 Acceptance + Tracker (M1, M4, M5) · CODE ~4 · slice `refound/6-security-delete` — the quarantine loses its 7 `security/tests` entries.

### 6V.1 · `refound/3-script-exits` (PR V13) — #46, after the k6/perf decision

- [ ] 6V.1.1 RED WU-3.13 · merge-verdict-composition › A script entrypoint cannot swallow its own failure (#46) · CODE ~15 · slice `refound/3-script-exits` — plant `.catch(console.error)` on a script entrypoint → exit 1.
- [ ] 6V.1.2 GREEN WU-3.13 · merge-verdict-composition › A script entrypoint cannot swallow its own failure (#46) · CODE ~60 · slice `refound/3-script-exits` — #46 as a hard-zero grep in a dependency-free job over `git ls-files '*.ts' '*.mts' '*.js'` for `\.catch\(\s*console\.(error|log|warn)\s*\)`; the current five hits are gone (four left with 6P.1, the fifth is fixed here); on the k6-keep branch also assert the report generator exits 1 on an empty results directory.
- [ ] 6V.1.3 **Red proof** WU-3.13 · CODE ~0 · slice `refound/3-script-exits` — 6V.1.1 through the complete step; restore.
- [ ] 6V.1.4 Tracker: Gates row (#46); M7 · CODE ~4 · slice `refound/3-script-exits`.

---

## Phase 6.N — New coverage: what has no tests today (design §7.12)

> **The slice count is fixed by 6.N0's measurement, never predicted here.** Coarse estimate from the plan: 150–250 new test files → 40–70 slices. Each slice: one package, ≤ 400 CODE, in an **isolated worktree** (D19 — the orchestrator owns every git operation and runs the hard probe, DD-22), raising that package's literal floor in the same PR, and landing only **after** that package's demolition slice and its `@test-utils/*` migration.

### 6N.0 · `refound/6n-order` (WU-6.N0) — the measured writing order

- [ ] 6N.0.1 **Measured** WU-6.N0 · behavioural-coverage-backfill › The writing order is measured, not assumed · design §7.12 · CODE ~0 · slice `refound/6n-order` — cross 5.2.3's per-package coverage with test density (core 488 sources / 72 tests; `core/domain` 183/4; the 11 packages with no test) and with risk (the tenant guard and GUC extensions, `core/customer-auth`, `core/auth`, `core/apiKeys`, the auth/mfa/admin routes; the publishing core; `core/billing`); output the ordered tracker table with, per package, current floor → target and the gap in files and unexecuted functions (from `coverage-final.json`). EVIDENCE ~300.
- [ ] 6N.0.2 WU-6.N0 · behavioural-coverage-backfill › The writing order is measured, not assumed · CODE ~10 · slice `refound/6n-order` — adjudicate the three storage adapters and `_template` (does anything import them?) **before** writing a test for them; a package of uncertain purpose goes to `untested-packages.json` with a reason instead.
- [ ] 6N.0.3 WU-6.N0 · behavioural-coverage-backfill › Parallel writers work in isolated worktrees, and the repository operations stay with one actor · CODE ~10 · slice `refound/6n-order` — write the slice list derived from 6N.0.1 into the tracker's Work-units table (one row per slice, with its package, its worktree and its owner), and append those rows to this file under the headings below.
- [ ] 6N.0.4 Tracker: M16 Baseline (packages at target / total; total unexecuted functions) · CODE ~4 · slice `refound/6n-order`.

### 6N.1 · `refound/6n-security-<n>` (WU-6.N1) — security first · slice count per 6N.0.1

- [ ] 6N.1.1 RED WU-6.N1 · behavioural-coverage-backfill › Security first, publishing core second · design §7.12 · CODE ≤ 400 per slice · slices `refound/6n-security-<n>` — the tenant guard proof a structural double cannot give, in the **integration tier**: `accountId` injected for every enrolled model and NOT injected for the denylisted ones; the GUC bound inside the transaction; `withSystemContext` behaviour. (Under the Prisma double `$extends` is an identity, so neither layer exists there — design §2f.)
- [ ] 6N.1.2 RED WU-6.N1 · behavioural-coverage-backfill › Security first, publishing core second · CODE ≤ 400 per slice · slices `refound/6n-security-<n>` — `core/customer-auth`, `core/auth`, `core/apiKeys`, and the untested auth/mfa/admin api routes through `buildRouteTestApp` + `inject`, **both directions**: 401/403 and the happy path with the body asserted.
- [ ] 6N.1.3 Acceptance WU-6.N1 · behavioural-coverage-backfill › Every new test proves in both directions, with the gutted subject as its acceptance · CODE ~0 · per slice — the orchestrator commits the writer's work in its worktree and runs `hard-probe` at that `HEAD` (DD-22): every new test comes back **RED** with the subject gutted; a self-reported probe is not evidence.
- [ ] 6N.1.4 WU-6.N1 · behavioural-coverage-backfill › Each package closes at its target floor or is listed as a declared gap with a reason · CODE ~10 per slice — each slice raises the package's literal floor via `autoUpdate` in the same PR; a package that cannot reach its target gets a Declared gaps row with a reason.
- [ ] 6N.1.5 Tracker: M8, M16 per slice · CODE ~4 per slice.

### 6N.2 · `refound/6n-publishing-<n>` (WU-6.N2) — the publishing core · slice count per 6N.0.1

- [ ] 6N.2.1 RED WU-6.N2 · behavioural-coverage-backfill › Security first, publishing core second · CODE ≤ 400 per slice · slices `refound/6n-publishing-<n>` — `packages/core/domain`: **every invariant gets a test that fails when it is violated and passes when it is met**; value objects; domain events carrying `aggregateId` and `occurredAt`; `reconstitute` of terminal states. `core/domain` is the largest package — several slices.
- [ ] 6N.2.2 RED WU-6.N2 · behavioural-coverage-backfill › Security first, publishing core second · CODE ≤ 400 per slice · slices `refound/6n-publishing-<n>` — `core/posts`, `core/channels`; the outbox claim statement in the **integration tier** (`publishedAt IS NULL AND retryCount < maxRetries AND nextRetryAt <= now` plus the lease); the saga (compensation in reverse order **only** pre-pivot; terminal sagas never re-execute).
- [ ] 6N.2.3 Acceptance + Tracker (probe RED per test; floors raised; M8, M16) · CODE ~4 per slice.

### 6N.3–6N.6 · the remaining families, in parallel per package (slice count per 6N.0.1)

- [ ] 6N.3.1 RED WU-6.N3 · behavioural-coverage-backfill › Each use case is covered on every Result branch, with values asserted · CODE ≤ 400 per slice · slices `refound/6n-core-<pkg>` — `core/billing` and the 39 contexts with a single test: per use case, **every** `Result` branch (validation, not-found, conflict, persistence failure — the branch webhooks lack today) and the happy path with **values** asserted, not `ok`. One package per PR (or two small ones).
- [ ] 6N.4.1 RED WU-6.N4 · behavioural-coverage-backfill › New tests consume the shared tooling and the single HTTP double · CODE ≤ 400 per slice · slices `refound/6n-routes-<area>` — the 36 untested api route files through `buildRouteTestApp` + `inject`: the full contract per route — auth required, Zod validation (400 with the detail), the success body asserted, and the domain-error → HTTP mapping through the **production** `errorPlugin`.
- [ ] 6N.5.1 RED WU-6.N5 · behavioural-coverage-backfill › New tests consume the shared tooling and the single HTTP double · CODE ≤ 400 per slice · slices `refound/6n-<pkg>` — the packages with no config: `packages/shared` (errors, `Result`, `channelCredentialsCrypto`: encrypt→decrypt→equal, wrong key→fails), `health-checks`, `opentelemetry`, `ports` (only what has runtime; pure interfaces go to `untested-packages.json` as verified `types-only`), `packages/ui` (49 components with RTL — render by props, interaction, state, and axe on the ones that open dialogs or menus; its vitest + jsdom config comes from the factory). `vitest-shared` is already born with tests in 4b.2 and 5.1.
- [ ] 6N.6.1 RED WU-6.N6 · behavioural-coverage-backfill › New tests consume the shared tooling and the single HTTP double · CODE ≤ 400 per slice · slices `refound/6n-<app>-<n>` — the untested `apps/client` and `apps/admin` hooks and components (MSW through `@test-utils/wire`), and `apps/workers` (17 of 125 files today: the publish worker, the mention ingest worker, the recorder).
- [ ] 6N.6.2 Acceptance WU-6.N · behavioural-coverage-backfill › Each package closes at its target floor or is listed as a declared gap with a reason · CODE ~0 · slices as above — every package in 6N.0.1's order is at floor ≥ target or in Declared gaps with a reason; **zero decorative-class blocks in anything new** (the 2.1 rules guarantee it, with no new suppression); M16 in the tracker.
- [ ] 6N.6.3 Tracker: M8, M16 per slice; Declared gaps rows · CODE ~4 per slice.

---

## Phase 7 — Mutation testing returns, with a purpose (design §7.13). **vitest 4 only.**

### 7.1 · `refound/7-entry-check` (WU-7.1 entry conditions)

- [ ] 7.1.1 **Measured** WU-7.1 · mutation-score-floors › Mutation is installed only after its entry conditions are measurably met · design §2k · CODE ~0 · slice `refound/7-entry-check` — prove from the tracker that Phase 5 is closed **and** 6.N1–6.N2's packages are at target. Nothing in Phase 7 may start otherwise: mutation over a thin base measures nothing.
- [ ] 7.1.2 Tracker: M12 entry row; Decisions log · CODE ~4 · slice `refound/7-entry-check`.

### 7.2 · `refound/7-tool-choice` (WU-7.1)

- [ ] 7.2.1 **Measured** WU-7.1 · mutation-score-floors › The tool is chosen against stated criteria, and the choice is recorded with numbers · CODE ~40 · slice `refound/7-tool-choice` — score the candidate against the stated criteria (vitest 4 support in the in-scope packages, reliable or verifiable per-test coverage, incremental mode, exit ≠ 0 on `break`, `disableBail`, per-mutant and per-test reporting, runtime inside the PR budget); pilot on `@core/accounts`, `@core/projects`, `@core/customer-auth`, `@core/application`; record the decision row with runtime and confirmed survivors.
- [ ] 7.2.2 Tracker: Decisions log with numbers; M12 · CODE ~4 · slice `refound/7-tool-choice`.

### 7.3 · `refound/7-mutation-runner` (WU-7.2 + WU-7.3)

- [ ] 7.3.1 GREEN WU-7.2 · mutation-score-floors › One root configuration, invoked per package — never one configuration per package · design §2k · CODE ~150 · slice `refound/7-mutation-runner` — one root `stryker.config.mjs` (`testRunner: "vitest"`, `coverageAnalysis: "perTest"`, `disableBail: true`, `reporters: ["json","clear-text"]`, `incremental: true` with a per-package `incrementalFile`, `ignoreStatic: true`, `timeoutMS` measured in the pilot) and `scripts/testing/mutation.mjs --package <name> [--incremental] [--mutate <range>]` deriving `mutate` from the convention and writing `reports/mutation/<pkg>/mutation.json`.
- [ ] 7.3.2 RED WU-7.3 · mutation-score-floors › Every survivor is CONFIRMED by an isolated re-run before it counts · CODE ~100 · slice `refound/7-mutation-runner` — each survivor is re-run alone with `coverageAnalysis: "off"` and `--mutate <range>`; only confirmed survivors count (the upstream false-"Survived" class); a run that gets dramatically faster is a **red condition**, not a win.
- [ ] 7.3.3 Tracker: M12 (score min/median per package) · CODE ~4 · slice `refound/7-mutation-runner`.

### 7.4 · `refound/7-mutation-floors` (WU-7.4)

- [ ] 7.4.1 RED WU-7.4 · mutation-score-floors › Mutation floors never descend (#49) · CODE ~20 · slice `refound/7-mutation-floors` — lower one floor in `mutation-floors.json` → exit ≠ 0.
- [ ] 7.4.2 GREEN WU-7.4 · mutation-score-floors › Mutation floors never descend (#49) · CODE ~80 · slice `refound/7-mutation-floors` — `mutation-floors.json` (`{"<pkg>": {"score", "measuredAt", "runId"}}`) with floors = the measured score rounded down, and gate #49 in #37's form (per package, by name, fail closed).
- [ ] 7.4.3 **Red proof** WU-7.4 · CODE ~0 · slice `refound/7-mutation-floors` — 7.4.1 through the complete step; restore.
- [ ] 7.4.4 Tracker: Gates row (#49); M12 · CODE ~4 · slice `refound/7-mutation-floors`.

### 7.5 · `refound/7-mutation-pr-lane` (WU-7.5)

- [ ] 7.5.1 RED WU-7.5 · mutation-score-floors › The pull-request lane is incremental and blocks on the configured failure condition · CODE ~20 · slice `refound/7-mutation-pr-lane` — delete the assertion that kills a pilot mutant → the incremental job exits ≠ 0.
- [ ] 7.5.2 GREEN WU-7.5 · mutation-score-floors › The pull-request lane is incremental and blocks on the configured failure condition · design §2k · CODE ~90 · slice `refound/7-mutation-pr-lane` — the PR job computing the changed `src` files in in-scope packages, restoring main's incremental file from an artifact, running `--incremental --mutate <changed>` and blocking on `break`; plus the weekly full run that refreshes the base and updates ONE tracking issue.
- [ ] 7.5.3 GREEN WU-7.5 · merge-verdict-composition › Only allowlisted jobs may write to the repository from CI (V8) · design §2h · CODE ~10 · slice `refound/7-mutation-pr-lane` — the weekly tracking-issue job needs `issues: write`, so it joins the `writers` allowlist in `collectors.json` **in this same slice**; it is never triggered on `pull_request`.
- [ ] 7.5.4 **Red proof** ×2 WU-7.5 · CODE ~0 · slice `refound/7-mutation-pr-lane` — 7.5.1, plus planting the weekly job's `issues: write` without the allowlist entry → verdict rule V8 exit 1; restore.
- [ ] 7.5.5 Tracker: M12; Gates rows · CODE ~4 · slice `refound/7-mutation-pr-lane`.

### 7.6 · `refound/7-mutation-ledger` (WU-7.6 + WU-7.7)

- [ ] 7.6.1 WU-7.6 · mutation-score-floors › Mutation results feed the ledger, and the both-directions rule is verified at scale · CODE ~80 · slice `refound/7-mutation-ledger` — feed the ledger: Stryker's green dry run = "passes when the code holds"; a killed mutant = "fails when it does not"; confirmed survivors = unrestricted behaviour; a test that kills 0 mutants (reliable thanks to `disableBail`) **reopens its ledger row** under criterion (a) or (d).
- [ ] 7.6.2 WU-7.7 · mutation-score-floors › The out-of-scope surfaces are DECLARED gaps with reasons, not silent omissions · CODE ~20 · slice `refound/7-mutation-ledger` — declare the gaps with their reasons: `apps/api` (the vitest runner is threads-only and Prisma's native binding crashes — measured) until upstream fork-pool support, a `pnpm patch` or a command runner over native-free slices; the node:test tier is not mutable (a stated limit, per X2's outcome).
- [ ] 7.6.3 Tracker: M12, M6 (reopened rows); Declared gaps rows · CODE ~4 · slice `refound/7-mutation-ledger`.

---

## Phase 8 — Docs and canon, then close (design §7.14)

> Rule: the true fact stays, the stale number goes, and a blocker that disappeared is **said** to have disappeared.

- [ ] 8.1.1 WU-8.2 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~80 · slice `refound/8-docs-testing` — fold any still-true pattern out of `docs/architecture/TESTING.md` (789 lines; stale runner versions, a "95 %+" coverage claim against measured floors, a citation of a non-existent ADR), then archive it with a FROZEN header pointing at `docs/development/TESTING_INFRASTRUCTURE.md` (state) and CODING_STANDARDS §Testing (rules); fix `docs/README.md`.
- [ ] 8.1.2 Tracker: the stale-doc adjudication row · CODE ~4 · slice `refound/8-docs-testing`.
- [ ] 8.2.1 WU-8.3 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~70 · slice `refound/8-docs-chaos` — fold `docs/architecture/chaos-testing.md` (the L1/L2/L3 taxonomy into the living document, the scenario backlog into the Phase 9 queue, "chaos runs in every PR; the nightly duplicate was removed") and archive it; re-link from the roadmap.
- [ ] 8.3.1 WU-8.4 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~70 · slice `refound/8-docs-providers` — after 6M.7.4, fold `docs/development/provider-testing.md` ("Add a provider's MSW handlers" into How to extend; the sandbox workflow, its test and the telegram alias are **said** to be gone) and archive it.
- [ ] 8.4.1 WU-8.5 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~40 · slice `refound/8-docs-saga` — keep and correct `saga-test-suites.md` (three suites: add the compensation-recovery and wait-amplification ones), linked from the living document.
- [ ] 8.5.1 WU-8.6 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~50 · slice `refound/8-docs-security` — keep and correct `SECURITY_TESTING_FRAMEWORK.md` (the real cron; `security/tests` and the Custom Security Test Suite job are said to be removed, with where each case went).
- [ ] 8.6.1 WU-8.7 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~90 · slice `refound/8-docs-e2e` — after 6E.8, archive the four E2E READMEs with FROZEN headers and write the "End-to-end" section of the living document (seed, selectors, sidecar, how to run).
- [ ] 8.7.1 WU-8.8 · testing-canon-and-tracker › One living testing document, re-measured and protected from deletion · CODE ~120 · slice `refound/8-living-doc` — re-measure `docs/development/TESTING_INFRASTRUCTURE.md`: every closed F-n becomes "Decided" with its PR; add it to fitness #24's anti-deletion list **without** an `@`-import (D16).
- [ ] 8.7.2 **Red proof** WU-8.8 · testing-canon-and-tracker › One living testing document, re-measured and protected from deletion · CODE ~0 · slice `refound/8-living-doc` — delete the file (or strip its required section) → fitness #24 exit 1 → restore.
- [ ] 8.7.3 Tracker: Gates row (#24 extended); M7 · CODE ~4 · slice `refound/8-living-doc`.

### 8.8 · `refound/1-quarantine-retired` (PR R15) — the close

- [ ] 8.8.1 WU-1.15 · test-reach-contract › Quarantine is temporary and only shrinks · CODE ~60 (net −60) · slice `refound/1-quarantine-retired` — when phases 2, 4 and 6 have emptied it: delete `quarantine.json` and its handling in the runner and the engine; #30 becomes hard-zero.
- [ ] 8.8.2 **Red proof** WU-1.15 · CODE ~0 · slice `refound/1-quarantine-retired` — plant an unreached file → exit 1 **with no quarantine path available** → restore.
- [ ] 8.8.3 Acceptance WU-1.15 · testing-canon-and-tracker › Declared gaps are counted, never faked · CODE ~0 · slice `refound/1-quarantine-retired` — the change's DoD is verifiable from the tracker: every file has a ledger verdict and zero decorative suppressions; disk − ⋃collectors = 0; every new or modified gate has a demonstrated red; the tier reports 0 skipped / 0 cancelled; coverage is measured in all 86 with floors that never descend; E2E and k6 (or k6's recorded deletion) are required contexts; mutation blocks on `break` in the declared scope; one living document plus the amended canon; every package at its target floor or in Declared gaps.
- [ ] 8.8.4 Tracker: M5 hard-zero; M7 final; the As-of date and the closing row · CODE ~4 · slice `refound/1-quarantine-retired`.

---

## Phase 9 — The queue (out of this change's scope, declared here so it is not lost)

- [ ] 9.1 WU-9 · testing-canon-and-tracker › Declared gaps are counted, never faked · CODE ~10 · slice `refound/8-living-doc` — record in Declared gaps, each with an owner: N-COR-8 PR 1d/1e measured under the new battery, the feature backlog, the "schedule → published" E2E (N-COR-8/9), the chaos scenarios from the roadmap, and the settings route-contract gap from task 2.12.1.

---

## Slice index

Every slice targets `main` (`stacked-to-main`) and is merged in the order below. "Depends on" names the slice that must be **merged** first; slices with the same dependency are parallel-safe. "Gates (red proof)" lists the gates the slice creates or modifies — each has its own red-proof checkbox in the phase above. "Tracker" names the metric rows the slice moves in its own PR.

| Slice  | Branch                               | Batch | Depends on                                | Tasks        | CODE       | Gates (red proof)                                   | Tracker             |
| ------ | ------------------------------------ | ----- | ----------------------------------------- | ------------ | ---------- | --------------------------------------------------- | ------------------- |
| 0.1    | `refound/0-tracker`                  | **1** | base merges (Edward)                      | 0.1.1–0.1.6  | ~400       | — (fitness #24 row)                                 | M7 + seed all       |
| 0.2    | `refound/0-toolchain-measure`        | 2     | 0.1                                       | 0.2.1–0.2.3  | ~40        | —                                                   | T.4 table           |
| 0.3    | `refound/0-toolchain-holds`          | 3     | 0.2                                       | 0.3.1–0.3.6  | ~150       | holds-vs-`outdated` gate ✅                         | M7                  |
| 0.4    | `refound/0-toolchain-eslint`         | 4     | 0.3                                       | 0.4.1–0.4.3  | ~78        | —                                                   | T.4 table           |
| 0.4b   | `refound/0-holds-table-fix`          | 4b    | 0.4                                       | 0.4b.1–5     | ~111       | holds gate: remove-when red re-proven ✅            | M7, Gates, T.4      |
| 0.5    | `refound/0-toolchain-types-node`     | 5     | 0.3                                       | 0.5.1–0.5.4  | ~334       | `engines.node` gate ✅                              | M7                  |
| 0.6    | `refound/0-toolchain-tsx`            | 6     | 0.3                                       | 0.6.1–0.6.2  | ~29        | —                                                   | T.4 table           |
| 0.7    | `refound/0-toolchain-browser`        | 7     | 0.3                                       | 0.7.1–0.7.2  | ~54        | —                                                   | T.4 table           |
| 0.8    | `refound/0-toolchain-msw`            | 8     | 0.3                                       | 0.8.1–0.8.2  | ~29        | —                                                   | T.4 table           |
| 0.9    | `refound/0-toolchain-rtl`            | 9     | 0.3                                       | 0.9.1–0.9.2  | ~54        | —                                                   | T.4 table           |
| 0.10   | `refound/0-toolchain-vitest-plugin`  | 10    | 0.3                                       | 0.10.1–2     | ~29        | —                                                   | T.4 table           |
| 0.11   | `refound/0-toolchain-storybook`      | 11    | 0.3                                       | 0.11.1–5     | ~74        | —                                                   | T.4, M13            |
| 0.12   | `refound/0-toolchain-jsdom`          | 12    | 0.3 + **H1**                              | 0.12.1–3     | ~64        | —                                                   | Decisions           |
| 0.13   | `refound/0-toolchain-vite-shims`     | 13    | 0.3                                       | 0.13.1–2     | ~19        | —                                                   | T.4 table           |
| 0.14   | `refound/0-toolchain-build`          | 14    | 0.13                                      | 0.14.1–3     | ~50        | —                                                   | T.4 table           |
| 0.15   | `refound/0-toolchain-quality-gates`  | 15    | 0.14                                      | 0.15.1–3     | ~70        | —                                                   | T.4 table, Phase 0  |
| 0.16   | `refound/0-runtime-node-26`          | 16    | 0.15, containerization resume, 2026-10-28 | 0.16.1–4     | ~54        | engines gate red on a manifest ahead of the runtime | T.4 table, D23      |
| P.1    | `refound/3-fitness-inventory`        | —     | 0.1                                       | P.1.1–P.1.4  | ~64        | #44 ✅                                              | M7                  |
| P.2    | `refound/3-reporters`                | —     | 0.1                                       | P.2.1–P.2.4  | ~44        | shard reporters ✅                                  | M2, M7              |
| P.3    | `refound/3-openapi-drift`            | —     | 0.1                                       | P.3.1–P.3.3  | ~64        | OpenAPI Drift job ✅                                | M7                  |
| P.4    | `refound/3-gitleaks`                 | —     | 0.1                                       | P.4.1–P.4.3  | ~24        | gitleaks fail-closed ✅                             | M7                  |
| P.5    | `refound/3-osv-measure`              | —     | 0.1                                       | P.5.1–P.5.2  | ~34        | — (measurement)                                     | OSV table           |
| P.6    | `refound/4b-env-write`               | —     | 0.1                                       | P.6.1–P.6.5  | ~300       | env refusals ✅, hermetic ✅                        | M15, M7             |
| P.7    | `refound/2-classifier`               | —     | 0.1                                       | P.7.1–P.7.3  | ~334       | — (rules land in 2.1)                               | M3 denominator      |
| P.8    | `refound/2-ledger-a`                 | —     | P.7, 1.14                                 | P.8.1–P.8.3  | ~264       | `ledger --check` ✅                                 | M4, M6              |
| P.9    | `refound/2-ledger-b`                 | —     | P.8                                       | P.9.1–P.9.4  | ~234       | `--area` prediction ✅                              | M4, M6              |
| P.10   | `refound/2-probe`                    | —     | P.8                                       | P.10.1–7     | ~374       | probe root ✅, worktree lifecycle ✅×4              | M7                  |
| 1.1    | `refound/1-suffix`                   | —     | 0.13                                      | 1.1.1–1.1.3  | ~14        | —                                                   | M1, M5              |
| 1.2    | `refound/1-factory-converge`         | —     | 1.1                                       | 1.2.1–1.2.6  | ~254       | factory refusals ✅                                 | M5, M7              |
| 1.3    | `refound/1-resolution`               | —     | 1.2                                       | 1.3.1–1.3.4  | ~144       | source-resolution assertion ✅                      | M7, Decisions       |
| 1.4    | `refound/1-double-collection`        | —     | 1.3                                       | 1.4.1–1.4.3  | ~254       | —                                                   | M5                  |
| 1.5    | `refound/1-timing-in-tests`          | —     | 1.4                                       | 1.5.1–1.5.4  | ~39        | contamination restore ✅×2                          | M9                  |
| 1.6    | `refound/1-tier-measure`             | —     | 1.5                                       | 1.6.1–1.6.2  | ~4         | — (measurement)                                     | M9 Baseline         |
| 1.7    | `refound/1-tier-rename`              | —     | 1.6                                       | 1.7.1–1.7.3  | ~114       | —                                                   | M1, M9              |
| 1.8    | `refound/1-runner-envfix`            | —     | 1.1 (or before)                           | 1.8.1–1.8.4  | ~134       | A1 data-loss refusal ✅                             | M7                  |
| 1.9    | `refound/1-services-collector`       | —     | 1.7, 1.8                                  | 1.9.1–1.9.7  | ~264       | 4 runner guards ✅, interim #30 ✅                  | M5, M9, M7          |
| 1.10   | `refound/4b-db` (PR E2)              | —     | P.6, 1.9                                  | 1.10.1–5     | ~274       | 4 identity/contamination refusals ✅                | M15, M7             |
| 1.11   | `refound/4b-processes` (PR E3a)      | —     | 1.10                                      | 1.11.1–5     | ~304       | 7 subprocess-lifecycle REDs ✅                      | M7                  |
| 1.12   | `refound/4b-integration-recipe`      | —     | 1.11                                      | 1.12.1–5     | ~204       | recipe phase order ✅, `full-integration` ✅        | M9, M7              |
| 1.13   | `refound/1-live-collector` (PR R8)   | —     | 1.12                                      | 1.13.1–5     | ~244       | `probe_live` ✅×2                                   | M5, M9, M7          |
| 1.14   | `refound/1-reach-engine` (PR R9a)    | —     | 1.13                                      | 1.14.1–4     | ~254       | fail-closed conditions                              | Decisions           |
| 1.15   | `refound/1-reach-selftests` (R9b)    | —     | 1.14                                      | 1.15.1–5     | ~184       | one RED per reach rule ✅                           | M5, M7              |
| 1.16   | `refound/1-test-contracts-job` (R10) | —     | 1.15, P.1                                 | 1.16.1–7     | ~124       | #30 new form ✅×6, mirror ruleset                   | M5, M7              |
| 1.17   | `refound/1-script-contract` (R11)    | —     | 1.16                                      | 1.17.1–4     | ~59        | part C ✅, #31 A widened ✅                         | M7                  |
| 1.18   | `refound/1-scopes` (PR R12)          | —     | 1.16                                      | 1.18.1–4     | ~154       | #36 new home ✅×2                                   | M7                  |
| 1.19   | `refound/1-node-reporter` (R16)      | —     | 1.9, 1.13                                 | 1.19.1–4     | ~174       | 4 guards re-proven ✅                               | M2, M9, M7          |
| 2.1    | `refound/2-lint-rules`               | —     | P.7, P.10                                 | 2.1.1–2.1.8  | ~314       | 3 `testing/*` rules ✅, #48 ✅                      | M3, M13, M7         |
| 2.2    | `refound/2-ledger-listing`           | —     | 2.1, P.9 · **H3**                         | 2.2.1–2.2.3  | ~4         | —                                                   | M6                  |
| 2.3    | `refound/2-coverage-exception`       | —     | 2.2 · **H8**                              | 2.3.1–2.3.4  | ~44        | #37 scenario ✅                                     | M14, Decisions      |
| 2.4    | `refound/2-whole-files`              | —     | 2.3                                       | 2.4.1–2.4.3  | ~10        | —                                                   | M1, M2, M4, M5      |
| 2.5    | `refound/2-todo-stubs`               | —     | 2.2                                       | 2.5.1–2.5.3  | ~6         | —                                                   | M2, M9, gaps        |
| 2.6    | `refound/2-dead-helpers`             | —     | 2.2 · **H2**                              | 2.6.1–2.6.4  | ~9         | —                                                   | M1, M4, M5          |
| 2.7    | `refound/2-blocks-1a`                | —     | 2.3                                       | 2.7.1–2.7.2  | ~324       | —                                                   | M2, M3, M14         |
| 2.8    | `refound/2-blocks-1b`                | —     | 2.7                                       | 2.8.1–2.8.2  | ~354       | —                                                   | M2, M3, M14         |
| 2.9    | `refound/2-blocks-2a`                | —     | 2.8                                       | 2.9.1–2.9.2  | ~354       | —                                                   | M2, M3, M14         |
| 2.10   | `refound/2-blocks-2b`                | —     | 2.9                                       | 2.10.1–2     | ~354       | —                                                   | M2, M3, M14         |
| 2.11   | `refound/2-blocks-3`                 | —     | 2.10                                      | 2.11.1–2     | ~354       | —                                                   | M2, M3, M14         |
| 2.12   | `refound/2-blocks-4`                 | —     | 2.11                                      | 2.12.1–2     | ~354       | —                                                   | M2, M3, M14, gaps   |
| 2.13   | `refound/2-blocks-5`                 | —     | 2.12, 1.19                                | 2.13.1–2     | ~304       | —                                                   | M2, M3              |
| 2.14   | `refound/2-blocks-6`                 | —     | 2.3 (parallel)                            | 2.14.1–2     | ~304       | —                                                   | M2, M3              |
| 2.15   | `refound/2-blocks-7`                 | —     | 2.3 (parallel)                            | 2.15.1–2     | ~304       | —                                                   | M2, M3              |
| 2.16   | `refound/2-rewrites`                 | —     | 2.13, P.10                                | 2.16.1–3     | ~64        | probe RED per rewrite ✅                            | M6                  |
| 3.1    | `refound/3-coverage-certifies` (V4)  | —     | P.2                                       | 3.1.1–3.1.4  | ~44        | certify-refusal ✅                                  | M7                  |
| 3.2    | `refound/3-remove-duplicate-gates`   | —     | 3.1 · **H4**                              | 3.2.1–3.2.5  | ~149       | (verdict rule V1 covers it)                         | M7, Decisions       |
| 3.3    | `refound/3-skip-gate` (PR V8)        | —     | 2.5, P.2                                  | 3.3.1–3.3.5  | ~84        | skip gate ✅                                        | M2, M9, M7          |
| 3.4    | `refound/1-skips-ast` (PR R13)       | —     | 1.16, 2.13, 4.2                           | 3.4.1–3.4.5  | ~214       | #32 new form ✅×4                                   | M9, M7              |
| 3.5    | `refound/3-verdict-static` (PR V9)   | —     | 1.16, 3.1, 3.2                            | 3.5.1–3.5.5  | ~444       | #45 V1/V2/V3/V7/V8 ✅×7                             | M7                  |
| 3.6    | `refound/3-ruleset` (PR V11)         | —     | 3.5 · **H5**                              | 3.6.1–3.6.5  | ~94        | required-context composition ✅                     | M15, Decisions      |
| 3.7    | `refound/3-verdict-drift` (PR V10)   | —     | 3.6                                       | 3.7.1–3.7.4  | ~194       | #45 V4/V5/V6 ✅×5                                   | M7                  |
| 3.8    | `refound/3-osv-decide` (PR V7b)      | —     | P.5, 3.6                                  | 3.8.1–3.8.3  | ~44        | OSV ignores ✅ or removal                           | Decisions           |
| 4b.1   | `refound/4b-adopt-workflows` (E4)    | —     | 1.12                                      | 4b.1.1–3     | ~154       | (#47 covers it) ✅                                  | M15                 |
| 4b.2   | `refound/4b-loader` (PR E5)          | —     | P.6                                       | 4b.2.1–4     | ~69        | loader refusal ✅                                   | M7                  |
| 4b.3   | `refound/4b-playwright-servers`      | —     | 1.11                                      | 4b.3.1–4     | ~74        | `webServer` from the script ✅                      | M7, Decisions       |
| 4b.4   | `refound/4b-identity` (PR E7)        | —     | 4b.1, 1.16                                | 4b.4.1–4     | ~184       | #47 ✅×3                                            | M15, M7             |
| 4b.5   | `refound/4b-hermetic-shards` (E8)    | —     | P.6, P.3                                  | 4b.5.1–4     | ~74        | hermetic shards ✅                                  | M8, Decisions       |
| S.1    | `refound/s-skeleton`                 | —     | 2.2                                       | S.1.1–S.1.4  | ~184       | depcruise `src ↛ test-utils` ✅×2                   | M13, M7             |
| S.2    | `refound/s-builders`                 | —     | S.1                                       | S.2.1–S.2.3  | ~244       | —                                                   | M13                 |
| S.3    | `refound/s-raw-reach`                | —     | S.2                                       | S.3.1–S.3.4  | ~154       | recorder classifier ✅                              | raw-reach table     |
| S.4    | `refound/s-uow-canon`                | —     | S.3                                       | S.4.1–S.4.4  | ~124       | transient UoW ✅                                    | Decisions           |
| S.5    | `refound/s-prisma-double`            | —     | S.4                                       | S.5.1–S.5.5  | ~314       | raw-SQL throw ✅                                    | M13, M6             |
| S.6    | `refound/s-redis-double`             | —     | S.5                                       | S.6.1–S.6.4  | ~324       | unsupported command ✅                              | M13                 |
| S.7    | `refound/s-route-app`                | —     | S.5                                       | S.7.1–S.7.2  | ~144       | production `errorPlugin` ✅                         | M13                 |
| S.8    | `refound/s-route-app-1`              | —     | S.7                                       | S.8.1        | ~300       | —                                                   | M13                 |
| S.9    | `refound/s-route-app-2`              | —     | S.8                                       | S.9.1        | ~300       | —                                                   | M13                 |
| S.10   | `refound/s-route-app-3`              | —     | S.9                                       | S.10.1–2     | ~304       | —                                                   | M13                 |
| S.11   | `refound/s-seed`                     | —     | S.5                                       | S.11.1–2     | ~164       | tenant-scoped cleanup ✅                            | M13                 |
| S.12   | `refound/s-seed-migrate-1`           | —     | S.11                                      | S.12.1       | ~300       | —                                                   | M13                 |
| S.13   | `refound/s-seed-migrate-2`           | —     | S.12                                      | S.13.1–2     | ~304       | —                                                   | M13                 |
| S.14   | `refound/s-builder-gate`             | —     | S.2, S.5                                  | S.14.1–4     | ~74        | builder-name ✅, cast ✅                            | M13, M7             |
| S.15   | `refound/s-migrate-core`             | —     | S.14, 2.14                                | S.15.1       | ~300       | —                                                   | M13                 |
| S.16   | `refound/s-migrate-adapters`         | —     | S.14, 2.14                                | S.16.1       | ~300       | —                                                   | M13                 |
| S.17   | `refound/s-migrate-providers`        | —     | S.14, 2.14                                | S.17.1       | ~300       | —                                                   | M13                 |
| S.18   | `refound/s-migrate-workers`          | —     | S.14, 2.15                                | S.18.1       | ~250       | —                                                   | M13                 |
| S.19   | `refound/s-migrate-api`              | —     | S.14, 2.13                                | S.19.1       | ~350       | —                                                   | M13                 |
| S.20   | `refound/s-migrate-client`           | —     | S.14, 2.15                                | S.20.1–2     | ~304       | both gates hard-zero ✅                             | M13                 |
| 4.1    | `refound/4-preconditions-a`          | —     | 1.13                                      | 4.1.1–4.1.3  | ~244       | throwing precondition ✅                            | M9                  |
| 4.2    | `refound/4-preconditions-b`          | —     | 4.1                                       | 4.2.1–4.2.3  | ~204       | —                                                   | M9                  |
| 4.3    | `refound/4-production-rewrite`       | —     | 4.2                                       | 4.3.1–4.3.4  | ~174       | probe RED ✅                                        | M2, M6              |
| 4.4    | `refound/4-outbox-topology`          | —     | 1.12, 4.3                                 | 4.4.1–4.4.4  | ~84        | `assertNoForeignRelay` ✅                           | M7                  |
| 4.5    | `refound/4-unquarantine-db`          | —     | 4.4                                       | 4.5.1–4.5.2  | ~14        | —                                                   | M5, M9              |
| 4.6    | `refound/4-unquarantine-live`        | —     | 4.5                                       | 4.6.1–4.6.3  | ~20        | —                                                   | M5, M9              |
| 4.7    | `refound/4-chaos`                    | —     | 4.6                                       | 4.7.1–4.7.2  | ~14        | —                                                   | M5, M15             |
| 4.8    | `refound/3-nightly` (PR V12)         | —     | 1.12, 1.13                                | 4.8.1–4.8.4  | ~124       | one-alarm ✅ (3 GitHub-write REDs)                  | M15, M7             |
| 4.9    | `refound/1-registered-entrypoints`   | —     | 4.8, 3.2                                  | 4.9.1–4.9.4  | ~134       | reach part B ✅                                     | M7                  |
| 4.10   | `refound/4-tier-acceptance`          | —     | 4.7, 4.9                                  | 4.10.1–2     | ~24        | —                                                   | M5, M9              |
| X.1    | `refound/x-runner-experiment`        | —     | 1.13, 1.12, 3.3                           | X.1.1        | 0 merged   | — (unmerged branch)                                 | —                   |
| X.2    | `refound/x-runner-evidence`          | —     | X.1 · **H7**                              | X.1.2–X.2.2  | ~70        | —                                                   | X1 table, Decisions |
| 5.1    | `refound/5-coverage-defaults` (C1)   | —     | 1.18                                      | 5.1.1–5.1.4  | ~104       | #36 coverage globs ✅, turbo `inputs` ✅            | M8, M7              |
| 5.2    | `refound/5-coverage-measure` (C2)    | —     | 5.1                                       | 5.2.1–5.2.4  | ~59        | summary-count ✅                                    | M8, Decisions       |
| 5.3    | `refound/5-floors-core-a` (C3)       | —     | 5.2                                       | 5.3.1–5.3.2  | ~334       | thresholds ✅                                       | M8                  |
| 5.4    | `refound/5-floors-core-b` (C4)       | —     | 5.3                                       | 5.4.1–5.4.2  | ~334       | thresholds ✅                                       | M8                  |
| 5.5    | `refound/5-floors-packages` (C5)     | —     | 5.4                                       | 5.5.1–5.5.2  | ~334       | thresholds ✅                                       | M8                  |
| 5.6    | `refound/5-floors-apps` (C6)         | —     | 5.5                                       | 5.6.1–5.6.2  | ~334       | thresholds ✅                                       | M8                  |
| 5.7    | `refound/5-floor-ratchet` (C7)       | —     | 5.6, 2.3                                  | 5.7.1–5.7.5  | ~244       | #37 new form ✅×6                                   | M7, M14             |
| 5.8    | `refound/5-floors-enforced` (C8)     | —     | 5.7                                       | 5.8.1–5.8.3  | ~54        | risen-floor ✅×2                                    | M8, M7              |
| 5.9    | `refound/5-denominator` (C9)         | —     | 5.7                                       | 5.9.1–5.9.4  | ~174       | denominator ✅×3                                    | M8, gaps            |
| 5.10   | `refound/5-canon-floors` (C10)       | —     | 5.8                                       | 5.10.1–2     | ~154       | —                                                   | M8, M16, Decisions  |
| 6M.1   | `refound/6-msw-core`                 | —     | S.1, 1.2                                  | 6M.1.1–6     | ~244       | network isolation ✅                                | M13, M7             |
| 6M.2   | `refound/6-msw-gate`                 | —     | 6M.1                                      | 6M.2.1–5     | ~209       | fetch-stub gate ✅                                  | M13, M7             |
| 6M.3   | `refound/6-msw-client-1`             | —     | 6M.2, 2.15                                | 6M.3.1       | ~300       | —                                                   | M13                 |
| 6M.4   | `refound/6-msw-client-2`             | —     | 6M.3                                      | 6M.4.1       | ~300       | —                                                   | M13                 |
| 6M.5   | `refound/6-msw-admin`                | —     | 6M.2, 2.15                                | 6M.5.1       | ~300       | —                                                   | M13                 |
| 6M.6   | `refound/6-msw-api`                  | —     | 6M.2, 2.13                                | 6M.6.1       | ~350       | —                                                   | M13                 |
| 6M.7a  | `refound/6-msw-providers-1`          | —     | 6M.2, S.17                                | 6M.7.1       | ~350       | —                                                   | M13                 |
| 6M.7b  | `refound/6-msw-providers-2`          | —     | 6M.7a                                     | 6M.7.2       | ~350       | —                                                   | M13                 |
| 6M.7c  | `refound/6-msw-providers-3`          | —     | 6M.7b                                     | 6M.7.3       | ~350       | —                                                   | M13                 |
| 6M.7d  | `refound/6-msw-providers-4`          | —     | 6M.7c                                     | 6M.7.4       | ~350       | —                                                   | M13                 |
| 6M.8   | `refound/6-msw-close`                | —     | 6M.7d, 6M.6, 6M.4                         | 6M.8.1–2     | ~24        | fetch-stub hard-zero ✅                             | M13 → 0             |
| 6E.1   | `refound/6-e2e-demolish`             | —     | 2.2                                       | 6E.1.1–3     | ~64        | —                                                   | M1, M4, M10         |
| 6E.2   | `refound/6-seed-e2e`                 | —     | 1.10, 6E.1                                | 6E.2.1–3     | ~194       | owner-connection refusal ✅                         | M10, M7             |
| 6E.3   | `refound/6-provider-seam`            | —     | 6M.1, 6M.7d                               | 6E.3.1–5     | ~244       | production refusal ✅, sidecar contract ✅          | M7, Decisions       |
| 6E.4   | `refound/6-e2e-config`               | —     | 4b.3, 6E.2, 6E.3                          | 6E.4.1–3     | ~124       | `failOnFlakyTests` ✅                               | M10, M7             |
| 6E.5   | `refound/6-e2e-specs-a`              | —     | 6E.4                                      | 6E.5.1–2     | ~154       | —                                                   | M10                 |
| 6E.6   | `refound/6-e2e-specs-b`              | —     | 6E.5                                      | 6E.6.1–3     | ~114       | sidecar 500 → red ✅                                | M10                 |
| 6E.7   | `refound/6-admin-e2e`                | —     | 6E.4                                      | 6E.7.1–4     | ~159       | a11y contrast ✅                                    | M10, gaps           |
| 6E.8   | `refound/6-e2e-ci`                   | —     | 6E.6, 6E.7, 3.6                           | 6E.8.1–7     | ~164       | E2E job ✅×2, reach row + ruleset                   | M10, M5, M7         |
| 6E.9   | `refound/6-e2e-gap`                  | —     | 6E.8                                      | 6E.9.1–2     | ~14        | —                                                   | gaps                |
| 6K.1   | `refound/6-k6-a`                     | —     | 6E.2, 1.12                                | 6K.1.1–4     | ~184       | `API_BASE_URL` throw ✅, threshold ✅               | M11, M7             |
| 6K.2   | `refound/6-k6-calibrate`             | —     | 6K.1 · **H6**                             | 6K.2.1–3     | ~9         | —                                                   | M11, Decisions      |
| 6K.3   | `refound/6-k6-b`                     | —     | 6K.2, 3.6                                 | 6K.3.1–4     | ~79        | k6 job ✅, reach row + ruleset                      | M11, M5, M7         |
| 6P.1   | `refound/6-perf-retire`              | —     | 2.2, 6K.2                                 | 6P.1.1–3     | ~24        | —                                                   | M1, M4, M5          |
| 6S.1   | `refound/6-security-fold`            | —     | 4.1, 1.13                                 | 6S.1.1–4     | ~314       | —                                                   | M2, gaps            |
| 6S.2   | `refound/6-security-delete`          | —     | 6S.1                                      | 6S.2.1–2     | ~9         | —                                                   | M1, M4, M5          |
| 6V.1   | `refound/3-script-exits` (PR V13)    | —     | 6K.3, 6P.1                                | 6V.1.1–4     | ~79        | #46 ✅                                              | M7                  |
| 6N.0   | `refound/6n-order`                   | —     | 5.2                                       | 6N.0.1–4     | ~14        | —                                                   | M16 Baseline        |
| 6N.1.* | `refound/6n-security-<n>`            | —     | 6N.0, S.19, 2.13                          | 6N.1.1–5     | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 6N.2.* | `refound/6n-publishing-<n>`          | —     | 6N.1, S.15                                | 6N.2.1–3     | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 6N.3.* | `refound/6n-core-<pkg>`              | —     | 6N.2, S.15                                | 6N.3.1       | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 6N.4.* | `refound/6n-routes-<area>`           | —     | 6N.1, S.10                                | 6N.4.1       | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 6N.5.* | `refound/6n-<pkg>`                   | —     | 6N.0, 5.9                                 | 6N.5.1       | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 6N.6.* | `refound/6n-<app>-<n>`               | —     | 6N.0, S.18, S.20                          | 6N.6.1–3     | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 7.1    | `refound/7-entry-check`              | —     | 5.10, 6N.2                                | 7.1.1–7.1.2  | ~4         | —                                                   | M12                 |
| 7.2    | `refound/7-tool-choice`              | —     | 7.1                                       | 7.2.1–7.2.2  | ~44        | —                                                   | M12, Decisions      |
| 7.3    | `refound/7-mutation-runner`          | —     | 7.2                                       | 7.3.1–7.3.3  | ~254       | survivor confirmation ✅                            | M12                 |
| 7.4    | `refound/7-mutation-floors`          | —     | 7.3                                       | 7.4.1–7.4.4  | ~104       | #49 ✅                                              | M12, M7             |
| 7.5    | `refound/7-mutation-pr-lane`         | —     | 7.4, 3.5                                  | 7.5.1–7.5.5  | ~124       | incremental `break` ✅, V8 allowlist ✅             | M12, M7             |
| 7.6    | `refound/7-mutation-ledger`          | —     | 7.5                                       | 7.6.1–7.6.3  | ~104       | —                                                   | M12, M6, gaps       |
| 8.1    | `refound/8-docs-testing`             | —     | 2.1, 5.10                                 | 8.1.1–8.1.2  | ~84        | —                                                   | docs row            |
| 8.2    | `refound/8-docs-chaos`               | —     | 4.7                                       | 8.2.1        | ~70        | —                                                   | docs row            |
| 8.3    | `refound/8-docs-providers`           | —     | 6M.7d                                     | 8.3.1        | ~70        | —                                                   | docs row            |
| 8.4    | `refound/8-docs-saga`                | —     | 1.13                                      | 8.4.1        | ~40        | —                                                   | docs row            |
| 8.5    | `refound/8-docs-security`            | —     | 6S.2                                      | 8.5.1        | ~50        | —                                                   | docs row            |
| 8.6    | `refound/8-docs-e2e`                 | —     | 6E.8                                      | 8.6.1        | ~90        | —                                                   | docs row            |
| 8.7    | `refound/8-living-doc`               | —     | 8.1–8.6                                   | 8.7.1–3, 9.1 | ~134       | #24 extended ✅                                     | M7, gaps            |
| 8.8    | `refound/1-quarantine-retired`       | —     | 4.10, 6E.8, 6K.3, 6N.6                    | 8.8.1–4      | ~74        | #30 hard-zero ✅                                    | M5 → 0, M7          |

**Dependency bottlenecks worth naming.** 1.16 (`Test Contracts`) is the highest-fan-out slice: 15 later slices read its engine or its ruleset, and a defect in it blocks every PR (design §9 risk 9 — rollback is reverting that one PR, which brings the old grep steps back). 2.2 (**H3**) gates all 13 demolition slices and Track S's start. 3.6 (**H5**, admin) gates every later required context, so 6E.8 and 6K.3 cannot make E2E or k6 required before it. S.4's canon fix gates S.5, and S.5 gates the whole route-app and seed chain. 6N is the long tail: its 40–70 slices are parallel **per package**, but each waits on that package's demolition slice and its `@test-utils/*` migration, so S.15–S.20 are its real critical path.
