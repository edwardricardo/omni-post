```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:335e38ca59de49772b3de808bf3a5fb6c00bd52f0af6daac68d19468368a67ec
verdict: fail
blockers: 0
critical_findings: 0
requirements: 12/19
scenarios: 45/64
test_command: cd apps/api && NODE_OPTIONS=--max-old-space-size=4096 TIER=pr-integration bash scripts/run-tests.sh
test_exit_code: 0
test_output_hash: sha256:335e38ca59de49772b3de808bf3a5fb6c00bd52f0af6daac68d19468368a67ec
build_command: NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc -b apps/api
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

> **Reading the machine verdict.** The envelope says `fail` with **0 blockers and 0 critical
> findings**, and those are not in tension. `gentle-ai sdd-verify-validate` refuses a passing
> verdict whenever `requirements`/`scenarios` are short of their totals, and the totals it compares
> against are CHANGE-wide (19 / 64 — all three specs). This change is deliberately incomplete at
> this point in a signed 3-PR chain: `single-use-claim-gate` (5 req / 16 scenarios) is sequenced to
> PR 2, and two non-blocking documentation scenarios await the PR 1 body (task 3.16). `fail` here
> therefore means **NOT ARCHIVE-READY**, which is true. It does not mean PR 1 is broken: within the
> verified scope, **all 12 `[MERGE-BLOCKING]` requirements are COMPLIANT on re-run evidence and
> nothing failed**. The prose verdict for the PR 1 scope is **PASS WITH WARNINGS**.

**Change**: admin-password-reset-claim (SMELL-97)
**Branch**: `workstream/admin-reset-claim` @ `289f657a` (clean tree)
**Mode**: Strict TDD
**Scope**: PR 1 of a signed 3-PR stacked-to-main chain — the two CLAIM capability specs.
The third spec (`single-use-claim-gate`, 5 requirements / 16 scenarios) is **SEQUENCED-NOT-YET-DUE**:
the signed ordering is "the gate lands with or after the fixes, never before" (tasks §1.1), and the
gate is RED until PR 1 merges. It is excluded from every disposition below and counted only in the
envelope totals, which follow the change-wide heading count (19 / 64) so native status does not
report a mismatch.

### Completeness

| Metric                         | Value                                                           |
| ------------------------------ | --------------------------------------------------------------- |
| Work units in scope (PR 1)     | U0, U1, U2, U3                                                  |
| PR 1 implementation tasks      | 1.1-1.13, 2.1-2.7, 3.1-3.15 — **all checked, all re-verified**  |
| PR 1 tasks open                | 3.16 (PR body) — orchestrator-owned, the writer never opens PRs |
| Tasks sequenced to PR 2 / PR 3 | U4 (4.1-4.11), U5 (5.1-5.4) — not due                           |
| Requirements in scope          | 14 (8 reset + 6 refresh); 12 `[MERGE-BLOCKING]`                 |
| Scenarios in scope             | 48 (31 + 17)                                                    |

### Build & Tests Execution

**Build**: PASSED

```text
NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc -b apps/api
exit 0 — zero bytes of output (the empty-file digest e3b0c442… is that success)
```

The raised heap is required on this LXC; `tsc` OOMs at the default (~2 GB). Environment-scoped.

**Tests**: 567 passed / 0 failed / 0 cancelled / 0 skipped, across two runs

```text
# Integration tier (CI DB-tier shape; contains both racers)
cd apps/api && TIER=pr-integration bash scripts/run-tests.sh
  integration:admin-single-use-claims   16 tests   16 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
  TOTAL: 522 tests, 522 pass, 0 fail, 0 cancel, 0 skip        exit 0
  (re-run once for digest capture — identical counts both times)

# Unit tier, scoped to the two evidence files
cd apps/api && pnpm exec vitest run \
  tests/unit/admin/auth/PasswordService.test.ts tests/unit/authService.test.ts
  Test Files 2 passed (2) · Tests 45 passed (45) · exit 0
```

`integration:admin-single-use-claims` reports a **non-zero collected count with 0 cancelled and 0
skipped**, which is fitness #31's rule for a run that is allowed to read as green.

**Formatting / lint**, all 14 touched files:

```text
pnpm exec eslint --max-warnings 0 <14 files>   exit 0
pnpm exec prettier --check <14 files>          exit 0  ("All matched files use Prettier code style!")
```

**Coverage**: not re-measured. The repo's coverage gate is the global vitest threshold block, whose
subject is the whole tier (574 files / ~8,937 tests, ~404 s); re-running it adds no evidence about
these five files that the scoped run above does not already carry. Fitness #37 (thresholds never
descend) is unaffected — `apps/api/vitest.config.ts` is not touched by this change.

---

### Spec Compliance Matrix — capability `admin-password-reset-claim` (8 req / 31 scenarios)

| Req                                         | Scenario                                               | Test / evidence                                                                                                                                | Result             |
| ------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| R1 `[MB]` one atomic count-gated claim      | staggered racers yield one success `[int]`             | `adminPasswordResetClaim.integration.test.ts:265` — `filter(r => r.ok).length === 1`, stored hash verifies WINNER true / LOSER false           | COMPLIANT          |
| R1                                          | simultaneous racers `[int]`                            | same file `:341`                                                                                                                               | COMPLIANT          |
| R1                                          | sequential replay changes nothing `[int]`              | `:379` — `INVALID_TOKEN` + whole-row `deepStrictEqual`                                                                                         | COMPLIANT          |
| R1                                          | successful claim consumes token columns `[int]`        | `:265` / `:199` — token+expiry null, stored hash verifies the new password                                                                     | PARTIAL (see S1)   |
| R1                                          | refused claim changes no column `[int]`                | `:240` "a refused compare-and-swap writes nothing at all, updatedAt included"                                                                  | COMPLIANT          |
| R1                                          | expiry enforced by the predicate `[int]`               | `:504` — refused, columns NOT nulled                                                                                                           | COMPLIANT          |
| R1                                          | exactly one write reaches the row `[static]`           | `PasswordService.ts:308` single `updateMany`; no `update({where:{id}})` of password/token columns remains                                      | COMPLIANT          |
| R1                                          | `count > 0` reasoning written at the site `[static]`   | `PasswordService.ts:299-307` — `id` caps the match; token column carries no unique index (SMELL-110); `randomUUID()` is explicitly NOT the cap | COMPLIANT          |
| R2 `[MB]` non-consuming exits               | weak password does not burn the token `[int]`          | `:459`                                                                                                                                         | COMPLIANT          |
| R2                                          | reused password does not burn the token `[int]`        | `:481`                                                                                                                                         | COMPLIANT          |
| R2                                          | an unknown token writes nothing `[int]`                | `:379` (a consumed token matches no row) + `PasswordService.test.ts:200`                                                                       | COMPLIANT (see S2) |
| R2                                          | non-consuming exits precede the claim `[static]`       | `PasswordService.ts:264-275` strength+reuse before `:308`; no compensating write                                                               | COMPLIANT          |
| R3 `[MB]` liveness + deliberate lockout     | inactive owner refused, nothing cleared `[int]`        | `:526`                                                                                                                                         | COMPLIANT          |
| R3                                          | successful confirm clears the lockout `[int]`          | `:556`                                                                                                                                         | COMPLIANT          |
| R3                                          | lockout decision documented `[static]`                 | `PasswordService.ts:325-328` — "proves control of the mailbox"                                                                                 | COMPLIANT          |
| R4 `[MB]` zero count disambiguated          | moved history is the conflict outcome `[int]`          | `:407` — `CONCURRENT_MODIFICATION`, token intact, retry succeeds                                                                               | COMPLIANT          |
| R4                                          | a dead token still yields `INVALID_TOKEN` `[int]`      | `:379`                                                                                                                                         | COMPLIANT          |
| R4                                          | the disambiguation is a re-read `[static]`             | `PasswordService.ts:346-356`                                                                                                                   | COMPLIANT          |
| R5 `[MB]` throw → `INTERNAL_ERROR`          | hashing failure `[unit]`                               | `PasswordService.test.ts:455`                                                                                                                  | COMPLIANT          |
| R5                                          | database failure at the claim `[unit]`                 | `:434`                                                                                                                                         | COMPLIANT          |
| R5                                          | no path collapses into `INVALID_TOKEN` `[static]`      | one catch, `PasswordService.ts:360-365` → `INTERNAL_ERROR` via `authLogger`                                                                    | COMPLIANT          |
| R6 `[MB]` one read, never an empty entry    | missing hash never poisons history `[unit]`            | `PasswordService.test.ts:168` — also asserts the predicate kept the UNFILTERED snapshot                                                        | COMPLIANT          |
| R6                                          | exactly one read precedes the claim `[static]`         | `PasswordService.ts:251` sole pre-claim read, selects `passwordHash`                                                                           | COMPLIANT          |
| R6                                          | predicate guards the snapshot that was read `[static]` | `:315` names `user.passwordHistory` (unfiltered)                                                                                               | COMPLIANT          |
| R7 `[MB]` evidence in CI, RED on `19fb9e6a` | named by exactly one batch `[static]`                  | `run-tests.sh:323-325` — measured count **1**                                                                                                  | COMPLIANT          |
| R7                                          | fitness #30 does not rise `[static]`                   | measured **20** vs baseline 21                                                                                                                 | COMPLIANT          |
| R7                                          | staggered is RED on the unmodified tree `[static]`     | apply-progress: `2 !== 1` — TWO successes on one token                                                                                         | COMPLIANT          |
| R7                                          | claim assertions are against stored state `[static]`   | every claim assertion reads the row / verifies the stored hash with argon2                                                                     | COMPLIANT          |
| R7                                          | the wired suite executes and passes `[int]`            | 16/16, non-zero collection                                                                                                                     | COMPLIANT          |
| R8 residual named (non-blocking)            | stated where a maintainer meets it `[static]`          | `PasswordService.ts:367-371` — site YES; **PR body pending (3.16)**                                                                            | PARTIAL            |
| R8                                          | side effects still run on success `[int]`              | `:265` — one `PASSWORD_RESET_COMPLETED`, session revoked `PASSWORD_RESET`                                                                      | COMPLIANT          |

### Spec Compliance Matrix — capability `admin-refresh-rotation-claim` (6 req / 17 scenarios)

| Req                                                  | Scenario                                                     | Test / evidence                                                                                                     | Result             |
| ---------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------ |
| F1 `[MB]` rotation is a claim                        | staggered mint exactly one pair `[int]`                      | `adminRefreshRotationClaim.integration.test.ts:227` — stored hash = hash(winner's new token)                        | COMPLIANT          |
| F1                                                   | simultaneous mint one pair `[int]`                           | `:292`                                                                                                              | COMPLIANT          |
| F1                                                   | loser's pair never issued nor stored `[int]`                 | `assertMintsUnstored` `:213-225` — guarded against vacuity by `refused.length > 0`                                  | COMPLIANT          |
| F1                                                   | both count gates justified at their own sites `[static]`     | `authServiceSession.ts:130-136` (`@unique` → `count === 1`) read against `PasswordService.ts:299-307` (`count > 0`) | COMPLIANT          |
| F2 `[MB]` a rotated token is never accepted again    | sequential replay refused, no pair `[int]`                   | `:320` — refused, stored hash stands                                                                                | COMPLIANT          |
| F2                                                   | refusal expressible in the existing union `[static]`         | union at `authServiceSession.ts:52` byte-identical to the spec's stated union; `TOKEN_BLACKLISTED` is a member      | COMPLIANT (see W1) |
| F3 `[MB]` the claim, not the cache, is the authority | replay refused with the blacklist inactive `[int]`           | `:320` — the racer never calls `setRedisInstance`                                                                   | COMPLIANT          |
| F3                                                   | the winner's new pair is usable `[int]`                      | `:348` "a rotation never blacklists its own output"                                                                 | COMPLIANT          |
| F3                                                   | the guarantee is not conditioned on the cache `[static]`     | `authServiceSession.ts:161-177` — the issue decision is the matched-row count; blacklist moved to `:187`            | COMPLIANT          |
| F4 `[MB]` a refused rotation changes nothing         | the refused attempt leaves the row alone `[int]`             | `:227` whole-row `deepStrictEqual` + `isActive` still true                                                          | COMPLIANT          |
| F4                                                   | the winner's session survives the refusal `[int]`            | `:348`, `:370`                                                                                                      | COMPLIANT          |
| F5 `[MB]` evidence in CI, RED by minting two pairs   | named by exactly one batch `[static]`                        | `run-tests.sh:325` — measured count **1**                                                                           | COMPLIANT          |
| F5                                                   | interleaving pinned before either blacklist write `[static]` | Redis absent by construction, stated in the file header `:7-11` and at `:258`                                       | COMPLIANT          |
| F5                                                   | RED on the unmodified tree by minting two pairs `[static]`   | apply-progress: `expected: 1, actual: 2` on the returned pairs, never an error code                                 | COMPLIANT          |
| F5                                                   | the wired suite executes and passes `[int]`                  | 16/16                                                                                                               | COMPLIANT          |
| F6 residuals documented (non-blocking)               | stated at the refusal site and the PR body `[static]`        | `authServiceSession.ts:142-148` — site YES; **PR body pending (3.16)**                                              | PARTIAL            |
| F6                                                   | the refused legitimate caller can recover `[int]`            | `:370`                                                                                                              | COMPLIANT          |

**Compliance summary**: **45/48 in-scope scenarios COMPLIANT, 3 PARTIAL, 0 FAILING, 0 UNTESTED.**
**All 12 `[MERGE-BLOCKING]` requirements are COMPLIANT.** The 3 PARTIALs sit on 2 non-blocking
documentation requirements plus one assertion clause; none touches a claim guarantee.

---

### Correctness (Static Evidence)

| Requirement                                         | Status      | Notes                                                                                                                                                                                                             |
| --------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single conditional write, full CAS snapshot         | Implemented | `PasswordService.ts:308-333` names `id`, token, strict future expiry, `isActive`, `passwordHash`, `passwordHistory`                                                                                               |
| `CONCURRENT_MODIFICATION` wired end to end          | Implemented | `adminAuthTypes.ts:428` union · `adminAuthMiddleware.ts:111` exhaustive `Record` message · `adminAuthRoutes.ts:344` → 409                                                                                         |
| DF-4 retype scoped to ONE literal                   | Implemented | `adminAuthRoutes.ts:340` is `Partial<Record<AuthErrorCode, number>>`; the other five `statusMap` literals (`:109`, `:137`, `:220`, `:443`, `:531`) remain `Record<string, number>` — exactly as tasks §0 required |
| Rotation CAS on the presented hash                  | Implemented | `authServiceSession.ts:149-159`; `count !== 1` → HIGH audit `ROTATED_TOKEN_REPLAYED` → `err("TOKEN_BLACKLISTED")`                                                                                                 |
| `blacklistToken` after a successful CAS             | Implemented | `:187-189`; the pre-mint call is gone                                                                                                                                                                             |
| Per-mint `jti` on the refresh token only            | Implemented | `authServiceCore.ts:435` `jwtid: randomUUID()`; access token untouched; `authTypes.ts:18` `jti?: string`                                                                                                          |
| Issuance exception documented + caller set measured | Implemented | `PrismaAdminSessionRepository.ts:51-64` — one caller tree-wide, with a remove-when                                                                                                                                |

### Coherence (Design rev 2)

| Decision                               | Followed? | Notes                                                                                                                                      |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 new code + 409, no in-service retry | Yes       | F5 residual (verdict names the row as of the re-read) written at `PasswordService.ts:342-345`                                              |
| D2 `TOKEN_BLACKLISTED`, no re-read     | Yes       | See W1 — D2's own "named, unchanged" asymmetry is what W1 reports                                                                          |
| D3 blacklist after the CAS             | Yes       | Rationale + N9 caller-visible half at `:179-186`                                                                                           |
| D4 predicate shape                     | Yes       | Read mirrors `isActive: true`; both derived columns named                                                                                  |
| D5 dedicated fail-closed fake          | Yes       | `statefulAdminUserPrismaFake.ts` throws on unknown column/operator (`:253`, `:273`, `:299`) — it cannot answer a silent false zero         |
| D6 gated-client racer seam             | Yes       | Both racers gate the write and signal on the pre-claim read; `writes.at(-1).count === 0` proves the CAS executed rather than being skipped |
| D8 try scope + exit shape              | Yes       | Post-claim effects deliberately outside the try                                                                                            |
| D9 per-mint `jti`                      | Yes       | Deviation 2 (apply) added a second triangulating case asserting the payload is identical apart from `jti` — strengthening, not drift       |
| D7 fitness #41                         | N/A       | PR 2                                                                                                                                       |

Six apply-phase deviations were declared in `apply-progress` (an extra recovery case, 6 unit cases
instead of 4, sequence-not-count ordering assertions, the audit sink captured in `beforeEach`,
instance-assignment mint recording, and U1's `mutateAdmin`). **Each re-reads as strengthening**:
every one earns a property the task text asserted or made unassertable. None weakens a check.

### TDD Compliance

| Check                               | Result | Details                                                                                                                                                                        |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TDD Evidence reported               | Yes    | Three batch tables in `apply-progress` (obs 715)                                                                                                                               |
| All units have tests                | Yes    | 5/5 evidence files exist on disk                                                                                                                                               |
| RED confirmed (tests exist)         | Yes    | 5/5 verified present                                                                                                                                                           |
| GREEN confirmed (tests pass)        | Yes    | 45/45 unit + 16/16 integration re-run by this phase                                                                                                                            |
| RED recorded BEFORE src edits       | Yes    | Verbatim RED captured for U1 (8 failed / 5 passed; integration `2 !== 1`), U2 (byte-identical JWTs), U3 (`expected: 1, actual: 2`; `['blacklist']` vs `['claim','blacklist']`) |
| RED shape matches the spec's demand | Yes    | Both racers fail on the unmodified tree by **succeeding twice**, observed on persisted state — never on an error code                                                          |
| Triangulation                       | Yes    | 13 / 11 / 6 / 5 / 2 cases across the five files; no single-case behaviour                                                                                                      |
| Safety nets before modification     | Yes    | Full unit tier 8931/8931 and DB tier 517/517 taken before any `src/**` edit                                                                                                    |
| Red-proof on added pins             | Yes    | `jwtid` planted out (`cp`, never git), suite went 3-failed, restored `cmp`-exact, 26/26                                                                                        |

### Test Layer Distribution

| Layer       | Tests                                 | Files        | Tool                      |
| ----------- | ------------------------------------- | ------------ | ------------------------- |
| Unit        | 45 (13 reset + 32 authService)        | 2 + 1 helper | vitest 4.1.11             |
| Integration | 16 (11 reset racer + 5 refresh racer) | 2            | node:test + real Postgres |
| E2E         | 0                                     | 0            | out of scope              |

### Assertion Quality

Audited all five evidence files for the banned patterns.

| File                                            | Assertions | Mocks | Ratio   |
| ----------------------------------------------- | ---------- | ----- | ------- |
| `adminPasswordResetClaim.integration.test.ts`   | 58         | 0     | —       |
| `adminRefreshRotationClaim.integration.test.ts` | 31         | 0     | —       |
| `PasswordService.test.ts`                       | 58         | 0     | —       |
| `authService.test.ts`                           | 89         | 11    | 8.1 : 1 |

**Assertion quality: all assertions verify real behaviour.** Zero tautologies, zero orphan-empty
checks, zero type-only assertions standing alone, zero smoke-only tests, zero mock-heavy files.
Two findings worth naming positively rather than as defects:

- **The ghost-loop class is closed explicitly.** `assertMintsUnstored`
  (`adminRefreshRotationClaim.integration.test.ts:213-225`) loops over refused mints and would pass
  vacuously on an empty collection, so it asserts `refused.length > 0` first, with the reason in the
  message: _"the refused attempt DID mint a pair — what the claim rejected is the write, not the
  mint, so this check is not vacuous."_
- **No claim assertion reads call shape.** The spec forbids asserting which methods a double
  recorded. `gated.writes.at(-1)?.count === 0` is not such an assertion: it is the DATABASE's own
  matched-row count for the loser's write, and it is what separates "refused by the claim" from
  "never reached the claim" — the distinction the whole capability rests on.

### Quality Metrics

**Linter**: no errors, no warnings (`--max-warnings 0`, exit 0, 14 files)
**Type checker**: no errors (`tsc -b apps/api`, exit 0)
**Formatter**: clean (`prettier --check`, 14 files)

### Fitness spot-checks (PR 1 relevant)

| Check                                            | Expected | Measured                                |
| ------------------------------------------------ | -------- | --------------------------------------- |
| #8 sprint/phase/timeline refs                    | 0        | **0**                                   |
| #9 missing `@file` header                        | 0        | **0**                                   |
| #10 invalid `@layer` value                       | 0        | **0**                                   |
| #30 unreached suites (ratchet 21, must not rise) | ≤ 21     | **20** — both racers ARE reached        |
| #31A `passWithNoTests`                           | 0        | **0**                                   |
| #31B zero-collection guards in `run-tests.sh`    | ≥ 1 each | **2** and **1**                         |
| #32 committed `.skip` / `.only`                  | 0        | **0**                                   |
| #40 Part A `$transaction` outside seams          | 0        | **0** (seam floor 3 satisfied — 3 hits) |

---

### Issues Found

**CRITICAL**: None.

**WARNING**

- **W1 — a `[MERGE-BLOCKING]` spec sentence the implementation does not literally satisfy, adjudicated at design time but never amended into the spec.** Refresh requirement F2 says: _"The refusal SHALL be produced by the rotation claim itself, not by a preceding cache lookup."_ For a **sequential** replay the refusal is produced elsewhere in both configurations: Redis-less, the `findUnique` at `authServiceSession.ts:84-91` misses (the old hash is gone) and returns `SESSION_EXPIRED`; with Redis, the blacklist check at `:56-75` answers first. The claim itself produces the refusal only in the racing interleaving — which is exactly the case no cache can cover, and which is proven. Every observable normative outcome of F2 holds (refused, no tokens, existing union, stored hash byte-identical), design **D2 named this asymmetry explicitly** as pre-existing and unchanged, and the racer states it in its own assertion message at `:334`. The defect is documentary, not behavioural: the spec sentence was left standing after D2 decided against it, so a later reader meets a SHALL the code does not meet. Amend F2's sentence (or add the asymmetry as a stated limit) before the spec is promoted at close.
- **W2 — U0's task checkboxes are unticked while the commit landed.** `tasks.md:67-70` shows `0.1`-`0.4` as `[ ]`, but `badd8b50` ("docs(sdd): registro de artefactos…") is in the branch and the `openspec/config.yaml` 27 → 40 correction it carries is on disk. Bookkeeping drift only — the work exists and was verified. It matters because PR 2's clean three-line 40 → 41 diff depends on that correction having landed, and an unticked box is how a later reader concludes it did not.
- **W3 — task 3.16 (the PR 1 body) is open, and it is the only thing standing between two requirements and COMPLIANT.** Reset R8 and refresh F6 each require their residual to be stated _in the PR body as well as at the site_. Both sites are done; neither PR body exists yet because the writer never opens PRs. The drafted text is in `apply-progress` §8 and covers all five required statements. This is correctly sequenced, not a defect — but PR 1 must not be opened without it, or the two requirements stay PARTIAL through merge.
- **W4 — fitness #30's documented baseline is one stale (21 documented, 20 measured).** Reported identically by U1, U2 and U3 and re-measured 20 by this phase. The ratchet is satisfied (it may fall, never rise), so nothing is masked today. The correction needs a `sensitive-edit` token for `CLAUDE.md` and is owned by PR 2 — carry it there rather than letting a third change re-discover it.

**SUGGESTION**

- **S1 — one scenario clause is proven by inference rather than by assertion.** Reset R1's "a successful claim consumes the token columns" ends _"…and the stored hash verifies against the new password **and not against the old one**"_. Both tiers assert the stored hash verifies the NEW password, and the staggered case asserts it does **not** verify the other password _presented_ — but no test asserts it fails against the admin's **seeded prior** password. The property cannot actually be false (argon2id is salted and `seedAdmin` uses a distinct `prior-${tag}-P@ssw0rd!`), and the prior hash is separately proven to have moved into `passwordHistory` (`adminPasswordResetClaim.integration.test.ts:237`). One line — `verifyPassword(row.passwordHash, priorPassword) === false` — would close the clause literally. `seedAdmin` already returns `priorHash`, so the seam exists.
- **S2 — a scenario's dedicated case sits one layer below its tag.** Reset R2's "an unknown token writes nothing" is tagged `[integration]`; the dedicated never-existed-token case is at `PasswordService.test.ts:200` (unit). Integration coverage comes from `:379`, where a _consumed_ token matches no row and the whole row is asserted byte-equal — substantively the same GIVEN. No gap in the guarantee; noted so the tag and the evidence are not read as disagreeing.
- **S3 — `AuthServiceCore.generateTokens` still carries no JSDoc** (`authServiceCore.ts:396`) while canon requires one on every public class method. Pre-existing, correctly NOT fixed by the writer (it would be CODE lines no requirement asks for). Named so it stays a decision.
- **S4 — `.claude/canon-decision-gaps.log` is not gitignored** and agent tooling appended to it during the run (three `jwt-algorithm` entries, all false positives — this change chooses no signing algorithm). `.gitignore:161` covers the sibling `.claude/hooks.log` but not this file, so a `git add -A` would sweep an agent log into PR 1. Staging is the orchestrator's call.
- **S5 — `eslint-plugin-boundaries` emits four config-deprecation advisories** on every lint run (file-pattern element descriptors, `rules` → `policies`, legacy selectors ×37). They are plugin stderr, not rule warnings — `--max-warnings 0` still exits 0 — and they are the v6→v7 migration already tracked as SMELL-66.

### Known context (not findings)

- **`auth.test.ts` was not executed locally.** It lives in the live-API batch `integration:flows`, whose siblings fetch `http://localhost:3000`; the DB tier does not reach it. CI covers it (`ci.yml:521`, `TIER: full-integration`). Its three refresh cases traverse paths this change left alone (valid token → `count === 1`; invalid token → `jwt` throw; after logout → `!isActive` at the read, before the claim). Its DF-7 de-sleep was proven GREEN at apply time (15/15, 3058 ms → 2032 ms).
- **Test files sit outside every `tsc` scope.** `apps/api/tsconfig.json` includes `src` only, so "tsc 0 errors" does not cover the 409-line racer or the 163-line unit block; ESLint's scoped `projectService` types them and passed at `--max-warnings 0`. Pre-existing and repo-wide.
- **EVIDENCE ≈2,300 lines against the re-adjudicated band max 2,150, inside the hard stop 2,470.** Breakdown: U1 **1,631** (reset racer 577 + fail-closed fake 571 + unit tier 475 + wiring 8) · U2 **83** (`authService.test.ts` 77 + `auth.test.ts` 6) · U3 **586** (refresh racer 409 + unit 170 + harness 7). Reported, not trimmed, per the signed rule. CODE ≈331 (U1 ≈245 + U2 11 + U3 75) against the 400 hard budget — under. The adjudication is Edward's signature of 2026-09-13 and is not re-opened here.

### Verdict

**PR 1 scope: PASS WITH WARNINGS. Change envelope: `fail` = NOT ARCHIVE-READY (0 blockers, 0 critical).**

All 12 `[MERGE-BLOCKING]` requirements across both PR 1 capabilities are
COMPLIANT on re-run evidence (45/48 in-scope scenarios, 0 FAILING, 0 UNTESTED, 0 CRITICAL), with the
RED-first discipline verified against recorded output in all three batches. PR 1's code is
merge-ready once task 3.16 supplies the PR body that two non-blocking documentation requirements
depend on (W3), and W1's spec sentence should be amended before the specs are promoted at close.
The change as a whole is **not archive-ready**: `single-use-claim-gate` (5 requirements /
16 scenarios) is sequenced to PR 2 and the close ritual to PR 3.
