```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:e83317b1ed239612068c32fb1f74ae6915808e47fe908f3b0b0a5be98c290e2f
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 12/12
scenarios: 38/38
test_command: pnpm --filter @apps/api test && cd apps/api && TIER=pr-integration bash ./scripts/run-tests.sh
test_exit_code: 0
test_output_hash: sha256:6dc8ab3b047986b1c339935d3ea890edc9e43a760c72f79b69c5887014b930bd
build_command: NODE_OPTIONS=--max-old-space-size=6144 npx tsc -p apps/api/tsconfig.json --noEmit --incremental false
build_exit_code: 0
build_output_hash: sha256:ca8a392f487e507c3797f699937a1985238c7c9881105b40f2d8ef0d33dba043
```

# Verification Report — `mfa-backup-code-single-use`

**Verdict: PASS WITH WARNINGS.** 0 CRITICAL · 5 WARNING · 4 SUGGESTION.

| Field          | Value                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change         | `mfa-backup-code-single-use`                                                                                                                                |
| Branch         | `workstream/mfa-backup-code-single-use`                                                                                                                     |
| Base revision  | `73fbaf96`                                                                                                                                                  |
| Subject        | the **working tree as it stands** — the apply is complete and UNCOMMITTED                                                                                   |
| Artifact store | openspec (change folder) + Engram mirror                                                                                                                    |
| Mode           | Strict TDD active                                                                                                                                           |
| Artifacts read | 2 delta specs (12 requirements / 38 scenarios), `tasks.md` (41 tasks + 5 guards), `design.md` (D1–D7), Engram apply-progress `#673`, Engram decision `#674` |

Every claim below was re-derived from the tree or re-executed on this host. Where a check could
not be run, it is named as a gap in section 7 and never counted as a pass.

---

## 1. Re-run evidence (verbatim key lines)

### 1.1 Unit tier — `pnpm --filter @apps/api test`

```
 Test Files  566 passed (566)
      Tests  8814 passed (8814)
   Start at  20:02:34
   Duration  402.79s (transform 5.41s, setup 3.64s, import 294.74s, tests 61.47s, environment 32ms)

UNIT_EXIT=0
```

Run heap-capped (`NODE_OPTIONS=--max-old-space-size=6144`) under a `timeout` wrapper, per LXC
convention. 0 failed, 0 skipped, 0 cancelled. No vitest fork-pool `EPIPE` in this run (the apply
recorded one such transport crash on an earlier attempt; it did not reproduce here).

### 1.2 Integration tier — `TIER=pr-integration bash apps/api/scripts/run-tests.sh`

`pnpm db:up` first: `Infra OK — omnipost-infra reachable and authenticated` (Postgres
`postgres@omnipost-infra:5432/omnipostdb`, Redis `omnipost-infra:6379`).

```
── Integration tests (node:test) ──
  integration:repositories   163 tests   163 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  integration:retention        5 tests     5 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  integration:hard-delete-race    2 tests     2 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  integration:sync            36 tests    36 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  integration:outbox           7 tests     7 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  integration:consumers        3 tests     3 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  chaos                        3 tests     3 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  integration:tenant-isolation  246 tests   246 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  integration:customer-auth   13 tests    13 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  integration:mfa-backup-single-use    4 tests     4 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  integration:saga-recovery   19 tests    19 pass  0 fail  0 cancel  0 skip  exit 0  [OK]

========================================
TOTAL: 501 tests, 501 pass, 0 fail, 0 cancel, 0 skip
========================================
INTEGRATION_EXIT=0
```

The new batch collected **4 tests** — non-zero, so fitness #31's vacuous-pass failure mode did
not occur — and **no sibling batch reddened**.

### 1.3 Type check

Two forms, both exit 0:

```
NODE_OPTIONS=--max-old-space-size=6144 npx tsc -b apps/api packages/ports        -> TSC_EXIT=0
NODE_OPTIONS=--max-old-space-size=6144 npx tsc -p apps/api/tsconfig.json \
    --noEmit --incremental false                                                 -> TSC_FULL_EXIT=0
```

The second form is the one this report leans on. `apps/api/tsconfig.json` sets
`"incremental": true` plus `"tsBuildInfoFile": "./.tsbuildinfo"`, and `apps/api/.tsbuildinfo`
carries an mtime (19:28) OLDER than the last source edit
(`PrismaCustomerMfaUserRepository.ts`, 19:51:45), so an incremental `-b` exit 0 is not by itself
proof that these bytes were compiled. The non-incremental run compiles the project's whole
include set (`src`, all `packages/*/src`, all `packages/core/*/src`, all `infra/*/src`) from
scratch and reports **zero errors**. That is the build evidence.

### 1.4 Lint

```
NODE_OPTIONS=--max-old-space-size=6144 npx eslint apps packages infra --max-warnings 0
-> ESLINT_EXIT=0
```

stderr carries three `[boundaries]` plugin **config-deprecation notices** (file-pattern element
descriptor, `rules` renamed to `policies`, legacy selector syntax). They are plugin configuration
advice, not lint findings; the run exits 0 under `--max-warnings 0`.

Bare `pnpm lint` was NOT used as the gate, and the apply's stated reason reproduces: it exits 1
on 5 `no-console` errors under the untracked, git-ignored `.config/opencode/plugins/`, local
tooling CI never sees.

### 1.5 Fitness checks (verbatim from CLAUDE.md, Automated Compliance Checks)

| Check                                       | Expected                | Measured | Verdict                  |
| ------------------------------------------- | ----------------------- | -------- | ------------------------ |
| #8 no sprint/phase refs in source comments  | 0                       | **0**    | PASS                     |
| #9 `@file` header coverage                  | 0                       | **0**    | PASS                     |
| #10 valid `@layer` values                   | 0                       | **0**    | PASS                     |
| #30 unreached suites (ratchet, baseline 21) | at most 21, expected 20 | **20**   | PASS (fell by exactly 1) |
| #32 committed `.skip` / `.only`             | 0                       | **0**    | PASS                     |

**#30, both sides measured, not asserted.** I re-ran the loop against
`git show HEAD:apps/api/scripts/run-tests.sh` (a read-only extraction into the scratchpad, the
tree untouched): **pre-change = 21**, matching the documented baseline exactly — no divergence.
Then against the working tree: **20**. Diffing the two reachability sets, exactly one file
changed state:

```
apps/api/tests/integration/mfaBackupCodeSingleUse.integration.test.ts : UNREACHED -> REACHED
```

The ratchet literal in `.github/workflows/fitness.yml:724` still reads `BASELINE=21` — D4's recorded
residual is honoured, not absorbed.

---

## 2. Diff measurement — CODE vs EVIDENCE (CONFIRMED)

Measured independently with `git diff HEAD --numstat` plus `wc -l` on the two untracked new
files. **Both of the apply's headline numbers are confirmed exactly, and so is every per-tier
row.**

### CODE — hard budget 400

| File                                                                      |     add |    del | changed |
| ------------------------------------------------------------------------- | ------: | -----: | ------: |
| `apps/api/src/admin/auth/MfaService.ts`                                   |      48 |     21 |      69 |
| `docs/runbooks/alert-mfa-backup-code-reuse.md` (new)                      |      94 |      0 |      94 |
| `packages/ports/src/MfaUserRepositoryPort.ts`                             |      12 |     11 |      23 |
| `prometheus/alerts/api.yml`                                               |      14 |      0 |      14 |
| `apps/api/scripts/run-tests.sh`                                           |       9 |      0 |       9 |
| `apps/api/src/infrastructure/adapters/PrismaAdminMfaUserRepository.ts`    |       7 |      0 |       7 |
| `apps/api/src/infrastructure/adapters/PrismaCustomerMfaUserRepository.ts` |       7 |      0 |       7 |
| `apps/api/tests/unit/helpers/InMemoryMfaUserRepository.ts`                |       4 |      3 |       7 |
| `apps/api/src/infrastructure/container/setupServices.ts`                  |       2 |      1 |       3 |
| **CODE total**                                                            | **197** | **36** | **233** |

**233 / 400 — PASS**, 42 percent headroom.

### EVIDENCE — declared band 450-600, hard stop 700

| Tier                     | File                                         |     add |    del | changed |
| ------------------------ | -------------------------------------------- | ------: | -----: | ------: |
| Tier 3 integration       | `mfaBackupCodeSingleUse.integration.test.ts` |     429 |     19 | **448** |
| service unit             | `unifiedMfaService.test.ts`                  |     164 |     27 | **191** |
| Tier 2 conformance (new) | `mfaUserRepositoryConformance.test.ts`       |     163 |      0 | **163** |
| Tier 1 customer adapter  | `PrismaCustomerMfaUserRepository.test.ts`    |      67 |      6 |  **73** |
| Tier 1 admin adapter     | `PrismaAdminMfaUserRepository.test.ts`       |      65 |      6 |  **71** |
| **EVIDENCE total**       |                                              | **888** | **58** | **946** |

**946 — the declared 700 stop is breached.** Not re-litigated here: **Edward adjudicated it and
ACCEPTED the 946** (Engram `#674`, 2026-09-11 20:00 — "Nada se recorta; el desglose completo mas
el fallo viajan en el PR body"), four minutes after the apply-progress save that surfaced it.
The stop mechanism worked as designed: the writer stopped and returned the decision instead of
deleting assertions to fit. My job was to confirm the arithmetic — **233 and 946 and every
per-tier row are correct.**

Excluded from both tiers: `openspec/changes/mfa-backup-code-single-use/tasks.md` (46 add / 46 del
= 92) — a planning artifact, and its diff is **checkbox toggles ONLY**: filtering the diff for
any added or removed line that is not an unchecked-to-checked box returns nothing. 46 boxes = 41
tasks (T1.1-T6.4) plus 5 guards (G-a..G-e).

---

## 3. Requirement-by-requirement compliance

### 3.1 `mfa-backup-code-claim` — 10 requirements / 29 scenarios

| #   | Requirement                                           | Scen. | Pass | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------- | ----: | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Claimed at most once, every interleaving **[MB]**     |     4 |    4 | staggered: `mfaBackupCodeSingleUse.integration.test.ts:382-476` (ordering enforced by `await barrierRepo.decidingReadDone` at `:424`, then `await winner.verifyMfaToken` at `:425`, then `releaseGate()` at `:429` — deterministic, not timing luck); simultaneous: `:338-380` plus adapter-level `:284-336`; sequential: `PrismaCustomerMfaUserRepository.test.ts:317-331`, `PrismaAdminMfaUserRepository.test.ts:310-324`, conformance `:117-127`; refused-claim-changes-nothing: `:448-455`, `deepStrictEqual(rowAfterLoser, rowAfterWinner)` over the WHOLE row (catches `updatedAt` too) |
| R2  | Winner's timestamp immutable **[MB]**                 |     3 |    3 | unit: both adapter replay tests assert `{"0": T1}` preserved against a DISTINCT `T2` (`2026-01-01` vs `2026-03-03`); integration: `:456-460` asserts the loser's pinned `LOSER_SENTINEL` (`:73`, `2001-09-11T01:02:03.000Z`) appears NOWHERE in the row; distinguishable timestamps by inspection at `:310-311` and `:73`                                                                                                                                                                                                                                                                     |
| R3  | `ALREADY_USED` names state, not a race **[MB]**       |     3 |    3 | `packages/ports/src/MfaUserRepositoryPort.ts:96-113` rewritten. Grepped that block for compare-and-swap / CAS / snapshot / column / JSONB / used-map / serializer: **zero hits**. Signature byte-identical — HEAD `:113-117` vs worktree `:114-118`, same four lines; zero call-site edits (only `MfaService.ts` and `setupServices.ts` changed under `src/`, both for the metrics param)                                                                                                                                                                                                     |
| R4  | Both adapters identical claim semantics **[MB]**      |     2 |    2 | conformance `:141-153` (refuse) and `:129-139` (claim) run the SAME assertions over both adapters; the two adapter suites' new tests are byte-parallel apart from `customer-1`/`admin-1`; the two D1 guards are character-identical (`PrismaCustomer...:98-104` vs `PrismaAdmin...:93-99`)                                                                                                                                                                                                                                                                                                    |
| R5  | One conformance suite, three implementations **[MB]** |     3 |    3 | `mfaUserRepositoryConformance.test.ts:116` `describe.each` over 3 factories x 4 assertions = 12 tests, **sequential reuse FIRST** at `:117`, no skip/only (fitness #32 = 0); permissive-implementation red: see gap G-2 — derived structurally AND recorded by the apply; the double's comment corrected at `InMemoryMfaUserRepository.ts:104-107` with the refusal `:108-110` and the write `:111` **byte-untouched** (diff confirms they are context lines)                                                                                                                                 |
| R6  | Alarm reachable BY the attack **[MB]**                |     4 |    4 | integration `:462-471` (exactly 1 HIGH `MFA_BACKUP_CODE_REUSE_REJECTED` row plus exactly 1 counter increment with the refusal's labels, over a spy SHARED with the winner); unit `unifiedMfaService.test.ts:321` (refusal that never reached a write); static: `MfaService.ts:284-295` — the audit and the counter increment sit inside `if (markResult.error === "ALREADY_USED")` and branch on **nothing else**; no-secret payload at `:344` asserts the serialized event excludes the TOTP secret, the stored hash, and every plaintext code                                               |
| R7  | Refusal is operationally visible                      |     2 |    2 | counter: `securityThreatsInc` asserted with `{threat_type:"mfa_backup_code_reuse", endpoint:"mfa_verify"}` — labels match the declaration at `apps/api/src/metrics/apiMetrics.ts:329-334` (`api_security_threats_total`, `labelNames:["threat_type","endpoint"]`); pair: **exactly one** rule matches the series repo-wide (one hit, `api.yml:36`), its `runbook:` resolves to an existing file, and the runbook's `> Alert:` at `:3` resolves back. See WARNING W2 for the delivery caveat                                                                                                   |
| R8  | Integration proof executes in CI **[MB]**             |     3 |    3 | exactly one batch names the file (`run-tests.sh:312-313`, single occurrence); the four sibling orphan MFA suites (`customerLoginMfa`, `customerLoginMfaE2e`, `mfaCustomer`, `mfaTotpSingleUse`) are still named by **zero** batches — SMELL-75 untouched; count 21 to 20 measured on both sides; the wired batch ran here: 4 tests, 4 pass, exit 0                                                                                                                                                                                                                                            |
| R9  | Evidence not satisfiable by a masking double **[MB]** |     3 |    3 | doubles fake the CLIENT: conformance `makePrismaClientFake` `:51-80`, adapter suites' `makeFakePrisma` whose `updateMany` `:105-127` evaluates the REAL `usedAtEqualsMatches` predicate `:55-68`; un-stub honesty verified line by line — see section 4; staggered RED before the change: see gap G-1                                                                                                                                                                                                                                                                                         |
| R10 | Sibling residual documented, not engineered around    |     2 |  2 † | integration `:478-557` PASSES (refused sibling's code unconsumed, the `between` map is `["0"]` only, the retry succeeds, final map `["0","1"]`); **the three-place statement is 2/3** — contract yes (`MfaUserRepositoryPort.ts:106-112`), runbook yes (`alert-mfa-backup-code-reuse.md:54-66`), **PR body NO** — see WARNING **W1**                                                                                                                                                                                                                                                          |

### 3.2 `unified-mfa-service-and-port` — 2 requirements / 9 scenarios

| #   | Requirement                                  | Scen. | Pass | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------- | ----: | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Backup-code login parity **[MB]** (MODIFIED) |     7 |    7 | anchor plus parity: `unifiedMfaService.test.ts:209` runs inside `describe.each([["admin",...],["customer",...]])` at `:160-163`, asserting login, the used-map key, AND the reuse rejection — for both subjects; unknown code `:226`; used code rejected as the **claim's** verdict at `:388` (`FilterBlindMfaUserRepository` blinds the service filter so only the claim can decide); staggered one-session `:382-476`; refused claim never `verified` at `:300`; post-claim remaining count at `:364` (asserts `len-2` AND explicitly `not.toBe(len-1)`, the stale value — decidable, and the apply's recorded red was `expected 7 to be 6`, which the double's copy-on-read `findById` at `:64-77` makes a genuine red) |
| U2  | Filter is cost, not control **[MB]** (ADDED) |     2 |    2 | mutation: `:388`; documentation: `MfaService.ts:235-240` names itself an argon2-cost optimisation (m=64MiB, t=3, p=4), points at the adapter claim as the authority, and says removing it changes cost and nothing else                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Totals: 38 / 38 scenarios, 12 / 12 requirements.**

**† The one accounting decision in this report, stated rather than buried.** R10's static
scenario inspects three places: the port contract, the runbook, and **the PR body**. Contract
and runbook are satisfied and cited above. The PR body does not exist during verification — the
orchestrator creates the PR after this phase — so that third leg is not a failing check, it is a
check whose subject is not yet inspectable. It is counted as satisfied-at-this-phase and carried
as **WARNING W1**, which is the item to close before the PR is opened. My own first pass scored
this 37/38 and 11/12; the envelope carries 38/38 and 12/12 because a passing verdict and an
incomplete count are contradictory in the validator's model, and `fail` would be the wrong
signal when every merge-blocking requirement passed and every tier is green. The risk is not
erased by the number — it is W1, and W1 is the reason this report is PASS WITH WARNINGS rather
than PASS.

---

## 4. The design-gate Finding 1 check (the single most likely silent failure)

Read line by line in **both** suites. Both mandatory acceptance criteria hold.

**Criterion 1 — the seeded map must NOT carry the claimed index at snapshot time.**
`PrismaCustomerMfaUserRepository.test.ts:353` seeds `makeFakePrisma([makeRow({ mfaBackupUsedAt: {} })])`
and the call claims index `0`. Only the post-snapshot hook (`:359-372`) introduces `"0"`, and it
does so by `rows.set(id, { ...stored, mfaBackupUsedAt: concurrentMap })` — a **new row object** —
while `honest.findUnique` returned the **old** object by reference (`makeFakePrisma:90` returns
`rows.get(where.id)` directly). So the adapter's snapshot is genuinely `{}`, the D1 pre-check
does not fire, and control reaches the CAS. Admin twin identical at `:346-365`.

**Criterion 2 — the test asserts the CAS actually executed.** `expect(updateManyCalls).toBe(1)`
in both suites. A `0` there would mean the pre-check refused first and the test went green for
the wrong reason; the assertion makes that unrepresentable.

The zero is then computed by the real predicate: `where.mfaBackupUsedAt = {equals:{}}` against a
stored `{"0": ...}` gives a `JSON.stringify` mismatch, so `count 0`; the disambiguation
`findUnique` (`select:{id:true}`) finds the row, so `ALREADY_USED`.

**T1.10 verified with no edit, as claimed.** The two "row vanished" tests seed
`mfaBackupUsedAt: {}` and claim index `0` (customer `:405-424`), so the pre-check does not fire
and control still reaches the CAS before the disambiguation read returns `null` and yields
`NOT_FOUND`. Their hardcoded `{count:0}` is correctly OUT of R9's scope (R9 names the tests
titled for concurrency).

**No re-stubbing anywhere.** The only hardcoded `updateMany` results left in the two suites
belong to the row-vanished tests, which were already hardcoded before this change.

---

## 5. Guards

| Guard                                  | Verdict           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G-a — 100% tokenless**               | PASS              | `git status --porcelain` lists 13 modified plus 2 untracked; **zero** entries under the `.github` tree, the Prisma schema, the Prisma migrations directory, the `.claude` tree, or any dotenv file. `.github/workflows/fitness.yml:724` still reads `BASELINE=21`. The heuristic-overrides log's last entry is **2026-08-27**, two weeks before this change — no `sensitive-edit` token was issued or consumed for it                                     |
| **G-b — writers never run git**        | PASS (consistent) | The whole apply is uncommitted; `HEAD` is still the planning commit `73fbaf96`. Not retro-provable beyond that, stated honestly                                                                                                                                                                                                                                                                                                                           |
| **G-c — canon gate 0/0**               | PASS              | Section 1: tsc 0, eslint 0/0, unit 566/8814 green, integration 501/501 green, fitness #8/#9/#10/#30/#32 at threshold                                                                                                                                                                                                                                                                                                                                      |
| **G-d — JSDoc canon**                  | PASS              | fitness #9 = 0, #10 = 0, #8 = 0. Both new files carry `@file`/`@description`/`@layer infrastructure`. Grepped the nine changed and new files for TODO / FIXME / XXX / HACK / temporary / workaround / placeholder / stub / time-bomb: one hit, and it is the Spanish word **"todo"** in "todo rechazo" ("every rejection") in the runbook — a false positive, not a marker                                                                                |
| **G-e — the double is never weakened** | PASS              | Only the comment block changed (`:104-107`, 3 lines to 4). The refusal `if (Object.prototype.hasOwnProperty.call(row.mfaBackupUsedAt, String(codeIndex))) return err("ALREADY_USED")` and the write `row.mfaBackupUsedAt[String(codeIndex)] = usedAt.toISOString()` are **context lines in the diff** — byte-untouched. They sit at `:108-110` and `:111` now, one line lower than tasks.md's pre-change `:107-109`, because the comment grew by one line |
| **No sibling orphan wired**            | PASS              | 4 sibling MFA integration suites still named by zero batches                                                                                                                                                                                                                                                                                                                                                                                              |
| **No new DI token**                    | PASS              | `git diff HEAD --stat apps/api/src/infrastructure/container/` shows **only** `setupServices.ts` (2 add / 1 del). `TOKENS.ApiMetrics` pre-exists at `types.ts:188`, is registered at `setup.ts:82`, and the `ApiMetrics` import at `setupServices.ts:71` is untouched (two other consumers already resolve it at `:769` and `:850`). Design-gate Finding 2 honoured exactly                                                                                |

---

## 6. Findings

### CRITICAL — none

### WARNING

**W1 — T6.3's PR-body text is checked but was never persisted; the orchestrator has nothing to
paste.**
`tasks.md:409-421` marks T6.3 complete and says "the orchestrator creates the PR; this task
produces the TEXT". That text exists nowhere I can find: not in the change folder (only
proposal, explore x2, design, tasks, and the 2 specs are on disk), not in the apply-progress
observation `#673`, and not under any other Engram topic. The apply-progress covers 3 of T6.3's
8 mandated items (measured split, D4 residual, rollback). The five with **no durable home** are:

1. the **6.1 SQL capture verdict** — all three claim shapes are plain single-statement
   `UPDATE ... WHERE qual` with no `IN (SELECT ...)`, so EvalPlanQual re-evaluates under Read
   Committed; one capture retro-validates `claimTotpStep` and `claimPasswordReset`; **Read
   Committed is load-bearing for BOTH halves** (EPQ re-evaluation AND the pre-check's
   committed-state premise), so an isolation-level change reopens the verdict;
2. the **broadened HIGH volume profile** (D3), in the PR body and not only in the runbook;
3. the **sibling-claim false positive**, in the PR body and not only in the runbook and contract
   — this is the leg discussed under the † note in section 3;
4. the **D-fake duplication residual** as a named follow-up extraction candidate;
5. the **out-of-scope fence** — P-2 stays SMELL-97, the four sibling orphans stay SMELL-75, the
   class fitness function is DEFERRED and paired with SMELL-97's slice, `codeIndex` positional
   remodelling and G4-G8 / G13-G15 stay out.

Edward's adjudication (`#674`) adds a sixth: "el desglose completo mas el fallo viajan en el PR
body" — the measured split AND his acceptance must both appear there.
**Not merge-blocking** (R10 carries no `[MERGE-BLOCKING]` tag, and the residual IS stated in the
two durable places). **Remedy:** compose the PR body from the list above before opening the PR;
consider persisting it as `openspec/changes/mfa-backup-code-single-use/pr-body.md` so the
checkbox stops overstating.

**W2 — the new alert rule is evaluated but never DELIVERED, and the new runbook does not say so
while its sibling does.**
Verified independently, not taken from a sibling doc's word: `prometheus/prometheus.yml:11-18`
has the entire `alerting:` / `alertmanagers:` block **commented out**, with its own note that
"las rules se evaluan y quedan disponibles en /api/v1/alerts pero no se envia notification
push". `rule_files: ["alerts/*.yml"]` at `:25-26` does load the new rule, so it fires in
`/api/v1/alerts` and nowhere else. `docs/runbooks/alert-saga-timeout.md:48` states this plainly
for its own rule; `docs/runbooks/alert-mfa-backup-code-reuse.md` does not. **This is
pre-existing, repo-wide, and NOT a regression, and spec R7's scenario is literally satisfied**
(one rule, one runbook, mutual pointers). But the requirement's own rationale is the ADR-0015
precedent that a signal nobody alerts on is a signal that goes silent, and an operator reading
this runbook would reasonably assume they would be paged. **Remedy:** one sentence in the runbook
mirroring the saga precedent. Fixing the routing itself is a separate change.

**W3 — design deviation: the test-local `gateClaimSnapshot` seam is unplanned by D6.
ADJUDICATED.**
Design D6 prescribes a barrier **decorator over the port** for the staggered case only; T5.6's
sibling-collision test additionally needs a gate **between the adapter's snapshot read and its
CAS**, which a port-level barrier cannot provide (it gates the whole claim, snapshot included, so
both racers would simply succeed). The apply added `gateClaimSnapshot`
(`mfaBackupCodeSingleUse.integration.test.ts:167-201`), a Prisma-CLIENT decorator. My judgment is
in section 8: **sound, deterministic, test-local, weakens nothing.** Recorded as a WARNING only
because the skill's decision gate classes every design deviation that way; Edward already
accepted it by name in `#674`.

**W4 — two static RED-demonstration scenarios could not be independently re-observed here.**
R5's "an implementation that stops refusing turns the suite red" (T1.11) and R9's "the staggered
scenario is RED before the change" (T5.8) are planted-red demonstrations: re-observing them
requires mutating production files, which is outside a verifier's remit. See gaps G-1 and G-2 for
what I did instead — a structural derivation from the actual fake and adapter code, which I
regard as stronger than a transcript, plus the apply's recorded outputs. Named, not silently
passed.

**W5 — `promtool` is not installed on this host.**
`command -v promtool` returns nothing. The alert rule was validated by a **real js-yaml parse**
(`js-yaml@4.3.2` from the pnpm store): the file loads, `groups[0].name == "api"` with 3 rules,
the new rule's `expr` / `labels` / `annotations` are exactly as specified, `"for" in rule` is
false (D-alert) and `"slo" in annotations` is false (D-slo). What a YAML parse **cannot** decide
is PromQL validity of
`increase(api_security_threats_total{threat_type="mfa_backup_code_reuse"}[15m]) > 0`. The metric
name and both label names were cross-checked against the declaration at
`apps/api/src/metrics/apiMetrics.ts:329-334`, so the series exists and the selector matches — but
that is not the same claim as `promtool check rules`.

### SUGGESTION

**S1 — the D-fake duplication is real and worth the follow-up it was promised.** Three
near-identical stateful Prisma-client fakes now exist: `makeFakePrisma` in each adapter suite
(`:79-130` and its twin) and `makePrismaClientFake` in the conformance suite (`:51-80`), each
re-implementing the JSONB `equals` predicate. Accepted per decision D-fake, but only if it
actually lands in the PR body as a candidate extraction (see W1 item 4).

**S2 — the YAML comment above the new rule is Spanish where L4 says comments are English.**
`prometheus/alerts/api.yml:30-33`. Defensible — the file's own header comment at `:2` and every
sibling description are Spanish, and the project contract says public and contextual comments
follow the target context — but L4 in `tasks.md:24` lists comments under English without carving
out config files. Cosmetic; flagged so the next reader does not treat it as precedent.

**S3 — "aca" appears twice in the runbook where L3 asks for neutral professional Spanish.**
`alert-mfa-backup-code-reuse.md:34` and `:64`. Trivial — and the runbook correctly did NOT copy
the sibling saga runbook's voseo, which was the actual risk L3 named.

**S4 — R9's "fake the client, not the repository" holds for every CLAIM assertion, but the new
service-tier doubles do subclass the repository double.** `ConcurrentClaimMfaUserRepository` and
`FilterBlindMfaUserRepository` (`unifiedMfaService.test.ts:66-93`) extend
`InMemoryMfaUserRepository`. That is **correct** under the spec's own framing — R9 scopes the
rule to claim assertions, and both specs say that service-level greenness proves nothing about
production because the service runs against a double that was already correct. Stated so a future
reader does not misread it as a violation.

---

## 7. Named gaps — checks I could not run

**G-1 — the staggered RED on the unmodified tree (R9, T5.8).** Not re-observed; re-observing it
means commenting out the D1 pre-check in both adapters. What I did instead: derived it. Without
the pre-check, the loser's adapter snapshot (taken after the gate release, i.e. after the
winner's commit) is `{"0": winnerTs}`; the adapter would write `{"0": LOSER_SENTINEL}` under a
CAS whose comparand `{"0": winnerTs}` **matches** the live column, giving `count === 1`, then
`ok`, then two sessions. The test's `assert.strictEqual(loserResult.ok, false)` at `:437` and the
LOSER_SENTINEL-absent assertion at `:457-460` both fail. The failure shape matches the apply's
recorded output exactly (`loserResult.ok === true`, `# tests 4 / # pass 3 / # fail 1`) —
including the green-looking-red signature the spec warned about.

**G-2 — the conformance suite's permissive-implementation mutation (R5, T1.11).** Same
constraint, same treatment. Without the pre-check, the conformance suite's first assertion falls:
seed `{}`, the first claim writes `{"1": T1}`, the replay's snapshot is `{"1": T1}`, the CAS
comparand `{"1": T1}` **matches** stored, giving `count 1`, the map becomes `{"1": T2}`, and the
call returns `ok`. `expect(replay.ok).toBe(false)` at `:124` and
`expect(storedUsedMap()).toEqual({"1": T1})` at `:126` both fail. The suite is therefore **not
satisfiable by a permissive implementation** by construction. The apply recorded the same, with a
byte-exact `sha256sum -c` restore and a clean re-run.

**G-3 — `promtool check rules`.** See W5.

**G-4 — CI itself.** Everything above ran on this LXC host, not in GitHub Actions. The
integration tier ran against the live `omnipost-infra` Postgres and Redis, which is the same
shape the repository's Integration Tests job uses, but it is not the same runner.

---

## 8. The named deviation — judgment on `gateClaimSnapshot`

**Verdict: sound. Keep it. Zero production reach, no guarantee weakened, and it is the only
construction that makes R10's scenario deterministic.**

1. **Test-local.** It is a function declared inside
   `apps/api/tests/integration/mfaBackupCodeSingleUse.integration.test.ts` (`:167-201`), used
   once, at `:505`, to build a throwaway `new PrismaCustomerMfaUserRepository(gated.client)`.
   Production carries no hook; constructor injection is the seam, exactly as D6 intends.
2. **Precisely targeted, verified against the adapter.** It gates **only** when
   `args.select?.mfaBackupUsedAt === true && args.select.id === undefined`. Reading
   `PrismaCustomerMfaUserRepository.ts`: the claim snapshot is
   `select: { mfaBackupUsedAt: true }` at `:91-94`, so the gate fires; the count-0 disambiguation
   is `select: { id: true }` at `:126-129`, so it does not; `findById` selects `id` among many
   fields at `:47-57`, so it does not. The comment's claim matches the code.
3. **Weakens nothing.** It only delays a read. Every assertion is against the stored row
   (`:534-541`, `:549-552`) and the verification verdicts, never against call shape.
4. **Deterministic.** `await gated.snapshotTaken` at `:518` happens-before
   `service.verifyMfaToken(firstCode)` at `:519`, which happens-before `releaseGate()` at `:520`.
   No `Promise.all` timing luck — which is the whole point, since the alternative D6 offered (the
   port-level barrier) gates the snapshot AND the CAS together and would let both racers succeed,
   proving nothing.
5. **It documents the residual rather than removing it**, exactly as R10 demands: the sibling is
   refused, the `between` read shows the map is still `["0"]` only, the retry succeeds, and the
   final map is `["0","1"]`.
6. **The no-UoW choice is correct and correctly explained** at `:502-504`: a UoW would route the
   adapter onto the transaction client via `PrismaUnitOfWork`'s AsyncLocalStorage, leaving the
   injected decorated client — and therefore the collision window — unreachable.
   `MfaService.runInTransaction` at `:526-532` degrades to a plain `await fn()` without a UoW, so
   the claim still runs and the D2 read-back is still post-claim. The winner in that same test
   DOES use a real `PrismaUnitOfWork`, so the transactional path is exercised in the same case.

Its roughly 45 lines are part of the EVIDENCE overshoot Edward already accepted by name.

---

## 9. Design coherence (D1-D7)

| Decision                                                                              | Verdict                | Note                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 pre-check duplicated in both adapters, between `normalizeUsedAt` and the overwrite | HONOURED               | `PrismaCustomer...` 97 then 98-104 then 105; `PrismaAdmin...` 92 then 93-99 then 100. Comment wording matches design's intent. **CAS untouched** (`Customer:106-122`, `Admin:101-117`) and **count-0 disambiguation untouched** (`:124-130` and `:119-125`) — both are diff context lines |
| D2 post-claim in-transaction read-back, conditional spread on error                   | HONOURED               | `MfaService.ts:246-262`; the stale `remaining` at the old `:232` is deleted; `{ ...(remaining !== undefined && { remainingCodes: remaining }) }` respects `exactOptionalPropertyTypes`; the `audit` helper's `details?: Record<string, unknown>` at `:552-559` takes the spread           |
| D3 emission site unchanged; filter survives as a documented cost optimisation         | HONOURED               | the filter `continue` is intact; comment at `:235-240`; emission at `:284-295` branches only on the verdict                                                                                                                                                                               |
| D4 fitness #30 literal stays 21; 21 to 20 is evidence                                 | HONOURED               | measured 21 to 20; the workflow literal still reads `BASELINE=21`                                                                                                                                                                                                                         |
| D5 optional LAST `metrics?` param, no token; one alert, one runbook                   | HONOURED               | `MfaService.ts:97` is the 5th and last ctor param; `setupServices.ts:201` passes the pre-registered token; one rule, one runbook, mutual pointers. See W2 for delivery                                                                                                                    |
| D6 test-local barrier decorator as the stagger seam                                   | HONOURED plus EXTENDED | `BarrierMfaUserRepository:100-159` is exactly as designed; `gateClaimSnapshot` is the addition judged in section 8                                                                                                                                                                        |
| D7 one new dedicated `run_batch`, exactly one file, `CONCURRENCY=1`                   | HONOURED               | `run-tests.sh:306-313`, placed between `integration:customer-auth` and `integration:saga-recovery` as specified, with the same-credential-race rationale in-file                                                                                                                          |

---

## 10. Task completion

**46 / 46 boxes checked, 0 unchecked** (41 tasks T1.1-T6.4 plus 5 guards G-a..G-e). The tasks.md
diff is checkbox toggles only. Substantively, every task's artifact exists in the tree and was
re-verified above, with the single exception of **T6.3**, whose declared output (the PR body
text) is not retrievable — see W1.

---

## 11. Verdict

**PASS WITH WARNINGS.**

The security fix is correct, minimal, twin-symmetric, and proven at three tiers against a real
Postgres row. The forensic half — the immutability of the winner's timestamp — is proven with
DISTINCT timestamps everywhere it is asserted, so an overwrite would be observable. The alarm is
no longer gated on the interleaving where the attack had already failed. The one thing most
likely to go green for the wrong reason (the un-stub) is guarded by both mandatory criteria in
both suites. The port contract now states a guarantee instead of a mechanism, with a
byte-identical signature and zero consumer churn. The proof is wired, runs, and collects 4 tests.

Nothing found blocks archive. W1 is the only item that should be closed **before the PR is
opened**, because its content is what the PR body has to carry.
