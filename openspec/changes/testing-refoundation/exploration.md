# Exploration: testing-refoundation

Re-foundation of the whole testing system so that a green run is evidence. INVESTIGATION ONLY — no source edited, no test/build/install run, no git. This document is the SDD exploration artifact; it is derived from the approved plan and from re-opening the cited files at source on branch `workstream/testing-refoundation`.

## 0. Provenance, and one correction on sources

Primary source: the approved plan at `/root/.claude/plans/lazy-swinging-moon.md` — 14 signed points, 20 signed authority decisions D1-D20, three contracts, ten phases (~130 work units), and three read-only evidence appendices A (CI/runners/environment), B (shared tooling and docs), C (demolishable inventory).

**Correction, verified:** `docs/development/TESTING_INFRASTRUCTURE.md` is **not present on this branch**, and no file in the repository references it (checked by glob over `docs/development/*.md` and by content search repo-wide: zero matches). It lands with its own pull request — signed point 5 lists "el informe" among the green open PRs that must merge before the workstream starts. Consequence: the `F-1..F-17` numbering cannot be dereferenced from this branch. What the plan pins explicitly is:

| Finding | Subject                                     | Plan site                    |
| ------- | ------------------------------------------- | ---------------------------- |
| F-1     | duplicated "Test and Build" job             | WU-3.5                       |
| F-2     | Coverage Merge certifies a red suite        | WU-3.4                       |
| F-3     | the shard is blind (no named reporter)      | WU-3.2                       |
| F-4     | OpenAPI drift buried inside shard 1         | WU-3.3                       |
| F-5     | a second job named "Security Audit"         | WU-3.5                       |
| F-6     | tests build their own `OutboxRelay`         | WU-4.4 (a class, not a test) |
| F-9     | `trendRadarRoutes` missing `dayKey`         | WU-1.8                       |
| F-12    | 11 packages with no coverage config         | WU-5.9                       |
| F-14    | `chaos.yml` re-runs the whole tier as owner | WU-4.7                       |
| F-15    | `turbo` caches `test:coverage`              | WU-5.1                       |
| F-16    | `apps/client` `test` script is watch-mode   | WU-1.11                      |

`F-7`, `F-8`, `F-10`, `F-11`, `F-13` and the range endpoint `F-17` are referenced only as the span "F-1..F-17" and cannot be bound to a subject from the plan text. This is an open question for the proposal (§7.2), and it has a second-order effect: WU-8.8 ("re-measure the report") and D16 (add the report to fitness #24's anti-deletion list) both depend on a document that is not yet on the trunk.

Everything in §3 was re-opened at source on this branch. Each judgement carries `file:line`.

## 1. Problem statement, and the signed definition of "confianza"

The repository has 12,623 green tests that do not constitute evidence. The problem is therefore not a shortage of tests; it is that the battery's verdict is uninformative. Four things were signed and are not re-litigated:

**Confianza** (point 1) = the code passes a battery that is **strict and exhaustive**, not accommodating. Every layer has its honest gate, and the merge is blocked by **all** of them.

**A test proves in both directions** (point 2): it fails when the behaviour is not met and passes when the code meets it. This is the same principle as "a gate is born with its red demonstrated", applied to each individual test — and it is the criterion both for demolishing and for building.

**Decorative test criterion** (point 3) — any one of four, proven per file and **listed before deleting**:

- (a) does not restrict behaviour — only asserts existence;
- (b) points at something that does not exist;
- (c) skips itself under the conditions CI actually provides;
- (d) cannot fail by construction.

The hard probe for a doubtful case: gut the implementation. If the test stays green, it is decorative.

**Order** (points 4, 13): decorative things are deleted **first** and the count may fall; frameworks are **not** deleted, they are re-founded afterwards. Start at the floor — reach, then demolition, then gates that can fail, then the integration tier, then coverage across all 86 configs, then re-found what is decorative, then mutation, then the tail. Starting at E2E would build the bedroom on the roof again.

## 2. Current state, measured

Numbers from the plan's §Context and appendices (the report's measurement) unless marked **[verified here]**.

| Dimension           | Measured                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test files          | 942 in workspaces + 8 outside                                                                                                                              |
| Tests               | 12,580 vitest passed / 43 `todo` · 934 node:test under TIER · **0 Playwright in CI**                                                                       |
| Vitest configs      | 86; coverage configured in **1** (`apps/api`)                                                                                                              |
| apps/api floors     | lines 56.8 · functions 57.3 · branches 47.8 · statements 56.2 **[verified: `apps/api/vitest.config.ts:116-119`]** vs a canon table of 90/85/70/70/75       |
| Unreached suites    | 20 node:test suites no runner collects (fitness #30 ratchet baseline 20)                                                                                   |
| Double-collected    | ≥10 files with two collectors; 23 orphan test files                                                                                                        |
| Decorative mass     | 272 `it/test` blocks in 105 files whose only assertion is existence; 1,941 of 27,073 assertion lines are existence-only                                    |
| Skips               | 114 runtime `t.skip(` in 17 files (65 in `security/`, 49 in api) · 6 `test.skip(` in client specs · 43 `it.todo` · 4 `describe.todo` stub files            |
| Verdict composition | 19 required checks, `strict: false`; `needs:` chains without `always()` → an upstream red becomes a downstream **skipped**, which GitHub counts as success |
| Environment         | 4 distinct Postgres identities across workflows; 12 workflows, **none** invokes Playwright, `test:e2e` or docker-compose                                   |
| Duplication         | 44 `fetch` stubs · 28 `createTestApp` copies · 35 `as unknown as PrismaClient` · 186 local factories of which 19 exported · `seedTenant` ×13               |
| Density             | `packages/core`: 51 subpackages, 488 sources / 72 tests, 39 with exactly one test; 11 packages with no vitest config at all                                |

The one thing that actually protects a merge today: `apps/api`'s vitest unit suite plus the node:test integration tier.

## 3. Code-quality judgement, surface by surface

Verdicts: **KEEP** · **KEEP-AND-ABSORB** (move the substance, do not re-derive it) · **REBUILD** · **DEMOLISH**.

### 3.1 `apps/api/scripts/run-tests.sh` — split verdict: the best-built verdict machinery in the repo bolted to the worst inventory

**KEEP, and preserve byte-exact:** the four-term failure disjunction (`:476`) with its explicit defence-in-depth rationale and its instruction not to "simplify" it back to one term; the per-batch guards for fail / cancel / skip-under-TIER / zero-collect (`:104-130`); the runner-exit capture that survives a crash after the summary (`:84`); the TAP reporter pin with the measured reason that the default `spec` reporter parses as 0 tests (`:77-84`); the `not ok` printer that names every failure **before** the tail window, added because the `production` batch produced two red runs whose logs never said which test failed (`:147-152`); the total zero-collect refusal (`:505-508`). Fitness #31 B pins two of these. Every one exists because a specific green-over-nothing was measured.

**DEMOLISH — the hand-maintained inventory** (`:221-445`: 18 batches, 78 named paths). The file's own header admits both holes: "a suite no batch names never runs (SMELL-75), and a batch can silently stop running a path it does name (SMELL-74) ... treat the lists as the inventory, never as proof of coverage" (`:8-13`). A list that can be wrong in two directions is the direct cause of the 20 unreached suites. Replaced by convention-based collection (WU-1.7/1.8).

**DEMOLISH — the vitest phase** (`:165-207`, with `run_vitest_phase` at `:48-51`): a second collector living inside the integration collector, carrying its own summary **text parser** (`:180-185`) whose comment records that an unanchored match once reported file counts as test counts (18 instead of 219). Two runners in one script is a principal reason "files with >1 collector" is ≥10.

**DEMOLISH, and raise its priority — the `.env` sourcing** (`:19-23`). When `DATABASE_URL` is unset the script sources the **root `.env`** — the development database — into the integration tier. The fixtures in that tier are destructive: `bulkScheduleHarness.cleanupTenant` issues `deleteMany` on `outboxEvent`, `outboxDeadLetter`, `bulkScheduleItem`, `bulkScheduleBatch`, `channel`, `project`, `account` (`apps/api/tests/integration/helpers/bulkScheduleHarness.ts:142-156`). A local `TIER=full-integration` with an unset URL therefore deletes development data. WU-1.6's `exit 2` is not tidying; it is a data-loss fix, and the proposal should frame it that way.

**DEMOLISH — the two ordering hacks** (`assert_publish_consumers` `:367-391`; `wait_for_api` `:419-453`). Both are carefully reasoned — `assert_publish_consumers` even distinguishes UNKNOWN from a decisive zero so the reader is not sent to restart healthy workers, and `wait_for_api` refuses to run the `production` batch rather than let a limiter artifact read as an outage. The reasoning is right; the **shape** is wrong. They compensate for a test that does not restore shared state (`tests/security.test.ts` deliberately exhausts the `/health` rate-limit window). WU-1.4 puts the restoration in the contaminating test, which is where it belongs.

Residual: `CONCURRENCY` defaults to 4 (`:66`) and every call site passes 1 — a dead default that reads like configuration.

### 3.2 `packages/vitest-shared/src/index.ts` — KEEP the mechanism, REBUILD the surface

**KEEP:** the reason it is a package and not a root file (`:1-11`) — a relative `../../vitest.shared` breaks from a copied or relocated tree in every spelling, and the comment ends "Do not collapse this back into a root file"; `findMonorepoRoot` searching for the `pnpm-workspace.yaml` marker instead of counting `../..` (`:51-60`); the alias map **derived** from `tsconfig.base.json` `paths` so a new workspace alias needs no edit here (`:77-123`); the two-pass glob-then-bare precedence and the longest-find-first sort (`:121`); and the `forbidOnly` comment (`:146-151`), which is the repository's own written record of a guard that guarded nothing ("it appears nowhere in vitest 4.1.11 ... Do not reintroduce it").

**The defect is what it does not set.** The factory's `test` block (`:142-152`) has `environment`, `globals`, `pool` — and no `include`, no `reporters`, no `coverage`, no `setupFiles`, no `exclude`. Five of the workstream's contracts converge on exactly those missing defaults: `RESERVED_TIER_EXCLUDES` (WU-1.2), named reporters (WU-3.2), the skip-gate reporter (WU-3.8), coverage + `ratchetFloor` (WU-5.1), MSW isolation via `setupFiles` (WU-6.M2). So this file is well built and under-used, and it becomes the single highest-fan-out file in the plan.

**Coupling that decides a measurement:** `buildWorkspaceAliases` force-maps `@infra/prisma` to `infra/prisma/src/vitest-entry.ts` (`:109-118`). The node:test→vitest experiment (WU-4.X1) must remove exactly that override to reach the real client, and hypothesis H4 ("no mock/alias/stub added to make Prisma or the saga engine run under vite") is therefore decided in this file.

**Structural inversion worth naming:** `apps/api/vitest.config.ts` does **not** use the factory (its own config builds aliases directly). The one config that has coverage is the one outside the shared factory — which is precisely why coverage sits at 1 of 86.

### 3.3 `apps/api/tests/unit/helpers/mockPrisma.ts` — REBUILD, for a sharper reason than duplication

**KEEP:** the stateful store model (`:26-34`, 11 model stores with `add/get/update/remove/clear/all`), `$transaction` handling both the callback and the array form (`:690-695`), and the automatic seeding of the three system roles so RBAC lookups work out of the box (`:720-722`). With 34 importers this is real leverage.

**DEMOLISH by behaviour — `:707-710`:**

```
$queryRaw: vi.fn(async () => []),
$queryRawUnsafe: vi.fn(async () => []),
$executeRaw: vi.fn(async () => 0),
$executeRawUnsafe: vi.fn(async () => 0),
```

preceded by the comment "used by PrismaUnitOfWork (S2.1c) to bind `app.account_id` via set_config. In tests the RLS layer doesn't apply, so these are no-ops" (`:704-706`). Any subject whose behaviour is carried by raw SQL **cannot fail** under this double, and the comment names its own victim: the transaction-local GUC binding that is layer 2 of tenant isolation. This is criterion (d) at the **harness** level — not one decorative test but a harness that makes a whole class of test unable to fail. WU-S.3's decision to make raw SQL **throw** ("raw SQL is not simulated: test this path in the integration tier") is therefore not ergonomics: it converts silent passes into listable ledger rows.

Same class, one line up: `$extends` is an identity wrapper returning the same mock (`:701-703`), with the honest comment that "our tests don't exercise the tenant guard semantics". Every unit test that goes through `setupContainer({ prisma })` runs with the tenant guard structurally absent. The honesty is welcome; the consequence is that unit tests prove nothing about `accountId` injection, which is why WU-6.N1 must own that proof in the integration tier and not in unit.

The 35 `as unknown as PrismaClient` casts are the symptom; a single `asPrismaClient` seam plus the S.8 lint gate is the right shape.

### 3.4 `apps/api/tests/integration/helpers/*` — KEEP; this is the standard the rest should be raised to

`seedPrismaClient.ts` is exemplary and needs nothing. It explains the owner/app-role split from the threat (`:9-18`), and it explicitly refuses the one-line alternative of binding the owner channel silently inside `createTestPrismaClient` because that "would have made every future test connection bypass row security without saying so at the point of use. That is the same defect this workstream exists to remove — a proof that never observed the role it claims to be about" (`:20-29`). `assertSeedChannelConfigured` (`:96-98`) resolves at module scope because node:test reports a failing `before` by cancelling every child — measured at 18 cancelled / 0 failed — and a run in that shape reads as a leak while the one line naming the cause is buried.

`appRoleClient.ts` is the template every new Track S helper should be held to. It states what it does **not** prove (`:33-36`), refuses a silent fallback to the owner channel because that "would turn every assertion written against this client into a claim about a superuser session" (`:38-43`), verifies the posture on the live connection (`assertAppRoleSession`), rejects the credentialed-login alternative on a measurement about credential availability in CI (`:26-31`), and carries the number that justifies its existence: the same 18-suite batch measured 177/177 as the owner and 170/177 as `omnipost_app` (`:13-14`).

`bulkScheduleHarness.ts` — KEEP the stub `QueuePort` (`:31-55`) and the tenant seeds; the defect is `makeRelay` (`:65-76`), which constructs a **second real** `OutboxRelay` against the same database. With the production relay live (`src/index.ts:866`) both claim the same rows. That is F-6, and it is a **class** — three suites route through this one factory — which is why WU-4.4 must land before those suites leave quarantine.

One additional hazard, not in the plan: `cleanupTenant` (`:142`) does `outboxEvent.deleteMany({ where: { aggregateType: "BulkScheduleItem" } })` with no tenant, batch or suite scope. It is safe only because the whole tier runs at `CONCURRENCY=1`. The moment the new collector parallelises anything, this deletes a sibling suite's rows. Either "the services tier stays serial" becomes a stated invariant of the reach contract, or Track S scopes this cleanup (§6.5).

### 3.5 Playwright configs and page objects — DEMOLISH; "decorative" understates it

The plan calls the client E2E tree decorative because 207 referenced `data-testid` attributes do not exist in the source. The reading found something stronger.

**`apps/client/tests/e2e/pages/BasePage.ts` cannot compile.** The `Page` import is commented out (`:6` — `// Page type not used directly '@playwright/test';`), `protected page: Page` references an undeclared type (`:14`), the constructor is `constructor(_page: Page) { this.page = page; }` — assigning from an identifier that does not exist in scope (`:16-17`), and `Locator` (`:21`) and `expect` (`:72`) are used and never imported. This file is not merely pointed at absent selectors; it was never syntactically valid.

Nothing noticed because `apps/client/tsconfig.json:41` excludes `tests/**/*`. **The entire E2E tree is outside `tsc`.** That is the finding with the longest reach in this section: whatever WU-6.E1-E4 rebuild must land inside a typecheck scope, or the next `BasePage.ts` is invisible again.

Client config (`apps/client/tests/e2e/config/playwright.config.ts`): nine projects (`:79-151`), of which `accessibility` matches `**/*.accessibility.spec.ts` (`:124`) and `performance` matches `**/*.performance.spec.ts` (`:149`) while the only accessibility file on disk is `a11y.spec.ts` — so those projects collect zero tests, and `apps/client/package.json:25` ships a `test:e2e:accessibility` script that runs an empty project. `webServer` exists only outside CI and starts only `pnpm dev` on 3200 (`:158-166`): never the API, never the workers — so no spec in this tree could ever have exercised a backend path, independent of the selectors. `retries: isCI ? 2 : 0` (`:45`) with no `failOnFlakyTests` means a test that passes on the third attempt reports green (D14 corrects both).

Admin config (`apps/admin/playwright.config.ts`): `webServer` and `globalSetup` are **commented out** (`:88-99`), and there is no `test:e2e` script. A config whose server boot is a comment is documentation, not a harness.

**KEEP:** `utils/a11y.ts` in both apps — imported by the one spec that is real. The near-duplicate pair is accepted residual per the plan.

**Budget note:** `test-results/` and `playwright-report/` are gitignored (`.gitignore:28-31`), so the ~100 failure screenshots and `error-context.md` files sitting under `apps/client/tests/e2e/config/test-results/` are untracked local residue, not committed fiction. They should not consume an EVIDENCE budget line.

### 3.6 `performance/` — DEMOLISH (D10/D11 hold; one file is the clearest criterion (d) in the repository)

`performance/database/postgres-stress.test.ts` contains **zero** `expect(`, `assert.` or `assert(` occurrences in the entire file — verified by content search, no matches — while carrying the `.test.ts` suffix. Meanwhile `performance.yml:96-98` introduces the steps that run it with "The threshold steps below assert. They used to carry continue-on-error, which made this workflow structurally incapable of reporting a regression." They do not assert. The thresholds are `console.warn`. The `continue-on-error` was removed from a step that cannot fail regardless.

`performance/k6/scenarios/api-performance.js:78` reads `const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"` while `performance.yml:221` passes `-e API_BASE_URL=http://localhost:3000`. Two compounding defects: the variable name never matches, **and** the fallback hides the mismatch — because the container runs with `--network host` (`:219`), `localhost:3000` happens to reach the API, so the scenario appears to work while ignoring its configuration entirely. This is the archetype of a default that converts a misconfiguration into an invisible one.

Deeper: every scenario targets `/api/projects`, `/api/auth/profile`, `/api/providers/...` (`:137-410`). `apps/api/src` registers **no** `/api` prefix and has no `/auth/register` route — verified, zero matches for either across the whole `apps/api/src` tree. The scenarios load-test 404s. `docker pull grafana/k6:latest` (`:208`) is an unpinned tag, and the k6 job is `needs: db-stress` (`:117`) — the one real gate queued behind two that cannot fail.

**KEEP nothing under `performance/` as-is.** Do keep the _shape_ of its API readiness block (`:189-205`) — liveness checked inside the loop, timeout classified separately from death — which is the same good block as `ci.yml` and belongs in `test-env.sh up`.

### 3.7 `security/tests` — DEMOLISH; the suite says so itself

`security/tests/auth-security.test.ts:5-11` carries this header: "DO NOT WIRE THIS SUITE INTO CI. It cannot pass: every URL it targets is under an `/api/*` prefix the application never registers, so the `before` hook 404s and every test skips. A database does NOT fix this — the run is byte-identical with Postgres up and down."

That honesty is admirable and it is also the verdict. A suite that documents it cannot pass exists only to look like coverage — criteria (b) and (c) together.

The mechanism, verified: `before` swallows every error (`catch { dbAvailable = false }`, `:27-29`) and each test opens with `if (!dbAvailable) { t.skip("Database not available"); return }` (`:38-41`). Criterion (c) by construction, and (d) as a consequence, because no assertion can ever be reached.

The header is itself already stale: it blames an `/api/*` prefix, but the suite now posts to `/auth/register` (`:57`) — which also does not exist. Decay layered on fiction.

The 12 cases WU-6.S1 folds into the live tier are the correct salvage, and the SSRF case is the one likely to go **genuinely red** (plan finding 14: external-notification sinks validate HTTPS only, `ConfigureExternalNotificationUseCase.ts:74-76`, and `secureSchemas.ts:129` blocks `localhost` by substring). The proposal must pre-authorize opening a SMELL / N-SEC row for that red instead of committing the case skipped.

### 3.8 CI workflows — individual gates are often excellent; the verdict COMPOSITION is not

**KEEP verbatim, and use as the template for `scripts/test-env.sh`:**

- the API and workers readiness blocks (`ci.yml:461-474`, `:505-518`): liveness checked inside the wait loop and exit-code classification that distinguishes "never became ready" from "exited during boot", with the stated reason that the server's output now goes to a file so it is no longer live;
- the log-dump-and-liveness step (`:544-570`) whose **exit status is the liveness verdict**, with the reason written out: "An annotation colours a line in the log and leaves the job green, so a run whose suites all passed against a server that died halfway would still report success";
- the `Security Audit` retry and classification block (`:639-681`). This is the highest-quality gate in the repository. It distinguishes "measured clean" from "could not measure", classifies by exit code plus failure signature rather than prose, retries with backoff on a network signature, and fails closed on an unmeasurable run **while saying which** — with both lies named explicitly: "'measured clean' and 'could not measure' must never collapse into each other, in either direction";
- the Build Check no-output gate (`:612-622`), including its honest scope statement about cache-hit replay blindness and why saving cache in only this job makes that acceptable.

**REBUILD — `coverage-merge` is `needs: test` with no `if: always()`** (`:235`). A red shard makes the certifier **skip**, and a skipped required check counts as success. F-2 verified at source.

**REBUILD — the shard runs `--reporter=blob` only** (`:189`), so the job log names no test. F-3 verified.

**REBUILD — the OpenAPI drift gate lives inside the shard job** behind `if: matrix.shard == 1` (`:203-230`). Two consequences, and the second is not in the plan: it is not an independent verdict, **and** because workflow steps abort on the first failure, a red shard-1 test step means the drift gate never runs at all. It is a gate that disappears exactly when the suite is unhealthy.

**REBUILD (policy change, not correction) — `Surface a risen coverage floor`** (`:264-298`). Its own comment states "It FAILS NOTHING, deliberately: a risen floor is good news, not a violation", and it reasons correctly about fitness #34 (`::warning` is the right instrument for a non-failing annotation). Under D14's strict ratchet this becomes the red path (WU-5.8). The existing reasoning should be preserved and its conclusion inverted, with the new reason stated.

**DEMOLISH — `production-ci.yml` `security-audit`** (`:22-24`). It carries the **same job name** as `ci.yml:628`, and its body is a verbatim copy whose comment asks the reader to "Keep the two copies in lockstep when editing either" (`:38-41`). Two jobs answering for one required context name is #44 rule V1's exact target. F-5 verified.

**DEMOLISH — `production-ci.yml` `test-and-build`.** Typecheck, lint, format and tests are **all** `if: github.event_name == 'push'` (`:118-147`). On a pull request, the required check named "Test and Build" builds and runs no test — the name asserts what the PR path does not do. Its Postgres is `postgres:16-alpine` with `test_db`/`test_user` (`:78-83`), without pgvector and without any migration step: the fourth identity. F-1 verified, sharper. Sequencing note: `container-security` is `needs: test-and-build` (`:168`), so WU-3.5 must repoint that dependency in the same PR, and Edward's admin removal of the required context must precede the merge or the PR waits forever on a check that no longer exists.

**DEMOLISH — `nightly.yml:91-95`.** `turbo run build --force` plus `turbo run test --force` duplicates the PR checks (the `test` task is already `cache: false`); the job migrates without seed and without the app role (`:79-89`); and `Notify on failure` (`:97-112`) creates a **new** issue on every run with no deduplication — the 31 open `nightly-failure` alarms. The `permissions` comment (`:18-25`) records that the step previously died with "Resource not accessible by integration", "which is why no nightly failure has ever produced an issue" — so the entire backlog of 31 accumulated after that fix, unread.

**DEMOLISH — `security-testing.yml` `custom-security-tests`** (`:79`). It runs `test:auth`, `test:rbac`, `test:security`, `test:mfa`, `test:ratelimit` (`:182, :198, :219, :248, :262`) over the same node:test files `run-tests.sh` already runs in `integration:flows` and `remaining`, and it runs them as the **owner** rather than the app role — a strictly weaker second collector. The `if: always()` on each suite (`:174, :195, :211, :245, :261`) is right for reporting and irrelevant to the duplication.

**DEMOLISH — `audit.yml` OSV-Scanner** (`:110-119`). `set +e`, then `if [ "$CODE" -ne 0 ] && [ "$CODE" -ne 1 ]` — exit 1, which is "findings", is treated as success; the step is titled "report only — baseline has 90 vulns". It is a **required** check that cannot fail on the thing it exists to find.

**DEMOLISH — `audit.yml` gitleaks** (`:144-152`). The pull-request path runs `gitleaks protect --staged` on a fresh `actions/checkout`, where nothing is staged: it scans an empty index. The push path (`:153-161`) is `detect` under `set +e` with a `::warning`. Neither can block a secret in a PR, which is the one thing the job is named for.

**Structural, and the reason this is a composition problem:** 19 required contexts with `strict: false`, and `needs:` chains lacking `always()` (Appendix A: Coverage Merge ← test, Test and Build ← security-audit). That is the mechanism by which an upstream failure becomes a downstream "skipped" that GitHub counts as a pass. The fix is D6's committed ruleset plus #44's composition rules, not nineteen individual repairs.

### 3.9 `scripts/ci-setup-test-env.sh` — KEEP-AND-ABSORB (WU-4b.1 should move these lines, not re-derive them)

Genuinely well built. It fails fast on `DATABASE_URL` and `REDIS_URL` with `:?` and an explicit no-fallback rationale tied to CWE-798 / fitness #15 (`:7-10`, `:15-16`). It stores no secret-shaped literal anywhere: `PLATFORM_ENCRYPTION_KEY` is derived from 32 bytes of `/dev/zero` (`:29`) and the name-digest ring from a printed, obviously-non-secret phrase (`:38`). And its single-quoting comment (`:54-63`) is a measured three-way comparison of how bash `source` and dotenv disagree on `{"1":"x"}` — unquoted, escaped, single-quoted — with the consequence named: the unquoted form "breaks the whole integration tier with a boot refusal that names the ring rather than the quoting". That is exactly the standard of evidence this workstream wants everywhere.

Two real defects: `PORT=3001` (`:42`) collides with Grafana in the homelab, which is why D9 moves test ports to dev+10 (API 3010); and `ENABLE_RATE_LIMITING=false` (`:67`) is contradicted at boot by `ci.yml:449` setting it to `"true"` for the full tier. The file's value is therefore a lie about the running system for anyone who reads it. The environment contract must own one value, not two.

### 3.10 Cross-cutting judgement

**The repository's failure is not craftsmanship.** Nearly every individual mechanism I opened is carefully reasoned and carries its own measured rationale: `run-tests.sh`'s four-term disjunction, the audit retry classifier, `appRoleClient`'s statement of what it does not prove, the vitest factory's package-not-file argument, the coverage floors' account of why 0.1pp of slack is load-bearing. The failure is **composition and reach**: excellent guards wired to a hand-maintained inventory, an unreachable half of the tree, and a required-check list in which skips count as passes. This is why the plan's order (reach → demolition → verdict → environment → coverage) is right, and why starting at E2E would rebuild the roof.

**The second pattern is the fallback.** In every defect found, a default hid it: `__ENV.BASE_URL || "http://localhost:3000"` (the variable name never matched and nobody could tell), `run-tests.sh` sourcing `.env` (the integration tier silently pointed at dev), `skipIfApiUnavailable` (a missing service became a pass), `dbAvailable = false` (a 404 became a skip), `$queryRaw → []` (raw SQL became a no-op). The legitimate counter-example proves the rule: `resolveSeedDatabaseUrl`'s `MIGRATE_DATABASE_URL || DATABASE_URL` (`seedPrismaClient.ts:51`) is a fallback that is **documented with its reason** and throws when both are absent. The workstream's throughline is therefore one sentence — **replace a default with a refusal** — and it unifies roughly fifteen separate work units. It belongs in the proposal as a stated design principle, because stating it once is cheaper than deriving it fifteen times.

## 4. Affected areas

- **Collectors and reach** — `apps/api/scripts/run-tests.sh`, all 86 `vitest.config.*`, both `playwright.config.ts`, `performance/k6/**`, new `packages/test-contracts/`, fitness #30/#31/#32/#36/#37.
- **Shared tooling** — `packages/vitest-shared/src/index.ts` (five contracts converge here), new `packages/test-utils/{domain,wire,persistence}`, new `packages/eslint-plugin-testing/`, `apps/api/tests/unit/helpers/**` (14 files, 3,419 lines), `apps/api/tests/integration/helpers/**`, `apps/api/tests/support/` (new home for the route-app builder).
- **Verdict** — `.github/workflows/{ci,production-ci,nightly,performance,security-testing,audit,fitness,chaos,eval}.yml`, new `.github/rulesets/main.json`, fitness #44-#49.
- **Environment** — new `scripts/test-env.sh` absorbing `scripts/ci-setup-test-env.sh`, `.env.test.example`, `turbo.json`, `infra/prisma/seed-e2e.ts` (new), the Telegram `apiClient` base-URL seam (the workstream's only production change).
- **Canon and docs** — `CLAUDE.md` §Automated Compliance Checks, `docs/development/CODING_STANDARDS.md` §Testing, new `docs/development/TESTING_REFOUNDATION.md`, ADR-0025, `MASTER_PLAN_ES.md` ficha N-TEST-1, `NORMALIZATION_ROADMAP.md` §2.3, eight docs to adjudicate.

## 5. Approaches compared, and the chosen one

The unit of the system is **the composition of the merge gate, not a runner** (signed point 10). Five frameworks become one system through three shared contracts plus common tooling — they do not call each other.

| Contract        | Chosen mechanism                                                                                                                                                                                                                                                                                                                                                                                                                               | Rejected, and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reach**       | The filename suffix is the router (`*.test.ts` vitest · `*.integration.test.ts` services tier · `*.live.test.ts` live tier · `*.spec.ts` Playwright · `*.k6.js` k6); exactly one collector per file; `packages/test-contracts` asks each runner what it collects and proves `disk − ⋃ collected-by-a-required-job = ∅`. The suffix names the **tier**, not the runner, so the router survives a node:test→vitest consolidation.                | **Directory-per-batch**: moves 98 files and ties the repository layout to the scheduler. **Manifest with existence checks**: still a hand-maintained list — the exact defect being removed. **Keeping the grep ratchet**: blind to `*.spec.ts`, `*.test.tsx`, packages, `security/`, `performance/`, and to double collection; "reached" currently means the path appears anywhere in `run-tests.sh`, including a comment.                                                                         |
| **Environment** | One `scripts/test-env.sh` owning everything from "the services are reachable" onward (`env`/`db`/`up`/`serve`/`liveness`/`run`). It starts neither Postgres nor Redis anywhere: in CI the `services:` blocks own them, locally the infrastructure LXC does. The contract is over **what** runs — image major, extensions, identities, database name, roles, processes, readiness — verified by preflight, not over who started the containers. | **A local docker-compose backend**: introduces a second identity Edward never uses. **Per-workflow sequences**: today's four Postgres identities and six hand-written setup blocks. Three safety properties are unrepresentable without a single owner: tests never touch the dev database (the script refuses any name but `omnipost_test`), never share Redis queues with dev workers (logical DB 15), and never talk to a live dev server (test ports = dev + 10, and a bound port is refused). |
| **Verdict**     | Each layer emits an exit code plus a machine- and human-readable report, and the merge gate **composes** them: all required, no `needs:` that can be evaded, no swallowed exit, each with a demonstrated red. Enforced by a committed `.github/rulesets/main.json`, the new #44 composition rules (V1-V7), named reporters, and the skip-gate reporter.                                                                                        | **Fixing the 19 gates individually**: does not close the `needs`-without-`always()` class, where a skip counts as a pass. **Classic branch protection**: unreadable from CI with `GITHUB_TOKEN`, so no drift gate is possible; rulesets are readable on a public repo via `GET /repos/{o}/{r}/rules/branches/main`, which is what makes V6 real.                                                                                                                                                   |
| **Tooling**     | **Three** packages: `@test-utils/domain`, `@test-utils/wire`, `@test-utils/persistence`.                                                                                                                                                                                                                                                                                                                                                       | **One `test-utils` package**: would place `@infra/prisma` — and therefore `prisma generate` — into the `^build` graph of every core and provider package, none of which depends on it today (plan finding 13). **`createTestApp` in a shared package**: Fastify is used only by `apps/api` and the builder needs `errorPlugin`, `setupContainer` and the Zod compilers (finding 15) → `apps/api/tests/support/`.                                                                                   |

Other alternatives considered and rejected, each on a measurement:

- **Sentinel row for the outbox smoke** — `OutboxRelay.integration.test.ts` seeds and pre-claims its own rows, but in the smoke the use case writes the outbox row inside its own transaction, so the race window stays open (finding 2). Replaced by topology (DB-only tier runs before the API boots) plus `assertNoForeignRelay()`.
- **Turning the relay off in the boot** — a test switch in the production boot path, and the live flows need the relay.
- **Asserting through the real relay** — moves a DB-only subject into a tier where the workers also consume: a second race.
- **`/api/test/seed`** — a test route inside the production binary is attack surface (D13). Replaced by an owner-connection `seed-e2e.ts` plus real endpoints.
- **Mass `data-testid` instrumentation** — 207 referenced, 0 present; role/label selectors instead, which also test the accessible name.
- **A single JSON ratchet file for coverage floors** — loses vitest's `autoUpdate`, needs a bespoke rewriter, and needs a new home for the `canon-exception` marker; fitness #37's scanner already reads the in-config block, and the floors belong next to the tests that measure them.

**Framework verdicts** (point 11) — vitest/RTL/coverage stay; Playwright stays; MSW becomes the **only** HTTP double; k6 stays only if load blocks merges after calibration, otherwise it is deleted; Jest leaves with `@storybook/test-runner` if nothing runs it; mutation returns **after** coverage, as the only tool that verifies the both-directions rule at scale. The one genuinely open fork is **node:test vs vitest** — two runners for the same defect class, 108 files at stake — and it is decided by measurement (WU-4.X1's nine metrics, WU-4.X2's hypotheses H1-H5), not by preference. H4 is the interesting one: any mock, alias or stub added to make Prisma or the saga engine run under vite fails it by the no-patches rule.

## 6. Constraints

- **The 14 signed points** and **D1-D20**, signed in block on 2026-09-27. D17 remains open.
- **D20 as clarified:** testing dependencies align to the latest **stable** version only — no betas, no release candidates, no prereleases — subject to ADR-0018's 7-day maturity buffer; a lag needs a documented hold row; `@types/node` tracks the runtime major (24) **downward**; a gate compares the hold table against `pnpm outdated` and fails on a lag with no row. This alignment lands **before** Phase 1 (WU-T.4) because both designs carry version-specific findings against vitest 4.1.11, and re-founding on one version to migrate afterwards is building twice.
- **CLAUDE.md canon and fitness style:** a dead scope is worse than no check (fail closed on zero configs, zero globs, zero models); every new or modified gate is born with its red demonstrated over the **complete step**, restored byte-exact and re-greened; the regex in CLAUDE.md **is** the regex in CI; the check inventory is contiguous (42 today, #43 arriving with #308, #44-#49 reserved by this plan).
- **Review budget:** 400 **CODE** lines per PR, hard; **EVIDENCE** pre-approved per slice (D1). Without that split, deleting `trendAnalysisService.test.ts` alone (731 lines) breaks the limit.
- **Canon obligations binding every slice:** 0 error / 0 warning with no deferral as "pre-existing"; `@file`/`@description`/`@layer` on every new file; no comment naming a phase, sprint or roadmap section (fitness #8); tests and JSDoc in the same slice as the code.
- **Coverage interlock:** demolition lowers the `apps/api` floors, because coverage counts execution and not assertion. Fitness #37 accepts a descent only with a `canon-exception:<scenario>` marker, and no scenario in the allowed list fits → a new `decorative-demolition` scenario plus ADR-0025 (WU-2.0) must land before the first api block-deletion slice.
- **Tonight's operating limits:** no push, no `sensitive-edit` token, no merge, no deletion. This exploration created no project file and executed nothing.
- **Preconditions outside the workstream:** the base merges (#286, #289, #292, #302, #308, #313, #314, the infrastructure report, and the N-COR-8 chain up to its last green link) precede WU-T.1; SMELL-175 merges when its own red closes; Edward's admin actions gate WU-3.5 (remove "Test and Build" from required) and WU-3.11 (apply the ruleset and clear the classic required checks).

## 7. Open questions for the proposal

1. **D17, signed open** — product classification of `apps/api/scripts/seed-demo-data.ts` and `seed-large-dataset.ts` (CLI entry points, 0 importers, unused since 04-22): PLANNED or DEAD. Zero importers is normal for a CLI, so the ledger cannot decide it. It sets WU-2.7's deletion boundary.
2. **Provenance of F-1..F-17** — the report is not on this branch and six of its findings cannot be bound to a subject. Does the proposal (a) wait on the report's merge before writing its DoD, or (b) carry the plan's numbering and reconcile in WU-8.8? This also decides when D16 (adding the report to fitness #24's anti-deletion list) can be written.
3. **#30's interim baseline** — the plan says it falls "from 20 to the dark-live count plus quarantine", a number only WU-1.5's per-file measurement produces. The proposal must state that this number is measured-then-committed rather than predicted, or the first Test Contracts PR has no acceptance criterion.
4. **`@storybook/test-runner` adjudication** (D20 (d)) — it is the only carrier of Jest. If no workflow or script runs it, it and Jest 30 leave the tree. Does that adjudication belong to WU-T.4 (toolchain, Phase 0) or to Phase 6? It decides whether Phase 0 can close.
5. **Serial-tier invariant** — `bulkScheduleHarness.cleanupTenant` (`:142`) deletes outbox rows by `aggregateType` with no tenant, batch or suite scope, and is safe only at `CONCURRENCY=1`. Is "the services tier stays serial" a stated invariant of the reach contract, or does Track S scope that cleanup now? Any future parallelism silently breaks sibling suites otherwise.
6. **k6's exit criterion** — D11 says that if the ten calibration runs show variance that empties the thresholds, k6 is deleted entirely. Against what numeric criterion, and who decides? Without it WU-6.K3 has no red and the decision has no gate.

## 8. Recommendation

Proceed to `sdd-propose`, **after** the selected research lane (`sdd/testing-refoundation/research`) completes. Adopt the plan's phase order unchanged — reach, demolition, verdict, environment, integration, coverage, re-foundation, new coverage, mutation, docs, tail — because the reading confirmed its premise: the mechanisms are good and the composition is not, so the floor has to come first.

Three amendments the reading produced:

1. **Raise `run-tests.sh:19-23` (the `.env` sourcing) to the first slice that touches the runner, and frame it as data-loss prevention.** A local `TIER=full-integration` with an unset `DATABASE_URL` points destructive `deleteMany` fixtures at the development database. WU-1.6 already fixes it; the proposal should not let it ride at the priority of a cleanup.
2. **Add "the rebuilt E2E tree lands inside a typecheck scope" as its own acceptance item.** `apps/client/tsconfig.json:41` excludes `tests/**/*`, which is why `BasePage.ts` could sit in the tree without compiling. The typecheck-tests ratchet (#289) is the natural home. Without this, the plan removes today's fiction and leaves the mechanism that let it in.
3. **Make "replace a default with a refusal" an explicit design principle of the proposal.** It is the measured throughline of every defect found — the k6 variable, the `.env` sourcing, `skipIfApiUnavailable`, `dbAvailable = false`, `$queryRaw → []` — and it unifies roughly fifteen work units into one decision that reviewers can check.

## 9. Risks

- **R1 — Scope.** Roughly 130 work units and 150-250 PRs across ten phases, with Phase 6.N alone estimated at 40-70. Sized by C2's measurement, not by guess, but it is the largest workstream in the repository and it blocks nothing while it runs, so it competes with the Master Plan for attention over months.
- **R2 — The coverage ratchet fights the demolition.** Deleting decorative tests lowers execution coverage. The ADR-0025 escape is correct but every api block slice must carry a marker, and a slice that forgets it goes red on #37 for the right reason at the wrong time.
- **R3 — The heuristic classifier is an upper bound.** The 272 decorative blocks include false positives (`toBeTruthy` over a computed boolean). The hard probe samples, the 5% BEHAVIOURAL calibration measures the false-negative rate, and mutation answers at scale — but between Phase 2 and Phase 7 the ledger's precision is estimated, not known. Nothing is deleted without a listed row and Edward's approval, which is the mitigation.
- **R4 — Two reds are expected, not hypothetical.** The `security/tests` SSRF case is likely a real product defect, and "schedule → the worker publishes" is red today because of N-COR-9, not because of the tests. Both need a pre-agreed landing place (a SMELL/N-SEC row, a declared gap owned by N-COR-8/9) or a slice will stall on a red it is not allowed to commit and not able to fix.
- **R5 — Admin-gated steps can deadlock a PR.** WU-3.5 removes the "Test and Build" job while "Test and Build" is a required context; if the context is not removed from required first, the PR waits forever on a check that no longer exists. The same shape applies to WU-3.11's ruleset switchover. Both need Edward's action sequenced explicitly in the task list, not as a footnote.
- **R6 — `strict: true` (D5) costs CI time.** Every branch must be up to date before merging, at roughly 15 minutes per rebase, and there is no merge queue on a personal repository. It is the only protection against the #308/#314 class (two PRs touching the same files, both individually mergeable), so the cost is accepted — but it changes the rhythm of a workstream that ships 150+ PRs.
- **R7 — The node:test decision could go either way, and 108 files hang on it.** If a hard hypothesis fails, node:test stays and the suffix router must keep serving two runners. The plan is built to survive either outcome (the suffix names the tier, not the runner), which is the mitigation — but the experiment must run before Phase 6's docs claim a framework table.
- **R8 — Provenance gap.** Six of the seventeen findings the workstream is named after cannot currently be read on the trunk. If the report's PR stalls, the DoD references a document nobody can check.

## 10. Ready for Proposal

**Yes**, conditioned on: the research lane completing, the base merges landing (they gate WU-T.1), and D17 being answered (it gates WU-2.7's boundary). The six open questions in §7 are the proposal's input, not blockers to starting it.
