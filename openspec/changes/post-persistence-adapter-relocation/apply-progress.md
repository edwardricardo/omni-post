# Apply progress: `post-persistence-adapter-relocation`

**Batch 1 — work unit W1 (T1.1 … T1.22)** and **batch 2 — work units W2–W5 (T2.1 … T5.4)**.
Branch `workstream/post-persistence-adapter-relocation` (base `main` @ `c23ec2c8`, W1 committed
as `ad8b7992`). Artifact store: openspec. Mode: **Strict TDD** (active).
Delivery: single PR, five work-unit commits; each batch ends at a work-unit boundary and the
ORCHESTRATOR commits. Batch 2 begins below at §"Batch 2".

Every number below was produced by RUNNING the command quoted beside it in this batch. No
number is carried over from the tasks forecast without re-measurement, and no command output
is paraphrased.

---

## Deviation from the design, recorded before anything else

**The mapper sits at `packages/adapters/db-prisma/src/post/PostAggregateMapper.ts`, not at
`…/src/post/mappers/PostAggregateMapper.ts`.** The four files were moved by the orchestrator
with `git mv` before this batch started, and that move flattened the `mappers/` level. D1 and
T1.5 name the nested path.

Consequences, all handled here:

- `PrismaPostRepository.ts`'s sibling import became `./PostAggregateMapper.js` (it was
  `./mappers/PostAggregateMapper.js`). D1 predicted this import would change **zero bytes**;
  it changed one line. The prompt for this batch names "the sibling-relative imports that must
  change" as in-scope for W1, so the edit is authorised rather than improvised.
- The barrel exports `./post/PostAggregateMapper.js`.
- `PostAggregateMapper.ts` itself is still byte-unchanged (nothing inside it referenced the
  directory level), so its rename similarity is unaffected. `PrismaPostRepository.ts` spends
  one extra line of rename headroom (measured budget was ≈ 40/903 → the extra line is noise
  against the 90 % threshold).
- No task changes meaning; **no other artifact needs amending**, but `design.md` D1/D8 and
  `tasks.md` T1.5 now name a path the tree does not have. Flagged for the verify phase rather
  than edited here — this batch does not own the design.
- **RESOLVED in batch 2 (W5), as correction C10.** The file is NOT moved back: the flat layout
  is what N-COR-8's own design already names (`post-publish-partial-failure/design.md:58` puts
  the mapper "beside" the repository, and `:281` names
  `packages/adapters/db-prisma/src/post/{PrismaPostRepository,PostAggregateMapper}.ts` — both
  read at apply time). `design.md` (`:34`, D1 prose, the D8 barrel, the D13 accent grep),
  `tasks.md` (T1.5 and the rename-headroom line) and `proposal.md:66` were amended to the flat
  path, and a `C10` row was added to the design's corrections table. `explore.md:27-28` was NOT
  touched: it describes the PRE-move tree and is still true.

---

## W1 — task ledger

| Task  | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1.1  | [x]    | Two injected-provider cases added to `PrismaUnitOfWork.test.ts` with D1's fixed doubles, importing from `@adapters/db-prisma`. RED observed (below).                                                                                                                                                                                                                                                                                            |
| T1.2  | [x]    | One case added to `PrismaPostRepository.test.ts`; the tx double gained `$executeRaw: vi.fn(async () => 1)` because `setTenantGuc` issues one. RED observed.                                                                                                                                                                                                                                                                                     |
| T1.3  | [x]    | Cross-boundary case added to `softDeleteJoinsUnitOfWork.test.ts`; `spyClient()` gained `post: { count }`. RED observed (the relocated repository was not importable).                                                                                                                                                                                                                                                                           |
| T1.4  | [x]    | NEW `apps/api/tests/unit/infrastructure/container/setupRepositories.test.ts` (3 cases). RED observed.                                                                                                                                                                                                                                                                                                                                           |
| T1.5  | [x]    | The four files exist at their new paths; the four old paths are gone (`rg` over `apps/api/src` for the old specifiers → **0**). Move performed by the orchestrator; see the deviation above.                                                                                                                                                                                                                                                    |
| T1.6  | [x]    | `PrismaUnitOfWork.ts`: `resolveGucScope` added to the `tenantGuc.js` import, `getAmbientGucScope` import deleted, `TenantContextProvider` type imported, constructor `(prisma, tenantProvider, options?)`, `const scope = resolveGucScope(this.tenantProvider);`. `txStorage` and `static getTransactionClient()` untouched.                                                                                                                    |
| T1.7  | [x]    | `PrismaPostRepository.ts`: same import surgery, constructor `(prisma, outboxWriter: OutboxWriter \| undefined, tenantProvider)`, three seam calls rewritten. All three reflowed to the multi-line form; token lands on **call+2** (verified by printing the call+3 window at `:185`, `:568`, `:664`).                                                                                                                                           |
| T1.8  | [x]    | Barrel block appended after `PrismaMentionRepository`: 4 exports + the comment distinguishing the `@ports/core` DTO factory `createPostRepository` from the `@core/domain` aggregate adapter. It names no `apps/api` path (the T1.20 boundary grep reads comments).                                                                                                                                                                             |
| T1.9  | [x]    | `setupRepositories.ts` (repository + UoW), `setupProjectUseCases.ts:71`, `setupAccountUseCases.ts:71` — each `+ import { ambientTenantContextProvider } from "../../security/tenantContext.js";`, provider passed as an imported VALUE, `HARD_DELETE_TX_OPTIONS` kept THIRD.                                                                                                                                                                    |
| T1.10 | [x]    | 17 `apps/api/src` importers re-pointed to the ROOT specifier, including the sibling-relative `unitofwork/tenantTransaction.ts:31`. `setupRepositories.ts`'s three import lines collapsed into one.                                                                                                                                                                                                                                              |
| T1.11 | [x]    | 19 integration files + `tests/accountLifecycle.test.ts` re-pointed; multi-specifier files collapsed to one import line.                                                                                                                                                                                                                                                                                                                         |
| T1.12 | [x]    | 6 unit files re-pointed. `PrismaUnitOfWork.test.ts`'s **16 two-line dynamic imports** (32 lines) collapsed into ONE static import (C7). Verified no `vi.mock` / `vi.doMock` / `vi.resetModules` in that file before collapsing.                                                                                                                                                                                                                 |
| T1.13 | [x]    | **64** constructions updated: 54 `new PrismaUnitOfWork(` + 10 `new PrismaPostRepository(`. Re-measured after the edits: every construction in `apps/` and `packages/` now passes a provider (grep for a construction without one → **0**). The 5 option-bearing sites keep their options in position 3.                                                                                                                                         |
| T1.14 | [x]    | 27 files carry the provider import: 12 new import lines, 15 extensions of an existing `security/tenantContext.js` import. Every tier injects `ambientTenantContextProvider`; the only fixed doubles are the NEW seam proofs.                                                                                                                                                                                                                    |
| T1.15 | [x]    | `tenantTransactionNesting.test.ts` LOUD half: `repoRoot` introduced, `apiSrc` derived from it, `HELPER` / 3 `INLINE_ADJUDICATED` / 7 `INDEPENDENT_BY_DESIGN` keys made repo-root-relative (the first inline key is now `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`), the three `readFileSync(join(apiSrc, …))` calls and the walk's `relative(apiSrc, …)` re-based on `repoRoot`. Walk stays single-root in W1; suite green. |
| T1.16 | [x]    | C3's three path-stale comments fixed: `Container.ts` `@example`, `ChannelAuthFailureRecorder.ts` ("`PrismaOutboxWriter` in `@adapters/db-prisma`, `OutboxRelay` in apps/api"), `tenantContext.ts` (new UoW path). `setupPostUseCases.ts:206`, `mockPrisma.ts:704`, `IntegrationEventDeliveryHandler.ts:73` left untouched.                                                                                                                      |
| T1.17 | [x]    | C5's three stale constructor-form comments fixed: `hardDeleteSerializableRace.test.ts` header and the twin comments in `setupProjectUseCases.test.ts` / `setupAccountUseCases.test.ts`. Only the quoted EXPRESSIONS changed; the claim they make is unchanged and still true.                                                                                                                                                                   |
| T1.18 | [x]    | `TX_SEAMS` re-pathed in **both** gate files, byte-identical in the code line (`diff` of the two extracted lines → IDENTICAL), plus D3's comment paragraph naming the new home AND the measured inertness of the `/saga/sagaTenant\.ts:` term. The inert term was NOT deleted (deletion is an authorisation — backlog B1).                                                                                                                       |
| T1.19 | [x]    | #40 Part A red demonstrated (transcript below): term reverted → `SEAM_HITS=2` → scope error, **exit 1**; shipped term → `SEAM_HITS=3`, `COUNT=0`, exit 0. The gate file was never edited to manufacture its own red.                                                                                                                                                                                                                            |
| T1.20 | [x]    | Full gate run below.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| T1.21 | [x]    | Coverage BEFORE/AFTER measured, config restored byte-exact (`cmp` exit 0, sha256 match), `coverageThresholds.test.ts` re-run green. **No literal breached.**                                                                                                                                                                                                                                                                                    |
| T1.22 | [x]    | This report. The apply ran no `git` command of its own (see the one disclosed exception under "Honesty notes").                                                                                                                                                                                                                                                                                                                                 |

---

## TDD Cycle Evidence (Strict TDD — mandatory)

| Task     | RED (observed, before the production change)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | GREEN                                                                                                                                                                                      | REFACTOR                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **T1.1** | `vitest run tests/unit/infrastructure/PrismaUnitOfWork.test.ts` → `Test Files 1 failed`, `Error: Cannot find module '../../security/tenantContext.js' imported from packages/adapters/db-prisma/src/unitofwork/PrismaUnitOfWork.ts`. That IS the subject: the relocated adapter's only `apps/api` dependency is unreachable from the package, so no injected-provider case can pass until the provider is injected. **Discriminating red also demonstrated after GREEN** (below) because a module-resolution red alone would not prove the assertions bite. | Constructor takes a REQUIRED `TenantContextProvider`; `const scope = resolveGucScope(this.tenantProvider)`. Both cases pass.                                                               | Comments state why a fixed double (not the ambient provider) is the discriminator.       |
| **T1.2** | Same load-time red (the repository imports the relocated UoW, which imported `apps/api`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Constructor `(prisma, outboxWriter \| undefined, tenantProvider)`; the standalone `create` binds `acc-injected` through `$executeRaw`. Passes.                                             | tx double comment explains why `$executeRaw` appears.                                    |
| **T1.3** | `Error: Cannot find module '../unitofwork/PrismaUnitOfWork.js' imported from apps/api/src/infrastructure/repositories/PrismaProjectRepository.ts` — the relocated repository was not importable from the test at all.                                                                                                                                                                                                                                                                                                                                       | Both repositories observe the SAME transaction client across the package boundary: `clients.tx.project.update` 1×, `clients.tx.post.count` 1×, `clients.base.post.count` not called.       | Comment states what the case does NOT prove (it is not a src/dist duality detector, D7). |
| **T1.4** | `Error: Cannot find module '../unitofwork/PrismaUnitOfWork.js' imported from apps/api/src/infrastructure/repositories/PrismaAdminUserRepository.ts` — the root's whole graph was unresolvable.                                                                                                                                                                                                                                                                                                                                                              | Under `withTenantContext({ accountId: "acc-root" })` the UoW issues `set_config` with `acc-root` and the repository's standalone `create` binds `acc-root`; with no context neither binds. | The "binds nothing" case states why unbound is the fail-closed default.                  |

### Discriminating red paths (planted after GREEN, byte-exact restore verified)

The first reds were module-resolution failures, which prove the move but not that the new
assertions bite. Two counterfactuals were planted to close that gap. Checksums recorded before
the plants and re-verified after (`sha256sum -c` → both `OK`).

**(a) The derivation ignores the injected provider.** In
`packages/adapters/db-prisma/src/unitofwork/PrismaUnitOfWork.ts`, `resolveGucScope(this.tenantProvider)`
→ `const scope: string | undefined = undefined;`

```text
Failed Tests 4
FAIL  PrismaUnitOfWork.test.ts > tenant scope from the injected provider > binds the accountId the INJECTED provider reports, with no ambient context bound
AssertionError: expected [ 'work' ] to deeply equal [ 'set_config', 'work' ]
FAIL  PrismaUnitOfWork.test.ts > tenant scope from the injected provider > binds the __system__ sentinel when the injected provider reports a system context
AssertionError: expected undefined to be '__system__' // Object.is equality
FAIL  PrismaUnitOfWork.test.ts > executeResultInTransaction > binds the GUC as the first statement of the transaction, as executeInTransaction does
AssertionError: expected [ 'work' ] to deeply equal [ 'set_config', 'work' ]
FAIL  setupRepositories.test.ts > gives the Unit of Work a provider that resolves the AMBIENT tenant context
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
Test Files 2 failed (2) | Tests 4 failed | 17 passed (21)   EXIT=1
```

**(b) The composition root passes no provider.** In `setupRepositories.ts`, the UoW
registration's `ambientTenantContextProvider` → `undefined as never`:

```text
Failed Tests 2
FAIL  setupRepositories.test.ts > gives the Unit of Work a provider that resolves the AMBIENT tenant context
TypeError: Cannot read properties of undefined (reading 'getSystemContext')
FAIL  setupRepositories.test.ts > binds nothing when no tenant context is bound, for either adapter
TypeError: Cannot read properties of undefined (reading 'getSystemContext')
Test Files 1 failed (1) | Tests 2 failed | 1 passed (3)   EXIT=1
```

**Restore:** `sha256sum -c` → `PrismaUnitOfWork.ts: OK`, `setupRepositories.ts: OK`; re-run
→ `Test Files 2 passed (2)`, `Tests 21 passed (21)`.

---

## Work Unit Evidence (W1)

| Evidence             | Value                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command | `cd apps/api && pnpm exec vitest run <the 10 affected unit suites>` → **10 passed / 113 passed**, exit 0                                                                                                            |
| Runtime harness      | `pnpm db:up` → infra OK; `TIER=pr-integration bash apps/api/scripts/run-tests.sh` → **536 tests, 536 pass, 0 fail, 0 cancel, 0 skip**, runner exit 0                                                                |
| Rollback boundary    | One revert of the W1 commit restores every specifier, every construction and the `TX_SEAMS` term together, and returns the four files to `apps/api/src`. The window closes when N-COR-8 PR 1b bases on these paths. |

---

## T1.19 — fitness #40 Part A red transcript

The runner is a verbatim transcription of the shipped block (it reads `TX_SEAMS` out of
`CLAUDE.md` at run time, so it cannot disagree with the gate); the red substitutes only the
pre-move term. **The gate file itself was never edited to produce its red.**

```text
### GREEN (shipped term)
TX_SEAMS=/db-prisma/src/unitofwork/PrismaUnitOfWork\.ts:|/saga/sagaTenant\.ts:|/db-prisma/src/ChannelRepository\.ts:
SEAM_HITS=3
COUNT=0
EXIT=0

### RED (pre-move term restored — the only change)
TX_SEAMS=/infrastructure/unitofwork/PrismaUnitOfWork\.ts:|/saga/sagaTenant\.ts:|/db-prisma/src/ChannelRepository\.ts:
SEAM_HITS=2
fitness #40 scope error: the named seams hold 2 `.$transaction(` calls against a floor of 3 —
the method was renamed, a seam moved, or the scan stopped matching. Failing closed rather than
reporting a clean zero over code it never read.
EXIT=1
```

Supplementary (NOT the red path, per D3): running the gate's own `tx_calls` pipeline with the
pre-move term and the floor check bypassed names the one call that would be `COUNT=1`:

```text
packages/adapters/db-prisma/src/unitofwork/PrismaUnitOfWork.ts:90:    return this.prisma.$transaction(
```

Byte-identity of the edited code line across the guard pair:

```text
CLAUDE.md   : TX_SEAMS='/db-prisma/src/unitofwork/PrismaUnitOfWork\.ts:|/saga/sagaTenant\.ts:|/db-prisma/src/ChannelRepository\.ts:'
fitness.yml : TX_SEAMS='/db-prisma/src/unitofwork/PrismaUnitOfWork\.ts:|/saga/sagaTenant\.ts:|/db-prisma/src/ChannelRepository\.ts:'
diff → IDENTICAL
```

---

## T1.20 — W1 gate

| Gate                         | Command                                                                                        | Result                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Types                        | `NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc -b apps/api packages/adapters/db-prisma` | **exit 0**, no output                                                           |
| Types (package, incl. tests) | `pnpm --filter @adapters/db-prisma typecheck`                                                  | **exit 0**                                                                      |
| Lint                         | `pnpm exec eslint apps packages infra --ext .ts,.tsx --max-warnings 0`                         | **exit 0** — 0 errors, 0 warnings (see Honesty notes for the root-scope caveat) |
| Format                       | `pnpm exec prettier --check "apps/**/*.{ts,tsx}" "packages/**/*.{ts,tsx}" "infra/**/*.ts"`     | "All matched files use Prettier code style!"                                    |
| Unit (api)                   | `pnpm --filter @apps/api test`                                                                 | **577 files / 8986 tests passed**, exit 0                                       |
| Unit (package)               | `pnpm --filter @adapters/db-prisma test`                                                       | **4 files / 70 tests passed**, exit 0                                           |
| Integration                  | `pnpm db:up` then `TIER=pr-integration bash apps/api/scripts/run-tests.sh`                     | **536 tests, 536 pass, 0 fail, 0 cancel, 0 skip**, exit 0                       |
| Structure                    | `pnpm exec madge --circular apps/api/src/ packages/`                                           | "No circular dependency found!"                                                 |
| Build                        | `pnpm build`                                                                                   | **86/86 tasks successful**, exit 0                                              |

### Integration batches (each one's own line, from the runner's summary)

```text
integration:repositories            163 tests  163 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
integration:retention                10 tests   10 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
integration:hard-delete-race          2 tests    2 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
integration:sync                     36 tests   36 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
integration:outbox                    7 tests    7 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
integration:consumers                 3 tests    3 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
chaos                                 3 tests    3 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
integration:tenant-isolation        246 tests  246 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
integration:customer-auth            13 tests   13 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
integration:mfa-backup-single-use     4 tests    4 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
integration:admin-single-use-claims  16 tests   16 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
integration:saga-recovery            33 tests   33 pass  0 fail  0 cancel  0 skip  exit 0 [OK]
TOTAL: 536 tests, 536 pass, 0 fail, 0 cancel, 0 skip
```

The seven behaviour proofs ran with **no assertion edit**. The one allowed comment clause in
`tenantGucTransactionBinding.test.ts` was taken: "resolves its scope from the provider it was
constructed with — here the ambient one".

### Suites this change touches that NO `run_batch` names (fitness #30's SMELL-75 population)

R10 requires every affected suite to RUN. Three were reached only by running them directly,
with the runner's own invocation shape and env loading:

```text
tests/integration/bulkScheduleMediaPath.integration.test.ts
tests/integration/bulkScheduleRelayRetry.integration.test.ts
  # tests 2   # pass 2   # fail 0   # cancelled 0   # skipped 0     EXIT=0

tests/accountLifecycle.test.ts            (batch "remaining", full-integration tier)
  # tests 15  # pass 15  # fail 0   # cancelled 0   # skipped 0     EXIT=0
```

The first two remain unreached by `test:all`; that is pre-existing (SMELL-75) and this change
neither adds to it nor fixes it. Named here so the evidence is not mistaken for CI coverage.

### Static invariants (spec R1, R2)

```text
rg '@adapters/db-prisma/' over apps/api/{src,tests} apps/workers/src packages (*.ts)   → 0   (no subpath specifier)
rg 'getAmbientGucScope' packages/ (*.ts)                                                → 0
rg -n 'apps/api|security/tenantContext' packages/adapters/db-prisma/src                 → 0
old-path specifiers over apps/api/{src,tests} apps/workers/src packages                 → 0
```

### Unedited guards, RE-MEASURED rather than assumed

```text
#38  swept-tree COUNT=0 (expect 0)   db-prisma DBCOUNT=11 (ratchet baseline 11)   exit 0
#37  FITNESS_BASE_REF=main → 0, with the four literals untouched                  exit 0
#2  0 · #3  0 · #5  0 · #8  0 · #9  0 · #10 0 · #21 0 · #22 0 · #23 0 · #32 0
```

### #40 Part B — measured, and the reason W4 must ship in this PR

Under its **shipped (unextended)** scope, Part B still passes but sits exactly on its floor,
and the three relocated seam calls are outside the scope entirely:

```text
SITES=10  (floor 10 → margin 0)     BCOUNT=0
outside the scope today:
  packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:185
  packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:568
  packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:664
```

Dry-run of D2's extended scope (what W4 ships) — **no gate file was edited for this**:

```text
PART_B_SCOPE="apps/api/src packages/adapters/db-prisma/src/{post,outbox,unitofwork}"
SITES=13   BCOUNT=0        → floor 10, margin 3, exactly as D2 predicted
```

R12 confirmed green before W4's plant: the token is on **call+2** at all three sites, inside
the call+3 window.

```text
      await withGucBoundTransaction(
        this.prisma,
        resolveGucScope(this.tenantProvider),
        doHardDelete
```

---

## T1.21 — coverage (R1, HIGH)

Procedure per D10: config copied to the scratchpad, `pnpm --filter @apps/api test:unit:coverage`,
totals read from `apps/api/coverage/coverage-summary.json`, config restored, `cmp` + sha256.

| Metric     | BEFORE | AFTER     | Committed literal | Delta | Verdict        |
| ---------- | ------ | --------- | ----------------- | ----- | -------------- |
| lines      | 59.58  | **59.37** | 56.8              | −0.21 | CLEARS by 2.57 |
| functions  | 59.95  | **59.68** | 57.3              | −0.27 | CLEARS by 2.38 |
| branches   | 49.88  | **49.77** | 47.8              | −0.11 | CLEARS by 1.97 |
| statements | 59.01  | **58.81** | 56.2              | −0.20 | CLEARS by 2.61 |

Raw summary line from the run: `Statements 58.81% (15622/26563) · Branches 49.77% (7855/15781)
· Functions 59.68% (3288/5509) · Lines 59.37% (15083/25403)`.

**No escalation.** Every AFTER value clears its literal with ~2pp of margin. The descent is
~0.2pp and is what relocating 1 431 covered lines out of `coverage.include` does.

`autoUpdate` rewrote the literals to 59.2 / 59.5 / 49.6 / 58.7 during the run, as its own
comment says it would. Restored:

```text
cmp: byte-exact restore OK (exit 0)
78d7eb2ee3985ad398d5c9444fff77f023102ec36d2e6df8405f8b6ef5ea8bc7  apps/api/vitest.config.ts   (identical to the pre-run hash)
lines: 56.8 · functions: 57.3 · branches: 47.8 · statements: 56.2
tests/unit/config/coverageThresholds.test.ts → 1 file / 8 tests passed
```

The raise `autoUpdate` would have committed stays unshipped (backlog **B12**). No literal was
lowered, no `canon-exception` marker was added, the ratchet was not neutralised.

---

## Files touched in W1

**Moved (by the orchestrator, edited in place here)**

| Path                                                             | Edit                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/adapters/db-prisma/src/unitofwork/PrismaUnitOfWork.ts` | imports, constructor, scope derivation (4 hunks)                               |
| `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`   | imports (incl. the flattened mapper path), constructor, 3 seam calls (6 hunks) |
| `packages/adapters/db-prisma/src/post/PostAggregateMapper.ts`    | **zero bytes**                                                                 |
| `packages/adapters/db-prisma/src/outbox/PrismaOutboxWriter.ts`   | **zero bytes**                                                                 |

**Package**

- `packages/adapters/db-prisma/src/index.ts` — 4 exports + the disambiguating comment.

**`apps/api/src` (17 files)** — `infrastructure/container/setupRepositories.ts`,
`setupProjectUseCases.ts`, `setupAccountUseCases.ts`, `infrastructure/unitofwork/tenantTransaction.ts`,
`infrastructure/adapters/PrismaCustomerMfaUserRepository.ts`, `…/PrismaAdminMfaUserRepository.ts`,
`infrastructure/repositories/{PrismaAuditLogRepository, PrismaConversionRepository,
PrismaAccountRepository, PrismaAdminSessionRepository, PrismaBulkScheduleBatchRepository,
PrismaCrisisProjectRepository, PrismaTrackedLinkRepository, PrismaProjectRepository,
PrismaCustomerUserRepository, PrismaAdminUserRepository, PrismaAccountSubscriptionAdapter}.ts`.

**Comment-only** — `apps/api/src/infrastructure/container/Container.ts`,
`apps/api/src/security/tenantContext.ts`, `apps/workers/src/services/ChannelAuthFailureRecorder.ts`.

**Tests (26 files)** — 19 integration + `helpers/publishNowPromotionHarness.ts` is one of them,
`tests/accountLifecycle.test.ts`, 6 unit files, plus the twin container suites
(`setupProjectUseCases.test.ts`, `setupAccountUseCases.test.ts` — comment only, C6) and the NEW
`tests/unit/infrastructure/container/setupRepositories.test.ts`.

**Gate pair (token-gated, both edited with the Edit tool)** — `CLAUDE.md`,
`.github/workflows/fitness.yml`: #40 Part A only.

---

## Honesty notes (things a reader would otherwise have to discover)

1. **`pnpm lint --max-warnings 0` at the repo ROOT exits 1**, and not because of this change.
   `eslint .` walks `.config/opencode/plugins/{model-variants,skill-registry}.ts` — untracked
   local tooling dated 2026-07-06 that `.gitignore:187` excludes from the repository — and
   reports 5 `no-console` errors there. CI checks out a tree in which `.config/` does not
   exist, so this is an environment artifact, not a defect in the committed tree. I did not
   edit those files: they are the user's local tooling and outside this change's authority.
   Scoped to the committed source (`eslint apps packages infra`) the run is **0/0**.
2. **`pnpm format:check` at the repo root exits 1** on 15 markdown files under
   `openspec/changes/{post-persistence-adapter-relocation,post-publish-partial-failure}/` —
   SDD artifacts written by earlier phases, unformatted before this batch began. The three
   source files this batch left unformatted were fixed (`tenantGucTransactionBinding.test.ts`,
   `PrismaPostRepository.test.ts`, `PrismaUnitOfWork.test.ts`) and the whole source tree is
   prettier-clean. The artifact markdown belongs to W5's `pnpm format:check` gate; flagged,
   not silently fixed, because reformatting `tasks.md` and `design.md` mid-apply would churn
   the documents the verify phase reads.
3. **`git` was not run by this apply**, with one disclosed exception: fitness **#37** is a
   shipped gate whose own script performs read-only `git rev-parse` / `git show` against the
   base ref — there is no way to evaluate it otherwise, and T1.21 requires its number. No
   mutating git command was issued at any point.
4. The `@example` in `PrismaUnitOfWork.ts` still shows `new PrismaUnitOfWork(prisma)` and is
   now wrong. That is **T2.1's** line by the task split (W2), and W2 ships in the same PR.
5. `apps/api/src/infrastructure/repositories/mappers/` is left in place and empty, as instructed.

## Backlog rows confirmed or added by this batch

| Row      | Note                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1       | `/saga/sagaTenant\.ts:` in #40 A is inert — **re-measured here**: the floor of 3 is carried by two files (`PrismaUnitOfWork.ts` ×1, `db-prisma/src/ChannelRepository.ts` ×2). Deletion still needs authorisation.                                                                                                                                                                               |
| B12      | The `autoUpdate` raise (59.2 / 59.5 / 49.6 / 58.7) is measured and unshipped.                                                                                                                                                                                                                                                                                                                   |
| B13      | Re-confirmed: no tsc project type-checks `apps/api/tests/**`; the 26 edited test files were validated by RUNNING them.                                                                                                                                                                                                                                                                          |
| SMELL-75 | Re-confirmed on two files this change edits (`bulkScheduleMediaPath`, `bulkScheduleRelayRetry`): no `run_batch` names them.                                                                                                                                                                                                                                                                     |
| **NEW**  | The mapper landed at `src/post/PostAggregateMapper.ts` rather than `src/post/mappers/`; `design.md` D1/D8 and `tasks.md` T1.5 name a path the tree does not have. Either amend those two artifacts or move the file in W2 — a decision for the orchestrator, not for this batch. **CLOSED in batch 2 as C10** — the artifacts were amended to the flat path, which is the one N-COR-8 consumes. |

---

# Batch 2 — work units W2, W3, W4, W5 (T2.1 … T5.4)

Same rules as batch 1: every number below was produced by RUNNING the command quoted beside it,
no git command was issued (fitness **#37** remains the one disclosed exception — its own shipped
script performs read-only `git rev-parse` / `git show`, and there is no other way to evaluate it),
and each edited gate ships with a red path that produced a REAL non-zero exit before a
checksum-verified restore.

## W2–W5 — task ledger

| Task     | Status | Evidence                                                                                                                                                                                                                                                                                                                         |
| -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T2.1** | [x]    | 13 Spanish comment blocks in `PrismaUnitOfWork.ts` translated (the `TransactionOptions` doc + its 3 field docs, the `txStorage` block, the class JSDoc, `executeInTransaction`'s doc, `getTransactionClient`'s doc and its two in-`@example` comments). The `@example` now shows `new PrismaUnitOfWork(prisma, tenantProvider)`. |
| **T2.2** | [x]    | 5 single-line Spanish comments in `PrismaPostRepository.ts` translated (`:143`, `:559`, `:614`, `:655`, `:675` at batch-2 line numbers). The `DELIBERATE soft-delete-sweep exception` markers were not touched — see the measured correction C11 below.                                                                          |
| **T2.3** | [x]    | Accent grep **0** over the four relocated files; the unaccented-Spanish sweep (a 24-word stop-list over comment lines) also **0**; every block explore §6 enumerates read back and confirmed English. `tsc -b` 0, fitness #8 / #9 / #10 all **0**. No sprint/phase/work-unit reference introduced.                               |
| **T3.1** | [x]    | RED — `SEAM_FILE_POPULATION = 16` + the `toContain` loop added against W1's single-root walk. **Both halves observed** (transcript below): the count red, then the `toContain` red with the counting mask lowered.                                                                                                               |
| **T3.2** | [x]    | GREEN — `SEAM_ROOTS` (4 roots) + `SEAM_ROOTS.flatMap((root) => walk(join(repoRoot, root)))`. Population back to **16**; suite 6/6 green. `apiSrc` was deleted because the flatMap retired its last use — leaving it would have been an unused binding and a lint error.                                                          |
| **T3.3** | [x]    | The three D6 reds each produced a real failing run, then a byte-exact restore (`sha256sum -c` → OK) and a green re-run. Transcripts below.                                                                                                                                                                                       |
| **T4.0** | [x]    | The `sensitive-edit` token was ACTIVE: every `CLAUDE.md` / `fitness.yml` edit went through the Edit tool, including the #23 bullet whose line carries the pre-existing `(S2.1c)` section marker (R13). No edit was blocked, nothing was paraphrased, no Bash write was used on either file.                                      |
| **T4.1** | [x]    | #40 Part B: `PART_B_SCOPE` + its own fail-closed existence loop, `seam_call_sites()` repointed at `$PART_B_SCOPE`, the window test widened to `grep -qE "getAmbientGucScope\(\)\|resolveGucScope\(this\.tenantProvider\)"`, floor kept at **10**, `SCOPE_EXEMPT` kept at ONE file. Residuals (2), (4) AND (5) rewritten.         |
| **T4.2** | [x]    | Three reds: (i) plant → `BCOUNT=1`, **exit 1**; (ii) same plant, scope narrowed to `apps/api/src` → `BCOUNT=0`, `SITES=10`; (iii) misspelled directory → scope error, **exit 1**. Restore `sha256sum -c` → OK; `SITES=13`, `BCOUNT=0`.                                                                                           |
| **T4.3** | [x]    | #23 scope extended to `packages/adapters/db-prisma/src` in both files, the "Scope:" sentence updated, the UoW exception re-pathed to `/db-prisma/src/unitofwork/PrismaUnitOfWork\.ts`, and its bullet replaced by D4's TWO English bullets (the exception is INERT; `resilience.ts:308` gets NO exception line).                 |
| **T4.4** | [x]    | #23 red, C2-corrected — planted in the relocated REPOSITORY, not the UoW: old scope **0** (the dead scope proving itself), new scope **1** with **exit 1**, restored **0**. Transcript below.                                                                                                                                    |
| **T4.5** | [x]    | #3 names `packages/adapters/db-prisma` in the existence loop and the grep scope, with D5's one-sentence comment. Measured 0 at entry.                                                                                                                                                                                            |
| **T4.6** | [x]    | #5 names `packages/adapters/db-prisma/src/` explicitly, with D5's comment stating WHY the one-level `packages/*/src/` glob never reached it and that the general widening is unmeasured.                                                                                                                                         |
| **T4.7** | [x]    | #3 red: `const leak = {} as any;` → 1, **exit 1**, old scope 0. #5 red: `// @ts-ignore` → 1, **exit 1**, old scope 0. Byte-exact restore after each, both back to **0**.                                                                                                                                                         |
| **T4.8** | [x]    | All **41** fitness checks run locally from the repo root; counts below. The edited grep expressions and scope lists compared token-by-token across the pair — identical.                                                                                                                                                         |
| **T5.1** | [x]    | The 6 stale file-path citations re-pathed: ADR-0023 ×4, ADR-0014 `:120`, ADR-0005 `:195`.                                                                                                                                                                                                                                        |
| **T5.2** | [x]    | `MULTI_TENANT_GUARDS.md` — BOTH #23 scope sentences extended (C9) and the exception mention now names the new UoW location. The two symbol-level mentions inside the DATED 2026-07-27 blind-spot blockquote were deliberately left — see C12.                                                                                    |
| **T5.3** | [x]    | `TENANT_RLS_AB_MEASUREMENT.md` — ONE dated blockquote added under the title. Not one `Source site` citation touched; the `scripts/rls-ab-measurement.ts` `sourceSite` literals untouched (B10).                                                                                                                                  |
| **T5.4** | [x]    | The C8 FILE-level deciding grep over `docs/technical docs/security` → **0** (6 before). `pnpm format:check` clean for every source, doc and this change's artifacts.                                                                                                                                                             |

---

## Corrections measured in batch 2

| #       | Artifact said                                                                           | Measured now                                                                                                                                                                                                                                                                                  | Action                                                                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C10** | D1/D8/T1.5: the mapper lands at `…/src/post/mappers/PostAggregateMapper.ts`             | It is FLAT at `…/src/post/PostAggregateMapper.ts`, which is the path N-COR-8's design already names                                                                                                                                                                                           | Artifacts amended (design `:34` + D1 prose + D8 barrel + D13 grep, tasks T1.5 + rename-headroom line, proposal `:66`, a `C10` row in the design corrections table). The file is NOT moved.                                   |
| **C11** | T2.2: "leave the **three** `DELIBERATE soft-delete-sweep exception` markers byte-exact" | `PrismaPostRepository.ts` holds **TWO** (`:146` hard-delete probe, `:710` version-conflict recovery) — which is exactly what `CLAUDE.md` #38's own exception note for that file names. The other two `DELIBERATE` markers in db-prisma live in the FLAT `PostRepository.ts`, a different file | Nothing to do — both surviving markers are untouched and #38 re-measured **0 / 11**, unchanged. The tasks-time count of three was one too many; recorded so the next reader does not hunt for a marker that was never there. |
| **C12** | T5.2: name the new UoW location in the exception mentions at `:1669` **and** `:1682`    | `:1682` / `:1687` sit INSIDE the dated `> **Blind spot found while verifying that scope claim (2026-07-27).**` blockquote, and both are SYMBOL-level (`PrismaUnitOfWork`), carrying no path — so nothing there is stale                                                                       | `:1669` updated; the dated blockquote left byte-exact. Rewriting a dated finding is the same class spec R8 forbids for `TENANT_RLS_AB_MEASUREMENT.md`. The file carries no full old path — the C8 grep confirms 0.           |
| **C13** | The prompt's expected fitness counts include "#30 ratchet **21**"                       | The tree measures **20** unreached suites. Batch 2 edited exactly ONE test file, `tests/unit/infrastructure/tenantTransactionNesting.test.ts`, which #30's population EXCLUDES by path (`-not -path "*/tests/unit/*"`), so this batch cannot have moved it                                    | Reported, not absorbed. 20 ≤ 21 satisfies the ratchet (it may fall, never rise). The 20 names are listed below so the number is attributable rather than asserted. **The baseline in `CLAUDE.md` was NOT lowered.**          |

---

## TDD Cycle Evidence — batch 2 (Strict TDD)

W2, W4 and W5 carry **no behaviour**: W2 is comment text, W4 is two shell gates, W5 is
documentation. Their hard gate is the RED PATH of each edited gate, transcribed below, which is
the same instrument applied to a non-code artifact. W3 is the one unit with a test change, and it
ran RED → GREEN → REFACTOR.

| Task     | RED (observed BEFORE the change that makes it pass)                                                                                                                                                                                            | GREEN                                                                                              | REFACTOR                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **T3.1** | `AssertionError: expected 15 to be greater than or equal to 16` — then, with the counting mask lowered to 15, `AssertionError: packages/adapters/db-prisma/src/post/PrismaPostRepository.ts is named but was not walked`. **Both halves red.** | `SEAM_ROOTS.flatMap(...)` → population 16, `6 passed (6)`, exit 0                                  | `apiSrc` removed (its last use went with the flatMap); the `SEAM_ROOTS` JSDoc states why the FLAT files stay outside. |
| **T2.x** | N/A — comment text. The standing proof is the accent grep + the unaccented-Spanish sweep + the block-by-block read-back, all **0** / confirmed.                                                                                                | `tsc -b` 0, 577 files / 8986 tests green, #8 / #9 / #10 = 0                                        | none                                                                                                                  |
| **T4.x** | Five gate reds, each a REAL non-zero exit, transcribed below                                                                                                                                                                                   | every edited gate back to its expected count after a `sha256sum -c` restore                        | residual (5) rewritten so the gate's own comment stops claiming Part B is `apps/api/src` alone                        |
| **T5.x** | The C8 FILE-level grep reported **6** stale citations before the edits                                                                                                                                                                         | the same grep reports **0** after, with `TENANT_RLS_AB_MEASUREMENT.md` outside the scope by design | none                                                                                                                  |

---

## Work Unit Evidence — W2, W3, W4, W5

| WU     | Focused test command and exact result                                                                                                                | Runtime harness                                                                                                                                                  | Rollback boundary                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **W2** | `pnpm --filter @apps/api test` → **577 files / 8986 tests passed**, exit 0; `pnpm --filter @adapters/db-prisma test` → **4 files / 70 tests passed** | **N/A** — comments only, no runtime boundary exists. Stated rather than skipped: the bytes changed are inside `/** */` and `//` and cannot reach a runtime path. | Independently revertible; carries no behaviour.                                                                                       |
| **W3** | `vitest run tests/unit/infrastructure/tenantTransactionNesting.test.ts` → **1 file / 6 tests passed**, exit 0                                        | **N/A** — the suite IS a filesystem walk over the repo; it needs no service. That is also why it is the guard that survives a relocation.                        | Independently revertible; the guard returns to W1's single-root walk, which is still green and still LOUD-half correct.               |
| **W4** | the five edited gate blocks, each red then green (transcripts below); all **41** fitness checks green from the repo root                             | **N/A** — shell gates. Both surfaces were exercised: the `CLAUDE.md` block for the COUNT and the transcribed `fitness.yml` step for the REAL `exit 1`.           | Independently revertible, but NOT before W1 — W1 depends on the #40 Part A term it ships, and reverting W4 alone re-opens the window. |
| **W5** | `pnpm format:check` clean for sources, docs and this change's artifacts; the C8 FILE-level grep → **0**                                              | **N/A** — documentation and SDD artifacts.                                                                                                                       | Independently revertible; docs only.                                                                                                  |

---

## T3.3 — nesting guard red transcripts

Checksum before the plants: `05a99492226b0a8d421e5fe1cdf5a5ec3564d2bd6657876b773929701b9a747c`.

```text
### (i) the relocated root dropped from SEAM_ROOTS
AssertionError: expected 15 to be greater than or equal to 16
Test Files 1 failed (1) | Tests 1 failed | 5 passed (6)      EXIT=1

### (iii) same drop, SEAM_FILE_POPULATION lowered to 15 — the counting mask stays closed
AssertionError: packages/adapters/db-prisma/src/post/PrismaPostRepository.ts is named but was
not walked: expected [ …(15) ] to include 'packages/adapters/db-prisma/src/post/…'
Test Files 1 failed (1) | Tests 1 failed | 5 passed (6)      EXIT=1

### (ii) one root misspelled — loud by design
Error: ENOENT: no such file or directory, scandir
'/root/omni-post/packages/adapters/db-prisma/src/postt'
Test Files 1 failed (1) | Tests 1 failed | 5 passed (6)      EXIT=1

### restore
sha256sum -c → tenantTransactionNesting.test.ts: OK
Test Files 1 passed (1) | Tests 6 passed (6)                 EXIT=0
```

---

## T4.2 / T4.4 / T4.7 — gate red transcripts

Checksum of the planted file before every plant:
`c32abb08551269007e947673eb2c6aa3fdacf28be5d2bc97075f24d563446194`
(`packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`). `sha256sum -c` returned `OK`
after each restore, and every gate was re-run green afterwards.

**Method note.** The `CLAUDE.md` blocks and the `fitness.yml` steps were both executed. The
`CLAUDE.md` block yields the COUNT; only the workflow step carries a failure mechanism, so the
`exit 1` evidence comes from a verbatim transcription of the shipped step (10-space indent
stripped, nothing else altered). The gate files themselves were never edited to manufacture a
red — the one apparent exception, #40 Part B red (iii), mutates the TRANSCRIPTION's
`PART_B_SCOPE` by a single character, because "a missing directory fails closed" is a property
of the gate that cannot be provoked from the source tree without deleting a live directory.

```text
### #40 Part B (i) — scope derivation replaced at the relocated `create` site
plant: resolveGucScope(this.tenantProvider) -> this.tenantProvider.getTenantContext()?.accountId
Fitness #40 part A: 0 transactions opened outside the seam (expect 0)
Fitness #40 part B: 1 seam calls with an underived scope (expect 0)
::error title=Fitness #40 violation (part B)::1 seam call(s) bind a scope that is not
`getAmbientGucScope()` or `resolveGucScope(this.tenantProvider)`. …
packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:568:      await withGucBoundTransaction(
EXIT=1                    CLAUDE.md block: SEAM_HITS=3 COUNT=0 SITES=13 BCOUNT=1

### #40 Part B (ii) — SAME plant, Part B scope narrowed back to apps/api/src
SEAM_HITS=3  COUNT=0  SITES=10  BCOUNT=0        EXIT=0
                      ^^^^^^^^ floor exactly; the extension is what sees the violation

### #40 Part B (iii) — one relocated directory misspelled in PART_B_SCOPE
::error title=Fitness #40 scope error::Part B scope
'packages/adapters/db-prisma/src/postt' does not exist — a relocated adapter home is gone, and
the scan would skip it silently and print 0.
EXIT=1

### restored
sha256sum -c → PrismaPostRepository.ts: OK
Fitness #40 part A: 0 …   Fitness #40 part B: 0 …   EXIT=0
SEAM_HITS=3  COUNT=0  SITES=13  BCOUNT=0
```

```text
### #23 — plant in the relocated REPOSITORY (C2: the UoW is a whole-file exception)
plant: await tx.$queryRawUnsafe("SELECT 1");   inside doCreate

OLD scope (apps/api/src + apps/workers/src, old exception filter)
  EXIT=0            ← the dead scope proving itself: 0 over a live violation

NEW scope (shipped)
::error title=Fitness #23 violation::1 raw Prisma query(s) outside tenant guard + composition root. …
packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:621:    await tx.$queryRawUnsafe("SELECT 1");
  EXIT=1            CLAUDE.md #23 block: 1

restored → sha256sum -c OK · fitness.yml step EXIT=0 · CLAUDE.md #23 block: 0
```

```text
### #3 — plant: const leak = {} as any;
NEW scope: ::error title=Fitness #3 violation::1 `any` usages …
           packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:621:    const leak = {} as any;
           EXIT=1        CLAUDE.md #3 block: 1
OLD scope: EXIT=0

### #5 — plant: // @ts-ignore
NEW scope: ::error title=Fitness #5 violation::1 @ts-ignore/@ts-nocheck in production source …
           packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:621:    // @ts-ignore
           EXIT=1        CLAUDE.md #5 block: 1
OLD scope: EXIT=0

### restored
sha256sum -c → PrismaPostRepository.ts: OK ; #3 = 0, #5 = 0, #23 = 0, #40 A/B = 0/0
```

---

## Guard-pair byte identity (spec R5, T4.8)

Compared after trimming the `fitness.yml` indentation. The grep EXPRESSIONS and scope lists are
identical; the shell plumbing and the messages differ by design, exactly as the design's rev 1.1
qualifier states (`CLAUDE.md` pipes to `wc -l`, `fitness.yml` captures `MATCHES=$(…)` and exits
under `::error title=…`).

```text
PART_B_SCOPE="apps/api/src packages/adapters/db-prisma/src/post packages/adapters/db-prisma/src/outbox packages/adapters/db-prisma/src/unitofwork"   IDENTICAL
for d in $PART_B_SCOPE; do                                                                        IDENTICAL
grep -rnE "withGucBoundTransaction\(" $PART_B_SCOPE --include="*.ts" | \                          IDENTICAL
sed -n "${ln},$((ln + 3))p" "$file" | grep -qE "getAmbientGucScope\(\)|resolveGucScope\(this\.tenantProvider\)"   IDENTICAL
SCOPE_EXEMPT='/saga/sagaTenant\.ts:'                                                              IDENTICAL   (still ONE file)
floor literal  -lt 10                                                                             IDENTICAL
TX_SEAMS='…' (W1)                                                                                 IDENTICAL
#3  scope list: packages/core apps/api/src/infrastructure packages/adapters/db-prisma             IDENTICAL
#5  scope list: apps/api/src/ packages/*/src/ packages/adapters/db-prisma/src/                    IDENTICAL
#23 scope list: apps/api/src apps/workers/src packages/adapters/db-prisma/src --include="*.ts" 2>/dev/null   IDENTICAL
#23 exception filter: grep -vE "/db-prisma/src/unitofwork/PrismaUnitOfWork\.ts"                   IDENTICAL
```

---

## Final gate — batch 2

| Gate                         | Command                                                                                        | Result                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                         | `pnpm exec eslint apps packages infra --ext .ts,.tsx --max-warnings 0`                         | **exit 0** — 0 errors, 0 warnings (the only output is 3 pre-existing `[boundaries]` plugin deprecation notices, which the plugin prints on every run and which `--max-warnings` does not count) |
| Types                        | `NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc -b apps/api packages/adapters/db-prisma` | **exit 0**, no output                                                                                                                                                                           |
| Types (package, incl. tests) | `pnpm --filter @adapters/db-prisma typecheck`                                                  | **exit 0**                                                                                                                                                                                      |
| Format                       | `pnpm format:check`                                                                            | clean for `apps/**`, `packages/**`, `infra/**`, `docs/**` and every artifact of THIS change                                                                                                     |
| Unit (affected)              | `vitest run` over the 7 suites this change touches                                             | **7 files / 93 tests passed**, exit 0                                                                                                                                                           |
| Unit (api, full)             | `pnpm --filter @apps/api test`                                                                 | **577 files / 8986 tests passed**, exit 0 — identical to W1 (batch 2 adds no test)                                                                                                              |
| Unit (package)               | `pnpm --filter @adapters/db-prisma test`                                                       | **4 files / 70 tests passed**, exit 0                                                                                                                                                           |
| Fitness                      | all 41, run from the repo root out of the shipped `CLAUDE.md` block                            | 41/41 green — counts below                                                                                                                                                                      |
| Boundary (spec R2)           | `rg -n "apps/api\|security/tenantContext" packages/adapters/db-prisma/src`                     | **0** — the new English comments were worded to keep it 0                                                                                                                                       |
| Comments (spec R6)           | accent grep over the four relocated files + a 24-word unaccented-Spanish sweep                 | **0** for both, plus a block-by-block read-back against explore §6                                                                                                                              |
| Docs (spec R8)               | the C8 FILE-level grep over `docs/technical docs/security`                                     | **0** (6 before)                                                                                                                                                                                |

### The 41 fitness counts, as printed

```text
#1  0   #2  0   #3  0   #4  0   #5  0   #6  0   #7  0   #8  0   #9  0   #10 0
#11 0   #12 0   #13 0   #14 0   #15 0   #16 0   #17 0   #18 0   #19 0   #20 0
#21 0   #22 0   #23 0   #24 (no output = pass)   #25 0 / 0      #26 0
#27 0 / 0       #28 0   #29 0   #30 20 (ratchet, baseline 21 — see C13)
#31 0 / 2 / 1   (Part A 0; Part B both floors held: 2 and 1, each ≥ 1)
#32 0   #33 0   #34 0   #35 0   #36 0   #37 0   #38 0 / 11      #39 0
#40 0 / 0       (internals: SEAM_HITS=3, COUNT=0, SITES=13 over floor 10, BCOUNT=0)
#41 0
```

### #40 Part B — the 13 sites the extended scope now reads

```text
apps/api/src/admin/SchedulingSlotHandlers.ts:418
apps/api/src/admin/SchedulingPostHandlers.ts:249
apps/api/src/admin/SchedulingPostHandlers.ts:349
apps/api/src/events/EventStore.ts:85
apps/api/src/outbox/outboxAdminRoutes.ts:73
apps/api/src/infrastructure/outbox/OutboxClaimService.ts:146
apps/api/src/infrastructure/repositories/PrismaProjectRepository.ts:383
apps/api/src/billing/gatewaySwitchProcessor.ts:117
apps/api/src/infrastructure/unitofwork/tenantTransaction.ts:55
apps/api/src/infrastructure/repositories/PrismaAccountRepository.ts:404
packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:185     ← relocated
packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:568     ← relocated
packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:664     ← relocated
```

### #30's 20 unreached suites, named so the ratchet is attributable (C13)

```text
integration/aiLocalizedRoutes · analyticsPremiumRoutes · analyticsStreamRoutes
integration/auditActorPolymorphism · bulkScheduleMediaPath · bulkScheduleReconciliation
integration/bulkScheduleRelayRetry · customerLoginMfa · customerLoginMfaE2e
integration/data-retention · inboxRoutes · mentionIngest · mfaCustomer · mfaTotpSingleUse
integration/redisTokenBucketRateLimiter · repurposeRoutes · sendReplyGuardrail
integration/shareOfVoice · trendRadarRoutes · universal-client-dashboard.integration
```

None of the 20 is a file batch 2 edited, and the only test file batch 2 DID edit
(`tests/unit/infrastructure/tenantTransactionNesting.test.ts`) is excluded from #30's population
by path. The fall from the documented 21 predates this batch in the working tree.

---

## Files touched in batch 2

**W2 — `refactor(persistence): translate relocated adapter comments to English`**

| Path                                                             | Edit                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/adapters/db-prisma/src/unitofwork/PrismaUnitOfWork.ts` | 4 comment hunks (13 blocks), incl. the stale `@example` → 3-parameter constructor |
| `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`   | 3 comment hunks (5 single-line comments)                                          |

**W3 — `test(persistence): keep the nesting-adjudication guard over the relocated adapters`**

| Path                                                                  | Edit                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/api/tests/unit/infrastructure/tenantTransactionNesting.test.ts` | `SEAM_ROOTS` + `SEAM_FILE_POPULATION` + the `toContain` loop; `apiSrc` removed |

**W4 — `chore(fitness): extend the seam, raw-query, any and ts-ignore scopes to db-prisma`**

| Path                            | Edit                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                     | #3 scope + comment · #5 scope + comment · #23 scope + sentence + re-pathed inert exception + 2 bullets · #40 Part B scope + loop + token + residuals (2)(4)(5) |
| `.github/workflows/fitness.yml` | the same four gates, grep expressions and scope lists byte-identical                                                                                           |

**W5 — `docs: re-path the relocated adapters in ADR-0023/0014/0005 and the guards doc`**

| Path                                                                     | Edit                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `docs/technical/ADR-0023-unit-of-work-result-aware-transaction.md`       | 4 citations re-pathed                                                                                  |
| `docs/technical/ADR-0014-multi-tenant-isolation-guards.md`               | 1 citation re-pathed (stale before this change)                                                        |
| `docs/technical/ADR-0005-unit-of-work-asynclocalstorage.md`              | 1 citation re-pathed (stale before this change)                                                        |
| `docs/security/MULTI_TENANT_GUARDS.md`                                   | both #23 scope sentences + the exception mention (C9); dated blockquote untouched (C12)                |
| `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`                              | ONE dated blockquote under the title; zero citations touched                                           |
| `openspec/changes/post-persistence-adapter-relocation/design.md`         | C10 row + the four flat-path amendments; prettier re-padded two tables and collapsed the barrel export |
| `openspec/changes/post-persistence-adapter-relocation/tasks.md`          | C10 amendments (T1.5, rename headroom) + the 19 W2–W5 `[x]` ticks                                      |
| `openspec/changes/post-persistence-adapter-relocation/proposal.md`       | C10 amendment at `:66`                                                                                 |
| `openspec/changes/post-persistence-adapter-relocation/apply-progress.md` | this merged artifact                                                                                   |

---

## Honesty notes — batch 2

1. **`pnpm format:check` at the repo root still exits 1**, on 10 markdown files under
   `openspec/changes/post-publish-partial-failure/` — the OTHER change's untracked artifacts.
   They were never touched, and the prompt forbids running prettier on them. Every file this
   change owns is prettier-clean.
2. **`pnpm lint --max-warnings 0` at the repo ROOT still exits 1** for the reason W1 recorded:
   `eslint .` walks `.config/opencode/plugins/*.ts`, untracked local tooling `.gitignore:187`
   excludes. Scoped to the committed tree (`eslint apps packages infra`) the run is 0/0.
3. `prettier --write` on `design.md` re-padded the corrections table and the D13 verification
   table and collapsed the barrel-export snippet onto one line, because the C10 amendment made
   two cells shorter and one longer. 41 lines moved; every one is a consequence of the
   amendment, not an independent edit.
4. **Neither `pnpm build` nor `pnpm --filter @apps/api test:all` was re-run in batch 2.** W1 ran
   both green (86/86 tasks; 536 integration tests, 0 fail / 0 cancel / 0 skip) and batch 2
   changes no runtime byte: W2 is comment text, W3 is a test-only guard, W4 is two shell gates,
   W5 is documentation. `tsc -b` and the full 8986-test unit run are the proof that no comment
   edit broke a parse. Naming this rather than implying full coverage.
5. The `sensitive-edit` token was active for every `CLAUDE.md` / `fitness.yml` edit, including
   the tripwire-carrying `(S2.1c)` line (R13). Nothing was blocked; no gate was paraphrased and
   no Bash write was used on either file.

## Backlog rows confirmed or added by batch 2

| Row     | Note                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1      | Re-confirmed: `/saga/sagaTenant\.ts:` in #40 A is inert; the floor of 3 is carried by two files. Its honest comment now ships in both gate files. Deletion still needs authorisation.                                                                                                                                                                                        |
| B2 / B3 | #23's UoW exception is INERT (tagged template vs a `\(`-anchored regex) and now SAYS so in both files; `resilience.ts:308` deliberately got NO exception line. Both close with SMELL-111.                                                                                                                                                                                    |
| B8      | #5's one-level `packages/*/src/` glob is named explicitly rather than widened; the two-level widening stays unmeasured.                                                                                                                                                                                                                                                      |
| B10     | Re-confirmed: `TENANT_RLS_AB_MEASUREMENT.md`'s citations and `scripts/rls-ab-measurement.ts:770-853`'s `sourceSite` literals are historical and were not rewritten — only a dated note was added.                                                                                                                                                                            |
| B15     | Re-confirmed and NOT acted on: `PrismaUnitOfWork.test.ts` still carries Spanish `it(...)` titles. It is not one of the four relocated files, so spec R6 does not reach it.                                                                                                                                                                                                   |
| **NEW** | `docs/security/MULTI_TENANT_GUARDS.md`'s 2026-07-27 blind-spot blockquote says "Seven live statements in `apps/api/src` are invisible to the check today". That count was taken before this relocation moved two of the statements out of `apps/api/src`; it is a DATED finding and was left alone (C12), but SMELL-111's closure should re-measure it rather than trust it. |

---

## Status

**41/41 tasks complete** (22 W1 + 19 W2–W5). Batch 2 stops at the W5 boundary for the
orchestrator's four commits (W2, W3, W4, W5), which are file-disjoint exactly as tasks.md scopes
them. Ready for `sdd-verify`.
