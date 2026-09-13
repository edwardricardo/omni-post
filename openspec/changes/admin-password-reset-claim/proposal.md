# Proposal: admin-password-reset-claim (SMELL-97)

**Phase**: sdd-propose · **Date**: 2026-09-12 · **Branch**: `workstream/admin-reset-claim` (tip = main `19fb9e6a`) · **Store**: openspec (+ Engram mirror `sdd/admin-password-reset-claim/proposal`)
**Inputs**: `explore.md` (current-state map, TOCTOU proof, class inventory) and `pre-propose-decisions.md` (Edward's four signed decisions + carried scope). Every load-bearing claim below was re-verified against the tree at `19fb9e6a`; three facts sharpen the explore and are marked **[verified+]**.

## Intent

Close SMELL-97 — the admin password-reset confirm at `apps/api/src/admin/auth/PasswordService.ts:229-289` resolves the token by `findFirst` and consumes it by `update({ where: { id } })`, so two confirms carrying one token both pass the read and the last writer owns the account, across a window of 1-6 argon2id operations that the attacker can widen. Close, in the same slice, the second unsound member of the single-use-claim class: `apps/api/src/auth/authServiceSession.ts:84-140` reads the session by `refreshTokenHash` and rotates keyed on `{ id }`, so a replayed refresh token rotates undetected — the exact failure rotation exists to prevent. Land the paired CLASS fitness gate (#41) hard-zero so the third member of this class cannot be written. All three are Edward's signed decisions; the proposer adds no product choice.

## Change summary (Edward's fixed format — the last gate before implementation)

**What it fixes, in one line:** a single-use admin credential (reset token, refresh token) can be consumed twice because its consuming write never names it; after this change both writes are count-gated claims and a gate keeps the class closed.

| Work item                                                                    | What it fixes                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Count-gated claim in `PasswordService.confirmPasswordReset`              | The TOCTOU: the consuming write names `id` + token + expiry + `isActive: true` + `passwordHistory` snapshot, so at most one confirm per token ever succeeds; the `passwordHistory` lost-update and the `\|\| ""` poison die in the same move (second read folded into the first). |
| (b) Rotation CAS in `AuthServiceSession.refreshTokens`                       | Refresh-token replay: the rotation names the PRIOR `refreshTokenHash`; a second presentation of a rotated token is refused instead of minting a second pair.                                                                                                                      |
| (c) Fitness #41, hard-zero, red-proven                                       | The class: any Prisma write whose `data` carries a consumption marker must name that credential's prior state in its own `where`; baseline 2/7 unsound → 0/7.                                                                                                                     |
| (d) Two staggered-interleaving racers + unit tier, wired into `run-tests.sh` | The proofs are RED on the unmodified tree (they fail by succeeding twice) and they execute in CI (fitness #30).                                                                                                                                                                   |

**What does NOT enter, and why** (each is a report, not a fix; rows are born at close — next free number in the backlog at `19fb9e6a` is 110):

| Finding (explore §)                                                                                 | Planned row                 | Why not here                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `"CHANGE_REQUIRED"` sentinel + dead `mustChangePassword` force-change feature (§5.2/§6.2, HIGH)     | SMELL-110                   | A different feature; folding it in blurs two proofs. The route's `z.string().uuid()` stays the only barrier and is named as such.             |
| Fitness #23 blind to tagged-template raw queries, 6 sites (§6.1, HIGH)                              | SMELL-111                   | Gate-integrity defect in another gate; its own re-measure + enrol/except change.                                                              |
| Issued-but-never-consumed credentials: DSAR `verificationToken`, `findByInviteToken` (§6.3, MEDIUM) | SMELL-112                   | Orphan ≠ delete; needs its own audit.                                                                                                         |
| Customer refresh has no server-side rotation (§6.4, MEDIUM)                                         | SMELL-113                   | Different table and flow; pairs with (b) as the customer twin, not with this diff.                                                            |
| `PasswordService` unconstructible for tests inside `AdminAuthService` (§6.5, MEDIUM)                | SMELL-114                   | Approach A is signed; the service keeps `PrismaClient` and this row owns that residual.                                                       |
| Enumeration timing fig leaf + `"reset_token_placeholder"` control-flow sentinel (§6.6, LOW)         | SMELL-115                   | Issuance path, not the claim.                                                                                                                 |
| `@unique` on `AdminUser.passwordResetToken`                                                         | none (blocked by SMELL-110) | The sentinel makes a unique index throw P2002 on the second forced reset; the claim is sound without it (`count > 0`, reasoning at the site). |

**The debatable point.** Work item (b) DETECTS replay and stops at refusal. OAuth 2.0 Security BCP practice on rotation-reuse detection is to revoke the whole session family, because the loser of the race may be the legitimate user and the winner the attacker — after this slice the attacker's pair stays live in that case. Family revocation is a product decision with real blast radius (a benign double-refresh from two tabs would log both out) and it is NOT signed; the proposal keeps the signed "replay-shaped rejection" and names family revocation as a follow-up row (pairs with SMELL-113). It is the weakest call here: the fix closes the mint-twice hole and leaves the act-on-detection half for Edward.

## Scope

### In scope — code

- **(a)** `apps/api/src/admin/auth/PasswordService.ts` — `confirmPasswordReset` becomes: one `findFirst` (token + expiry, selecting `id`, `passwordHistory`, `passwordHash`; design may mirror `isActive: true` here so an inactive admin never reaches argon2 work) → strength check → reuse check (both non-consuming, before the claim) → hash → ONE `updateMany` whose `where` names `id`, `passwordResetToken: token`, `passwordResetExpires: { gt: now }`, `isActive: true`, `passwordHistory: { equals: snapshot }` and whose `data` carries the new hash/algo/history, nulls the token columns and clears `failedLoginAttempts`/`lockedUntil`/`lockReason` (KEPT — proof of mailbox control, documented as deliberate). `count > 0` → success (no `@unique`; `randomUUID()` collision negligible; reasoning written at the site). `count === 0` → one re-read by `id`: token gone/expired/owner inactive → `INVALID_TOKEN`; token still live but history moved → the signed retryable conflict, never a false `INVALID_TOKEN`. A thrown error → explicit `err("INTERNAL_ERROR")` — **[verified+]** the code already exists in `AuthErrorCode` (`adminAuthTypes.ts:425`) and the route maps unmapped codes to 500 (`adminAuthRoutes.ts:340-346`), so this exit costs no type or route change. Security event + session revocation stay after the claim (pre-existing non-atomicity, named, unchanged).
- **(b)** `apps/api/src/auth/authServiceSession.ts` — the rotation at `:134-140` becomes `updateMany({ where: { id: session.id, refreshTokenHash: <presented hash>, isActive: true }, data: { refreshTokenHash: <new>, expiresAt } })`. **[verified+]** `AdminSession.refreshTokenHash` is `@unique` (`schema.prisma:231`), so `count ∈ {0, 1}` by construction and `count === 1` is the whole verdict (customer-precedent semantics — the opposite of (a)). `count === 0` → replay-shaped rejection from the existing union (`TOKEN_BLACKLISTED` is the Redis path's replay verdict today; design picks); the loser's freshly minted pair is never returned. Design also fixes the order of `blacklistToken` (`:116-118`) relative to the CAS.
- **(c)** Fitness #41 in `CLAUDE.md §Automated Compliance Checks` (+ "40 checks" → 41) mirrored byte-exact in `.github/workflows/fitness.yml` — **the slice's one `omnipost-allow sensitive-edit` token, at apply time**. Shape: explicit marker list (`passwordResetToken: null`, `resetToken: null`, `mfaBackupUsedAt`, `mfaLastUsedTotpStep`, `refreshTokenHash:`) in the `data` of `update|updateMany|upsert`; the same column must appear in that call's `where` window. Fail-closed like #40: marker-site floor of 7 and scope-directory existence; the backfill script is excluded by path (`migration` scenario). Residual limits written INTO the check: cache-backed consumption (`OAuthFlowStore`), dynamically built `where`/`data`, markers reached through a helper, line-window matching. Red-proven per the "new gates prove their red" rule: plant `where: { id }` on one site → real non-zero exit → byte-exact restore (`cmp`) → 0.

### In scope — evidence

| Deliverable                                                                              | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reset racer `apps/api/tests/integration/adminPasswordResetClaim.integration.test.ts`     | MFA template's 4-layer shape, driving `new PasswordService(prisma)` directly (ctor takes `PrismaClient`; no HTTP, no DI). Staggered (loser's read after winner's commit), simultaneous, sequential replay; weak/reused exits leave the token usable; expired token not nulled by the failed attempt; inactive owner refused and lockout NOT cleared; history moved → conflict, not `INVALID_TOKEN`; refused claim changes no column; stored hash verifies against the winner's password only. **Harness from zero** — no test calls `confirmPasswordReset` today (grep-confirmed) — forecast as its own EVIDENCE line. |
| Refresh racer `apps/api/tests/integration/adminRefreshRotationClaim.integration.test.ts` | Real `AuthService` over real adapters — **[verified+]** the construction recipe already exists in `apps/api/tests/auth.test.ts:22-39`, which calls `refreshTokens` (`:289`, `:327`), so this side is NOT from zero. Staggered + simultaneous: exactly one new pair, the loser's pair never issued, stored hash = winner's; sequential replay refused. Must interleave BEFORE either racer blacklists (Redis masks the race otherwise).                                                                                                                                                                                 |
| `apps/api/scripts/run-tests.sh`                                                          | Both files named by exactly one `run_batch`; fitness #30's count must not rise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Unit tier (strict TDD, coverage floor 85)                                                | Stateful Prisma-client fakes, never repository doubles (precedent rule). New `apps/api/tests/unit/admin/auth/PasswordService.test.ts`; rotation cases join `apps/api/tests/unit/authService.test.ts` (already calls `refreshTokens`). The hoisted fake in `tests/unit/admin/adminAuthService.test.ts` understands `gt` and `updateMany` but not list `equals` — design extends or picks `tests/unit/helpers/mockPrisma.ts`.                                                                                                                                                                                            |
| Design-phase `$on('query')` capture                                                      | For the reset claim shape — the first claim filtering on a non-unique, non-indexed column — proving one plain `UPDATE … WHERE (…)`; recorded in `design.md`, not assumed from the MFA capture.                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Out of scope

The seven rows in the table above; NO schema change or migration; NO port/DI rework (approach A signed); NO family revocation on replay (debatable point); NO change to `initiatePasswordReset`, `changePassword` (its own history RMW is a lost-update on history only, no credential consumed — stays with SMELL-114's lane), the customer flows, or the route/Turnstile handling.

## Capabilities

### New Capabilities

- `admin-password-reset-claim`: the admin reset confirm is one atomic, count-gated claim — at most one success per token under every interleaving; non-consuming exits preserved; liveness, history-CAS conflict, `INTERNAL_ERROR` never collapsed into `INVALID_TOKEN`; evidence executes in CI.
- `admin-refresh-rotation-claim`: refresh-token rotation is a CAS on the prior hash — a rotated token is never accepted again, one pair per presentation; evidence executes in CI.
- `single-use-claim-gate`: fitness #41 — the class invariant, its baseline (7 sites, 0 unsound), fail-closed floors, in-check residual limits, and the demonstrated red.

### Modified Capabilities

- None. `mfa-backup-code-claim`'s preamble defers the class gate to this slice but has no requirement on it; `customer-password-reset` names the admin reset as a successor and its requirements are untouched.

## Approach

Approach **A** (signed): tighten the two existing writes in place — no port, no adapter, no DI token, no schema. Both fixes are predicate-tightening on existing columns; the fix templates are `PrismaCustomerUserRepository.claimPasswordReset` and `PrismaAdminMfaUserRepository.claimTotpStep` (count-0 disambiguation via re-read). Sequencing is forced: the gate is red until BOTH fixes land, so the gate lands with or after them, never before. Strict TDD: racers and unit tests first, red by succeeding twice (asserted against stored state, never call shape), then green.

## Affected Areas

| Area                                                                                                                      | Impact                          | Description                                                                     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `apps/api/src/admin/auth/PasswordService.ts`                                                                              | Modified                        | Claim (a); second read removed; `INTERNAL_ERROR` exit                           |
| `apps/api/src/auth/authServiceSession.ts`                                                                                 | Modified                        | Rotation CAS (b); blacklist ordering                                            |
| `apps/api/src/admin/auth/adminAuthTypes.ts`, `adminAuthRoutes.ts:340-346`                                                 | Possibly modified (design)      | Only if the retryable-conflict exit needs a new code + 409 mapping (~4-8 lines) |
| `CLAUDE.md §Automated Compliance Checks`                                                                                  | Modified                        | #41 + count sentence                                                            |
| `.github/workflows/fitness.yml`                                                                                           | Modified (sensitive-edit token) | #41 mirror, byte-exact                                                          |
| `apps/api/tests/integration/adminPasswordResetClaim.integration.test.ts`, `adminRefreshRotationClaim.integration.test.ts` | New                             | The two racers                                                                  |
| `apps/api/tests/unit/admin/auth/PasswordService.test.ts`, `apps/api/tests/unit/authService.test.ts`                       | New / Modified                  | Unit tier                                                                       |
| `apps/api/scripts/run-tests.sh`                                                                                           | Modified                        | Batch wiring                                                                    |
| `docs/reports/roadmap-detected-smells-backlog.md`                                                                         | Modified at close               | SMELL-97 → DONE; SMELL-110..115 born                                            |

**Fitness interactions (config rule):** #41 new hard-zero; #30 two suites wired, count must not rise; #23 untouched (no raw SQL — `StringNullableListFilter` covers the history CAS); #38/#39/#40 untouched (`AdminUser` bears no `deletedAt`/`accountId`; one statement, no transaction); #8/#9/#10/#32 on every new file; #4 does not apply (`apps/api/src`, not `packages/core`), yet the thrown-error exit is still converted to `Result`.

## Risks

| Risk                                                                                                | Likelihood         | Mitigation                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `isActive: true` gating: a deactivated admin holding a live token now gets `INVALID_TOKEN`          | Certain (signed)   | Spec documents it; admin-only flow; no client distinguishes the code                                              |
| Replay rejection hits a benign concurrent double-refresh (two tabs) — one tab is forced to re-login | Med                | Named in spec + PR body; the winner's session survives; family revocation deferred (debatable point)              |
| Redis blacklist masks the rotation race in the racer                                                | Med                | Staggered interleaving pinned before either blacklist write; evidence asserts the stored hash, not the error code |
| Retryable-conflict exit needs a new `AuthErrorCode` + 409 route mapping — two more files            | Med                | Design decides between a new code and one bounded in-service re-attempt; either is ≤ 10 CODE lines                |
| Gate #41 is textual: a helper-built `where` or dynamic `data` hides a marker                        | Certain (residual) | Written into the check; floors fail closed on scope drift                                                         |
| Scope creep from the sentinel (§5.2) and the #23 hole (§6.1), both more severe in class             | Med                | Rows reserved above; neither enters the diff                                                                      |
| `openspec/config.yaml` still says "#1-#26" / "27 fitness functions" (stale since #40 landed)        | Certain            | Not this slice: a one-line orchestrator docs fix, named here so it is not silently absorbed                       |
| `fitness.yml` mirror drifts from `CLAUDE.md`                                                        | Low                | Paste, never paraphrase; verify with `diff` of the extracted block at verify                                      |

## Rollback Plan

Revert the PR(s). Both fixes tighten predicates on existing columns: no migration, no data rewrite, no new token, no port. If the gate shipped in a separate PR, revert the gate FIRST (else CI turns red on the reverted fixes); its `fitness.yml` revert is a second sensitive-edit token. Racers and unit tests revert with their fix.

## Dependencies

- `pnpm db:up` (Postgres + Redis) for the integration tier; LXC-safe single-file heap-capped runs.
- One `omnipost-allow sensitive-edit` token at apply for `.github/workflows/fitness.yml`.
- No external dependency, no schema, no ADR (approach A amends no canon rule).

## Delivery shape hint (tasks decides)

CODE estimate: `PasswordService.ts` ~70-100 churn · `authServiceSession.ts` ~25-35 · types/route ~0-8 · `CLAUDE.md` #41 block ~70-90 · `fitness.yml` mirror ~60-80 → **~230-310 CODE, under the 400 hard budget → single PR likely**. EVIDENCE: two racers ~250-350 each + unit tier ~150-250 + wiring ~10 → **~650-950, one Edward decision in the tasks forecast**, with the from-zero reset harness as its own line. If CODE crests 400, the only clean seam is PR 1 = both fixes + all evidence, PR 2 = gate #41 (stacked-to-main; the gate cannot precede the fixes).

## Success Criteria

- [ ] Reset racer: staggered and simultaneous pairs yield exactly ONE success; stored hash verifies against the winner's password only; token columns null; RED on `19fb9e6a`.
- [ ] Refresh racer: exactly ONE new pair per token; the rotated token is refused on re-presentation; RED on `19fb9e6a`.
- [ ] Non-consuming exits (`PASSWORD_TOO_WEAK`, `PASSWORD_REUSED`), expired token, inactive owner: token columns unchanged; inactive owner's lockout unchanged.
- [ ] A moved `passwordHistory` surfaces as the conflict exit, never `INVALID_TOKEN`; a thrown error surfaces as `INTERNAL_ERROR`.
- [ ] Fitness #41: 7 sites measured, 0 unsound, red demonstrated (planted → exit ≠ 0 → `cmp`-verified restore → 0); `CLAUDE.md` and `fitness.yml` blocks identical.
- [ ] Both suites named by exactly one `run_batch`; fitness #30 count does not rise.
- [ ] Design records the `$on('query')` capture for the reset claim: one `UPDATE … WHERE (…)`.
- [ ] Gate: lint 0/0, tsc 0, all 41 fitness checks green, unit + integration green; no `.skip`/`.only`.
