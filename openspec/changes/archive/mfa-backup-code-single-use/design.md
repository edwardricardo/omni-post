# Design: MFA Backup-Code Single-Use — Snapshot-Consistent Pre-Check

> Inputs: `proposal.md`, `explore-reverification.md`, delta specs `mfa-backup-code-claim` + `unified-mfa-service-and-port`. Edward's binding decisions: class fitness function DEFERRED to SMELL-97's slice; this change is 100% tokenless; EVIDENCE tier pre-approved.

## The §6.1 capture — STOP condition does NOT fire

Probe: `scratchpad/probe-updatemany-sql.mts` (zero-mutation, nonexistent id), run 2026-09-11 against the real generated client + `PrismaPg` driver adapter, captured on BOTH layers (`adapter:tx:executeRaw` — a proxy over the driver adapter recording every SQL string handed to pg — AND `$on('query')`). Both layers agree byte-for-byte on all three claim shapes. Verbatim:

**Shape 1 — backup-code CAS, JSON `equals` arm:**

```sql
UPDATE "public"."CustomerUser" SET "mfaBackupUsedAt" = $1, "updatedAt" = $2 WHERE ("public"."CustomerUser"."id" = $3 AND "public"."CustomerUser"."mfaBackupUsedAt"::jsonb = $4)
```

**Shape 2 — backup-code CAS, `Prisma.AnyNull` arm:**

```sql
UPDATE "public"."CustomerUser" SET "mfaBackupUsedAt" = $1, "updatedAt" = $2 WHERE ("public"."CustomerUser"."id" = $3 AND ("public"."CustomerUser"."mfaBackupUsedAt"::jsonb = $4 OR "public"."CustomerUser"."mfaBackupUsedAt" IS NULL))
```

**Shape 3 — `claimTotpStep` OR qual:**

```sql
UPDATE "public"."CustomerUser" SET "mfaLastUsedTotpStep" = $1, "updatedAt" = $2 WHERE ("public"."CustomerUser"."id" = $3 AND ("public"."CustomerUser"."mfaLastUsedTotpStep" IS NULL OR "public"."CustomerUser"."mfaLastUsedTotpStep" < $4))
```

**Verdict: the GOOD form.** Every shape is a plain single-statement `UPDATE … WHERE qual` — no `IN (SELECT …)`. Under Read Committed, when a concurrent writer commits first, Postgres EvalPlanQual re-evaluates the qual against the updated row version, so the loser's `equals`/`lt` predicate fails and `count = 0`. The CAS is SOUND. This one capture retro-validates `claimTotpStep` AND `claimPasswordReset`: all three claim sites are settled. Read Committed is load-bearing for BOTH halves of the mechanism — EPQ's qual re-evaluation above, and the D1 pre-check's premise that the adapter snapshot sees only committed state; an isolation-level change reopens this verdict. Design proceeds.

## Technical Approach

The whole-column CAS already supplies the atomic write (W). This change adds the missing predicate (P): each adapter refuses when **its own snapshot** already carries `codeIndex` — the check's evidence IS the write's predicate, because the write commits only if the live column still equals that same snapshot. Interleaving coverage is the proposal's table; the staggered case (loser's adapter snapshot taken AFTER the winner's commit) is closed by the pre-check, all others by the EPQ-backed CAS just proven.

## Architecture Decisions

### D1 — Pre-check stays duplicated in both adapters (twins kept, not extracted)

**Choice**: insert the identical ~4-line guard in each adapter between `normalizeUsedAt` and the overwrite (`Cust:97→98`, `Admin:92→93`), with the same twin-comment convention the CAS already uses.
**Rejected**: shared helper across the two table-typed delegates — requires generic typing over Prisma client delegates, the exact complexity the `claimTotpStep`/`updateOneLiveRow` precedent deliberately avoids (explore §3: "No — the precedent says so").
**Rationale**: parity is enforced by the Tier 2 conformance suite (structural), not by shared code.

```ts
const usedMap = normalizeUsedAt(snapshot);
// Claim pre-check: our own snapshot already carries this index, so the code is
// consumed. Refuse without writing — an existing claim (the winner's forensic
// timestamp) is immutable. The CAS below covers every other interleaving.
if (Object.prototype.hasOwnProperty.call(usedMap, String(codeIndex))) {
  return err("ALREADY_USED");
}
usedMap[String(codeIndex)] = usedAt.toISOString();
// … existing CAS unchanged
```

### D2 — `remaining` is a post-claim read INSIDE the same transaction

**Choice**: after a successful claim, still inside `runInTransaction`, re-read via `repo.findById(subject.id)` and compute `remaining = mfaBackupCodes.length − Object.keys(mfaBackupUsedAt).length`. Same UoW connection ⇒ the read sees the claim's own write (verified in explore §1.3: snapshot and CAS stay on the UoW connection). Without a UoW the read still runs after the claim resolved — still post-claim state.
**Rejected**: returning the post-claim map from the port (signature change — forbidden); `usedIndexes.size + 1` (still derived from the stale `:199` snapshot; a sibling claim in the argon2 window makes it wrong — the spec scenario demands persisted state).
**Edge**: if the in-tx re-read errs (row gone mid-tx — unreachable in practice), audit **omits** `remainingCodes` (conditional spread) rather than report a stale number. Cost: one SELECT per successful backup-code login — rare path.

### D3 — G2 emission point: unchanged site; the `:226-228` filter SURVIVES as `continue`

**Choice**: the HIGH audit + metric fire at the existing `markResult.error === "ALREADY_USED"` site — branching only on the claim's verdict, never on which mechanism (pre-check vs lost CAS) produced it. The service filter stays, re-commented as an argon2-cost optimisation naming the adapter claim as the authority.
**Volume profile (stated, per spec)**: the HIGH stream broadens from "lost a concurrent write" (today: fires only when the attack already failed) to "every refusal the adapter returns" — the staggered attack, racing reuse, stale-snapshot replays, and the sibling-claim false positive. Fresh-snapshot sequential replays remain filtered at `:228` and end as `MFA_VERIFICATION_FAILED` (MEDIUM), exactly as today — so steady-state HIGH volume stays near zero and any sustained firing is signal. Threshold is tuned at the alert (D5), never suppressed in code.
**Rejected**: deleting the filter (pays up to 8 serial argon2 verifies per replayed code for zero security gain; the unified-spec mutation scenario proves the guarantee survives without it either way).

### D4 — Fitness #30 baseline literal stays 21

The measured unreached count falls 21→20 and is recorded as evidence; the ratchet baseline in `fitness.yml` is NOT tightened here — that is a workflow edit needing a token, and this change is deliberately token-free. Tightening belongs to the next slice that edits that file. Recorded residual, not silently absorbed.

### D5 — G3 placement per the ADR-0015 precedent

**Metric**: `MfaService` gains an optional LAST constructor param `metrics?: ApiMetrics` (after `unitOfWork` — every existing call site keeps compiling); the composition root passes `TOKENS.ApiMetrics` (`setupServices.ts:196-200`). At the D3 refusal site: `this.metrics?.metrics.securityThreats.inc({ threat_type: "mfa_backup_code_reuse", endpoint: "mfa_verify" })` — the existing `api_security_threats_total` counter, `RedisBruteForceAdapter` precedent. Spec R3's "no DI change" is port-scoped: the optional constructor param introduces no new DI token and no container registration — the composition root passes the already-registered `TOKENS.ApiMetrics` — so R3 holds.
**Alert**: ONE rule appended to `prometheus/alerts/api.yml` (`MfaBackupCodeReuseRejected`, `increase(api_security_threats_total{threat_type="mfa_backup_code_reuse"}[15m]) > 0`, severity `warning` — HIGH in audit, warning on page, because the sibling-claim false positive is a documented non-incident), `runbook:` annotation pointing at the new runbook.
**Runbook**: `docs/runbooks/alert-mfa-backup-code-reuse.md` (sibling naming pattern) stating the broadened volume profile AND the sibling-claim false positive (code unconsumed, user retry succeeds).

### D6 — Tier 3 stagger seam: a test-local barrier decorator; constructor injection IS the seam

**Choice**: no production seam. The integration test builds racer B's `MfaService` over a `BarrierMfaUserRepository` implementing `MfaUserRepositoryPort`: every method delegates to the real Prisma adapter, except `markBackupCodeUsed` first awaits a gate promise and substitutes a pinned, clearly-distinct `usedAt` sentinel. Racer A runs undecorated. Sequence: start both → B's deciding read (`:199`) resolves immediately (pre-commit, passes the filter) → B blocks at the claim → A's `verifyMfaToken` resolves (claim committed) → capture the winner's stored timestamp → release the gate → B's adapter snapshot now carries the index → pre-check refuses → `INVALID_TOKEN` + HIGH + metric. Deterministic — no timing luck. Pinning B's sentinel makes the immutability assertion decidable (spec: distinct timestamps) and satisfies the `[static]` distinguishable-timestamps scenario by inspection.
**RED today**: B's fresh adapter snapshot matches `equals` → `count 1` → two sessions — asserted against the stored row and session count, never call shape.

### D7 — Wiring: a NEW dedicated `run_batch`

`CONCURRENCY=1 run_batch "integration:mfa-backup-single-use" tests/integration/mfaBackupCodeSingleUse.integration.test.ts` in the DB-only section (the suite drives adapters + service directly, no HTTP ⇒ runs on every PR). Own batch for the same reason `integration:customer-auth` states in-file: its cases race the SAME credential on purpose, and a sibling suite sharing the runner would make which statement won ambiguous. Exactly ONE file wired; siblings stay SMELL-75.

## File Changes

| File                                                                                          | Action | Description                                                                                            |
| --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `apps/api/src/infrastructure/adapters/PrismaCustomerMfaUserRepository.ts`                     | Modify | D1 pre-check between `:97` and `:98`; CAS untouched                                                    |
| `apps/api/src/infrastructure/adapters/PrismaAdminMfaUserRepository.ts`                        | Modify | Twin pre-check between `:92` and `:93`                                                                 |
| `packages/ports/src/MfaUserRepositoryPort.ts`                                                 | Modify | `markBackupCodeUsed` JSDoc rewrite (below); signature byte-identical                                   |
| `apps/api/src/admin/auth/MfaService.ts`                                                       | Modify | D2 read-back; D3 filter re-comment; D5 metric + optional `metrics` param                               |
| `apps/api/src/infrastructure/container/setupServices.ts`                                      | Modify | Pass `TOKENS.ApiMetrics` to `MfaService`                                                               |
| `apps/api/tests/unit/helpers/InMemoryMfaUserRepository.ts`                                    | Modify | `:104-106` comment corrected to name the claim contract; semantics untouched                           |
| `apps/api/tests/unit/infrastructure/adapters/Prisma{Admin,Customer}MfaUserRepository.test.ts` | Modify | Tier 1 sequential-reuse reds; un-stub the two concurrency tests (`Admin:317-329` / `Customer:324-336`) |
| `apps/api/tests/unit/infrastructure/adapters/mfaUserRepositoryConformance.test.ts`            | Create | Tier 2 — three implementations, one suite                                                              |
| `apps/api/tests/unit/unifiedMfaService.test.ts`                                               | Modify | G2 unit scenarios, read-back, no-secret payload, filter-removed mutation scenario                      |
| `apps/api/tests/integration/mfaBackupCodeSingleUse.integration.test.ts`                       | Modify | Repair (distinct timestamps, real UoW) + D6 staggered racer + sibling residual                         |
| `apps/api/scripts/run-tests.sh`                                                               | Modify | D7 — one new batch                                                                                     |
| `prometheus/alerts/api.yml`                                                                   | Modify | D5 — one rule                                                                                          |
| `docs/runbooks/alert-mfa-backup-code-reuse.md`                                                | Create | D5 — volume profile + false positive                                                                   |

## Interfaces / Contracts

Port JSDoc replacement (guarantee, never mechanism — no CAS, no snapshot, no column encoding):

```
Claim a single backup code (by array index) as consumed at `usedAt`, retaining
all prior claims. Guarantee: for a given (userId, codeIndex), at most ONE
caller ever receives Ok — under sequential replay and under every concurrent
interleaving. An existing claim is immutable: the first consumption's
timestamp is never overwritten by any later attempt.

@returns Ok(void) when THIS caller claimed the code. Err("ALREADY_USED") when
the claim is refused: the code is already consumed — the caller MUST reject
the verification and MUST NOT retry the claim. A refusal can also be a
sibling-claim collision (a concurrent claim of a DIFFERENT index for the same
user); the code is then NOT consumed and a fresh user-initiated verification
succeeds — this attempt is still rejected. Err("NOT_FOUND") when the user is gone.
```

## Data Flow (staggered attack, post-change)

    A: findById ──argon2──▶ claim(i) ──commit──▶ ok ──▶ session
    B: findById (pre-commit; filter passes) ──argon2──▶ [gate] ──▶ adapter snapshot
       ──▶ snapshot carries i ──▶ pre-check refuses ──▶ ALREADY_USED
       ──▶ INVALID_TOKEN + HIGH audit + securityThreats.inc — no session

## Testing Strategy

| Tier             | What                                                                                                                                  | Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 unit           | Sequential reuse refused, timestamp immutable, both adapters                                                                          | Stateful Prisma-CLIENT fake (never repo fake) seeded `{i: T1}`, claim at distinct `T2` → `ALREADY_USED`, stored still `T1`. RED today. Un-stub the two concurrency tests: replace hardcoded `{count: 0}` with the honest fake plus a post-snapshot-read hook that mutates the row (the "concurrent writer"), so the fake's real predicate computes the zero. Two guards keep the un-stub honest: the seeded map must NOT carry the claimed index at snapshot time — only the hook introduces it, otherwise the D1 pre-check refuses before the CAS runs and the test goes green for the wrong reason — and the test asserts the fake's `updateMany` actually executed |
| 1 unit (service) | G2 not cause-gated; refusal never `verified`; read-back; no secret in payload; guarantee survives filter removal                      | Against `InMemoryMfaUserRepository` (already-correct semantics) + metric spy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2 unit           | One conformance suite, three implementations                                                                                          | Parametrized factories: each Prisma adapter over its stateful client fake + the in-memory double. First assertion: sequential reuse. A permissive implementation cannot satisfy it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3 integration    | Staggered racer (D6), simultaneous racer, refused-claim-changes-nothing, timestamp survival, sibling residual, alarm+metric on attack | Real Postgres + real UoW; wired per D7; LXC heap-capped under `timeout`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration. Zero schema/migration edits, no sensitive-edit token, port signature byte-identical (zero consumer churn). Rollback = single PR revert; reverting the `run-tests.sh` line restores the prior collector state.

## PR Forecast (two-tier)

**CODE ≈ 200–260, counting mandatory JSDoc** (adapters ~16, port doc ~30, MfaService ~45 incl. param + JSDoc, container ~3, double comment ~6, alert rule ~14, runbook ~50, batch ~6). Under the 400 hard budget. **EVIDENCE ≈ 450–600**, pre-approved by Edward as one declared budget (Tier 1 ~120, Tier 2 ~200, Tier 3 ~250, wiring evidence ~10), split in the PR body.

    Decision needed before apply: No
    Chained PRs recommended: No
    400-line budget risk: Low

## Open Questions

None. The §6.1 verdict resolved the only STOP branch; the four spec-surfaced items are D2/D3/D4/D5.
