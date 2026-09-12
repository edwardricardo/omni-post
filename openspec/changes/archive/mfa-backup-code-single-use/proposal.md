# Proposal: MFA Backup-Code Single-Use — Complete the CAS With a Snapshot-Consistent Pre-Check

> Foundation: `explore-reverification.md` (2026-09-11, AUTHORITATIVE) over `explore.md` (2026-08-15, prior art). Runs AFTER password-reset-integrity (f992a1fb / d38be4cf / 5744f606) per Edward's signed order.

## Intent

`markBackupCodeUsed` in both Prisma adapters (`PrismaCustomerMfaUserRepository.ts:85-124` / `PrismaAdminMfaUserRepository.ts:80-119`) is a whole-column CAS whose comparand is its own in-method read: a racer whose snapshot lands AFTER the winner's commit matches `equals`, gets `count === 1`, and mints a second session inside the hundreds-of-milliseconds argon2 window. **HIGH**: single-use control failure (NIST SP 800-63B-4 §3.1.2.2 SHALL — one recovery credential mints N sessions) **plus** evidence destruction, the worse half: `:98` overwrites the winner's timestamp, and the HIGH alarm `MFA_BACKUP_CODE_REUSE_REJECTED` fires only on `count === 0` — only on the interleaving that already blocked the attack. This is the third arrival at this code (naive RMW → `7b245e3e` CAS closing only the simultaneous window → this change), so the discipline is explicit: every correctness argument states which interleavings it covers, and the evidence exercises the staggered one.

## Scope

### In Scope (re-verification §5.1 — ONE PR)

1. ~3-line snapshot-consistent pre-check in BOTH adapters: refuse when the adapter's own snapshot already carries the index; the existing whole-column CAS stays untouched.
2. Port doc rewritten to the observable guarantee; signature byte-identical (no new port, token, or DI).
3. `MfaService.ts:226-228` demoted to an argon2-cost optimisation; `remaining` read back from the claim.
4. The double's mirror comment corrected (`InMemoryMfaUserRepository.ts:104-106` — its `:107-109` semantics were correct all along; production now matches its own double).
5. Tier 1: sequential-reuse reds in both adapter unit suites; the two stubbed "concurrency" tests un-stubbed against the honest fake.
6. Tier 2: port-conformance suite binding all three implementations (sequential reuse first).
7. Tier 3: repair the integration file (distinct timestamps, real UoW) + STAGGERED racer (barrier-injected decorator between `MfaService.ts:199` and `:240`) + WIRE `mfaBackupCodeSingleUse.integration.test.ts` into exactly one `run_batch` (fitness #30 unreached count falls 21→20).
8. G1 by construction (an existing key is never overwritten) + G2 (alarm + metric reachable BY the attack; volume profile changes deliberately).
9. G3 minimal observability: one metric, one alert rule, one runbook (ADR-0015 precedent).

### Out of Scope

- Claim table / migration / backfill / ADR — OBVIATED by the schema verdict (§2): NO schema change, NO sensitive-edit token.
- P-2 (admin password-reset race) — filed as SMELL-97; MUST NOT be absorbed here.
- The other four orphan MFA suites (SMELL-75) · `codeIndex` remodelling (recorded target state) · G4-G8, G13-G15 · P-5, P-10.

## Capabilities

### New Capabilities

- `mfa-backup-code-claim`: the single-use claim contract — at most one caller ever receives ok for a given `(userId, codeIndex)` under any interleaving; an existing claim is never overwritten (winner's timestamp immutable); `ALREADY_USED` means "claimed", never "a concurrent writer touched the row"; the reuse alarm and metric are reachable by the attack; conformance binds all three implementations; the integration proof is collector-wired.

### Modified Capabilities

- `unified-mfa-service-and-port`: the "Backup-code login parity" requirement strengthens from "code is recorded consumed" to the observable single-use guarantee under the staggered interleaving; the port documents the guarantee, never the mechanism; the adapter claim (`:240`) is the sole authority and the service-level check is a cost optimisation.

## Approach

Measured against the generated client, not inferred (§2.1): the only expressible write for `mfaBackupUsedAt` is the whole JSON value, so a per-key predicate (P) alone is unsafe — but the existing whole-column CAS already supplies the atomic write (W). The fix supplies (P): the pre-check's evidence IS the write's predicate — the write commits only if the live column still equals the same snapshot S the check read, and S lacks the index. Interleaving coverage (attempt-#3 discipline):

| Interleaving                               | Covered by                                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| B's snapshot AFTER A commits (the exploit) | S_B carries the index → pre-check refuses, no write                                                                                          |
| B's snapshot BEFORE A commits              | EPQ recheck fails `equals S_B` → `count 0` → ALREADY_USED                                                                                    |
| Simultaneous, same index                   | Row lock serializes; loser's qual re-evaluates → `count 0`                                                                                   |
| Different indices, concurrent              | One loses the CAS → spurious ALREADY_USED — accepted residual: code not consumed, retry succeeds, false HIGH alarm named, not engineered for |

**DESIGN MANDATE (§6.1)**: capture the emitted `updateMany` SQL via `$on('query')` BEFORE building. Plain `UPDATE ... WHERE qual` ⇒ EPQ guaranteed — settles this fix, `claimTotpStep`, AND `claimPasswordReset` at once. `WHERE id IN (SELECT ...)` ⇒ THREE claim sites are racy: design STOPS and re-plans.

## Decision for Edward (surfaced, not decided)

Discretionary class fitness function — a consumption-marker write in `data` must name the claim in `where`:

|                | (a) Include in this change                                                                                         | (b) Defer to its own change                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Token          | CI mirror in `fitness.yml` = the ONE file needing `sensitive-edit`                                                 | This change 100% tokenless                                                                             |
| Class coverage | Gate lands now against P-2/P-5/P-10 drift                                                                          | Class stays ungated until its own change                                                               |
| Birth state    | NOT hard-zero: P-2 is a live hit → ratchet baseline + backlog entry + demonstrated red, inside a HIGH security fix | Born with (or after) SMELL-97, where fixing P-2 shrinks the baseline; red demonstrated in its own diff |

**Recommendation: (b).** The gate cannot be born hard-zero while P-2 lives; a ratchet + token + workflow edit couples real extra scope onto a fix whose virtue is being token-free and single-concern. Pair the gate with SMELL-97. (The explorer leaned (a); the ratchet-at-birth cost is why this proposal differs.)

## Affected Areas

| Area                                                                                                      | Impact       | Description                                                         |
| --------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| `apps/api/src/infrastructure/adapters/Prisma{Customer,Admin}MfaUserRepository.ts`                         | Modified     | ~3-line pre-check each; CAS unchanged                               |
| `packages/ports/src/MfaUserRepositoryPort.ts`                                                             | Modified     | Doc-only rewrite; signature byte-identical                          |
| `apps/api/src/admin/auth/MfaService.ts`                                                                   | Modified     | `:226-228` demoted; `remaining` read-back; G2 alarm path; G3 metric |
| `apps/api/tests/unit/helpers/InMemoryMfaUserRepository.ts`                                                | Modified     | Comment corrected; semantics untouched                              |
| Adapter unit suites + new port-conformance suite                                                          | Modified/New | Tier 1 reds, un-stubbing; Tier 2                                    |
| `apps/api/tests/integration/mfaBackupCodeSingleUse.integration.test.ts` + `apps/api/scripts/run-tests.sh` | Modified     | Repair + stagger + wire exactly ONE batch                           |
| Prometheus rule + runbook (G3)                                                                            | New          | One metric, one alert, one runbook                                  |

## Risks

| Risk                                                 | Likelihood | Mitigation                                                                                                              |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| A third wrong fix                                    | Med        | Interleaving table above; Tier 3 exercises the staggered exploit; any new argument must state its covered interleavings |
| Emitted SQL is the `IN (SELECT)` form                | Low        | Design-mandate capture before build; on the bad form, STOP — three claim sites racy, re-plan                            |
| The double masks the fix in a NEW direction          | Med        | Service-level greenness proves nothing; the Tier 1 adapter test is the only unit-level oracle                           |
| Un-stubbing surfaces unrelated failures              | Med        | Budgeted in the EVIDENCE tier; fix, never re-stub                                                                       |
| Wiring the orphan reddens siblings                   | Low        | Wire exactly ONE file                                                                                                   |
| Spurious ALREADY_USED + false HIGH on sibling claims | Accepted   | Exists identically today; document, do not engineer for                                                                 |

## Rollback Plan

Single revert of one PR: no migration, no schema change, no data movement, port signature unchanged (zero consumer churn). Reverting the `run-tests.sh` line restores the prior collector state.

## Dependencies

- password-reset-integrity chain committed (f992a1fb / d38be4cf / 5744f606) — Edward's signed order.
- Edward's (a)/(b) fitness-function decision resolved before sdd-tasks.

## Budget (two-tier rule, §5.3)

CODE ≈150-190 (single PR, risk Low) · EVIDENCE ≈450-600, declared for ONE Edward pre-approval, split in the PR body.

    Decision needed before apply: No (once (a)/(b) is resolved)
    Chained PRs recommended: No
    400-line budget risk: Low

## Success Criteria

- [ ] Exactly one `ok` per `(userId, codeIndex)` under the STAGGERED interleaving, proven against real Postgres by the wired Tier 3 racer.
- [ ] The winner's timestamp survives the refused second attempt (asserted at Tier 1 and Tier 3 against the stored value).
- [ ] `MFA_BACKUP_CODE_REUSE_REJECTED` + its metric fire on the attack interleaving; the volume-profile change is stated in the PR body.
- [ ] `mfaBackupCodeSingleUse.integration.test.ts` is named by exactly one `run_batch` and executes in CI (fitness #30 count falls).
- [ ] Port-conformance suite passes over all three implementations with sequential reuse as its first assertion; the double's comment no longer asserts a false mirror.
- [ ] Zero edits to `schema.prisma` / `infra/prisma/migrations/**`; no sensitive-edit token consumed (under (b); under (a), exactly `fitness.yml`).
- [ ] The §6.1 `$on('query')` capture is recorded in design with its verdict.
