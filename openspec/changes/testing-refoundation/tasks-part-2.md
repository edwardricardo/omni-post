# Tasks: Testing Re-foundation (`testing-refoundation`) — part 2

> This checklist is split by size so each file stays under the reviewer context budget: [tasks.md](tasks.md) holds the forecast, the grammar, Phase 0 and Phase P; this file holds Phase 1, Phase 2, Phase 3, Phase 4b, Phase S, Phase 4 and Phase X; [tasks-part-3.md](tasks-part-3.md) holds Phase 5, Phase 6, Phase 6.N, Phase 7, Phase 8, Phase 9 and the slice index.

## Phase 1 — Reach contract (design §7.3)

### 1.1 · `refound/1-suffix` (PR R1) — free the `.integration` suffix, name the k6 files

- [ ] 1.1.1 WU-1.1 · test-reach-contract › The filename suffix is the collector router · design §2a · CODE ~10 · slice `refound/1-suffix` — `git mv` the 24 `apps/client/tests/integration/*.integration.test.tsx`, the 2 under `apps/api/tests/unit`, and the 4 provider stubs → `*.test.ts(x)`; `performance/k6/scenarios/*.js` → `*.k6.js`; repoint `performance.yml`, the root `perf:api` script and `run-performance-tests.sh`. EVIDENCE ~2,400 (renames at 100 % similarity).
- [ ] 1.1.2 Acceptance WU-1.1 · test-reach-contract › The filename suffix is the collector router · CODE ~0 · slice `refound/1-suffix` — `git ls-files '*.integration.test.*'` lists only node:test files under `apps/api/tests`; `vitest list --filesOnly` per package identical before and after (832).
- [ ] 1.1.3 Tracker: M5 (files with 2 collectors) and M1 rows · CODE ~4 · slice `refound/1-suffix`.

### 1.2 · `refound/1-factory-converge` (PR R2) — reserved suffixes and the four factory migrations (DD-20)

- [ ] 1.2.1 RED WU-1.2 · test-reach-contract › The filename suffix is the collector router · design §2e · CODE ~30 · slice `refound/1-factory-converge` — failing tests for `defineWorkspaceVitestConfig`: `RESERVED_TIER_EXCLUDES` appended to `configDefaults.exclude`; a planted `apps/api/tests/unit/x.integration.test.ts` is NOT listed by `vitest list`.
- [ ] 1.2.2 RED WU-1.2 · shared-test-tooling › The tooling is three packages, not one, and production never imports them · design §DD-20 · CODE ~40 · slice `refound/1-factory-converge` — failing tests for the refusals: overriding a **factory-owned key** (`test.reporters`, `coverage.provider`, `coverage.reporter`, `coverage.reportsDirectory`, `coverage.include`, `resolve.alias`) THROWS naming the option to use instead; `coverageInclude` omitted with no `<packageDir>/src` THROWS "pass coverageInclude"; `setupFiles` and `exclude` concatenate deduplicated with factory entries first; `localAliases` precede the derived map.
- [ ] 1.2.3 GREEN WU-1.2 · test-reach-contract › The filename suffix is the collector router · design §2e · CODE ~70 · slice `refound/1-factory-converge` — export `RESERVED_TIER_EXCLUDES`, `SHARED_COVERAGE_EXCLUDE`, `ratchetFloor` (moved from `apps/api/vitest.config.ts`) and the `WorkspaceVitestOptions` (`localAliases`, `coverageInclude`) from `packages/vitest-shared/src/index.ts`; implement the refusals; keep `:1-11`, `:51-60`, `:77-123`, `:146-151` byte-exact.
- [ ] 1.2.4 GREEN WU-1.2 · test-reach-contract › The filename suffix is the collector router · design §2e table · CODE ~110 · slice `refound/1-factory-converge` — migrate the **four** configs that sit outside the factory today to the factory: `apps/api/vitest.config.ts`, `apps/workers/vitest.config.ts` (its hand alias map and its own `findMonorepoRoot` are deleted), `apps/admin/vitest.config.ts` and `apps/client/vitest.config.ts` (each keeping `plugins: [react()]`, `environment: "jsdom"`, its own `setupFiles` entry, its excludes and its `localAliases`); both Playwright configs get `testMatch: "**/*.spec.ts"`; the convention table lands in `docs/development/CODING_STANDARDS.md` §Test Framework Rules.
- [ ] 1.2.5 **Red proof** WU-1.2 · test-reach-contract › The filename suffix is the collector router · CODE ~0 · slice `refound/1-factory-converge` — plant `apps/api/tests/unit/x.integration.test.ts` with a vitest test → `vitest list` does not list it; a config that passes `test.reporters` fails at load naming the rule; `apps/admin` with `coverageInclude` omitted fails at load naming the option → restore all three.
- [ ] 1.2.6 Tracker: Gates rows (factory refusals); M5 · CODE ~4 · slice `refound/1-factory-converge`.

### 1.3 · `refound/1-resolution` (PR R2b) — source resolution in node and jsdom (DD-11)

- [ ] 1.3.1 **Measured** WU-1.2b · module-resolution › The unit runner resolves alias-less workspace packages from `src` · design §2e/DD-11 · CODE ~20 · slice `refound/1-resolution` — measure which vitest-collected tests import the 18 alias-less workspace packages bare (they resolve through `exports` to `dist` today).
- [ ] 1.3.2 RED WU-1.2b · module-resolution › The unit runner resolves alias-less workspace packages from `src` · design §DD-11 · CODE ~40 · slice `refound/1-resolution` — the assertion "every workspace package a collected test imports resolves under `src/`", run in **one node config and in `apps/admin`** (jsdom); red-proof: delete an alias or the condition → the import resolves to a nonexistent `dist` and the test fails naming the package, in both environments.
- [ ] 1.3.3 GREEN WU-1.2b · module-resolution › The unit runner resolves alias-less workspace packages from `src` · CODE ~80 · slice `refound/1-resolution` — the factory writes `development` into **both** `resolve.conditions` and `ssr.resolve.conditions` (spelling verified on 4.1.11) and keeps the derived alias map.
- [ ] 1.3.4 Tracker: Gates row (resolution assertion); Decisions log for the `ssr.*` vs `resolve.*` finding · CODE ~4 · slice `refound/1-resolution`.

### 1.4 · `refound/1-double-collection` (PR R3) — remove double collection and subset entrypoints

- [ ] 1.4.1 WU-1.3 · test-reach-contract › Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts · design §6 · CODE ~250 · slice `refound/1-double-collection` — delete `.github/workflows/eval.yml`; delete the `custom-security-tests` job from `.github/workflows/security-testing.yml` (its cases already run as app role with rate limiting, stricter than that job's owner connection); delete the 26 node:test subset scripts plus `test:eval` and `test:ratelimit` from `apps/api/package.json`. EVIDENCE ~300.
- [ ] 1.4.2 Acceptance WU-1.3 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · CODE ~0 · slice `refound/1-double-collection` — no `test:(auth|rbac|security|mfa|ratelimit|eval|plan|category)` reference remains in `.github` or `apps/api/package.json`; the "files with >1 collector" metric goes 10 → 0.
- [ ] 1.4.3 Tracker: M5 second column reaches 0 · CODE ~4 · slice `refound/1-double-collection`.

### 1.5 · `refound/1-timing-in-tests` (PR R4) — timing and ordering move into the tests

- [ ] 1.5.1 WU-1.4 · test-reach-contract › Timing and ordering needs live in the test, not in the runner · design §DD-14 · CODE ~25 · slice `refound/1-timing-in-tests` — `describe(name, { timeout })` at the top of the nine files that need it (hard-delete race and the saga suites 120 s, the customer saga 180 s, publish/analytics/media/schedule.flow 60 s), taking the values from the runner's current per-batch `TIMEOUT`.
- [ ] 1.5.2 WU-1.4 · integration-tier-preconditions › A test that contaminates shared state restores it · CODE ~10 · slice `refound/1-timing-in-tests` — in `apps/api/tests/security.test.ts` add an `after()` to "Advanced Rate Limiting" that waits for `${TEST_API_URL}/health` → 200, bounded by `Retry-After` / `X-RateLimit-Reset` + 5 s (90 s cap), and throws if the window does not reopen.
- [ ] 1.5.3 **Red proof** ×2 WU-1.4 · integration-tier-preconditions › A test that contaminates shared state restores it · CODE ~0 · slice `refound/1-timing-in-tests` — without the `after()` the `production` sequence fails with 429 (proving the ordering coupling was real); with `{ timeout: 120_000 }` a planted `sleep(45_000)` passes under `--test-timeout=30000` and fails without the option → restore.
- [ ] 1.5.4 Tracker: M9 note (the two ordering hacks are retired) · CODE ~4 · slice `refound/1-timing-in-tests`.

### 1.6 · `refound/1-tier-measure` (PR R5a) — measure the tier of the 100 node:test files

- [ ] 1.6.1 **Measured** WU-1.5 · integration-tier-preconditions › Dark suites are admitted by MEASURED tier, never by a guess · plan WU-1.5 · CODE ~0 · slice `refound/1-tier-measure` — run each of the 100 files alone with Postgres/Redis up and API/workers **down**: passes with 0 skips → `.integration`; otherwise → `.live`; also record which pass with the services down (hermetic candidates feeding the ledger and X1). EVIDENCE ~250 (the measured table).
- [ ] 1.6.2 Tracker: the measured tier table; M9 Baseline · CODE ~4 · slice `refound/1-tier-measure`.

### 1.7 · `refound/1-tier-rename` (PR R5b) — commit the measured tiers

- [ ] 1.7.1 WU-1.5 · integration-tier-preconditions › Dark suites are admitted by MEASURED tier, never by a guess · CODE ~110 · slice `refound/1-tier-rename` — `git mv` the 100 files to the tier **1.6.1 measured**; repoint the runner's paths, the constants in `sagaContextInvariants.static.test.ts` and `sagaLiveSuitePrecondition.static.test.ts`, the RLS table in `CLAUDE.md`, and ~28 docs (lychee); re-key `apps/api/tests-typecheck-baseline.json` with `typecheck-tests-ratchet.mjs --write`. EVIDENCE ~9,000 (renames).
- [ ] 1.7.2 Acceptance WU-1.5 · CODE ~0 · slice `refound/1-tier-rename` — Integration Tests green with the same per-batch counts; the typecheck ledger diff is a pure rename (same `TScode` multiset per path); the old #30 baseline still reads 20.
- [ ] 1.7.3 Tracker: M1/M9 rows · CODE ~4 · slice `refound/1-tier-rename`.

### 1.8 · `refound/1-runner-envfix` (PR R6) — **A1 only**: the runner stops guessing a database

- [ ] 1.8.1 RED WU-1.6 · test-reach-contract › The integration collector is a collector only, and refuses to guess a database · design §2d/A1 · CODE ~20 · slice `refound/1-runner-envfix` — **threat matrix — destructive database target**: `TIER=pr-integration` with an empty `DATABASE_URL` must exit 2 naming `scripts/test-env.sh integration` **before any file runs**.
- [ ] 1.8.2 GREEN WU-1.6 · test-reach-contract › The integration collector is a collector only, and refuses to guess a database · CODE ~110 · slice `refound/1-runner-envfix` — delete the `.env` sourcing from `apps/api/scripts/run-tests.sh` (it could send integration at the dev database) and replace it with that refusal; delete the vitest phase and `run_vitest_phase`, and the vitest cases of `runTestsGate.static.test.ts`; `apps/api/package.json` `test:all` = `pnpm test && pnpm test:integration`. **`full-integration` is still accepted here** — its refusal lands with the recipe in 1.11 (design §7.3, so Integration Tests is never red in between).
- [ ] 1.8.3 **Red proof** WU-1.6 · CODE ~0 · slice `refound/1-runner-envfix` — run the complete step with an empty `DATABASE_URL` and `TIER=pr-integration` → exit 2, nothing ran → restore byte-exact.
- [ ] 1.8.4 Tracker: Gates row (A1 data-loss refusal); M7 · CODE ~4 · slice `refound/1-runner-envfix`.

### 1.9 · `refound/1-services-collector` (PR R7) — collect the services tier by convention

- [ ] 1.9.1 RED WU-1.7 · test-reach-contract › One execution unit per file, and the services tier runs serially · design §2d · CODE ~60 · slice `refound/1-services-collector` — rewrite `runTestsGate.behavior.test.ts` so the stub `node` receives ONE file per call ("batches printed failed" → "units"), plus the four guard REDs: (a) an empty `*.integration.test.ts` → exit 1 on zero collected; (b) a throwing `before` → exit 1 on cancel; (c) `t.skip()` under `TIER` → exit 1; (d) an orphan `tests/integration/orphan.test.ts` without a suffix → over the interim #30 baseline → exit 1.
- [ ] 1.9.2 GREEN WU-1.7 · test-reach-contract › One execution unit per file, and the services tier runs serially · CODE ~200 · slice `refound/1-services-collector` — `collect <integration|live>` (`find … -name "*.<suffix>.test.ts" -not -path 'tests/unit/*' | LC_ALL=C sort`, reversible with `TEST_ORDER=reverse`); `run_batch` → `run_file` keeping `:63-157` byte-exact (one path argument, `CONCURRENCY` literal 1, the runner-exit capture, the four per-unit guards, the `not ok` printer) and the gate block `:476-508` byte-exact; `--list` printing `integration\t<path>` / `live\t<path>` / `quarantined\t<path>`; delete the DB batch inventory.
- [ ] 1.9.3 WU-1.7 · test-reach-contract › Quarantine is temporary and only shrinks · design §DD-1 · CODE ~30 · slice `refound/1-services-collector` — `packages/test-contracts/quarantine.json` as a bare sorted array `[{path, reason, owner, since}]` read with `jq`; each entry printed `QUARANTINED (not run): <path> — <reason>` and excluded; seed it with every dark DB suite that fails in CI as app role, each with a reason and an owning WU.
- [ ] 1.9.4 WU-1.7 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · CODE ~30 · slice `refound/1-services-collector` — **interim #30**: the fitness step and `CLAUDE.md` move from `grep -qF "$path" run-tests.sh` to membership in `run-tests.sh --list | cut -f2`; the baseline falls from 20 to the **measured** dark-live + quarantine count (never a predicted number).
- [ ] 1.9.5 Acceptance WU-1.7 · CODE ~0 · slice `refound/1-services-collector` — CI green; tests ≥ baseline + the dark DB suites; 0 skips; the job stays ≤ 15 min; per-file overhead ≤ 60 s over the base run.
- [ ] 1.9.6 **Red proof** ×4 WU-1.7 · CODE ~0 · slice `refound/1-services-collector` — run each of 1.9.1's four cases through the **complete step**, restoring byte-exact after each.
- [ ] 1.9.7 Tracker: M5, M9, and the new interim #30 baseline; Gates rows · CODE ~4 · slice `refound/1-services-collector`.

### 1.10 · `refound/4b-db` (PR E2) — one database identity, and a destructive target refused

- [ ] 1.10.1 RED **threat matrix — destructive database target** WU-4b.2 · test-environment-contract › One Postgres identity, and any database name but the test database is refused · design §2c/DD-23 · CODE ~50 · slice `refound/4b-db` — bats REDs: exporting `MIGRATE_DATABASE_URL=postgresql://…/omnipostdb` in the caller's shell → `db` exits 3 naming the key and `omnipostdb`, nothing migrated; `postgres:16-alpine` → exit 3 naming `vector`; `ALTER ROLE omnipost_app NOLOGIN` after migrate → exit 3 naming the role.
- [ ] 1.10.2 RED WU-4b.2 · test-environment-contract › Migration state is verified, and a contaminated database is named rather than used · CODE ~20 · slice `refound/4b-db` — a row in `_prisma_migrations` with no directory under `infra/prisma/migrations` → exit 8 "reset required", no migration applied.
- [ ] 1.10.3 GREEN WU-4b.2 · test-environment-contract › One Postgres identity, and any database name but the test database is refused · design §2c · CODE ~200 · slice `refound/4b-db` — `test-env.sh db [--reset]`: preflight (owner and app role reach and authenticate; `server_version_num` major 16; `vector` in `pg_available_extensions`; `current_database()` on both connections — stated as structurally unfalsifiable; the DD-23 caller-environment conflict → exit 3), contamination check → exit 8, `--reset` explicit and never implied, then `prisma migrate deploy` as owner, `scripts/db/enable-app-role-login.sh`, seed, `seed:e2e`; every workflow's `services.postgres` collapses onto the single identity.
- [ ] 1.10.4 Acceptance WU-4b.2 · CODE ~0 · slice `refound/4b-db` — every job that touches Postgres goes through one command; "Postgres identities in workflows" 4 → 1.
- [ ] 1.10.5 Tracker: M15 second column reaches 1; Gates rows for the four refusals · CODE ~4 · slice `refound/4b-db`.

### 1.11 · `refound/4b-processes` (PR E3a) — `up | serve | down | liveness | logs | run`

- [ ] 1.11.1 RED **threat matrix — subprocess lifecycle** WU-4b.3 · test-environment-contract › Readiness is probed, and liveness is a verdict · design §2c/§5 · CODE ~70 · slice `refound/4b-processes` — the seven bats REDs: `run` with a command exiting 3 → exit 3 and no listener on 3010 afterwards; SIGINT during `run` → processes gone and the PID dir empty; port 3010 pre-bound → exit 4 naming the bound port and the whole test port set, nothing started; `down` twice → exit 0 both times; a PID file rewritten to a foreign PID → `down` refuses, names "stale", exits 0, the foreign process survives; a broken API env → exit 6 in < 90 s; workers killed mid-run → `liveness` exit 7.
- [ ] 1.11.2 GREEN WU-4b.3 · test-environment-contract › Readiness is probed, and liveness is a verdict · design §2c · CODE ~200 · slice `refound/4b-processes` — `up <api|workers|sidecar>` (background, PID **and** pgid + launch cmdline in `$TEST_ENV_RUN_DIR`, readiness loops copied from the workflow verbatim: API 90 s on the health route, workers 120 s on the readiness route, sidecar 10 s on its calls route); `serve <proc>` (`exec` in foreground, same env; `client|admin` = `next start -p 3210|3110` refused without `.next/BUILD_ID`); `down` (kill the group, ≤ 10 s, then SIGKILL; idempotent; never a stale PID); `liveness`; `logs`; `run [--with a,b] [--before-up "<cmd>"] -- <cmd>` under ONE trap; exit-code vocabulary 2–8 (DD-10).
- [ ] 1.11.3 GREEN WU-4b.3 · test-environment-contract › Test queues and test ports cannot collide with a running development stack · CODE ~20 · slice `refound/4b-processes` — `ENABLE_RATE_LIMITING=true` is exported only into the API child that `up|serve api` starts, never written to `.env.test` (whose both profiles carry `false`); `apps/api/tests/testUtils.ts` reads `TEST_API_URL` and **throws** when it is missing (the `localhost:3000` default is deleted).
  - [ ] 1.11.3a RED WU-4b.3 · test-environment-contract › Readiness is probed, and liveness is a verdict · design §4 · CODE ~10 · slice `refound/4b-processes` — written and observed failing BEFORE 1.11.3's change: a vitest case that, with `TEST_API_URL` unset, imports `apps/api/tests/testUtils.ts` and reads its base URL, expecting an error naming `TEST_API_URL`. Today the module resolves `process.env.BASE_URL || "http://localhost:3000"` and throws nothing, so the case fails; 1.11.3 turns it green, which proves the `localhost:3000` default is gone.
- [ ] 1.11.4 **Red proof** ×7 WU-4b.3 · CODE ~0 · slice `refound/4b-processes` — run 1.11.1's seven cases through the complete step; restore byte-exact.
- [ ] 1.11.5 Tracker: Gates rows (7 subprocess REDs); M7 · CODE ~4 · slice `refound/4b-processes`.

### 1.12 · `refound/4b-integration-recipe` (PR E3b) — the phased recipe, in one slice (DD-19)

- [ ] 1.12.1 RED WU-4b.3 + E3 · integration-tier-preconditions › A shared-subject race is closed by topology, not by a sentinel · design §DD-19 · CODE ~40 · slice `refound/4b-integration-recipe` — bats REDs: `run --before-up "exit 3"` → exit 3, nothing started, `down` still ran; port 3010 bound before the DB-only phase → exit 4; the recipe's phase order (before-up carries `TIER=pr-integration`, after-up `TIER=live-integration`).
- [ ] 1.12.2 GREEN WU-4b.3 + E3 · test-environment-contract › One script owns the environment, and it starts no datastore · design §2c/DD-19 · CODE ~100 · slice `refound/4b-integration-recipe` — `run` gains `--before-up "<cmd>"` (after `db`, before `up`, with the API port asserted unbound); the named recipe `test-env.sh integration` = `run --with api,workers --before-up "TIER=pr-integration pnpm --filter @apps/api test:integration" -- TIER=live-integration pnpm --filter @apps/api test:integration`, exporting `TEST_ORDER` into both phases.
- [ ] 1.12.3 GREEN WU-4b.3 + E3 · test-reach-contract › The integration collector is a collector only, and refuses to guess a database · design §2d · CODE ~60 · slice `refound/4b-integration-recipe` — **in this same slice** (design §7.3): `run-tests.sh` gains the `live-integration` TIER case, refuses `full-integration` with exit 2 naming the recipe, and the Integration Tests job in `ci.yml` switches to `bash scripts/test-env.sh integration`; `runTestsGate.behavior.test.ts` gains the `full-integration` → exit 2 case.
- [ ] 1.12.4 **Red proof** ×4 WU-4b.3 · CODE ~0 · slice `refound/4b-integration-recipe` — 1.12.1's three cases plus `TIER=full-integration` → exit 2 naming the recipe; complete step; byte-exact restore.
- [ ] 1.12.5 Tracker: Gates rows; M9 · CODE ~4 · slice `refound/4b-integration-recipe`.

### 1.13 · `refound/1-live-collector` (PR R8) — the live tier onto the convention

- [ ] 1.13.1 RED WU-1.8 · test-reach-contract › One execution unit per file, and the services tier runs serially · design §2d · CODE ~40 · slice `refound/1-live-collector` — REDs: removing 1.5.2's `after()` makes `probe_live` fail before the next live file naming `security.live.test.ts` → exit 1; killing the workers mid-run → exit 1 naming the file.
- [ ] 1.13.2 GREEN WU-1.8 · test-reach-contract › One execution unit per file, and the services tier runs serially · CODE ~200 · slice `refound/1-live-collector` — loop over `collect live`; `probe_live` before EACH live file (`curl -fsS "$TEST_API_URL/health"` and `"$TEST_WORKERS_READY_URL"`), printing `env-unready-before: <file> (last ran: <previous>)` and stopping the tier; delete the live batch inventory including `assert_publish_consumers` and `wait_for_api`; `bash run-tests.sh <path>…` path filters replacing the deleted subset scripts; rewrite `sagaLiveSuitePrecondition.static.test.ts` and `sagaContextInvariants.static.test.ts` to state the new invariants; quarantine the dark live suites that fail, with owners.
- [ ] 1.13.3 Acceptance WU-1.8 · CODE ~0 · slice `refound/1-live-collector` — CI green including the dark live suites that pass; 0 skips; ≤ 15 min; one green `TEST_ORDER=reverse` run recorded in the PR.
- [ ] 1.13.4 **Red proof** ×2 WU-1.8 · CODE ~0 · slice `refound/1-live-collector` — the two cases above through the complete step; restore.
- [ ] 1.13.5 Tracker: M5, M9; Gates rows · CODE ~4 · slice `refound/1-live-collector`.

### 1.14 · `refound/1-reach-engine` (PR R9a) — the engine

- [ ] 1.14.1 GREEN WU-1.9 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · design §2a/DD-21 · CODE ~230 · slice `refound/1-reach-engine` — `packages/test-contracts` (private, source-only, no build script): `src/cli.ts` (`reach|scopes|skips|floors|identity|verdict|denominator`, exit 0/1, `--json`), `src/lib/collectorOf.ts` (the one router), `src/lib/disk.ts` (`git ls-files` + test-shaped filter, fail-closed < 800), `src/lib/vitest-collector.ts` (`createVitest` + `globTestSpecifications()`, fallback `vitest list --filesOnly --json`, fail-closed < 80 configs), `src/lib/node-collector.ts` (`run-tests.sh --list`), `src/lib/playwright-collector.ts`, `src/lib/k6-collector.ts`, `src/lib/registry.ts` (`collectors.json`, `executedBy: []` legal — the collector has no job yet, DD-21), `src/reach.ts` (R1–R3 + parts B and C + the serial-tier invariant + the phase-order check); `pnpm-workspace.yaml` gains `packages/test-utils/*`.
- [ ] 1.14.2 WU-1.9 · test-reach-contract › The reach gate fails closed · design §2a · CODE ~30 · slice `refound/1-reach-engine` — every fail-closed condition: disk < 800, configs < 80, a collector returning 0, a config that does not resolve, a non-empty `executedBy` naming a missing job/workflow, a missing ruleset or one with 0 contexts, an unreadable base quarantine, a phased entry whose recipe cannot be found.
- [ ] 1.14.3 **Measured** WU-1.9 · test-reach-contract › The tier collector reads structured runner EVENTS, not formatted text · design §9 risk 2 · CODE ~20 · slice `refound/1-reach-engine` — verify the Playwright `--list --reporter=json` combined schema against the installed 1.63; if it is not as documented, keep the text `--list` parser with a fail-closed count (record which).
- [ ] 1.14.4 Tracker: Decisions log (Playwright list schema); Gates rows staged · CODE ~4 · slice `refound/1-reach-engine`.

### 1.15 · `refound/1-reach-selftests` (PR R9b) — one planted violation per rule

- [ ] 1.15.1 RED WU-1.9 · test-reach-contract › The reach gate fails closed · design §8 · CODE ~150 · slice `refound/1-reach-selftests` — vitest self-tests over fixture trees under `packages/test-contracts/tests/fixtures/<case>/` with an injected `listFiles()` and injected collector outputs; one test per rule plants its violation and asserts exit ≠ 0 **naming it**: R1 unreached / collected twice; R2 missing job / phase order swapped; R3 quarantine growth / dead entry / collected by an executed collector; part B / part C (including a package config that sets `reporters` in the outer `defineConfig` argument); DD-21 `executedBy: []` with an unquarantined file → exit 1.
- [ ] 1.15.2 RED **threat matrix — documentation-like / executable classification** WU-1.9 · test-reach-contract › The filename suffix is the collector router · design §5 · CODE ~30 · slice `refound/1-reach-selftests` — a fixture tree with all six names: `.test.ts.disabled`, `.old`, `.k6.js` are test-shaped; `.env.test.example`, `*.spec.md`, `README.sh` are not; `*.fixture.ts` / `*.test-helpers.ts` route to `none`; a planted `x.spec.md` is ignored and a planted `y.test.ts.old` is "unreached".
- [ ] 1.15.3 RED **threat matrix — git repository selection** WU-1.9 · test-reach-contract › The reach gate fails closed · design §5 · CODE ~15 · slice `refound/1-reach-selftests` — `reach` from a nested cwd returns the same disk set (every git call runs from the toplevel, never `git -C <user path>`).
- [ ] 1.15.4 Acceptance WU-1.9 · CODE ~0 · slice `refound/1-reach-selftests` — self-tests green in Package Tests; one hand run over the real tree prints the unreached set = the quarantine seed (evidence in the PR).
- [ ] 1.15.5 Tracker: M5; Gates rows for every self-test red · CODE ~4 · slice `refound/1-reach-selftests`.

### 1.16 · `refound/1-test-contracts-job` (PR R10) — wire the new #30, retire the grep ratchet

- [ ] 1.16.1 WU-1.10 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · design §2a · CODE ~60 · slice `refound/1-test-contracts-job` — the `test-contracts` job "Test Contracts" in `.github/workflows/fitness.yml` (checkout `fetch-depth: 0`, node+pnpm cache, hermetic `DATABASE_URL` for Prisma's postinstall) with the `if: always()` step running the reach CLI; delete the old grep step; rewrite `CLAUDE.md` #30 as a script-backed check (description, invocation, limits) and stop stating a baseline there.
- [ ] 1.16.2 WU-1.10 · merge-verdict-composition › The required-context list is versioned in the repository, with an up-to-date-branch policy · design §DD-12 · CODE ~30 · slice `refound/1-test-contracts-job` — commit `.github/rulesets/main.json` as a **mirror** of today's classic required checks with `strict: false`, so R2 has a source before the switch; **[hand checklist]** the PR body states the mirror-vs-classic comparison, because no machine can verify it before PR V11.
- [ ] 1.16.3 **Measured** WU-1.10 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · design §2h · CODE ~10 · slice `refound/1-test-contracts-job` — read `GET /repos/{o}/{r}/commits/{sha}/check-runs` and record `app.id` per context; write the measured id per context into the ruleset (15368 only where measured; a context emitted by another app gets that app's id).
- [ ] 1.16.4 WU-1.10 · test-reach-contract › Quarantine is temporary and only shrinks · design §2a/DD-21 · CODE ~20 · slice `refound/1-test-contracts-job` — seed the full quarantine with an owner per entry: the 9 Playwright specs (owner WU-6.E8), the 7 `security/tests` (6.S2), `postgres-stress.test.ts` (6.P2), the 2 admin fetch scripts, the `_template` sandbox, `.disabled`, `.old`, the 6 `*.k6.js` (6.K4) and the 2 dark failures; set `playwright:client`, `playwright:admin` and `k6` to `executedBy: []`.
- [ ] 1.16.5 **Red proof** ×5 WU-1.10 · CODE ~0 · slice `refound/1-test-contracts-job` — through the complete step: (1) an orphan file → "unreached"; (2) a second config including a file → "collected twice"; (3) a collected file added to quarantine → exit 1; (4) a quarantined file deleted without removing its entry → exit 1; (5) `collectors.json` pointing at a nonexistent job → exit 1; plus swapping the two `TIER=` lines in the recipe → "phase order" exit 1. Restore each with `sha256sum`.
- [ ] 1.16.6 Acceptance WU-1.10 · CODE ~0 · slice `refound/1-test-contracts-job` — Test Contracts green in ≤ 6 min; "test-shaped files unreached outside quarantine" = 0; `CLAUDE.md` §Extending the suite step 2 now admits script-backed checks (workflow and doc call the same command).
- [ ] 1.16.7 Tracker: M5 reaches 0 · 0; Gates rows (#30 new form); M7 · CODE ~4 · slice `refound/1-test-contracts-job`.

### 1.17 · `refound/1-script-contract` (PR R11) — part C and #31 A widened

- [ ] 1.17.1 RED WU-1.11 · test-reach-contract › Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts · CODE ~15 · slice `refound/1-script-contract` — part C REDs: reverting `apps/client/package.json`'s `test` to bare `"vitest"` → exit 1; a planted `--passWithNoTests` in a `ci.yml` step → #31 exit 1.
- [ ] 1.17.2 GREEN WU-1.11 · test-reach-contract › Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts · CODE ~40 · slice `refound/1-script-contract` — part C in the engine (every package with a vitest config has `scripts.test === "vitest run"`, and no package config sets a factory-owned key in **either** `mergeConfig` argument); fix `apps/client`'s watch-mode `test` script and the CI call that relied on it; delete the watch justification comment; widen #31 A's scope to `git ls-files '*.json' '*.ts' '*.mts' '*.yml'` repo-wide.
- [ ] 1.17.3 **Red proof** ×3 WU-1.11 · CODE ~0 · slice `refound/1-script-contract` — 1.17.1's two cases plus `script -qc "pnpm --filter @apps/client test"` with a 60 s timeout: it does not terminate before, it does after → restore.
- [ ] 1.17.4 Tracker: Gates rows (#31 A widened, part C) · CODE ~4 · slice `refound/1-script-contract`.

### 1.18 · `refound/1-scopes` (PR R12) — #36 over resolved configs, in all 86

- [ ] 1.18.1 RED WU-1.12 · test-reach-contract › Every positive include glob matches at least one file, in every scope · CODE ~30 · slice `refound/1-scopes` — REDs: pointing one package's `test.include` at `"testz/**/*.test.ts"` → exit 1; breaking one config's syntax → exit 1 (fail closed, never a silent zero).
- [ ] 1.18.2 GREEN WU-1.12 · test-reach-contract › Every positive include glob matches at least one file, in every scope · design §2a · CODE ~120 · slice `refound/1-scopes` — `packages/test-contracts/src/scopes.ts` resolving every config and asserting each positive `test.include` glob matches ≥ 1 file (`coverage.include` joins at C1/5.1; Playwright projects ≥ 1 test once E2E is rebuilt); move the #36 step into Test Contracts; rewrite the `CLAUDE.md` block keeping its fail-closed wording.
- [ ] 1.18.3 **Red proof** ×2 WU-1.12 · CODE ~0 · slice `refound/1-scopes` — the two cases through the complete step; restore.
- [ ] 1.18.4 Tracker: Gates row (#36 new home) · CODE ~4 · slice `refound/1-scopes`.

### 1.19 · `refound/1-node-reporter` (PR R16) — structured runner events (DD-7)

- [ ] 1.19.1 RED WU-1.16 · test-reach-contract › The tier collector reads structured runner EVENTS, not formatted text · design §DD-7 · CODE ~50 · slice `refound/1-node-reporter` — unit test feeding synthetic `TestsStream` events including a `test:summary`: pass/fail/cancelled/skipped/todo each counted; a `test:fail` with `failureType === "cancelledByParent"` → `cancelled=1` in the machine line; a `test:summary` whose `counts` disagree with the per-event tallies → the mismatch is printed and the larger failure count wins; failure detail is printed.
- [ ] 1.19.2 GREEN WU-1.16 · test-reach-contract › The tier collector reads structured runner EVENTS, not formatted text · design §DD-7 · CODE ~120 · slice `refound/1-node-reporter` — `scripts/testing/node-summary-reporter.mjs` over the documented `TestsStream` events, printing every failure with its detail and one anchored `@@SUMMARY tests=N pass=N fail=N cancelled=N skipped=N todo=N`; `run-tests.sh` switches to `--test-reporter=<repo>/scripts/testing/node-summary-reporter.mjs --test-reporter-destination=stdout`, parses only that line, keeps `--conditions development` on the command (module-resolution › Source-mode invocations opt in via `--conditions development` on the command) and keeps the four guards; update the #31 B pins in the same PR. **Node 24.15.0 ships no `json` test reporter** — research §Errata; a built-in reporter is not an option.
- [ ] 1.19.3 **Red proof** ×4 WU-1.16 · testing-canon-and-tracker › Every new or modified gate is recorded with its demonstrated red · CODE ~0 · slice `refound/1-node-reporter` — re-demonstrate each of the four guards (fail / cancel / skip / zero-collect) against the new reporter through the complete step; restore.
- [ ] 1.19.4 Tracker: M2, M9; Gates rows (four guards re-proven) · CODE ~4 · slice `refound/1-node-reporter`.

---

## Phase 2 — Demolition (design §7.4). **No deletion task may precede gate H3 (task 2.2.2), and the slices that depend on slice 2.3 (2.4 and 2.7–2.15) also wait for gate H8 (task 2.3.1): their deletions can descend a coverage floor, and slice 2.3 adds the marker that admits the descent.**

### 2.1 · `refound/2-lint-rules` — the durable form (WU-2.4 + WU-8.1a land together)

- [ ] 2.1.1 RED WU-2.4 · decorative-test-demolition › The durable form is a lint rule pinned at `error`, with suppressions as a shrinking baseline · design §2b · CODE ~40 · slice `refound/2-lint-rules` — `RuleTester` valid/invalid per rule per framework for `testing/no-empty-test`, `testing/no-tautological-assertion`, `testing/no-existence-only-test`; plus the suppression test: a stale suppression makes a plain `eslint` run exit 2 and `eslint --prune-suppressions` removes it.
- [ ] 2.1.2 **Measured** WU-2.4 · decorative-test-demolition › The classifier is a tested workspace package, calibrated on both frameworks · design §2b · CODE ~10 · slice `refound/2-lint-rules` — only classes calibrated ≥ 90 % GREEN by the probe become rules; TITLE-CONTRADICTION stays ledger-only. Record the per-class calibration rate.
- [ ] 2.1.3 **Measured** WU-2.4 · msw-single-http-double › A hand-written HTTP stub is a lint error, and the baseline reaches zero · design §9 risk 5 · CODE ~5 · slice `refound/2-lint-rules` — verify the `assertFunctionNames` member wildcard (`assert.*`) matches on ONE file before enabling it repo-wide; fall back to explicit `assert.<name>` forms if it does not.
- [ ] 2.1.4 GREEN WU-2.4 · decorative-test-demolition › The durable form is a lint rule pinned at `error`, with suppressions as a shrinking baseline · CODE ~120 · slice `refound/2-lint-rules` — the new blocks in `eslint.config.ts`: the three `testing/*` rules on both frameworks; the `vitest/*` set (`expect-expect` with `assertFunctionNames: ["expect","expect*","assert","assert.*","expectTypeOf"]`, `no-conditional-expect`, `valid-expect`, `no-standalone-expect`, `no-identical-title`, `no-commented-out-tests`, `no-disabled-tests`, `no-focused-tests`) applied **only** to files `collectorOf` routes to `vitest:*`, never to node:test files; `no-console: error` on every test glob; generate `eslint-suppressions.json` with `eslint --suppress-rule`.
- [ ] 2.1.5 GREEN WU-2.4 · merge-verdict-composition › A script entrypoint cannot swallow its own failure (#46) · design §2b · CODE ~20 · slice `refound/2-lint-rules` — the fitness pin (#48, in #31 B's form) that a `testing/*` or `vitest/*` rule sitting at `warn` instead of `error` exits 1.
- [ ] 2.1.6 WU-8.1a · testing-canon-and-tracker › The coding standard states the framework per BOUNDARY, the both-directions rule, and the criterion · design §7.4 · CODE ~120 · slice `refound/2-lint-rules` — `docs/development/CODING_STANDARDS.md` §Testing part 1: replace "Three frameworks" and its 4-row table with the **framework-per-boundary** table (pure logic → vitest unit · in-process HTTP route → vitest + `inject` · persistence/SQL/RLS/transactions → the services tier · process topology → the live tier · component/hook → vitest + RTL + MSW · outbound HTTP → vitest + MSW handlers · cross-process journey → Playwright · latency under load → k6 · test quality → mutation); add the both-directions rule and criteria (a)–(d) with the hard probe; state Jest is not a framework of this repo; replace the literal `makePost` example with `aPost()` from `@test-utils/domain`. **The runner column for the services tier stays "node:test (or vitest per X2)" until gate H7 resolves.** **The table it replaces has had a fifth row since #443 (2026-10-06, ADR-0035), and the new table carries it:** component stories (`packages/ui`, client and admin components) → `vitest` browser mode through `@storybook/addon-vitest` with Playwright Chromium, `Meta`/`StoryObj` from `@storybook/react` (packages) or `@storybook/nextjs-vite` (apps) and `storybook/test` for `play`; the paragraph under the table (the story row adds no fourth framework) and the pass criterion that follows it (no page error, nothing on `console.error` or `console.warn`, its `play` passing, zero axe violations at `error` over the WCAG 2.1 A/AA tags) stay, so the rewrite does not drop the story requirement.
- [ ] 2.1.7 **Red proof** ×3 WU-2.4 · CODE ~0 · slice `refound/2-lint-rules` — plant an existence-only block in a vitest file and in a node:test file → lint exit 1; delete a suppressed block without pruning → a plain run exits 2; set one rule to `warn` → #48 exit 1; `cmp`-restore each.
- [ ] 2.1.8 Tracker: M3 Baseline (suppressions per rule), M13; Gates rows · CODE ~4 · slice `refound/2-lint-rules`.

### 2.2 · `refound/2-ledger-listing` — list before deleting · **[HUMAN GATE H3]**

- [ ] 2.2.1 WU-2.5 · decorative-test-demolition › Nothing is deleted without a listed ledger row and human approval · design §2b · CODE 0 · slice `refound/2-ledger-listing` — commit `docs/development/testing-refoundation/{ledger.json,LEDGER.md,probes.json,adjudications.json}`, the overlay seeded with every ADJUDICATE row. EVIDENCE ~4,000.
- [ ] 2.2.2 **[HUMAN GATE H3]** WU-2.5 · decorative-test-demolition › Nothing is deleted without a listed ledger row and human approval · CODE 0 · slice `refound/2-ledger-listing` — Edward approves the unambiguous DELETE set **in one pass**; ADJUDICATE rows are approved slice by slice. STOP and wait. No task in 2.3–2.14 may start before this is recorded in `adjudications.json` with `status: "confirmed"`, reviewer and date.
- [ ] 2.2.3 Tracker: M6 (machine / confirmed / total) · CODE ~4 · slice `refound/2-ledger-listing`.

### 2.3 · `refound/2-coverage-exception` (WU-2.0) — **[HUMAN GATE H8: needs a `sensitive-edit` token]**

- [ ] 2.3.1 **[HUMAN GATE H8]** WU-2.0 · decorative-test-demolition › The coverage descent demolition causes is admitted only through a named canon exception · CODE ~0 · slice `refound/2-coverage-exception` — `CLAUDE.md` §Pragmatic Exceptions is a tripwire path: obtain the `sensitive-edit` token (audited in `.claude/heuristic-overrides.log`) before editing. STOP if it is not granted.
- [ ] 2.3.2 GREEN WU-2.0 · decorative-test-demolition › The coverage descent demolition causes is admitted only through a named canon exception · design §2i/DD-15 · CODE ~40 · slice `refound/2-coverage-exception` — add the `decorative-demolition` scenario to `CLAUDE.md` §Pragmatic Exceptions (marker `canon-exception: decorative-demolition:<ledger-slice>` in a line comment), add it to #37's scenario set, and write `docs/technical/ADR-0025-decorative-demolition-coverage-exception.md`.
- [ ] 2.3.3 **Red proof** WU-2.0 · CODE ~0 · slice `refound/2-coverage-exception` — lower a floor without the marker → #37 exit ≠ 0; with the marker → exit 0 with the acceptance logged; restore.
- [ ] 2.3.4 Tracker: M14 row (floor descents with marker); Decisions log (ADR-0025) · CODE ~4 · slice `refound/2-coverage-exception`.

### 2.4 · `refound/2-whole-files` (WU-2.6a) — whole decorative files, criteria (a)(b)(d)

- [ ] 2.4.1 WU-2.6a · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~6 · slice `refound/2-whole-files` — delete the six files the approved ledger rows name (`apps/client/tests/components/ListeningCharts.test.tsx`, `apps/api/tests/unit/trendAnalysisService.test.ts` — keeping its `.test-helpers.ts`, 4 importers —, `apps/api/tests/universal-client-dashboard.integration.test.ts`, `packages/providers/_template/tests/integration/sandbox.template.test.ts`, `apps/admin/tests/apiClient.smoke.test.ts`, `apps/admin/tests/posts.flow.test.ts`) and remove the two now-dead excludes in `apps/admin/vitest.config.ts`. EVIDENCE ~1,223.
- [ ] 2.4.2 Acceptance WU-2.6a · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~0 · slice `refound/2-whole-files` — vitest −47 tests exactly as `--area` predicted; orphans −3; `ledger --check` green; `eslint --prune-suppressions` run; lint 0/0, `tsc`, `format:check`.
- [ ] 2.4.3 Tracker: M1, M2, M4, M5 · CODE ~4 · slice `refound/2-whole-files`.

### 2.5 · `refound/2-todo-stubs` (WU-2.6b) — the four `describe.todo` stubs (D3)

- [ ] 2.5.1 WU-2.6b · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~2 · slice `refound/2-todo-stubs` — delete the 4 `describe.todo` stub files; the gap they stood for is already a declared gap and is counted as one. EVIDENCE ~116.
- [ ] 2.5.2 Acceptance WU-2.6b · testing-canon-and-tracker › Declared gaps are counted, never faked · CODE ~0 · slice `refound/2-todo-stubs` — todo 43 → 0 and skipped files 4 → 0, so every later run can assert absolute zeros (the precondition of the skip gate, slice 3.3).
- [ ] 2.5.3 Tracker: M2 (todo → 0), M9; Declared gaps row · CODE ~4 · slice `refound/2-todo-stubs`.

### 2.6 · `refound/2-dead-helpers` (WU-2.7) — dead helpers, runners and files · **[HUMAN GATE H2]**

- [ ] 2.6.1 **[HUMAN GATE H2 / D17]** WU-2.7 · decorative-test-demolition › Nothing is deleted without a listed ledger row and human approval · design §3 D17 · CODE ~0 · slice `refound/2-dead-helpers` — `apps/api/scripts/seed-demo-data.ts` and `apps/api/scripts/seed-large-dataset.ts` are CLI entrypoints: zero importers is normal for them. They are **excluded from this and every other delete slice** until Edward classifies them. State the exclusion in the PR body.
- [ ] 2.6.2 WU-2.7 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~5 · slice `refound/2-dead-helpers` — re-verify 0 importers, then delete `apps/api/tests/setup/*` (they import only each other), `coverage-utils.ts`, `tests/run.ts`, `run-with-coverage.ts`, `analytics-ml-integration.test.ts.disabled`, `threading.flow.test.ts.old`, `unit/helpers/InMemoryBruteForceAdapter.ts` and the four dead `*.test-helpers.ts`. EVIDENCE ~3,000.
- [ ] 2.6.3 Acceptance WU-2.7 · CODE ~0 · slice `refound/2-dead-helpers` — `ledger --check` green; the quarantine loses the `.disabled` and `.old` entries; lint 0/0, `tsc`, `format:check`.
- [ ] 2.6.4 Tracker: M1, M4, M5 · CODE ~4 · slice `refound/2-dead-helpers`.

### 2.7–2.13 · `refound/2-blocks-{1a,1b,2a,2b,3,4,5}` — block deletion by `--area` (WU-2.8.1a…2.8.5)

> Serial inside `apps/api` because each slice can move the api coverage floor; parallel across other packages. Every slice: `ledger --check` green · `eslint --prune-suppressions` · the real drop equals the `--area` prediction · the `decorative-demolition` marker if an api floor descends · lint 0/0, `tsc`, `format:check` · the full vitest run of the touched packages or `run-tests.sh <path>` for node:test.

- [ ] 2.7.1 WU-2.8.1a · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~320 · slice `refound/2-blocks-1a` — delete the approved blocks in `apps/api/tests/unit/rateLimitingDashboard.test.ts` (18) and `logger.test.ts` (11); empty `describe`s go with them; a file left empty is deleted whole.
- [ ] 2.7.2 Acceptance + Tracker (M2, M3, M14) · CODE ~4 · slice `refound/2-blocks-1a` — real drop = prediction; suppressions of the touched files at 0.
- [ ] 2.8.1 WU-2.8.1b · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~350 · slice `refound/2-blocks-1b` — `auditMiddleware` (10, incl. the calibration case), `webhookHandler.stats` (9, incl. the two `>= 0` tautologies), `healthMetrics` (8 blocks + 9 tautologies).
- [ ] 2.8.2 Acceptance + Tracker (M2, M3, M14) · CODE ~4 · slice `refound/2-blocks-1b`.
- [ ] 2.9.1 WU-2.8.2a · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~350 · slice `refound/2-blocks-2a` — the flat root of `apps/api/tests/unit`, alphabetical chunk 1 of 2 (196 files total), including `providerConstraintValidator`'s two tautologies.
- [ ] 2.9.2 Acceptance + Tracker (M2, M3, M14) · CODE ~4 · slice `refound/2-blocks-2a`.
- [ ] 2.10.1 WU-2.8.2b · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~350 · slice `refound/2-blocks-2b` — alphabetical chunk 2 of 2.
- [ ] 2.10.2 Acceptance + Tracker (M2, M3, M14) · CODE ~4 · slice `refound/2-blocks-2b`.
- [ ] 2.11.1 WU-2.8.3 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~350 · slice `refound/2-blocks-3` — `apps/api/tests/unit/{application,infrastructure,domain}`.
- [ ] 2.11.2 Acceptance + Tracker (M2, M3, M14) · CODE ~4 · slice `refound/2-blocks-3`.
- [ ] 2.12.1 WU-2.8.4 + WU-2.9 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~350 · slice `refound/2-blocks-4` — `apps/api/tests/unit/{security,ai,webhooks,saga,auth,admin,…}` including `enhancedValidator.mutations-request`'s 4 tautologies; **and WU-2.9**: `git mv apps/api/tests/unit/settingsRoutes.test.ts settingsSchemas.test.ts` + header, with "settings route contract untested" entered as a declared gap owned by Phase 9.
- [ ] 2.12.2 Acceptance + Tracker (M2, M3, M14, Declared gaps) · CODE ~4 · slice `refound/2-blocks-4`.
- [ ] 2.13.1 WU-2.8.5 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~300 · slice `refound/2-blocks-5` — the node:test tier (`syncEngine.monitoring` 5, `threading.canonical` 1, `security-endpoints` 1, the existence-only lines of `planPublication`); **no file may reach zero tests** — the zero-collect guard would fire, which is the correct behaviour and must not be triggered by a deletion.
- [ ] 2.13.2 Acceptance + Tracker (M2, M3) · CODE ~4 · slice `refound/2-blocks-5` — `bash scripts/test-env.sh integration` green with the same unit count minus the prediction.

### 2.14 · `refound/2-blocks-6` (WU-2.8.6) and 2.15 · `refound/2-blocks-7` (WU-2.8.7)

- [ ] 2.14.1 WU-2.8.6 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~300 · slice `refound/2-blocks-6` — packages (`@adapters/storage-cloudinary` 8 blocks, logger 1, fallback-strategies 1 tautology, the rest per ledger).
- [ ] 2.14.2 Acceptance + Tracker (M2, M3) · CODE ~4 · slice `refound/2-blocks-6`.
- [ ] 2.15.1 WU-2.8.7 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~300 · slice `refound/2-blocks-7` — `apps/client`, `apps/admin`, `apps/workers`.
- [ ] 2.15.2 Acceptance + Tracker (M2, M3) · CODE ~4 · slice `refound/2-blocks-7`.

### 2.16 · `refound/2-rewrites` (WU-2.10) — weak but behavioural: rewritten, never deleted

- [ ] 2.16.1 RED WU-2.10 · decorative-test-demolition › Weak-but-behavioural tests are rewritten, never deleted, and the rewrite is probe-proven · CODE ~60 · slice `refound/2-rewrites` — rewrite `@core/webhooks` (activate `rotateFails` and assert the failure), `@core/compliance` (assert values on both happy paths) and `@core/settings` (assert the exact masked shape); each rewrite's acceptance is **probe RED** with the subject gutted.
- [ ] 2.16.2 Acceptance WU-2.10 · CODE ~0 · slice `refound/2-rewrites` — the orchestrator runs `hard-probe` over the three rewritten blocks (D19: writers never invoke it) and records RED for each in `probes.json`.
- [ ] 2.16.3 Tracker: M6 (REWRITE rows confirmed) · CODE ~4 · slice `refound/2-rewrites`.

---

## Phase 3 — Verdict (design §7.5)

### 3.1 · `refound/3-coverage-certifies` (PR V4)

- [ ] 3.1.1 RED WU-3.4 · merge-verdict-composition › The coverage step runs when the suite is red, and refuses to certify it · design §2h · CODE ~10 · slice `refound/3-coverage-certifies` — a local dry run of the refusal step with `needs.test.result=failure` must exit 1.
- [ ] 3.1.2 GREEN WU-3.4 · merge-verdict-composition › The coverage step runs when the suite is red, and refuses to certify it · CODE ~30 · slice `refound/3-coverage-certifies` — Coverage Merge gains `if: ${{ !cancelled() }}` at job level, a "Count shard blobs" step (exactly 2 `blob-*`, else `::error` + `exit 1`), the merge that renders every failure from the blobs, and a "Refuse to certify a red suite" step (`if: !cancelled()`) that exits 1 unless `needs.test.result == success`; the risen-floor and upload steps stay `always()`.
- [ ] 3.1.3 **Red proof** WU-3.4 · CODE ~0 · slice `refound/3-coverage-certifies` — a draft PR with a planted unit failure: Coverage Merge **runs**, prints the test name, and exits 1 (run URL in the PR) → restore.
- [ ] 3.1.4 Tracker: Gates row; M7 · CODE ~4 · slice `refound/3-coverage-certifies`.

### 3.2 · `refound/3-remove-duplicate-gates` (PR V5) — **[HUMAN GATE H4]**

- [ ] 3.2.1 **[HUMAN GATE H4]** WU-3.5 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · design §2h · CODE ~0 · slice `refound/3-remove-duplicate-gates` — **before this PR merges**, Edward removes "Test and Build" from the classic required checks; otherwise the PR waits forever on a context no job produces. The command goes in the PR body. STOP and wait for confirmation.
- [ ] 3.2.2 GREEN WU-3.5 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · CODE ~140 (net −140) · slice `refound/3-remove-duplicate-gates` — in `.github/workflows/production-ci.yml` delete the duplicate `security-audit` job and the `test-and-build` job (it duplicates Build Check on PRs and `ci.yml` on push) and its `needs:`; rename the workflow to "Container Images".
- [ ] 3.2.3 WU-3.5 · merge-verdict-composition › The required-context list is versioned in the repository, with an up-to-date-branch policy · design §DD-12 · CODE ~5 · slice `refound/3-remove-duplicate-gates` — remove "Test and Build" from the committed **mirror** ruleset in this same PR, and carry the hand mirror-vs-classic comparison in the PR checklist (nothing verifies it by machine before PR V11).
- [ ] 3.2.4 Acceptance WU-3.5 · CODE ~0 · slice `refound/3-remove-duplicate-gates` — the required list no longer names "Test and Build"; "Security Audit" has exactly one emitter.
- [ ] 3.2.5 Tracker: Gates rows; Decisions log (D4) · CODE ~4 · slice `refound/3-remove-duplicate-gates`.

### 3.3 · `refound/3-skip-gate` (PR V8) — a skipped vitest test fails CI

- [ ] 3.3.1 RED WU-3.8 · merge-verdict-composition › A skipped test fails CI · design §2e · CODE ~20 · slice `refound/3-skip-gate` — `it("x", (ctx) => ctx.skip())` in `packages/core/posts` → `CI=true pnpm --filter @core/posts test` exits ≠ 0 naming the test; with `CI` unset the run is green (the gate is CI-only).
- [ ] 3.3.2 GREEN WU-3.8 · merge-verdict-composition › A skipped test fails CI · CODE ~60 · slice `refound/3-skip-gate` — `packages/vitest-shared/src/skipGateReporter.ts` importing only from `vitest/node`: on `CI === "true"` collect every `skipped` / `pending` / `todo` in `onTestRunEnd`, print `file > full name`, fail the run (throw from `onTestRunEnd` if vitest resets `process.exitCode`); append it in `workspaceReporters()`; update the residual #32 wording (runtime skips are gated in every runner; Playwright inherits the same rule at the E2E rebuild).
- [ ] 3.3.3 **Red proof** WU-3.8 · CODE ~0 · slice `refound/3-skip-gate` — 3.3.1 through the complete step; restore.
- [ ] 3.3.4 WU-3.8 · merge-verdict-composition › A skipped test fails CI · CODE ~40 · slice `refound/3-skip-gate` — the same reporter also fails NAMING every collected file that produced no result. Measured 2026-09-30: an intermittent forks-pool child death in the `apps/api` suite (`[vitest-pool]: Worker forks emitted error` → `write EPIPE`) exits 1 but reports `581 passed (582)` / `9048 passed (9050)` without naming the lost file — vitest 4.1.11's `onTaskError` omits `formatFiles(task)` (its sibling start/terminate messages include it) and `stop()` detaches the `exit` listener, so neither the file nor the child's code/signal is recorded. 1 red in 8 candidate runs, 0/5 on main and 0/5 on the candidate under controlled conditions → cause unidentified. In `onTestRunEnd`, compare the collected specifications with the modules that reported and throw listing each missing path; red proof: kill the child mid-file (`process.kill(process.pid, "SIGKILL")` in a planted test) → the run fails naming that file. Also draft the upstream vitest issue (include `formatFiles(task)` in the task-error message).
- [ ] 3.3.5 Tracker: M9, M2 (todo 0 is now enforced, not just achieved); Gates row · CODE ~4 · slice `refound/3-skip-gate`.

### 3.4 · `refound/1-skips-ast` (PR R13) — #32 over the syntax tree (unblocked by Phase 2)

- [ ] 3.4.1 RED WU-1.13 · test-reach-contract › Skips, focus and disabled tests are detected over the syntax tree of every test-shaped file · design §2a · CODE ~40 · slice `refound/1-skips-ast` — plant (a) `test.fixme(` in a spec, (b) `const d = describe.skip;`, (c) `it("x", { skip: true }, …)` → each exit 1; and (d) `{ skip: 2 }` inside a Prisma call → **green** (proves it does not flag Prisma's `skip`).
- [ ] 3.4.2 GREEN WU-1.13 · test-reach-contract › Skips, focus and disabled tests are detected over the syntax tree of every test-shaped file · CODE ~160 · slice `refound/1-skips-ast` — `packages/test-contracts/src/skips.ts` parsing the whole disk set with `ts.createSourceFile` (no type-check): member access `.(skip|only|fixme|todo|skipIf|runIf)` on `it|test|describe|suite|test.describe` called or merely referenced; `skip|only|todo` keys in a second-argument options object; Playwright `test.skip(` / `test.fixme(` anywhere; `.todo` is a skip (D3). Move the #32 step into Test Contracts.
- [ ] 3.4.3 WU-8.9 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~10 · slice `refound/1-skips-ast` — in the same PR, delete the false `CLAUDE.md` claim that `forbidOnly` is set in "5 of 83" configs and the `.todo` exemption.
- [ ] 3.4.4 **Red proof** ×4 WU-1.13 · CODE ~0 · slice `refound/1-skips-ast` — 3.4.1's four cases through the complete step; restore.
- [ ] 3.4.5 Tracker: Gates row (#32 new form); M9 · CODE ~4 · slice `refound/1-skips-ast`.

### 3.5 · `refound/3-verdict-static` (PR V9) — #45 verdict rules V1, V2, V3, V7 and V8

- [ ] 3.5.1 RED WU-3.9 · merge-verdict-composition › No required job can report a skip, swallow an exit, or be filtered away (V2–V5, V7) · design §2h · CODE ~90 · slice `refound/3-verdict-static` — self-tests planting: a second workflow with `name: Security Audit` → verdict rule V1; deleting the Integration Tests job → V1 (0 producers); `if: github.event_name == 'push'` on a required job → V2; removing `!cancelled()` from Coverage Merge → V3; `paths:` on `ci.yml`'s `pull_request` → V7; `include/exclude` in a matrix → fail closed "unsupported matrix".
- [ ] 3.5.2 RED **threat matrix — CI automation that writes to GitHub** WU-3.9 · merge-verdict-composition › Only allowlisted jobs may write to the repository from CI (V8) · design §5 · CODE ~20 · slice `refound/3-verdict-static` — plant `issues: write` on an unlisted job → verdict rule V8 exits 1 naming the job; an allowlisted job triggered on `pull_request` → exit 1.
- [ ] 3.5.3 GREEN WU-3.9 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · CODE ~330 · slice `refound/3-verdict-static` — `packages/test-contracts/src/verdict.ts` parsing every workflow with `yaml` and the committed ruleset: **verdict rule V1** (exactly one producer per required context, matrix expanded), **V2** (no job-level `if:` outside the always-true-on-PR allowlist), **V3** (`needs:` ⇒ `!cancelled()` / `always()` **and** a step referencing `needs.<id>.result` per needed id), **V7** (no `paths` / `paths-ignore` on a workflow producing a required context), **V8** (`writers` allowlist in `collectors.json` — initially `nightly.yml:alarm`; `security-events: write` and `actions: write` are out of scope by name); the #45 block in `CLAUDE.md`.
- [ ] 3.5.4 **Red proof** ×7 WU-3.9 · CODE ~0 · slice `refound/3-verdict-static` — 3.5.1's five plus 3.5.2's two through the complete step; restore each.
- [ ] 3.5.5 Tracker: Gates rows (#45 static, V1/V2/V3/V7/V8); M7 · CODE ~4 · slice `refound/3-verdict-static`.

### 3.6 · `refound/3-ruleset` (PR V11) — the merge gate, versioned · **[HUMAN GATE H5]**

- [ ] 3.6.1 WU-3.11 · merge-verdict-composition › The required-context list is versioned in the repository, with an up-to-date-branch policy · design §2h · CODE ~80 · slice `refound/3-ruleset` — rewrite `.github/rulesets/main.json` with `enforcement: "active"`, `bypass_actors: []`, `deletion`, `non_fast_forward`, `strict_required_status_checks_policy: true` (D5) and the post-rebuild composition **by rendered context name**, each with the `integration_id` measured in task 1.16.3.
- [ ] 3.6.2 WU-3.11 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · CODE ~10 · slice `refound/3-ruleset` — the composition includes the new contexts that exist by now (OpenAPI Drift, Test Contracts) and the promoted ones (Semgrep CE, size-limit, Dependency Consistency, CodeQL as one `javascript-typescript` context, Security Audit with one emitter); E2E and k6 join in their own slices (6E.8, 6K.4); Container Security joins when green.
- [ ] 3.6.3 Acceptance WU-3.11 · CODE ~0 · slice `refound/3-ruleset` — verdict rule V1–V8 green over the committed file; a draft PR with one required check red shows "merging is blocked" (evidence in the PR).
- [ ] 3.6.4 **[HUMAN GATE H5]** WU-3.11 · CODE ~0 · slice `refound/3-ruleset` — Edward runs `gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main.json`, clears the classic required-checks list and enables `allow_update_branch`. Rollback: `gh api -X DELETE …/rulesets/{id}` plus the mirror. The commands go in the PR body. STOP and wait.
- [ ] 3.6.5 Tracker: Gates row; Decisions log (D5, D6, D7); M15 · CODE ~4 · slice `refound/3-ruleset`.

### 3.7 · `refound/3-verdict-drift` (PR V10) — #45 operational rules V4, V5 and drift V6

- [ ] 3.7.1 RED WU-3.10 · merge-verdict-composition › Drift between the committed ruleset and the live gate is detected, and fails closed (V6) · design §2h · CODE ~40 · slice `refound/3-verdict-drift` — REDs: `continue-on-error: true` on a required job's step whose name does not end in "(never gates)" → verdict rule V4 exit 1; a `|| true` on a line invoking a gate tool → V5 exit 1; a fake context in the ruleset → V6 exit 1; an empty rules array → exit 1 ("no active rules — an evaluate-mode ruleset is invisible"); a network failure → 3 retries then "could not measure" exit 1, never a silent green.
- [ ] 3.7.2 GREEN WU-3.10 · merge-verdict-composition › Drift between the committed ruleset and the live gate is detected, and fails closed (V6) · CODE ~150 · slice `refound/3-verdict-drift` — verdict rules V4 and V5, and V6 reading `GET /repos/{o}/{r}/rules/branches/main` (paginated, `GITHUB_TOKEN`) and comparing contexts, `integration_id`, strict, `deletion` and `non_fast_forward` against the committed ruleset; V6 runs on push to main, nightly and dispatch — **never on `pull_request`** (a PR editing the ruleset would be red until an admin applies it).
- [ ] 3.7.3 **Red proof** ×5 WU-3.10 · CODE ~0 · slice `refound/3-verdict-drift` — 3.7.1's five cases through the complete step; restore.
- [ ] 3.7.4 Tracker: Gates rows (V4, V5, V6); M7 · CODE ~4 · slice `refound/3-verdict-drift`.

### 3.8 · `refound/3-osv-decide` (PR V7b) — measured, then decided

- [ ] 3.8.1 WU-3.7(b) · merge-verdict-composition › A required gate either can fail or is removed — measured, then decided · CODE ~40 or −30 · slice `refound/3-osv-decide` — **per P.5.1's measurement** (D8): if ≥ 1 moderate+ finding exists that `pnpm audit` does not see and nobody audited → pin the binary by sha256, add `osv-scanner.toml` `[[IgnoredVulns]]` (id, reason, ignoreUntil) per audited finding, and remove `set +e` and the exit-1 tolerance; otherwise → delete the job and remove it from the required list.
- [ ] 3.8.2 **Red proof** WU-3.7(b) · CODE ~0 · slice `refound/3-osv-decide` — on the keep branch: remove one ignore → exit 1 → restore. On the delete branch: verdict rule V1 proves no required context is left without a producer.
- [ ] 3.8.3 Tracker: Decisions log (D8 with the numbers); Gates row or its removal · CODE ~4 · slice `refound/3-osv-decide`.

---

## Phase 4b — Environment, remaining slices (design §7.6)

### 4b.1 · `refound/4b-adopt-workflows` (PR E4)

- [ ] 4b.1.1 WU-4b.4 · test-environment-contract › One script owns the environment, and it starts no datastore · design §6 · CODE ~150 (net deletions) · slice `refound/4b-adopt-workflows` — repoint `performance.yml`, `security-testing.yml` (ZAP) and `nightly.yml` onto `scripts/test-env.sh`; no workflow boots an application process any other way.
- [ ] 4b.1.2 Acceptance + **Red proof** WU-4b.4 · test-environment-contract › Environment identity is gated, not conventional (#47) · CODE ~0 · slice `refound/4b-adopt-workflows` — `rg "dev:test" .github` = 0; plant an inline `pnpm --filter @apps/api dev:test &` → #47 exit 1 (enforced in 4b.4) → restore.
- [ ] 4b.1.3 Tracker: M15 · CODE ~4 · slice `refound/4b-adopt-workflows`.

### 4b.2 · `refound/4b-loader` (PR E5)

- [ ] 4b.2.1 RED WU-4b.5 · test-environment-contract › The test-environment loader fails closed with an actionable message · design §2e · CODE ~15 · slice `refound/4b-loader` — move `.env.test` away → `pnpm --filter @apps/workers test` exits ≠ 0 with "run `bash scripts/test-env.sh env hermetic`", **not** a Zod error.
- [ ] 4b.2.2 GREEN WU-4b.5 · test-environment-contract › The test-environment loader fails closed with an actionable message · CODE ~50 · slice `refound/4b-loader` — `packages/vitest-shared/src/setup/loadTestEnv.ts` (root via `findMonorepoRoot`, loads `.env.test`, throws with the command when absent, sets `process.env.NODE_ENV ??= "test"`); registered by the factory as the first `setupFiles` entry; delete `apps/api/tests/setup-env.ts` and `apps/workers/tests/setup-env.ts` (whose the hardcoded three-level parent traversal offset is the counting the spec forbids); `apps/workers/package.json` gains the `@packages/vitest-shared` devDependency.
- [ ] 4b.2.3 **Red proof** WU-4b.5 · CODE ~0 · slice `refound/4b-loader` — 4b.2.1 through the complete command; restore.
- [ ] 4b.2.4 Tracker: Gates row · CODE ~4 · slice `refound/4b-loader`.

### 4b.3 · `refound/4b-playwright-servers` (PR E6) — one owner per process (DD-18)

- [ ] 4b.3.1 GREEN WU-4b.6 · test-environment-contract › The browser runner's servers come from the same script · design §DD-18 · CODE ~60 · slice `refound/4b-playwright-servers` — both Playwright configs call `loadTestEnv()` first, read `TEST_CLIENT_URL` / `TEST_ADMIN_URL` for `baseURL` (throwing when unset) and replace their `webServer` with the array `[serve sidecar, serve api, serve workers, serve client|admin]`, every entry `reuseExistingServer: false`, `cwd` = repository root, `timeout` = each process's readiness budget; the `!isCI` branch and the commented-out admin block are deleted.
- [ ] 4b.3.2 **Measured** WU-4b.6 · test-environment-contract › The browser runner's servers come from the same script · design §9 risk 14 · CODE ~10 · slice `refound/4b-playwright-servers` — record Playwright 1.63's observed `webServer` array start semantics (parallel vs sequential) and the total start budget; the four processes are independent either way.
- [ ] 4b.3.3 **Red proof** WU-4b.6 · CODE ~0 · slice `refound/4b-playwright-servers` — `playwright test --list` unchanged; with the API env broken, `playwright test` fails inside `webServer` (`serve api` exits 6 in its readiness window) before any test runs → restore.
- [ ] 4b.3.4 Tracker: Decisions log (webServer semantics); Gates row · CODE ~4 · slice `refound/4b-playwright-servers`.

### 4b.4 · `refound/4b-identity` (PR E7) — #47, one environment identity

- [ ] 4b.4.1 RED **threat matrix — destructive database target** WU-4b.7 · test-environment-contract › Environment identity is gated, not conventional (#47) · design §5 · CODE ~40 · slice `refound/4b-identity` — the three plants, each exit 1: `postgres:16-alpine` in a `services.postgres`; a retyped `postgresql://test_user@…` literal in a workflow; a key deleted from `.env.test.example`.
- [ ] 4b.4.2 GREEN WU-4b.7 · test-environment-contract › Environment identity is gated, not conventional (#47) · CODE ~140 · slice `refound/4b-identity` — `packages/test-contracts/src/identity.ts`: every `services.postgres` uses `pgvector/pgvector:pg16` + `POSTGRES_DB=omnipost_test` + `POSTGRES_USER=postgres`; every `services.redis` is `redis:7-alpine`; every `postgresql://` literal in `.github/workflows` is the canonical hermetic URL read from `scripts/test-env.sh`, never retyped; no inline `dev:test`; `.env.test.example`'s key set equals the script's required inputs.
- [ ] 4b.4.3 **Red proof** ×3 WU-4b.7 · CODE ~0 · slice `refound/4b-identity` — 4b.4.1 through the complete step; restore.
- [ ] 4b.4.4 Tracker: M15 reaches 1; Gates row (#47) · CODE ~4 · slice `refound/4b-identity`.

### 4b.5 · `refound/4b-hermetic-shards` (PR E8) — measured first

- [ ] 4b.5.1 **Measured** WU-4b.8 · test-environment-contract › The hermetic profile makes an accidental service dependency fail fast · CODE ~0 · slice `refound/4b-hermetic-shards` — run the api vitest suite under the hermetic profile locally and in a draft PR; list every failure. EVIDENCE ~80.
- [ ] 4b.5.2 GREEN WU-4b.8 · test-environment-contract › The hermetic profile makes an accidental service dependency fail fast · CODE ~70 (net −70) · slice `refound/4b-hermetic-shards` — **if 4b.5.1 measured 0**: the `test` job loses its `services` and database steps. **If N > 0**: those files are integration tests in the wrong tier → open a ledger row each and this slice waits (record the decision; never soften the profile). Acceptance: the slice records the N that 4b.5.1 measured and, for N = 0, the removed `services` and database steps; for N > 0, the ledger row opened for each failing file and the resume condition, a re-run of 4b.5.1 that measures 0.
- [ ] 4b.5.3 **Red proof** WU-4b.8 · CODE ~0 · slice `refound/4b-hermetic-shards` — a planted api unit test that opens Prisma fails with `ECONNREFUSED 127.0.0.1:1` → restore.
- [ ] 4b.5.4 Tracker: M8 (shards measured hermetic); Decisions log · CODE ~4 · slice `refound/4b-hermetic-shards`.

---

## Phase S — Shared test tooling (design §7.7). Each migration lands **after** its package's demolition slice.

### S.1 · `refound/s-skeleton` (WU-S.1)

- [ ] S.1.1 RED WU-S.1 · shared-test-tooling › The tooling is three packages, not one, and production never imports them · design §2f · CODE ~30 · slice `refound/s-skeleton` — the depcruise rule red: plant `import { aPost } from "@test-utils/domain"` in `packages/core/posts/src/` → exit ≠ 0; and `@test-utils/*` appearing outside `devDependencies` → exit ≠ 0.
- [ ] S.1.2 GREEN WU-S.1 · shared-test-tooling › The tooling is three packages, not one, and production never imports them · CODE ~150 · slice `refound/s-skeleton` — create `packages/test-utils/{domain,wire,persistence}` (`@layer infrastructure`, source exports, no build script) with the dependency directions of design §1; `pnpm-workspace.yaml` (glob added in 1.14.1), `tsconfig.base.json` paths (the vitest alias derives itself), `.dependency-cruiser.*`; assert `@core/domain`, `@shared/types` and `@infra/prisma` never depend on test-utils (turbo cycle).
- [ ] S.1.3 **Red proof** ×2 WU-S.1 · CODE ~0 · slice `refound/s-skeleton` — S.1.1's two plants through the complete step; restore.
- [ ] S.1.4 Tracker: Gates rows (depcruise); M13 Baseline · CODE ~4 · slice `refound/s-skeleton`.

### S.2 · `refound/s-builders` (WU-S.2)

- [ ] S.2.1 RED WU-S.2 · shared-test-tooling › Canonical builders construct aggregates through the domain's own factory · design §2f · CODE ~60 · slice `refound/s-builders` — one test per builder asserting `create()` returns ok and one invariant actually holds; a non-ok `create()` throws `fixture: <Aggregate>.create failed: …`.
- [ ] S.2.2 GREEN WU-S.2 · shared-test-tooling › Canonical builders construct aggregates through the domain's own factory · CODE ~180 · slice `refound/s-builders` — `aPost`, `aScheduledPost`, `aProject`, `aChannel`, `anAccount` via `create()` only (`reconstitute()` only for states unreachable by create: published, failed, soft-deleted); ids by counter (`post-000001`), clock fixed `2026-01-01T00:00:00Z`, no faker; `aProjectRepo(found?)` for the 15+ local `makeProjectRepo`; `aCanonicalPost()` and `a<Thing>Dto()` in wire.
- [ ] S.2.3 Tracker: M13 (local canonical builders) starts falling · CODE ~4 · slice `refound/s-builders`.

### S.3 · `refound/s-raw-reach` (WU-S.3a) — measure who reaches raw SQL (DD-17 step 1)

- [ ] S.3.1 RED WU-S.3a · shared-test-tooling › One Prisma double, and its raw SQL throws · design §DD-17 · CODE ~40 · slice `refound/s-raw-reach` — the recorder's classifier over synthetic stacks: a `set_config('app.account_id'` statement through `PrismaUnitOfWork` or the `tenantGuc` extension → `guc-binding`; anything else → `raw-subject`; `raw-reach.json` deterministic (sorted, no timestamps); a planted `SELECT 1` in a unit test yields one `raw-subject` row naming the file and the test.
- [ ] S.3.2 **Measured** WU-S.3a · shared-test-tooling › One Prisma double, and its raw SQL throws · CODE ~80 · slice `refound/s-raw-reach` — instrument the double's four raw methods with a recorder (caller stack + first SQL token) and run the unit tier per file (LXC-safe); write `docs/development/testing-refoundation/raw-reach.json`. EVIDENCE ~400.
- [ ] S.3.3 RED WU-S.3a · shared-test-tooling › One route-app builder, in the API app's own test support, using the production error plugin · design §9 risk 13 · CODE ~30 · slice `refound/s-raw-reach` — one test that resolves a mutating use case **after** a later `TOKENS.UnitOfWork` registration and asserts the double is reached — proving the lazy-singleton override wins and that nothing resolves it eagerly inside `setupContainer`.
- [ ] S.3.4 Tracker: the `raw-reach.json` classification table; Decisions log (which rows are `raw-subject`) · CODE ~4 · slice `refound/s-raw-reach`.

### S.4 · `refound/s-uow-canon` (WU-S.3b) — the composition-root canon fix (DD-17 step 3)

- [ ] S.4.1 RED WU-S.3b · shared-test-tooling › One Prisma double, and its raw SQL throws · design §DD-17 · CODE ~30 · slice `refound/s-uow-canon` — a test that `TOKENS.UnitOfWork` resolves **transient** (two resolves are two instances) and that no use-case factory constructs `new PrismaUnitOfWork(...)` directly.
- [ ] S.4.2 GREEN WU-S.3b · shared-test-tooling › One Prisma double, and its raw SQL throws · CODE ~90 · slice `refound/s-uow-canon` — restore ARCHITECTURE_CANON §Dependency Injection in the one class with three sites: register `TOKENS.UnitOfWork` transient in `apps/api/src/infrastructure/container/setupRepositories.ts`, and make `setupProjectUseCases.ts` and `setupAccountUseCases.ts` resolve the token instead of constructing the concrete. **If Edward declines this correction** (human gate H9, [tasks.md §Human decision gates](tasks.md#human-decision-gates-never-silently-skipped)), the affected tests are tiered as `raw-subject` rows instead and the double is NOT softened (design §9 risk 12); the branch taken is recorded against H9 in this task and in the tracker Decisions log.
- [ ] S.4.3 Acceptance WU-S.3b · CODE ~0 · slice `refound/s-uow-canon` — `pnpm --filter @apps/api test` and `bash scripts/test-env.sh integration` green; fitness #21 and the DI canon unchanged.
- [ ] S.4.4 Tracker: Decisions log (canon fix, ADR reference) · CODE ~4 · slice `refound/s-uow-canon`.

### S.5 · `refound/s-prisma-double` (WU-S.3) — the throwing double and the UoW double

- [ ] S.5.1 RED WU-S.3 · shared-test-tooling › One Prisma double, and its raw SQL throws · design §2f · CODE ~50 · slice `refound/s-prisma-double` — `$queryRaw` / `$queryRawUnsafe` / `$executeRaw` / `$executeRawUnsafe` throw with the exact message "raw SQL is not simulated: test this path in the integration tier"; `createUnitOfWorkDouble()` returns `err` unchanged from `executeResultInTransaction` and never calls a raw method; `$extends` stays an identity wrapper and its doc states that tenant-guard semantics are proven only in the integration tier.
- [ ] S.5.2 GREEN WU-S.3 · shared-test-tooling › One Prisma double, and its raw SQL throws · CODE ~220 · slice `refound/s-prisma-double` — `git mv apps/api/tests/unit/helpers/mockPrisma.ts packages/test-utils/persistence/src/prismaDouble.ts` keeping the store model, the `$transaction` fn+array forms and the auto-seeded roles byte-exact; typed generic registry; `presets.adminAuth`; `asPrismaClient(double)` as the only cast site; `prismaModuleFactory(double)` with `vi.hoisted` for `vi.mock("@infra/prisma")`; `createUnitOfWorkDouble()` registered by `buildRouteTestApp` right after `setupContainer`.
- [ ] S.5.3 GREEN WU-S.3 · shared-test-tooling › One Prisma double, and its raw SQL throws · CODE ~40 · slice `refound/s-prisma-double` — the codemod over the 31 importers (mechanical; its output is EVIDENCE ~900).
- [ ] S.5.4 Acceptance WU-S.3 · CODE ~0 · slice `refound/s-prisma-double` — api vitest green; **every test that turns red on the throwing raw path becomes a ledger row** (DELETE or re-tier), per S.3.2's measurement — never a softened double.
- [ ] S.5.5 Tracker: M13 (PrismaClient casts) falls; M6 gains the tiering rows · CODE ~4 · slice `refound/s-prisma-double`.

### S.6 · `refound/s-redis-double` (WU-S.4)

- [ ] S.6.1 RED WU-S.4 · shared-test-tooling › One Redis double, and an unsupported command throws · design §2f · CODE ~50 · slice `refound/s-redis-double` — TTL behaviour under the virtual clock; an unsupported command throws naming it.
- [ ] S.6.2 GREEN WU-S.4 · shared-test-tooling › One Redis double, and an unsupported command throws · CODE ~150 · slice `refound/s-redis-double` — `createRedisDouble()` as a typed `Pick<Redis, …>` over the union of the 7 existing copies' commands plus `{ clock: { advance(ms) } }`; no `ioredis-mock` (TTL, Lua and BullMQ stay in the integration tier).
- [ ] S.6.3 GREEN WU-S.4 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~120 · slice `refound/s-redis-double` — migrate the 7 consumers (saga manager/integration helpers, the two content helpers, the performance-monitor helper, the rate-limit dashboard and the health routes) and prune their suppressions.
- [ ] S.6.4 Tracker: M13 · CODE ~4 · slice `refound/s-redis-double`.

### S.7–S.10 · `refound/s-route-app` and `refound/s-route-app-{1,2,3}` (WU-S.5)

- [ ] S.7.1 RED WU-S.5 · shared-test-tooling › One route-app builder, in the API app's own test support, using the production error plugin · design §2f · CODE ~40 · slice `refound/s-route-app` — a test that a domain error is mapped through the **production** `errorPlugin` (status, `correlationId`, `timestamp`), and that the UoW registration made before the first resolve wins over the lazy singleton.
- [ ] S.7.2 GREEN WU-S.5 · shared-test-tooling › One route-app builder, in the API app's own test support, using the production error plugin · CODE ~100 · slice `refound/s-route-app` — `apps/api/tests/support/buildRouteTestApp.ts` registering the Zod compilers, the production `errorPlugin`, `setupContainer({ prisma })` and the auth mocks; retire `createTestContainer` from the production composition root.
- [ ] S.8.1 WU-S.5 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~300 · slice `refound/s-route-app-1` — migrate batch 1 of the 28 `createTestApp` copies and the 9 users of `*Routes.test-helpers.ts`; prune suppressions.
- [ ] S.9.1 WU-S.5 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~300 · slice `refound/s-route-app-2` — batch 2, including the 6 `admin/*Routes.test.ts` that call captured handlers today and move to `inject`.
- [ ] S.10.1 WU-S.5 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~300 · slice `refound/s-route-app-3` — batch 3; `createTestApp` count reaches 0.
- [ ] S.10.2 Tracker: M13; Declared gaps if any route test cannot migrate · CODE ~4 · slices `refound/s-route-app-{1,2,3}` (one row per slice).

### S.11–S.13 · `refound/s-seed` and `refound/s-seed-migrate-{1,2}` (WU-S.6)

- [ ] S.11.1 RED WU-S.6 · shared-test-tooling › Seeds are canonical, and cleanup is scoped to the tenant it seeded · design §DD-16 · CODE ~40 · slice `refound/s-seed` — a test that `cleanupTenant` deletes only the seeded tenant's aggregates (the outbox deletes are scoped to its aggregate ids) and leaves a second tenant's rows intact; plus the serial-tier invariant assertion (one file per process, concurrency 1).
- [ ] S.11.2 GREEN WU-S.6 · shared-test-tooling › Seeds are canonical, and cleanup is scoped to the tenant it seeded · CODE ~120 · slice `refound/s-seed` — move `createSeedPrismaClient` (whole file, not rewritten), `seedTenant` and `cleanupTenant` to `packages/test-utils/persistence/src/seed`, keeping `bulkScheduleHarness`'s `makeStubQueue`, `makeRelay` and `seedTenant` byte-exact; the codemod over the 77 importers (EVIDENCE ~700).
- [ ] S.12.1 WU-S.6 · shared-test-tooling › Seeds are canonical, and cleanup is scoped to the tenant it seeded · CODE ~300 · slice `refound/s-seed-migrate-1` — migrate batch 1 of the 12 inline tenant-isolation copies onto the canonical base ids plus named extras (`seedTrackedLinks`, `seedSink`).
- [ ] S.13.1 WU-S.6 · shared-test-tooling › Seeds are canonical, and cleanup is scoped to the tenant it seeded · CODE ~300 · slice `refound/s-seed-migrate-2` — batch 2; inline copies reach 0.
- [ ] S.13.2 Tracker: M13 · CODE ~4 · slices `refound/s-seed-migrate-{1,2}` (one row per slice).

### S.14 · `refound/s-builder-gate` (WU-S.7 + WU-S.8)

- [ ] S.14.1 RED WU-S.7 + S.8 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · design §2f · CODE ~20 · slice `refound/s-builder-gate` — plant `const makeProject = () => …` in a package's test → lint exit 1; plant a double-`as` `PrismaClient` cast outside `@test-utils/persistence` → lint exit 1.
- [ ] S.14.2 GREEN WU-S.7 + S.8 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~50 · slice `refound/s-builder-gate` — the two `no-restricted-syntax` rules (builder-name regex outside `packages/test-utils/**`; the `TSAsExpression` cast selector outside `@test-utils/persistence`) with suppressions as the baseline (35 casts, ≥ 60 builders) and a fitness pin that both stay at `error`.
- [ ] S.14.3 **Red proof** ×2 · CODE ~0 · slice `refound/s-builder-gate` — S.14.1's two plants through the complete step; restore.
- [ ] S.14.4 Tracker: M13 Baseline pinned; Gates rows · CODE ~4 · slice `refound/s-builder-gate`.

### S.15–S.20 · `refound/s-migrate-<pkg>` (WU-S.7 migrations, one per family)

- [ ] S.15.1 WU-S.7 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~300 · slice `refound/s-migrate-core` — migrate `packages/core/*` tests onto `@test-utils/*`; prune the family's suppressions.
- [ ] S.16.1 WU-S.7 · same requirement · CODE ~300 · slice `refound/s-migrate-adapters` — `packages/adapters/*`.
- [ ] S.17.1 WU-S.7 · same requirement · CODE ~300 · slice `refound/s-migrate-providers` — `packages/providers/*`.
- [ ] S.18.1 WU-S.7 · same requirement · CODE ~250 · slice `refound/s-migrate-workers` — `apps/workers`.
- [ ] S.19.1 WU-S.7 · same requirement · CODE ~350 · slice `refound/s-migrate-api` — `apps/api`.
- [ ] S.20.1 WU-S.7 · same requirement · CODE ~300 · slice `refound/s-migrate-client` — `apps/client` and `apps/admin`.
- [ ] S.20.2 Tracker: M13 reaches 0 · 0 · 0; the two gates go hard-zero (suppressions empty) · CODE ~4 · slice `refound/s-migrate-client`.

---

## Phase 4 — The integration tier as the model (design §7.8)

### 4.1 · `refound/4-preconditions-a` (WU-4.1a)

- [ ] 4.1.1 RED WU-4.1a · integration-tier-preconditions › Availability is a throwing precondition, never a skip · design §2d · CODE ~40 · slice `refound/4-preconditions-a` — with the API down, `assertApiAvailable()` in `before` THROWS naming the start command; the suite reports failed, never skipped.
- [ ] 4.1.2 GREEN WU-4.1a · integration-tier-preconditions › Availability is a throwing precondition, never a skip · CODE ~200 · slice `refound/4-preconditions-a` — replace `skipIfApiUnavailable` / `skipIfWorkerUnavailable` with `assertApiAvailable()` / `assertWorkersAvailable()` in the three live suites with the most sites (provider registry 37, production 27, multiproject flow 21), following the existing throwing pattern.
- [ ] 4.1.3 Tracker: M9 (runtime `t.skip` sites) falls · CODE ~4 · slice `refound/4-preconditions-a`.

### 4.2 · `refound/4-preconditions-b` (WU-4.1b)

- [ ] 4.2.1 GREEN WU-4.1b · integration-tier-preconditions › Availability is a throwing precondition, never a skip · CODE ~200 · slice `refound/4-preconditions-b` — the remaining suites (link routes 12, crisis routes 10, security endpoints 11, adapters 8, the five `syncEngine.*`), then delete the helper from `apps/api/tests/testUtils.ts`.
- [ ] 4.2.2 Acceptance WU-4.1b · integration-tier-preconditions › Availability is a throwing precondition, never a skip · CODE ~0 · slice `refound/4-preconditions-b` — `rg "t\.skip\(|skipIf(Api|Worker)?Unavailable" apps/api/tests` = 0, so #32 can make runtime `t.skip(` hard-zero.
- [ ] 4.2.3 Tracker: M9 reaches 0 runtime skip sites · CODE ~4 · slice `refound/4-preconditions-b`.

### 4.3 · `refound/4-production-rewrite` (WU-4.3)

- [ ] 4.3.1 RED WU-4.3 · integration-tier-preconditions › A suite that prints its own success, or accepts either outcome, is rewritten to assert exactly · CODE ~50 · slice `refound/4-production-rewrite` — the delete-post case asserts exactly `403` **and** the domain code (not `200 || 403`); the quota case uses an account with a known subscription and an exact `maxProjects`.
- [ ] 4.3.2 GREEN WU-4.3 · integration-tier-preconditions › A suite that prints its own success, or accepts either outcome, is rewritten to assert exactly · CODE ~120 · slice `refound/4-production-rewrite` — delete the unconditional "Test Summary" PASSED block, the duplicated "Client Interface Verification" health check and the "should simulate media upload" case whose title and assertion contradict each other; remove the ~40 `console.log`s; apply 4.1's preconditions.
- [ ] 4.3.3 Acceptance WU-4.3 · CODE ~0 · slice `refound/4-production-rewrite` — the suite is green and the orchestrator records a **probe RED** over the account-creation path.
- [ ] 4.3.4 Tracker: M2, M6 · CODE ~4 · slice `refound/4-production-rewrite`.

### 4.4 · `refound/4-outbox-topology` (WU-4.4) — F-6 closed by topology (DD-19)

- [ ] 4.4.1 RED WU-4.4 · integration-tier-preconditions › A shared-subject race is closed by topology, not by a sentinel · design §DD-19 · CODE ~20 · slice `refound/4-outbox-topology` — run the outbox suite with the API up → exit ≠ 0 in < 2 s naming `apps/api/src/index.ts:866` (`outboxRelay.start()`) and the claim statement in `OutboxClaimService.ts:90-100`; with the API down → green.
- [ ] 4.4.2 GREEN WU-4.4 · integration-tier-preconditions › A shared-subject race is closed by topology, not by a sentinel · CODE ~60 · slice `refound/4-outbox-topology` — `bulkScheduleHarness.makeRelay` calls `assertNoForeignRelay()` (probes `getBaseUrl()/health`); `OutboxRelay.integration.test.ts` keeps its sentinel for local runs; the DB-only phase already runs with the application down (task 1.12.2).
- [ ] 4.4.3 Acceptance WU-4.4 · CODE ~0 · slice `refound/4-outbox-topology` — 10 consecutive CI runs with zero outbox failures, run ids in the tracker.
- [ ] 4.4.4 Tracker: Gates row; the three bulk-schedule suites may now leave quarantine · CODE ~4 · slice `refound/4-outbox-topology`.

### 4.5 · `refound/4-unquarantine-db` (WU-4.5) and 4.6 · `refound/4-unquarantine-live` (WU-4.6 + WU-4.2)

- [ ] 4.5.1 WU-4.5 · test-reach-contract › Quarantine is temporary and only shrinks · CODE ~10 · slice `refound/4-unquarantine-db` — remove the 10 dark DB-only suites' quarantine entries (they were renamed by measured tier in 1.7.1 and the collector takes them by convention); the three bulk-schedule suites leave only now, after 4.4.
- [ ] 4.5.2 Acceptance + Tracker (M5, M9) · CODE ~4 · slice `refound/4-unquarantine-db` — quarantine loses 10 entries; `TIER` reports skip 0 / cancel 0.
- [ ] 4.6.1 WU-4.2 · integration-tier-preconditions › Dark suites are admitted by MEASURED tier, never by a guess · CODE ~6 · slice `refound/4-unquarantine-live` — fix `trendRadarRoutes.test.ts`: add `dayKey: <fetchedAt>.toISOString().slice(0,10)` to the three `trendRadarResult.create` calls, matching the use case's semantics and the `@@unique([accountId, dayKey, topic])` constraint; 5/5 alone and in the tier.
- [ ] 4.6.2 WU-4.6 · test-reach-contract › Quarantine is temporary and only shrinks · CODE ~10 · slice `refound/4-unquarantine-live` — remove the 9 live suites' quarantine entries; order comes from `LC_ALL=C sort` and per-file readiness (1.13.2) replaces the old ordering dependency.
- [ ] 4.6.3 Acceptance + Tracker (M5, M9, per-file durations) · CODE ~4 · slice `refound/4-unquarantine-live` — quarantine holds no api suites.

### 4.7 · `refound/4-chaos` (WU-4.7)

- [ ] 4.7.1 WU-4.7 · integration-tier-preconditions › The scheduled duplicate of the tier is removed; its scenarios run in every pull request · CODE ~10 · slice `refound/4-chaos` — rename the two chaos files per the convention if needed and **delete `.github/workflows/chaos.yml`** (it re-ran the whole DB-only tier nightly as owner without `MIGRATE_DATABASE_URL` and opened an issue per failure); close SMELL-79 stating the scenarios run in every PR.
- [ ] 4.7.2 Acceptance + Tracker (M5, M15) · CODE ~4 · slice `refound/4-chaos` — `chaos.yml`'s `issues: write` leaves with the file (verdict rule V8's allowlist shrinks).

### 4.8 · `refound/3-nightly` (PR V12) — one alarm per workflow

- [ ] 4.8.1 RED **threat matrix — CI automation that writes to GitHub** WU-3.12 · merge-verdict-composition › The scheduled run has one alarm, and duplicate schedules are removed · design §5 · CODE ~30 · slice `refound/3-nightly` — dispatch on a scratch branch with a planted failing integration test → **exactly one** issue created; dispatch again → one comment, no second issue; dispatch without the plant → the issue closed with the run link.
- [ ] 4.8.2 GREEN WU-3.12 · merge-verdict-composition › The scheduled run has one alarm, and duplicate schedules are removed · CODE ~90 (net −60) · slice `refound/3-nightly` — delete the `build --force` / `test --force` steps (covered elsewhere and `test` is already `cache: false`); add the `integration-reversed` job (`TEST_ORDER=reverse bash scripts/test-env.sh integration` — the same two phases, reversed inside each, never the DB-only tier with the application up); add ONE `alarm` job (`needs`, `if: always()`, `permissions: issues: write`, `github-script` search-before-create on the `nightly-failure` label, close on green) and put it in the `writers` allowlist.
- [ ] 4.8.3 **[admin, once]** WU-3.12 · CODE ~0 · slice `refound/3-nightly` — Edward closes the 31 open `nightly-failure` issues citing the first green nightly.
- [ ] 4.8.4 Tracker: M15 (open nightly alarms → ≤ 1); Gates rows · CODE ~4 · slice `refound/3-nightly`.

### 4.9 · `refound/1-registered-entrypoints` (PR R14) — reach part B

- [ ] 4.9.1 RED WU-1.14 · test-reach-contract › Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts · CODE ~20 · slice `refound/1-registered-entrypoints` — plant `run: pnpm --filter @apps/api exec vitest run tests/unit/foo` → exit 1.
- [ ] 4.9.2 GREEN WU-1.14 · test-reach-contract › Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts · CODE ~110 · slice `refound/1-registered-entrypoints` — part B over `.github/workflows/*.yml` with `yaml`: (B1) no `vitest` / `node --test` / `playwright test` / `k6 run` with a positional path outside the forms registered in `collectors.json`; (B2) every `pnpm … test*` / `turbo run test*` is one of `test`, `test:coverage`, `test:integration`, `test:e2e`; repoint the last offender in `dependency-updates.yml`.
- [ ] 4.9.3 **Red proof** WU-1.14 · CODE ~0 · slice `refound/1-registered-entrypoints` — 4.9.1 through the complete step; restore.
- [ ] 4.9.4 Tracker: Gates row (part B) · CODE ~4 · slice `refound/1-registered-entrypoints`.

### 4.10 · `refound/4-tier-acceptance` (WU-4.9)

- [ ] 4.10.1 Acceptance WU-4.9 · integration-tier-preconditions › The tier closes at zero skipped, zero cancelled, zero failed on two consecutive runs · CODE ~20 · slice `refound/4-tier-acceptance` — two consecutive CI runs of the DB-only and live phases with 0 skipped / 0 cancelled / 0 failed; every suite named exactly once; the reach gate reports 0 unreached; write the run ids into the tracker.
- [ ] 4.10.2 Tracker: M9 closes at 0/0; M5 at 0 · 0 · CODE ~4 · slice `refound/4-tier-acceptance`.

---

## Phase X — The runner experiment (design §7.9)

### X.1 · `refound/x-runner-experiment` (PR X1) — unmerged branch; only the evidence merges

- [ ] X.1.1 WU-4.X1 · integration-tier-preconditions › The runner fork is decided by a measured table against stated hypotheses · design §2j · CODE ~250 (on the unmerged branch, 0 merged) · slice `refound/x-runner-experiment` — build runner B (`apps/api/vitest.integration.config.ts` with the alias map minus the `@infra/prisma → vitest-entry.ts` override, both condition lists, `pool: "forks"`, `isolate: true`, `fileParallelism: false`, `maxWorkers: 1`, the two timeouts, projects `integration` and `live`, the four reporters, `loadTestEnv`) and the import-line-only codemod; both runners run under the same `test-env.sh integration` recipe.
- [ ] X.1.2 **Measured** WU-4.X1 · integration-tier-preconditions › The runner fork is decided by a measured table against stated hypotheses · CODE ~0 · slice `refound/x-runner-evidence` — the same commit, CI and homelab, 3 runs each: M1 verdict parity, M2 runtime, M3 failure naming over the 7 planted red cases (28 points), M4 force-exit equivalent, M5 skip/cancel/zero guards without a text parser, M6 migration cost (assertions changed = 0), M7 coverage mergeability with the unit blobs, M8 flakiness over 10 nightly repeats, M9 peak RSS. EVIDENCE ~400 (the table, URLs and codemod diff stats).
- [ ] X.1.3 Tracker: the full X1 table with run URLs · CODE ~40 · slice `refound/x-runner-evidence`.

### X.2 · decision — **[HUMAN GATE H7]**

- [ ] X.2.1 **[HUMAN GATE H7]** WU-4.X2 · integration-tier-preconditions › The runner fork is decided by a measured table against stated hypotheses · design §2j · CODE ~20 · slice `refound/x-runner-evidence` — apply the decision rule to X1's table: hard criteria H1 parity 100 %, H2 every red case exits ≠ 0 under B, H3 the guards expressible in config + reporter ≤ 60 lines, H4 no assertion change **and no mock/alias/stub added to make Prisma or the saga engine run under vite**, H5 CI runtime ≤ 1.25× and within 15 min. All pass → consolidate on vitest; any hard criterion other than H5 fails, alone or together with others (H5 included) → keep node:test and record each failed criterion as the class only it sees; only H5 fails → keep node:test the same way, unless everything else is better, in which case → Edward with the numbers. **Do not hard-code a runner before this task; later tasks say "per X2 outcome".** Write the outcome into the Decisions log.
- [ ] X.2.2 WU-4.X2 · testing-canon-and-tracker › The coding standard states the framework per BOUNDARY, the both-directions rule, and the criterion · CODE ~10 · slice `refound/x-runner-evidence` — resolve the "node:test (or vitest per X2)" cell of the CODING_STANDARDS table (task 2.1.6) to the decided runner; the suffix router is unchanged either way.

---
