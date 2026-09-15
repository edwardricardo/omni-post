# Pre-propose decisions — admin-password-reset-claim (SMELL-97)

**Status**: CONFIRMED — signed by Edward Velasquez, 2026-09-12, at the pre-propose product gate.
The proposer receives these as settled input. Do NOT re-interview or re-litigate; design may only
surface NEW evidence that contradicts a premise, in which case it stops and reports.

## The four signed decisions (this gate)

1. **Liveness in the claim predicate: YES.** The consuming claim names `isActive: true` alongside
   `id`, `passwordResetToken` and `passwordResetExpires: { gt: now }` — admin parity of the customer
   claim's `deletedAt: null`. Accepted behaviour change: a deactivated admin holding a live token can
   no longer reset. The confirm KEEPS clearing `lockedUntil` / `failedLoginAttempts` on success
   (proof of mailbox control); the spec documents this as deliberate.
2. **Gate #41 ships hard-zero: the admin refresh-token rotation converts IN THIS SLICE.**
   `authServiceSession.ts` (~:134-140) rotates keyed on `{id}` after reading by `refreshTokenHash`
   — the second unsound member of the class (real replay window). It gets its own CAS (rotation
   predicate names the prior `refreshTokenHash`) and its own racer proof. Blast radius is therefore
   TWO files, superseding the row's single-file premise. The class fitness check (#41: a consumption
   marker in `data` must name the claim in `where`) lands with the slice, hard-zero, red-proven,
   with its residual limits (cache-backed consumption, dynamic `where`, helper indirection) written
   into the check itself.
3. **`passwordHistory`: full snapshot CAS.** Predicate carries `passwordHistory: { equals: snapshot }`
   (StringNullableListFilter — no raw SQL, fitness #23 untouched). `count === 0` is disambiguated by
   a re-read so a concurrent history move surfaces as a retryable conflict, never a false
   `INVALID_TOKEN`. The redundant second read dies (select `passwordHash` in the first `findFirst`),
   killing the `|| ""` history poison in the same move.
4. **Model plumbing**: session restarted after this gate so `sdd-propose`/`sdd-design` run on the
   pinned `claude-fable-5-1` (agent-registry cache measured session-sticky). SDD Agent calls omit
   the `model` param per the amended gate in `.claude/CLAUDE.md`.

## Standing signed scope (from the backlog row, corrected by explore §0/§5)

- Claim applied ONLY on the consuming exit; `PASSWORD_TOO_WEAK` / `PASSWORD_REUSED` keep the token
  usable; a thrown error becomes an explicit `INTERNAL_ERROR`-shaped exit, never collapsed into
  `INVALID_TOKEN`.
- NO schema change. There is NO `@unique` on `AdminUser.passwordResetToken` (row premise false) and
  adding one is blocked by the `"CHANGE_REQUIRED"` sentinel — the claim gates on `count > 0` with
  the reasoning written at the site.
- Two-racer integration proof per the MFA staggered-interleaving template; new suite wired into
  `apps/api/scripts/run-tests.sh` (fitness #30).
- Approach **A** (in-place claim; no port/DI churn). Named residual: the service still holds
  `PrismaClient` — owned by the explore §6.5 backlog row, not this slice.
- Adjacent findings stay REPORTS → new backlog rows at close: `"CHANGE_REQUIRED"` sentinel + dead
  `mustChangePassword` feature (HIGH); fitness #23 blind to tagged-template raw queries, 6 sites
  (HIGH); orphaned issued-never-consumed credentials (MEDIUM); customer refresh non-rotation
  (MEDIUM); `PasswordService` unconstructible for tests (MEDIUM); enumeration timing fig leaf +
  `"reset_token_placeholder"` sentinel (LOW).
- Research lane: offered and NOT selected — external canon already validated (MFA EPQ capture,
  NIST 800-63B). Design MUST include one `$on('query')` capture for the new claim shape (first
  claim filtering on a non-unique, non-indexed column) instead of assuming the prior capture
  generalises.

## Session preflight (carried)

`auto` (gatekeeper per phase) · store `openspec` (+ engram mirror per topic keys) · delivery
`ask-on-risk`, chain `stacked-to-main` when split · two-tier budget: CODE 400 hard per PR;
EVIDENCE band declared in the tasks forecast with ONE Edward decision per change; the from-zero
integration harness is forecast as its own EVIDENCE line (SMELL-98 lesson), and this change carries
TWO racers (reset + refresh).
