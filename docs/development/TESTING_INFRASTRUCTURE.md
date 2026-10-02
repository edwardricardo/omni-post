# Testing Infrastructure

**Owner:** Platform engineering
**As of:** 2026-09-27

The one living description of how omni-post is tested: which frameworks are installed, which test files any runner reaches, what CI executes, and which gates cannot fail. It replaces `docs/development/testing-backlog.md`, `docs/reports/testing/testing-infrastructure-complete.md` and `docs/reports/CI_TEST_REACH_AUDIT.md`, now frozen under `docs/archive/`. It does not yet adjudicate the other testing documents in `docs/` (`architecture/TESTING.md`, `architecture/chaos-testing.md`, `architecture/provider-testing.md`, `development/saga-test-suites.md`, `security/SECURITY_TESTING_FRAMEWORK.md`, the two `e2e/README.md` files); where one of them states a version, a count or a coverage figure that this document contradicts, this document is the measured one. It records findings. The action plan that follows from them is decided separately and is not written here.

## The state in one table

Every row carries its provenance: **R** = executed on 2026-09-27 and read from the run output; **P** = counted by the read-only exploration recorded in the approved plan behind this document (glob and grep counts, not executions); **F** = measured on 2026-09-27 after that plan was written; **M** = re-measured while writing this document, with the command cited where the number appears.

| Dimension                                          | Measured                                                                                                                  | Src   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----- |
| Vitest, full local run                             | 86 packages, 832 test files, 12,623 tests: 12,580 passed, 43 `todo`, 0 failed, 0 skipped; 8m55s wall clock                | R     |
| Test files in the pnpm workspaces                  | 942 = 832 collected by vitest + 78 node:test files named by `run-tests.sh` + 9 Playwright specs + 23 reached by no runner | P + M |
| The 20 node:test suites no runner reaches          | First run ever: 18 pass as they are, 2 fail                                                                               | R     |
| `security/tests` (outside every workspace)         | 7 files, 65 tests: 56 skipped, 6 failed, 3 passed                                                                         | R     |
| E2E in CI                                          | 0 invocations in any workflow                                                                                             | P     |
| E2E, first local runs                              | client: 3 passed, 795 failed, 36 skipped; admin: 8 passed, 29 failed                                                      | R     |
| k6 load scenarios ever executed                    | 0 of 6                                                                                                                    | P     |
| Configs that measure coverage                      | 1 of 86 (`apps/api`)                                                                                                      | P + M |
| Required checks on `main`                          | 19, `strict: false`                                                                                                       | M     |
| Gates that cannot fail or cannot explain a failure | 5 structural defects, listed under "Gates that cannot fail"                                                               | P + F |
| `main` red on `6701be00`                           | `integration:outbox` smoke races the API's own outbox relay; the same SHA passed on re-run                                | F     |

## How these numbers were produced

The executed runs left their output in the scratchpad of the session that measured them. **Those artifacts are not in the repository and will not survive that session**; they are named here so the provenance is auditable, and every number below also names the command that re-derives it.

| Artifact (scratchpad, not committed)                                                            | Produced by                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turbo-test-timed.log`, `.turbo/runs/3JtHML9eKFEz6bPQb3W0eMYvQ66.json` (gitignored)             | `turbo run test --force --concurrency=2 --summarize`; the log is parsed after stripping ANSI colour codes                                                                                                                  |
| `dark/SUMMARY.txt`, `dark/*.tap`, `run-dark-suites.sh`                                          | Each file in its own process: `node --conditions development --import tsx --test --test-reporter=tap --test-force-exit --test-concurrency=1 --test-timeout=60000 <file>`, Postgres and Redis up, both database URLs loaded |
| `e2e-client.log`, `pw-install.log`, `pw-deps.log`                                               | `pnpm --filter @apps/client test:e2e` against running dev servers, after installing Playwright's Chromium and its system dependencies                                                                                      |
| `e2e-admin.log`                                                                                 | The `apps/admin/playwright.config.ts` config run by hand (the package has no E2E script)                                                                                                                                   |
| `perf-db.log`, `perf-db-real.log`, `run-perf-db.sh`                                             | `pnpm perf:db` as CI runs it, and again with `NODE_OPTIONS=--conditions=development` and the repository env loaded                                                                                                         |
| `flake-blob/`                                                                                   | `vitest --merge-reports` over the `vitest-blob-1` artifact of CI run 36278618314, attempt 1 (artifact id 10918157288), in an isolated directory                                                                            |
| `types-node.log`                                                                                | `tsc --explainFiles` over four programs, counting which `@types/node` copy each one loads                                                                                                                                  |
| `ci-outbox.log`, `tenant-iso.log`, `probe-db.sh`, `applied.txt`, `ondisk.txt`, `main-runs.json` | The log of CI run 36281151728 and a read-only probe of the local database                                                                                                                                                  |
| `cfgs.txt`, `pkgs.txt`, `manifests.txt`, `scope.mjs`                                            | The config, package and manifest inventories behind the reach counts                                                                                                                                                       |
| `fitness-after-30.log`                                                                          | The 42 fitness checks run locally: 42 green on the commit that lowered the #30 baseline to 20                                                                                                                              |

## 1. Frameworks and tooling

| Tool                            | Version                                                                                        | Role and reach                                                                                          | Src   |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----- |
| Vitest                          | 4.1.11 (catalog; a documented CVE floor in [SECURITY_CANON.md](../security/SECURITY_CANON.md)) | Unit, component and hook tests. 86 configs, one independent run per package, orchestrated by turbo      | M + R |
| `@vitest/coverage-v8`           | 4.1.11                                                                                         | Coverage provider, used by `apps/api` only                                                              | M     |
| `node:test`                     | Node 24 built-in (`.nvmrc`)                                                                    | `apps/api` integration tier and `security/tests`. 108 files import it                                   | M     |
| `tsx`                           | 4.23.15 since 2026-10-02 (slice `0.6`); 4.22.4 when this document was measured on 2026-09-27   | Loader for every `node:test` run and for the `perf:*` scripts                                           | M     |
| Playwright (`@playwright/test`) | 1.63.0 since 2026-10-02 (slice `0.7`); 1.61.1 when this document was measured on 2026-09-27    | E2E. Two configs: `apps/client` declares 9 projects, `apps/admin` declares 1                            | M     |
| `@testing-library/react`        | 16.3.3 since 2026-10-02 (slice `0.9`); 16.3.2 when this document was measured on 2026-09-27    | Component and hook tests in the portals                                                                 | M     |
| `jsdom`                         | 29.1.1                                                                                         | DOM environment for frontend vitest runs                                                                | M     |
| MSW                             | 2.15.0 since 2026-10-02 (slice `0.8`); 2.14.6 when this document was measured on 2026-09-27    | HTTP mocking. Declared by `apps/api`, `apps/client` and `packages/providers/shared`; no config wires it | M     |
| k6                              | `grafana/k6:latest` Docker image, unpinned                                                     | Load tests, 6 scenarios under `performance/k6/scenarios/`                                               | M     |
| Jest 30                         | Absent since 2026-10-02 (slice `0.11`); `jest@30.4.2` in the store on 2026-09-27               | Left with `@storybook/test-runner`; only `jest-worker@27.5.1` remains, via webpack's terser plugin      | P + M |
| Mutation testing                | None since 2026-09-27 (removed by PRs #307, #310, #311; see MASTER_PLAN_ES.md N-CI-4)          | No replacement chosen                                                                                   | F     |

Versions above come from `pnpm-workspace.yaml` (the catalog); the store entries from `eza -d node_modules/.pnpm/<name>@*`, and the Jest row's 2026-10-02 state from parsing `pnpm-lock.yaml` (no `jest@` key; `jest-worker@27.5.1` declared by `terser-webpack-plugin@5.6.1`).

### Vitest configuration

- **86 configs, 10 distinct shapes by fingerprint, zero `vite.config.*`, zero `projects:`** (P; config count and `vite.config` count re-measured with `fd -g 'vitest.config.*' apps packages infra -E node_modules -E dist`).
- **The shared factory.** 82 of 86 configs import `defineWorkspaceVitestConfig` from `@packages/vitest-shared`; `apps/api`, `apps/admin` and `apps/client` import only its helpers (`buildWorkspaceAliases`, `findMonorepoRoot`); `apps/workers` imports neither and carries its own copy of `findMonorepoRoot` at `apps/workers/vitest.config.ts:10` (M, `rg` over the 86 configs). The plan also counted **24 configs that re-declare the factory's 3 defaults** — a change to those defaults in the factory does not reach them — and recorded that `apps/workers` keeps an alias map of its own (P).
- **Coverage is measured by 1 config of 86** (M: `coverage:` appears only in `apps/api/vitest.config.ts`), over **551 of 1,896 production files, 29%** (P). Its floors are literals at `apps/api/vitest.config.ts:116-119` — lines 56.8, functions 57.3, branches 47.8, statements 56.2 — ratcheted by `autoUpdate` and guarded by fitness #37. They were **read, not re-measured**: the 2026-09-27 run did not enable coverage. `apps/workers` and `@adapters/db-prisma` declare a `test:coverage` script with no coverage config or provider (P). The portals' `test:coverage` is `vitest --coverage` without `run` (M, the two `package.json` files).
- **`apps/api` runs in one fork**: `pool: "forks"` and `maxWorkers: 1` (`apps/api/vitest.config.ts:45`, `:55`).

### Duplicated and drifting type and tool versions

- **Two vitest generations in the tree.** Storybook brings `@vitest/{expect,spy,utils,pretty-format}` 3.2.4 next to 4.1.11, plus `chai` 5.3.3 and `tinyrainbow` 2.0.0 (P; `@vitest+expect@3.2.4` and `@4.1.11` both present in `node_modules/.pnpm`, M).
- **`@types/node` triad.** Runtime Node 24 (`.nvmrc`, plus 7 pins counted by the plan); declared types 25.9.3 (catalog); a stray 26.0.0 reached through 37 transitive parents (P). `tsc --explainFiles` over `apps/api`, `apps/workers` and `packages/core/domain` loads 173 files, all from `@types/node@25.9.3`, and none from 26.0.0; `infra/prisma` printed no `@types/node` line at all (R, `types-node.log`, 11 s). The stray copy is inert for those four programs. Because 108 files import `node:test`, the types decide what the compiler accepts for the integration tier. **0 of 98 manifests declare `engines`** (M, `node` over `manifests.txt`).
- **Dead `vite` shims.** 86 dead `vite` bin shims and none of any other bin; store and lockfile agree on `jiti@2.6.1`, so the shims are the stale part; the two live shims belong to the two packages that declare `vite` (P).
- **Dependency lag.** 17 of the 18 direct dependencies in the plan's testing-tool inventory sit below their latest mature release, and 3 carry a documented reason (the Storybook family, `esbuild`, `eslint`) (P). Re-checked for vitest only: 4.1.11 installed; 5.0.1 published 2026-09-15; 5.0.2 published 2026-09-25, inside the 7-day maturity window on 2026-09-27 (M, `pnpm view vitest time --json`). The 4.1.11 pin is a CVE floor, which is a minimum and does not explain staying on 4.x.

### MSW

MSW is installed and no config wires it: none of the four `setupFiles` declared by `apps/{api,admin,client,workers}/vitest.config.ts` mentions MSW, and each MSW user starts its own server (P; M: 19 files import from `msw` and 16 contain `setupServer` or `server.listen(`, both with `rg -l`). In `apps/client/tests/integration`, **9 of 24 files stub `fetch` with `vi.stubGlobal`** (M: `rg -l -U "stubGlobal\(\s*['\"]fetch['\"]"`); the plan recorded 10, which equals the number of files calling `vi.stubGlobal` for any global — the tenth stubs `EventSource`. The providers' MSW helper, `@providers/shared/test-utils/msw-helpers`, is imported by one test file, `packages/providers/telegram/tests/TelegramAdapter.publish.msw.test.ts` (M; the plan counted 1 consumer of 12).

## 2. Reach

| Population                                                                                            | Files | Src   |
| ----------------------------------------------------------------------------------------------------- | ----- | ----- |
| Test files in the pnpm workspaces                                                                     | 942   | P     |
| Collected by a vitest config (the 2026-09-27 run executed the same count)                             | 832   | P + R |
| `apps/api` `node:test` files named in `apps/api/scripts/run-tests.sh`                                 | 78    | M     |
| Playwright specs (`apps/client` 5, `apps/admin` 4)                                                    | 9     | P + M |
| Reached by no runner: 20 `apps/api` `node:test` suites, 2 admin fetch scripts, 1 `_template` scaffold | 23    | P     |
| Outside every workspace: `security/tests` 7, `performance/database/postgres-stress.test.ts` 1         | 8     | M     |

832 + 78 + 9 + 23 = 942. The `apps/api` split: 577 vitest files under `tests/unit` and `tests/eval`, and 98 `node:test` files, of which 78 are named by `run-tests.sh` and 20 are not (M: `fd -g '*.test.ts' tests -E /unit -E /eval` from `apps/api`, each path checked with `rg -qF` against `scripts/run-tests.sh`, the same method fitness #30 uses). `pnpm-workspace.yaml` does not list `security/` or `performance/`.

**Packages with no test config: 11 of 97**, and 10 of them have no test file at all (M, `scope.mjs`): `packages/ui`, `packages/ports`, `packages/shared`, `packages/monitoring/health-checks`, `infra/prisma`, `packages/observability/opentelemetry`, the three storage adapters `storage-azure`, `storage-gcs`, `storage-do-spaces`, and `packages/vitest-shared`. The eleventh is `packages/providers/_template` (one scaffold file). Their source-file counts, from the plan: `ui` 49 components consumed by both portals, `ports` 24, `shared` 17, `health-checks` 10, `infra/prisma` 7, `opentelemetry` 4. `turbo run test` only schedules packages that declare a `test` task, so none of these produce a signal of any colour.

**Density.** `packages/core/domain` has 183 source files (M, `fd -e ts . packages/core/domain/src`) and 4 test files (R). 50 packages have exactly one collected test file (R, and `scope.mjs` agrees); the plan recorded 45, and the difference was not reconciled.

**Dead globs.** 4 positive globs match zero files (P). Three are `testMatch` values of the client Playwright projects `accessibility` (`**/*.accessibility.spec.ts`), `visual-regression` (`**/*.visual.spec.ts`) and `performance` (`**/*.performance.spec.ts`), while the files on disk are named `a11y.spec.ts` and `visual.spec.ts` (M: `fd -g` returns 0 for each glob). In the full client run those three projects contributed no test at all (R: no output line names them; 834 tests = 6 projects × 139). `apps/client` has scripts that select two of them: `test:e2e:accessibility` and `test:e2e:visual` (M).

**Provider apiClients are unit-testable, and two families of suites anchor closed defects.** Seven `*ApiClient.writeFailFast.test.ts` suites pin behaviourally the no-write-fallback invariant that fitness #25 enforces statically, and four `*ApiClient.cacheIsolation.test.ts` suites hold the circuit-breaker cross-tenant isolation fix — the roles as recorded by the 2026-09-26 correction in the replaced `testing-infrastructure-complete.md`; the counts re-measured (M: `fd -g` over `packages/providers` finds 7 and 4). The circuit breaker does not stand between a unit test and an apiClient.

**Skips and todos that no gate sees.** Client specs commit 6 `test.skip(` calls (`auth.spec.ts` 5, `visual.spec.ts` 1; M), and fitness #32 scans only `*.test.ts`/`*.test.tsx`. The four provider integration stubs (`linkedin`, `pinterest`, `snapchat`, `telegram`) each wrap `it.todo` cases in `describe.todo`; vitest reports them as 4 skipped files and 43 `todo` tests (R).

## 3. Execution

### What CI runs

Read from `.github/workflows/{ci,production-ci,nightly,performance}.yml`; the required column from `gh api repos/edwardricardo/omni-post/branches/main/protection/required_status_checks` (M).

| Check name                                  | Workflow                             | What it executes                                                                                                                                                                          | Required |
| ------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `Test Suite (shard 1)`, `(shard 2)`         | `ci.yml`                             | `apps/api`: `vitest run --shard=N/2 --reporter=blob --coverage.enabled`; shard 1 also regenerates the OpenAPI types and checks for drift                                                  | yes      |
| `Coverage Merge`                            | `ci.yml`                             | `needs: test`; merges the two blobs with `vitest run --mergeReports --coverage.enabled` and enforces the coverage floors                                                                  | yes      |
| `Integration Tests`                         | `ci.yml`                             | Boots the API and the workers, then `run-tests.sh` with `TIER=full-integration` on push and on PR alike                                                                                   | yes      |
| `Package Tests`                             | `ci.yml`                             | `turbo run test --continue`, excluding `@apps/api`, `@apps/admin`, `@apps/client`                                                                                                         | yes      |
| `Frontend Tests`                            | `ci.yml`                             | `apps/admin` `vitest run`; `apps/client` `vitest run`                                                                                                                                     | yes      |
| `Test and Build`                            | `production-ci.yml`                  | Tests **only on push** (`if: github.event_name == 'push'`), and then `pnpm run test`, which is `turbo run test --filter='[HEAD^1]'`: changed packages only. On a PR the job is build-only | yes      |
| `Security Audit`                            | `ci.yml` **and** `production-ci.yml` | `pnpm audit`; two different jobs emit this same name                                                                                                                                      | yes      |
| `Full test suite (cache bypassed)`          | `nightly.yml`                        | Cron 03:00 UTC: `turbo run build --force`, then `turbo run test --force`; files an issue on failure                                                                                       | no       |
| `Database & Memory Stress` → `k6 Load Test` | `performance.yml`                    | `pnpm perf:db`, `pnpm perf:memory`; the k6 job has `needs: db-stress`                                                                                                                     | no       |

`run-tests.sh` tiers (`apps/api/scripts/run-tests.sh:39-60`): unset runs the vitest unit step plus every `node:test` batch; `pr-integration` runs the DB-only batches; `full-integration` runs the DB-only and the live-API batches. A TIER-driven run fails on any skip and on a zero-test collection. The CI run 36281151728 executed 934 `node:test` tests in that tier (R).

CI timings, from the plan (P): the merge critical path is about 10 minutes, `Test Suite (shard 1)` 9m11s followed by `Coverage Merge` 47s; `Integration Tests` 8m01s; the nightly job 51 minutes.

### The full vitest run, locally

`turbo run test --force --concurrency=2 --summarize` on 2026-09-27 (R): turbo scheduled 169 tasks (86 `test`, 83 `build` they depend on), 169 successful, 0 cached, wall clock 535,077 ms. All 86 `test` tasks printed a vitest summary. The sum of vitest `Duration` over the 86 packages is 572.2 s. `@apps/api` holds 577 of the 832 files (69.4%), 8,988 of the 12,623 tests (71.2%) and 449.0 s of the 572.2 s (78.5%).

| Package                       | Test files | Tests | vitest Duration (s) |
| ----------------------------- | ---------- | ----- | ------------------- |
| `@apps/api`                   | 577        | 8,988 | 449.0               |
| `@providers/tiktok`           | 12         | 624   | 5.7                 |
| `@apps/client`                | 43         | 541   | 22.9                |
| `@adapters/cache-redis`       | 9          | 175   | 1.2                 |
| `@providers/instagram`        | 9          | 125   | 2.8                 |
| `@apps/workers`               | 17         | 125   | 2.2                 |
| `@providers/snapchat`         | 5          | 120   | 1.8                 |
| `@apps/admin`                 | 15         | 114   | 7.3                 |
| `@providers/linkedin`         | 6          | 108   | 1.2                 |
| `@adapters/dead-letter-queue` | 4          | 94    | 1.6                 |

<details>
<summary>All 86 packages</summary>

| Package                               | Test files | Tests | vitest Duration (s) | Notes                   |
| ------------------------------------- | ---------- | ----- | ------------------- | ----------------------- |
| `@apps/api`                           | 577        | 8,988 | 449.0               |                         |
| `@providers/tiktok`                   | 12         | 624   | 5.7                 |                         |
| `@apps/client`                        | 43         | 541   | 22.9                |                         |
| `@adapters/cache-redis`               | 9          | 175   | 1.2                 |                         |
| `@providers/instagram`                | 9          | 125   | 2.8                 |                         |
| `@apps/workers`                       | 17         | 125   | 2.2                 |                         |
| `@providers/snapchat`                 | 5          | 120   | 1.8                 | 1 file skipped, 9 todo  |
| `@apps/admin`                         | 15         | 114   | 7.3                 |                         |
| `@providers/linkedin`                 | 6          | 108   | 1.2                 | 1 file skipped, 12 todo |
| `@adapters/dead-letter-queue`         | 4          | 94    | 1.6                 |                         |
| `@providers/telegram`                 | 5          | 84    | 1.8                 | 1 file skipped, 11 todo |
| `@providers/youtube`                  | 4          | 84    | 1.7                 |                         |
| `@providers/bluesky`                  | 3          | 81    | 1.1                 |                         |
| `@adapters/external-apis`             | 5          | 79    | 1.6                 |                         |
| `@adapters/db-prisma`                 | 4          | 70    | 1.5                 |                         |
| `@providers/x`                        | 7          | 70    | 7.8                 |                         |
| `@adapters/queue-bullmq`              | 5          | 68    | 1.6                 |                         |
| `@providers/facebook`                 | 5          | 67    | 2.2                 |                         |
| `@core/bulk-scheduling`               | 4          | 60    | 1.1                 |                         |
| `@providers/pinterest`                | 4          | 60    | 1.0                 | 1 file skipped, 11 todo |
| `@core/projects`                      | 3          | 58    | 1.4                 |                         |
| `@core/domain`                        | 4          | 55    | 1.0                 |                         |
| `@providers/shared`                   | 2          | 49    | 1.0                 |                         |
| `@adapters/storage-s3`                | 2          | 47    | 1.3                 |                         |
| `@core/accounts`                      | 3          | 43    | 1.9                 |                         |
| `@observability/background-scheduler` | 2          | 39    | 0.3                 |                         |
| `@adapters/storage-cloudinary`        | 1          | 39    | 1.1                 |                         |
| `@adapters/fallback-strategies`       | 2          | 36    | 1.6                 |                         |
| `@core/customer-auth`                 | 3          | 35    | 0.9                 |                         |
| `@observability/browser-logger`       | 3          | 34    | 0.7                 |                         |
| `@core/application`                   | 2          | 31    | 0.9                 |                         |
| `@core/posts`                         | 2          | 27    | 1.2                 |                         |
| `@providers/threads`                  | 1          | 23    | 1.3                 |                         |
| `@packages/api-errors`                | 1          | 20    | 0.1                 |                         |
| `@core/team`                          | 3          | 19    | 1.1                 |                         |
| `@core/threading`                     | 1          | 18    | 0.9                 |                         |
| `@core/engine`                        | 1          | 17    | 0.8                 |                         |
| `@core/security`                      | 2          | 15    | 0.9                 |                         |
| `@monitoring/circuit-breaker`         | 1          | 14    | 0.8                 |                         |
| `@core/billing`                       | 2          | 14    | 0.8                 |                         |
| `@core/recurring`                     | 2          | 13    | 0.9                 |                         |
| `@adapters/crm-hubspot`               | 1          | 13    | 0.1                 |                         |
| `@adapters/crm-salesforce`            | 1          | 12    | 0.1                 |                         |
| `@packages/api-common`                | 1          | 10    | 0.1                 |                         |
| `@core/campaigns`                     | 2          | 10    | 0.9                 |                         |
| `@core/apiKeys`                       | 1          | 10    | 0.8                 |                         |
| `@core/auth`                          | 1          | 8     | 0.8                 |                         |
| `@core/external-notifications`        | 1          | 8     | 0.8                 |                         |
| `@core/ai-image`                      | 1          | 7     | 0.8                 |                         |
| `@packages/query-client`              | 1          | 6     | 0.8                 |                         |
| `@packages/i18n`                      | 1          | 6     | 0.1                 |                         |
| `@core/reports`                       | 1          | 6     | 0.9                 |                         |
| `@core/links`                         | 1          | 6     | 1.2                 |                         |
| `@core/brand-voice`                   | 1          | 5     | 0.8                 |                         |
| `@core/settings`                      | 1          | 5     | 0.8                 |                         |
| `@core/brand-kit`                     | 1          | 5     | 0.8                 |                         |
| `@core/analytics`                     | 1          | 5     | 0.8                 |                         |
| `@core/crm`                           | 1          | 5     | 0.8                 |                         |
| `@core/compliance`                    | 1          | 5     | 0.8                 |                         |
| `@core/embeddings`                    | 1          | 5     | 0.8                 |                         |
| `@observability/logger`               | 1          | 4     | 0.1                 |                         |
| `@core/inbox`                         | 1          | 4     | 0.8                 |                         |
| `@core/webhooks`                      | 1          | 4     | 0.8                 |                         |
| `@core/utm`                           | 1          | 4     | 1.1                 |                         |
| `@core/channels`                      | 1          | 4     | 1.1                 |                         |
| `@core/trends`                        | 1          | 4     | 0.8                 |                         |
| `@core/crisis`                        | 1          | 4     | 1.2                 |                         |
| `@core/first-comment`                 | 1          | 4     | 0.9                 |                         |
| `@core/notifications`                 | 1          | 4     | 0.8                 |                         |
| `@core/usage`                         | 1          | 4     | 0.8                 |                         |
| `@core/listening`                     | 1          | 4     | 0.8                 |                         |
| `@core/integrations`                  | 1          | 4     | 0.8                 |                         |
| `@core/aiPromptTemplates`             | 1          | 4     | 0.8                 |                         |
| `@core/comments`                      | 1          | 4     | 0.8                 |                         |
| `@core/guardrails`                    | 1          | 4     | 0.1                 |                         |
| `@core/providers`                     | 1          | 4     | 0.9                 |                         |
| `@core/custom-reports`                | 1          | 4     | 0.8                 |                         |
| `@core/approvals`                     | 1          | 4     | 0.9                 |                         |
| `@core/referral`                      | 1          | 4     | 0.8                 |                         |
| `@core/assets`                        | 1          | 4     | 0.8                 |                         |
| `@core/ml`                            | 1          | 4     | 0.8                 |                         |
| `@core/mentions`                      | 1          | 4     | 0.8                 |                         |
| `@core/style-guide`                   | 1          | 4     | 0.8                 |                         |
| `@core/glossary`                      | 1          | 4     | 0.8                 |                         |
| `@core/ai`                            | 1          | 4     | 0.8                 |                         |
| `@core/tasks`                         | 1          | 3     | 0.8                 |                         |

</details>

`ci.yml` excludes `@apps/client` from `Package Tests` with the comment that its `test` script (`vitest`, no `run`) is watch mode and would hang the job. In this local turbo run that same script completed: 43 files, 541 tests, 22.9 s (R). Its behaviour on a CI runner was not measured.

### First executions of what had never run

#### The 20 `node:test` suites no runner reaches

These are the files fitness #30 counts (baseline lowered from 21 to 20 on 2026-09-27, PR #314). Each file ran in its own process so a broken `before` hook could not hide a neighbour's verdict (R, `dark/SUMMARY.txt`):

- **18 of 20 pass as they are**, 71 tests, none skipped. They include the four customer MFA suites (`mfaCustomer` 8, `mfaTotpSingleUse` 4, `customerLoginMfa` 3, `customerLoginMfaE2e` 3), `redisTokenBucketRateLimiter` 4 and `data-retention` 2.
- **`tests/integration/trendRadarRoutes.test.ts` — 5 of 5 cancelled.** The suite's `before` hook fails at line 100: `prisma.trendRadarResult.create()` omits the required `dayKey` ("Argument `dayKey` is missing"), so node cancels every test in the file.
- **`tests/universal-client-dashboard.integration.test.ts` — 9 tests: 3 pass, 5 fail, 1 skip.** The first failure is line 96: it expects 9 registered providers and the registry reports 11. The others: line 130 (active-provider count), line 171 (health monitoring expected 200), lines 256 and 272 (expect 404 and 400, receive 401). In the same run the file prints its own summary, "All integration tests passed! Universal Client Dashboard is fully functional."

The August audit listed `mfaBackupCodeSingleUse.integration.test.ts` among these orphans; `run-tests.sh:313-314` now names it in batch `integration:mfa-backup-single-use`, which ran 4 tests in CI run 36281151728 (M; R, `ci-outbox.log`).

#### `security/tests`

Seven files outside every pnpm workspace, resolved from the root manifest, same one-file-per-process method (R). The runner script counted a file whose every test skipped as OK; here such a file is **vacuous**.

| File                                               | Tests | Pass | Fail | Skip | Verdict |
| -------------------------------------------------- | ----- | ---- | ---- | ---- | ------- |
| `api-security.injection.test.ts`                   | 10    | 0    | 0    | 10   | vacuous |
| `api-security.validation-auth.test.ts`             | 10    | 0    | 0    | 10   | vacuous |
| `infrastructure-security.test.ts`                  | 16    | 0    | 0    | 16   | vacuous |
| `injection-tests.ldap-xml-template-header.test.ts` | 8     | 0    | 0    | 8    | vacuous |
| `injection-tests.sql-nosql.test.ts`                | 6     | 0    | 0    | 6    | vacuous |
| `injection-tests.xss-command.test.ts`              | 6     | 0    | 0    | 6    | vacuous |
| `auth-security.test.ts`                            | 9     | 3    | 6    | 0    | red     |

The six vacuous suites register a user through `POST /api/auth/register` (directly or via `injection-tests.test-helpers.ts`); the TAP records "Route POST:/api/auth/register not found", no token is obtained, `dbAvailable` becomes false, and every test skips with the message "Database not available" or "Database or auth not available" — while Postgres and Redis were up. `auth-security.test.ts` targets `POST /auth/register`, which does not exist either: `apps/api/src/auth/authRoutes.ts` registers `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/auth/sessions` and `/auth/revoke-all`. Its first failure is `Weak password "123456" should be rejected (got 404)`; of its six failures, four receive 404 and two (the SQL and NoSQL injection-in-login cases) receive 429. The disposition of this suite is SMELL-83 in [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md).

#### E2E, `apps/client`

`pnpm --filter @apps/client test:e2e` (R, 1.8 minutes, exit 1): **834 tests, 3 passed, 795 failed, 36 skipped.** The 834 are 6 browser projects × 139 tests; the three specialised projects contributed none.

- **The 3 passes are the first green E2E in this repository's history**: `a11y.spec.ts`, "login page has no critical/serious WCAG 2 AA violations", in the `chromium`, `mobile-chrome` and `tablet` projects.
- **In the three Chromium-based projects, every failure is the same defect**: 132 per project, all `ReferenceError` — `AnalyticsPage` (42), `AuthPage` (27 in `auth.spec.ts`, 25 in `visual.spec.ts`), `PublishingPage` (38). Four of the five specs import only `{ test, expect } from "../config/test-setup"` (for example `apps/client/tests/e2e/tests/auth.spec.ts:6`) and then construct page objects they never import (`auth.spec.ts:20`: `new AuthPage(page)`); the page objects exist under `apps/client/tests/e2e/pages/`.
- **`firefox`, `webkit` and `mobile-safari` failed 133 each on `browserType.launch: Executable doesn't exist`**: only Chromium was installed on the measuring host (`pw-install.log`). That is an environment fact, not a repository fact.
- The 36 skips are the 6 committed `test.skip(` calls × 6 projects. The global setup logged "Cannot navigate to invalid URL" for `/login` and "Failed to seed test data" and continued.
- `apps/client/tests/e2e/config/playwright.config.ts` defines `webServer` only when `CI !== "true"` (`webServer: !isCI ? {…} : undefined`, with `reuseExistingServer: !isCI`), so under `CI=true` nothing starts the portal.

#### E2E, `apps/admin`

The admin config run by hand, because `apps/admin/package.json` has no E2E script (R, 7.5 minutes, one worker, one `chromium` project): **37 tests in 4 spec files, 8 passed, 29 failed.**

- The seed helper failed 21 times. `apps/admin/tests/e2e/helpers.ts:38` runs `pnpm --filter @infra/prisma exec -- node -e "const { prisma } = require('./src/client.ts'); …"` under bare `node`, with no TypeScript loader; `infra/prisma/src/client.ts:10` imports `../generated/prisma/client/client.js`, and the generated directory holds 133 `.ts` files and no `.js` (M), so the helper dies with `ERR_MODULE_NOT_FOUND`. The same command with the loader yields `typeof prisma === "object"` (F).
- One failure is a real accessibility defect, unrelated to seeding: `/en/login` has a **serious `color-contrast` violation** — the submit button renders `#ffffff` on `#3b82f6`, contrast 3.67 against the 4.5:1 WCAG AA minimum.
- The 8 passes need no seeded user: six login-page rendering and loading-state tests, "Content page renders without errors" and "Posts: no JavaScript errors on load".

#### `perf:db` and k6

`perf:db` is `tsx performance/database/postgres-stress.test.ts` in the root `package.json`. Five root `perf:*` scripts use the same bare-`tsx <file>` form, and fitness #27 Part A scopes neither the root `package.json` nor that form (F). The failure has three layers:

1. **Module resolution.** CI's `db-stress` job failed 38 of 38 times with `Cannot find module '@adapters/db-prisma/dist/index.js'`: nothing builds before the run (P).
2. **A stale call.** `postgres-stress.test.ts:44` calls `createBullMQQueueAdapter()` with no argument. Run with the development condition and the database env, it dies with `TypeError: Cannot read properties of undefined (reading 'connection')` at `packages/adapters/queue-bullmq/src/queue-adapter.ts:73` (R). The factory has required an `options` argument since `231a8798` (2026-04-30), and `aca3638d` (2026-06-09) made the injected connection mandatory; the stress file was last changed on 2026-06-08 (`47556bbf`) (M, `git log -S` and `git log -1`).
3. **Every failure exits 0.** `postgres-stress.test.ts:621` is `runPostgresStressTest().catch(console.error);`. All three local invocations printed a stack trace and exited 0 (R). Layer 1 fails while the module loads, before that `catch` is attached, and that is why CI turned red at all; with layer 1 alone repaired, the job would report green over a stress test that ran nothing.

`k6 Load Test` has `needs: db-stress`, so **its 6 scenarios have never run** (P). The k6 image is `grafana/k6:latest`, unpinned (`performance.yml:208`).

#### Nightly

31 issues labelled `nightly-failure` are open, created from 2026-08-26 to 2026-09-26 (M, `gh issue list --label nightly-failure --state open`). The plan counted 40 failures in 40 runs, with the test steps passing inside them (P). The latest run, 36229399515 on 2026-09-26, failed on the step "Upload mutation reports" (M, `gh run view`), a step that no longer exists on `main`. No nightly had run on a tree without that step when this document was written (2026-09-27T02:03Z).

## 4. Gates that cannot fail

These are not coverage gaps. Each is a check whose construction prevents it from turning red, or from saying why it did.

1. **`Test and Build` runs no tests on a pull request.** The step carries `if: github.event_name == 'push'` (`production-ci.yml:141-147`), the check is required, and on push it tests only packages changed against `HEAD^1`.
2. **`Coverage Merge` cannot fail when a shard fails.** `needs: test` covers the whole matrix (`ci.yml:235`), so when a shard is red the only job that enforces the coverage floors does not run — and it is also the only job that would render the blob into a readable failure (P). Whether a skipped required check satisfies branch protection is under "Not measured".
3. **The blind shard.** `--reporter=blob` replaces the default reporter and `apps/api` declares no other, so a red shard prints no test name, file, count or error class; a search of the failing log for 10 distinct markers returns nothing (P). `Integration Tests` is the opposite model: it names the failing batch and prints every `not ok` with its TAP block (R, `ci-outbox.log`).
4. **The OpenAPI drift gate skips silently.** Both steps carry `if: matrix.shard == 1` (`ci.yml:206`, `:222`), which GitHub wraps in an implicit `success()`, so any earlier failure in shard 1 skips the drift check; the plan saw that in 4 of the last 6 red runs (P).
5. **`Security Audit` is emitted by two jobs** (`ci.yml:628` and `production-ci.yml:23`) and satisfies one required context.

Two related defects surfaced while executing:

- **The shard-1 flake, unprovable by construction.** `Test Suite (shard 1)` reported FAILURE and SUCCESS on the same SHA, `12e1212d`, at 23:12 and 23:28 (P). The failing attempt's blob, merged in isolation, shows every visible file passing, one `{ type: 'Unhandled Error', stacks: [] }`, and a summary of "Test Files no tests / Tests no tests / Errors 1 error" (R, `flake-blob/`): the artifact cannot say which test failed. On `034efa99`, `Test and Build` showed the other face: `[vitest-pool]: Worker forks emitted error`, 576 of 577 files passing, zero assertion failures (P).
- **The outbox smoke races the API's own relay.** `apps/api/tests/integration/bulkScheduleOutboxSmoke.test.ts:139-143` builds its own relay, calls `relay.poll()` once and asserts exactly one enqueued job, while the API process that `Integration Tests` boots starts the real relay at `apps/api/src/index.ts:866` (`outboxRelay.start()`, inside `start()`, with no environment condition). Both compete for the same rows through the claim at `apps/api/src/infrastructure/outbox/OutboxClaimService.ts:90-98` (`publishedAt IS NULL AND retryCount < maxRetries AND nextRetryAt <= now AND (claimedAt IS NULL OR claimedAt < leaseExpiry)`). The neighbouring `apps/api/tests/integration/outbox/OutboxRelay.integration.test.ts` documents exactly this competition at lines 13-20 and defends against it with a sentinel pre-claim and `TEST_LEASE_MS = 30_000` (line 52); the smoke has no such defence. CI run 36281151728 on `6701be00` failed it with "one job enqueued per confirmed row", expected 1, actual 0, at line 143 (933 of 934 passing, R); a re-run of the same SHA passed 934 of 934 (F). A flake, not a regression of the merged chain.

## Findings for decision

Each entry states the evidence and the options seen. Choosing among them is the separate action plan; nothing here is a decision.

**F-1 — `Test and Build` promises tests and runs none on a PR.** Evidence: gate 1 above. Options seen: run the test step on PRs as well; rename the check to what it does; remove it from the required list and let `ci.yml` own PR validation, as the job's own comment says it does.

**F-2 — `Coverage Merge` is skipped exactly when a shard fails.** Evidence: gate 2. Options seen: run it with a status function (`!cancelled()`) and fail explicitly on a failed shard; move floor enforcement elsewhere; leave it and first establish whether a skipped required check blocks a merge.

**F-3 — The blob-only shard is blind, and the flake it hosts cannot be diagnosed.** Evidence: gate 3 and the shard-1 flake. Options seen: add a human-readable reporter next to `blob`; add an on-failure step that merges and prints the blob; collect more failing samples before changing the fork pool.

**F-4 — The OpenAPI drift gate disappears after any earlier shard-1 failure.** Evidence: gate 4. Options seen: give it a status function; move it to its own job.

**F-5 — One required context, two jobs.** Evidence: gate 5. Options seen: rename one job; keep both and record which one the context is meant to name.

**F-6 — The outbox smoke races the live relay.** Evidence: the outbox entry in "Gates that cannot fail". Options seen: adopt the sentinel pre-claim of `OutboxRelay.integration.test.ts`; keep the API's relay from starting under test; move the smoke to a batch with no API process; assert through the real relay instead of a second one.

**F-7 — `perf:db` cannot fail meaningfully, and k6 has never run.** Evidence: the three layers under "perf:db and k6". Options seen: build or add the development condition before the run; pass an injected connection or drop the queue from the stress test; exit non-zero on failure; retire the stress file; stop gating k6 on `db-stress`; pin the k6 image.

**F-8 — E2E exists and has no CI job; most specs cannot run at all.** Evidence: the client and admin E2E results. Options seen: import the page objects in the four client specs; fix or delete the three zero-match projects and the two scripts that select them; give `apps/admin` an E2E script and run its seed helper with a TypeScript loader; add a CI job with browsers and booted services; fix the admin login contrast; decide whether `CI=true` should start a web server.

**F-9 — 20 written `node:test` suites are unreached, and 18 of them already pass.** Evidence: the dark-suite results. Options seen: add the 18 to `run-tests.sh` batches (fitness #30's baseline then falls with them); repair the `trendRadarRoutes` fixture's missing `dayKey`; rewrite or delete `universal-client-dashboard.integration.test.ts`, whose assertions expect 9 providers where the registry has 11 and whose own summary prints success on failure.

**F-10 — `security/tests` is vacuous or red, and its skip messages blame a database that was up.** Evidence: the `security/tests` table. Options seen: point the suites at routes that exist and wire them into a runner with a skip counter-gate; fold the useful cases into the `apps/api` integration tier; delete the suite (SMELL-83).

**F-11 — Coverage is measured for one package.** Evidence: 1 of 86 configs, 551 of 1,896 files. Options seen: add coverage to the shared factory with measured per-package floors, starting with `packages/core`; measure per package without floors first; amend the canon's per-layer targets to what is measured.

**F-12 — Eleven packages produce no test signal, including `packages/ui`.** Evidence: "Packages with no test config". Options seen: require every workspace to declare `test` or appear in a justified allowlist; write suites for `ui`, `health-checks` and `opentelemetry`; retire the three storage adapters if nothing imports them.

**F-13 — Toolchain drift.** Evidence: the Jest 30 stack in the tree against the canon's "Jest is NOT allowed"; two vitest generations; `@types/node` one major ahead of the runtime and no `engines` field anywhere; 24 configs re-declaring the factory's defaults and `apps/workers` carrying its own copy of the factory's helper; 86 dead shims; MSW wired by no config while 9 client integration files stub `fetch`; the dependency lag. Options seen: per item, either align it or record the reason next to it, as the Storybook, `esbuild` and `eslint` holds already are.

**F-14 — Thirty-one unread nightly alarms.** Evidence: the nightly section. Options seen: close the issues filed for a step that no longer exists after the first green nightly; change how failures are reported so repeats do not open a new issue each night.

**F-15 — `test:coverage` is cacheable in turbo.** Evidence: `turbo.json` declares `test:coverage` with `outputs: ["coverage/**"]` and no `cache: false`, unlike `test` and `test:e2e` (M). Options seen: set `cache: false`; leave it while no workflow invokes the task.

**F-16 — `@apps/client`'s `test` script is `vitest` without `run`.** Evidence: the `Package Tests` exclusion comment against the local run completing. Options seen: make the script `vitest run` and drop the special case; keep the exclusion.

**F-17 — Mutation testing has no replacement.** Evidence: the tooling table. The options are listed in the Master Plan entry N-CI-4.

## Not measured

- Whether a required check in state SKIPPED satisfies branch protection: no pull request in the corpus had `Coverage Merge` skipped with every other check green.
- Current coverage percentages: the floors were read from `apps/api/vitest.config.ts`, and the 2026-09-27 run did not enable coverage.
- The cause of the shard-1 failure on `12e1212d`, and whether the `Worker forks emitted error` crash belongs to the memory-exhaustion class that `maxWorkers: 1` bounds.
- Whether `@apps/client`'s `vitest` script hangs on a CI runner; it completed under turbo on the measuring host.
- Which of the 28 admin E2E failures other than the accessibility one are caused by the seed helper, test by test.
- The client E2E suite in Firefox and WebKit: those browsers were not installed on the measuring host.
- What Playwright does when `--project=accessibility`, `visual-regression` or `performance` is invoked alone with zero matching files.
- Whether all 78 `node:test` files named by `run-tests.sh` sit in a batch that `TIER=full-integration` selects.
- The five local integration failures seen while reproducing the red `main` were attributed to database contamination (85 migrations applied locally against 83 on disk: `20260917093257_add_post_channel_publication` and `20260919222448_add_retraction_alert_notifications` exist only in the local database, and `prisma migrate status` did not report them). Four are in `integration:tenant-isolation` and read the policy catalog; the fifth, an event-ordering assertion in `integration:saga-recovery` (`sagaPublishNowPromotion.test.ts`), was not traced to those migrations.
- Whether the stress logic in `postgres-stress.test.ts` works once its first two layers are repaired, and what the six k6 scenarios' thresholds would report.
- The dependency-lag counts were not re-run with `pnpm outdated -r`; only vitest was re-checked.
- The CI job timings were taken from the plan, not re-read from run logs.
- The plan's 45 single-file packages against the 50 counted here.
- Figures from the August audit that were not re-measured: the share of production modules outside every test's import closure, the frontend reach, the estimate of vacuous test blocks, and the state of the non-required check-runs (Container Security and others).

## How to extend

**Add tests to a package.** Give it a `vitest.config.ts` built with `defineWorkspaceVitestConfig` from `@packages/vitest-shared` without re-declaring the factory's defaults, and a `test` script that runs `vitest run`. A package without a `test` task is invisible to `turbo run test`, to `Package Tests` and to the nightly job; nothing reports its absence.

**Wire a `node:test` suite in `apps/api`.** Add its path to a `run_batch` in `apps/api/scripts/run-tests.sh` under the tier predicate that matches the services it needs (`run-tests.sh:48-60`). Fitness #30 counts unreached files as a ratchet; when a change wires one, lower the baseline in `CLAUDE.md` and `.github/workflows/fitness.yml` in the same change.

**Add or change a gate.** Follow `CLAUDE.md` "Extending the suite": prove the red path with a real non-zero exit before merging.

**Keep this document current.** Re-run the commands this document names, update **As of**, and move a finding out of "Findings for decision" only with the evidence that closes it. A number whose measurement could not be repeated goes to "Not measured"; it is not carried forward. The full vitest table re-derives from a `turbo run test --force --concurrency=2 --summarize` log: strip `\x1b\[[0-9;]*m`, then read each package's `Test Files`, `Tests` and `Duration` lines. The document already has the canon-child shape (`**Owner:**` and this section), so fitness #24 can adopt it if that is decided.
