# Exploration: admin-password-reset-claim (SMELL-97)

**Phase**: sdd-explore · **Date**: 2026-09-12 · **Branch**: `workstream/admin-reset-claim` (tip = main `19fb9e6a`)
**Subject**: Admin password-reset confirm TOCTOU (backlog row SMELL-97) + the paired single-use-claim class fitness gate.
**Persistence note**: investigation executed by the sdd-explore agent (read-only toolset); artifact materialized verbatim by the orchestrator. Engram mirror: `sdd/admin-password-reset-claim/explore` (obs 703). Load-bearing claims spot-checked by the orchestrator against the tree before persisting (schema lines 183/354, sentinel, write predicates, uuid gate, refresh rotation).

## 0. Corrections to the backlog row — read these first

The row's own scoping sentence is wrong in two load-bearing places. Both were verified against the live tree.

| Row claim                                                               | Reality                                                                                                                       | Evidence                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| "Touches `apps/api/src/auth/PasswordService.ts`"                        | The file is `apps/api/src/admin/auth/PasswordService.ts`. `apps/api/src/auth/PasswordService.ts` does not exist.              | `Glob **/PasswordService*.ts` → one hit    |
| "no schema (the `@unique` on the token column already backs the claim)" | **`AdminUser.passwordResetToken` is `String?` with NO `@unique` and NO index.** The `@unique` belongs to the _customer_ twin. | `infra/prisma/schema.prisma:183` vs `:354` |

```prisma
# schema.prisma:183-184  (AdminUser)                  # schema.prisma:354-355 (CustomerUser)
passwordResetToken    String?                          resetToken        String?   @unique
passwordResetExpires  DateTime? @db.Timestamptz(6)     resetTokenExpiry  DateTime? @db.Timestamptz(6)
```

This does **not** sink the claim — a single `UPDATE … WHERE (<qual>)` is atomic regardless of uniqueness, so single-use still holds. What it removes is the customer comment's reasoning that _"a match caps at one row by construction and `count` is the whole verdict"_. Consequences carried into design in §5.

## 1. Verified current-state map

### 1.1 The flow, end to end

| Step                | Location                      | What happens                                                                                                                                      |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route registration  | `adminAuthRoutes.ts:588-595`  | `POST /admin/auth/password/reset/confirm`, registered in the **public** block. `preHandler: [rateLimit(5, 900000)]` only — no `requireAdminAuth`. |
| Input validation    | `adminAuthSchemas.ts:116-120` | `token: z.string().uuid()`, `newPassword: passwordSchema`, optional `turnstileToken`.                                                             |
| Handler             | `adminAuthRoutes.ts:299-350`  | Optional Turnstile (only when a `turnstileSecretKey` credential exists, fetched per request), then delegates.                                     |
| Service passthrough | `AdminAuthService.ts:372-381` | Binds `logSecurityEvent` and forwards.                                                                                                            |
| **Subject**         | `PasswordService.ts:218-313`  | The TOCTOU.                                                                                                                                       |

Issuance path: `adminAuthRoutes.ts:237-293` → `AdminAuthService.ts:365-367` → `PasswordService.ts:163-213`. Token = `crypto.randomUUID()`, 1h expiry, written via `update({where:{id}})`, returned to the route which emails it.

### 1.2 `confirmPasswordReset` decomposed

| Lines   | Operation                                                                                                       | Cost                    | Consumes token?     |
| ------- | --------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------- |
| 229-238 | `findFirst({ passwordResetToken: token, passwordResetExpires: { gt: now } })`, selects `id` + `passwordHistory` | 1 read                  | no                  |
| 240-242 | `!user → INVALID_TOKEN`                                                                                         | —                       | no                  |
| 245-248 | `validatePasswordStrength` → `PASSWORD_TOO_WEAK`                                                                | —                       | **no (deliberate)** |
| 251-259 | reuse loop over `passwordHistory.slice(-N)` → `PASSWORD_REUSED`                                                 | **1-6 argon2id verify** | **no (deliberate)** |
| 262     | `hashPassword(newPassword)`                                                                                     | **1 argon2id hash**     | no                  |
| 265-268 | **second read** `findUnique({id})` selecting `passwordHash`                                                     | 1 read                  | no                  |
| 270-272 | `[...history, currentHash?.passwordHash \|\| ""]`                                                               | —                       | no                  |
| 275-289 | `update({ where: { id: user.id }, data: { …, passwordResetToken: null, passwordResetExpires: null, … } })`      | 1 write                 | **YES**             |
| 292-297 | `onSecurityEvent(PASSWORD_RESET_COMPLETED)`                                                                     | —                       | after               |
| 300-310 | `adminSession.updateMany` revoke all                                                                            | —                       | after               |

### 1.3 Side effects and tests

- Audit/security event is emitted **after** the consuming write, and session revocation after that. A throw in either leaves the password changed and returns 500 — pre-existing atomicity wart, unchanged by this slice, named for honesty.
- **Existing tests: none.** `Grep "PasswordService|initiatePasswordReset" apps/api/tests` → _no matches_. The entire admin password service (change, issue, confirm) is untested.

## 2. Quality verdicts

| Unit                                                                                   | Verdict        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PasswordService.confirmPasswordReset` (:218-313)                                      | **MAL HECHO**  | TOCTOU (§3.1); a redundant second read inside the window (:265); `\|\| ""` poisons `passwordHistory` (:270); no liveness check; silently clears lockout (:285-287); zero tests.                                                                                                                                                                                                                                                                  |
| `PasswordService.changePassword` (:57-157)                                             | **ARREGLABLE** | Same `passwordHistory` RMW (:70 read → :124 write) but no credential is consumed and the caller proved the current password. Lost-update on history only.                                                                                                                                                                                                                                                                                        |
| `PasswordService.initiatePasswordReset` (:163-213)                                     | **ARREGLABLE** | The "fake token to maintain timing consistency" (:182-184) is a fig leaf — a bare `crypto.randomUUID()` is not comparable to an `update` + email send, so the enumeration oracle survives as a timing channel. It also returns a **sentinel string** `"reset_token_placeholder"` that `adminAuthRoutes.ts:253` string-compares to decide whether to send mail — control flow through a magic string, the _second_ sentinel in this blast radius. |
| `AccountSessionService.resetPassword` (:36-106)                                        | **MAL HECHO**  | Writes the guessable literal `"CHANGE_REQUIRED"` into a security-decision column (:79) with a 24h expiry, and never sets the real flag `mustChangePassword`. See §5.2.                                                                                                                                                                                                                                                                           |
| `AdminAuthService` wiring (:46-48)                                                     | **ARREGLABLE** | `new PasswordService(this.prisma)` inside the constructor. Not a fitness #21 violation (no singleton import), but it is why nothing can substitute the service — the **causal root of the zero test coverage**.                                                                                                                                                                                                                                  |
| `adminAuthRoutes.resetPasswordConfirm` (:299-350)                                      | **ARREGLABLE** | Works, but `z.string().uuid()` is load-bearing _security_ (§5.2) and nothing says so. Turnstile secret is re-fetched per request with no cache.                                                                                                                                                                                                                                                                                                  |
| `PrismaCustomerUserRepository.claimPasswordReset` (:210-237)                           | **BIEN**       | The reference: one conditional write, `count === 1` gate, `INTERNAL_ERROR` never collapsed into `INVALID_TOKEN`, reasoning in the comment.                                                                                                                                                                                                                                                                                                       |
| `PrismaAdminMfaUserRepository.claimTotpStep` (:144-166) / `claimBackupCode` (:~95-126) | **BIEN**       | CAS + count-0 disambiguation via a second read so the caller rejects rather than retries.                                                                                                                                                                                                                                                                                                                                                        |
| `OAuthFlowStore.consume` (:43-51)                                                      | **BIEN**       | Non-atomic read-then-delete, but the residual is measured, argued and documented in the JSDoc. Honest, not hidden.                                                                                                                                                                                                                                                                                                                               |
| fitness #23 regex (`CLAUDE.md`, `fitness.yml:504`)                                     | **MAL HECHO**  | §6.1 — it cannot see the canonical Prisma raw form.                                                                                                                                                                                                                                                                                                                                                                                              |

## 3. The defect, demonstrated from the code

### 3.1 TOCTOU — predicate analysis

Read predicate (`:229-233`) vs write predicate (`:275-276`):

```
READ :  WHERE passwordResetToken = $token AND passwordResetExpires > now()
WRITE:  WHERE id = $user.id                        ← the token is ABSENT
```

The write's predicate is satisfiable by any row with that `id`, independent of whether the token still exists. Two confirms carrying the same token both pass the read, and both writes succeed: the second overwrites the first's `passwordHash`. Under Read Committed the second `UPDATE` waits on the row lock, re-reads the committed row, finds `id` still matching, and proceeds — EvalPlanQual protects a qual that _names the contested column_, and `id` is not contested.

**Window size:** 1-6 argon2id verifies (`:254-259`, each m=64MiB/t=3/p=4 per `passwordHashing.ts:30-36`) + 1 argon2id hash (`:262`) + a second round-trip (`:265`). Tens to hundreds of milliseconds — the widest claim window of any site in the inventory, and attacker-inflatable by choosing a password that maximises history comparisons.

**Impact:** the last writer owns the account. Two parties who both obtained the token (mailbox compromise, forwarded link, shared inbox) race deterministically rather than first-come-first-served.

### 3.2 The `passwordHistory` read-modify-write

Read at `:236` (first query) **and** `:265-268` (second query), computed at `:270-272`, written at `:280`. Neither read is named in the write predicate. Two concurrent password operations on the same admin (a reset and a `changePassword`, which has its own RMW at `:70`→`:124`) each compute from a stale array and the last writer wins — a dropped history entry, which means a password the policy should refuse becomes reusable. Reuse prevention silently degrades.

The second read is also **pure liability**: `passwordHash` could have been selected in the first `findFirst`. Worse, `:270` writes `currentHash?.passwordHash || ""` — if the row vanished, an **empty string enters the history array**, where a later `verifyPassword(newPassword, "")` is a permanent no-op entry (`passwordHashing.ts:57-63` swallows the malformed-hash throw and returns `false`).

**Feasible CAS:** `passwordHistory: { equals: string[] }` is expressible — `StringNullableListFilter` at `infra/prisma/generated/prisma/client/models/AdminUser.ts:839-845` — so a snapshot CAS is available without raw SQL (fitness #23 safe), exactly mirroring the MFA JSONB-`equals` precedent.

## 4. Class inventory + baseline for fitness #41

**Class definition proposed:** a Prisma write whose `data` contains a _consumption marker_ for a single-use credential (a token nulled, a used-map extended, a step advanced, a token hash rotated) must name that credential's prior state in its own `where`.

### In class — the baseline the gate must measure

| #   | Site                                                                  | Marker in `data`                                         | `where`                      | Verdict                  |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------- | ------------------------ |
| 1   | `admin/auth/PasswordService.ts:275-289`                               | `passwordResetToken: null`, `passwordResetExpires: null` | `{ id }`                     | **UNSOUND** ← this slice |
| 2   | `auth/authServiceSession.ts:134-140`                                  | `refreshTokenHash: <rotated>`                            | `{ id: session.id }`         | **UNSOUND**              |
| 3   | `infrastructure/repositories/PrismaCustomerUserRepository.ts:220-227` | `resetToken: null`, `resetTokenExpiry: null`             | token + expiry + `deletedAt` | SOUND                    |
| 4   | `infrastructure/adapters/PrismaAdminMfaUserRepository.ts:106-117`     | `mfaBackupUsedAt`                                        | `{ equals: snapshot }`       | SOUND                    |
| 5   | `infrastructure/adapters/PrismaAdminMfaUserRepository.ts:152-158`     | `mfaLastUsedTotpStep`                                    | `OR[null, { lt: step }]`     | SOUND                    |
| 6   | `infrastructure/adapters/PrismaCustomerMfaUserRepository.ts:111-122`  | `mfaBackupUsedAt`                                        | `{ equals: snapshot }`       | SOUND                    |
| 7   | `infrastructure/adapters/PrismaCustomerMfaUserRepository.ts:159-165`  | `mfaLastUsedTotpStep`                                    | `OR[null, { lt: step }]`     | SOUND                    |

**Baseline = 2 unsound of 7.** Site #2 is a genuine second finding, not a technicality: `authServiceSession.ts:84-87` reads the session by `refreshTokenHash`, then `:134-140` rotates it keyed only on `id`. Two concurrent refreshes with the same token both pass and both rotate — refresh-token replay with no detection, which is precisely what rotation exists to prevent.

**Consequence for the pairing:** fixing only site #1 leaves the gate at 1. Either the slice also converts #2 (hard-zero, ~20 lines, but touches the session path and needs its own racer proof), or #41 ships as a documented ratchet at 1 with an owning backlog row. This is a real fork — §8 Q2.

### Adjacent but out of class — state the boundary so the gate is honest

| Site                                                                                                                                                                                | Why excluded                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session revocations (`PasswordService.ts:144-154`, `:300-310`; `AdminAuthService.ts:287-305`; `SessionManager.ts:129-159`, `:234-238`; `authServiceSession.ts:244-248`, `:277-279`) | Idempotent state transitions, not single-use credentials — and they already name `isActive: true`.                                                                 |
| `infrastructure/outbox/OutboxClaimService.ts:72-101`                                                                                                                                | Work-item **lease**, not a credential; sound via raw `FOR UPDATE SKIP LOCKED`.                                                                                     |
| `auth/oauth/OAuthFlowStore.ts:43-51`                                                                                                                                                | Cache-backed, not Prisma. **Residual limit of the gate**: cache-backed single-use consumption is outside its reach, and must be stated in the check's own comment. |
| `packages/core/customer-auth/RefreshCustomerTokenUseCase.ts`                                                                                                                        | Stateless JWT — no consumption marker exists at all (no server-side rotation). Adjacent smell, §6.4.                                                               |
| `admin/AccountSessionService.ts:77-83`                                                                                                                                              | Writes the sentinel; an issuance, not a consumption.                                                                                                               |
| `infra/prisma/scripts/backfill-admin-mfa-backup-codes.ts:239-241`                                                                                                                   | One-off migration script — the `migration` canon-exception scenario.                                                                                               |

## 5. Feasibility of Edward's scoping

| #   | Scoping item                                                                                                                                       | Verdict                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Claim shape `updateMany({where:{id, passwordResetToken: token, passwordResetExpires:{gt:now}}})`, `count===0 → INVALID_TOKEN`, consuming exit only | **Feasible and correct.** Preserves both non-consuming exits by construction — they return before the claim runs.                                                                                                                                                                                                                                                                                       |
| 2   | Fix the `passwordHistory` RMW in the same slice                                                                                                    | **Feasible**, and cheaper than expected: deleting the second read (`:265-268`) and selecting `passwordHash` in the first query removes one round-trip _and_ the `\|\| ""` poison. Snapshot CAS is available on top (§3.2) but raises a count-0 ambiguity — §8 Q3.                                                                                                                                       |
| 3   | Two-racer integration proof                                                                                                                        | **Feasible**, template exists: `apps/api/tests/integration/mfaBackupCodeSingleUse.integration.test.ts` drives real Prisma adapters directly (no HTTP), with a 4-layer structure including the **staggered** interleaving that `Promise.all` cannot reliably produce — which is exactly the argon2-window shape here. Must be added to `apps/api/scripts/run-tests.sh` or fitness #30 says it never ran. |
| 4   | Blast radius = `PasswordService.ts` only, no schema                                                                                                | **Partly false.** Path corrected (§0). The `@unique` premise is false, and adding it is _blocked_ (§5.2). Single-file is achievable only on approach A below.                                                                                                                                                                                                                                           |
| 5   | CLASS fitness gate lands with the slice                                                                                                            | **Feasible**, baseline measured above, but see the ratchet fork.                                                                                                                                                                                                                                                                                                                                        |

### 5.1 Surprises inventory

**Non-consuming exits — there are more than the two named.**

| Exit                                                                  | Consumes? | Correct?                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!user` → `INVALID_TOKEN` (:240)                                      | no        | yes                                                                                                                                                                                                                                                                                                        |
| `PASSWORD_TOO_WEAK` (:246)                                            | no        | yes — named                                                                                                                                                                                                                                                                                                |
| `PASSWORD_REUSED` (:256)                                              | no        | yes — named                                                                                                                                                                                                                                                                                                |
| **Thrown exception** from `hashPassword` (:262) or either Prisma call | no        | **unnamed third class** — escapes uncaught through `AdminAuthService` to Fastify as a 500; the token survives, which is the right outcome, but it is accidental rather than designed. The customer precedent converts this to `INTERNAL_ERROR` explicitly and refuses to collapse it into `INVALID_TOKEN`. |

**Missing liveness check.** `confirmPasswordReset` never selects or checks `isActive`; only `initiatePasswordReset` does (`:176`, `:181`). A token issued before deactivation stays usable for its full hour. The confirm also clears `failedLoginAttempts`, `lockedUntil`, `lockReason` (`:285-287`) — a brute-force lockout reset. The customer claim names `deletedAt: null` ("a live owner"); the admin parity of that is `isActive: true` in the predicate. Behaviour change — §8 Q1.

**Tenant/system context: no concern.** `adminUser` and `adminSession` are absent from `TENANT_SCOPED_MODELS` (`infra/prisma/src/extensions/tenantGuard.ts`), so no tenant guard, no RLS GUC, no `withGucBoundTransaction`. Fitness #40 is untouched: the claim is one statement, no transaction. Fitness #39 is untouched: `AdminUser` bears no `accountId`. Soft-delete: `AdminUser` has no `deletedAt`, so fitness #38 is untouched.

**The port does not have a claim method.** `PrismaAdminUserRepository.update` (`:216-243`) is a clean partial update — the customer side's `save()`-overwrites-19-columns defect does **not** repeat here. But `AdminUserRepository` has no `claimPasswordReset`, and `PasswordService` bypasses the repository entirely (it takes `PrismaClient` directly, `:22`). Mirroring the customer precedent therefore means port + adapter + DI changes, not a one-file edit.

### 5.2 The `"CHANGE_REQUIRED"` sentinel — the biggest surprise

`AccountSessionService.ts:77-83`, on an admin-initiated reset with `requirePasswordChange: true`:

```ts
passwordResetToken:   data.requirePasswordChange ? "CHANGE_REQUIRED" : null,
passwordResetExpires: data.requirePasswordChange ? new Date(Date.now() + 24*60*60*1000) : null,
```

A **constant, guessable, non-secret literal** is written into the reset-token column with a strictly-future expiry. `confirmPasswordReset`'s predicate matches it. The public endpoint takes an arbitrary caller-supplied token. The **only** thing standing between that and an unauthenticated admin takeover is `token: z.string().uuid()` at `adminAuthSchemas.ts:117`, which rejects the literal at the route boundary.

So: **not live today**, and not overstated. But the classification matters — this is a _trampa_, inert now and armed by touching the right thing: relax the schema to `z.string().min(1)`, add a second caller that skips the route, or reuse the service from a CLI, and it becomes an unauthenticated privilege escalation. The security sits in the wrong layer, and nothing labels it.

Two hard consequences for this slice:

1. **It blocks the `@unique` option.** Multiple admins can hold `"CHANGE_REQUIRED"` simultaneously; a unique index makes the second `AccountSessionService.resetPassword` throw P2002, caught at `:102-105` and returned as `DATABASE_ERROR`. Adding the constraint breaks a live feature unless the sentinel dies first.
2. **The column is three-way overloaded**: genuine UUID tokens, this sentinel, and historically a JSON array of MFA backup-code hashes (`infra/prisma/scripts/backfill-admin-mfa-backup-codes.ts:89`, `:163`, `:215` filter on `startsWith: "["`).

And the feature the sentinel serves is **decorative**: nothing anywhere reads `"CHANGE_REQUIRED"` (only the backfill guard, to skip it), and `AccountSessionService.resetPassword` never sets `mustChangePassword: true`. Nothing enforces `mustChangePassword` either — `adminUserRoutes.ts:169` only displays it, and `PasswordService` only ever sets it `false` (`:131`, `:284`). A phantom completion: the API accepts `requirePasswordChange`, reports success, and forces nothing.

## 6. Adjacent smells — report, do not fix

### 6.1 Fitness #23 cannot see the canonical Prisma raw form — HIGH (gate integrity)

The regex, in `CLAUDE.md` and mirrored at `fitness.yml:504`:

```
\.\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\(
```

It requires a literal `(` **immediately after** the method name. Prisma's canonical raw query is a **tagged template**: `` prisma.$executeRaw`SELECT …` ``. That form has a backtick there, so the check never sees it.

Measured — 4 matched sites (all already in the exception list) versus **6 production sites the check is blind to**:

| Site                                                             | Form                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/api/src/database/DatabaseOptimizer.ts:68`                  | `` $executeRaw`SELECT refresh_analytics_summary()` ``                      |
| `apps/api/src/database/DatabaseOptimizer.ts:246`                 | `` $executeRaw` … ` `` (multiline)                                         |
| `apps/api/src/database/DatabaseOptimizer.ts:322`                 | `` $executeRaw`ANALYZE` ``                                                 |
| `apps/api/src/database/DatabaseOptimizer.ts:325`                 | `` $executeRaw`SELECT collect_connection_pool_stats()` ``                  |
| `apps/api/src/saga/SagaManagerLifecycle.ts:1070`                 | `` $queryRaw`SELECT 1` ``                                                  |
| `apps/api/src/infrastructure/outbox/OutboxClaimService.ts:77-89` | ``$queryRaw<…>(Prisma.sql`…`)`` — the `(` follows `>`, not the method name |

None touches a tenant-scoped table today, so **there is no live CWE-639 leak**. The defect is that the gate's stated invariant is false as measured, and it would not catch a _new_ tenant-touching tagged-template raw query — the exact carrier it exists to block. Same class as the dead scopes of #2/#3/#4 and the dead globs of #36. Disposition: **new SMELL row**, own change; fix the regex to accept `` ` `` / `<` / `(` after the method name, re-measure, and enroll or except the 6 sites explicitly.

### 6.2 `"CHANGE_REQUIRED"` sentinel + dead force-change feature — HIGH (latent)

Per §5.2. Disposition: **new SMELL row**, own change. Set `mustChangePassword: true`, stop writing the sentinel, enforce the flag at login, and only then consider `@unique`. It is a different feature from the claim; folding it in would blur two proofs.

### 6.3 Orphaned single-use credentials — MEDIUM

- DSAR `verificationToken` is generated (`packages/core/compliance/src/ComplianceService.ts:499`) and **never consumed** — no read-by-token exists anywhere. A verification step that does not verify.
- `findByInviteToken` exists as port (`CustomerUserRepository.ts:52-56`) and adapter (`PrismaCustomerUserRepository.ts:190-208`) with **no production caller**; `CustomerUser.acceptInvitation` (`:459-472`) is likewise unreached. Invite acceptance is unimplemented.

Disposition: one backlog row for "issued-but-never-consumed credentials", audited before deletion (orphan ≠ delete).

### 6.4 No refresh rotation on the customer side — MEDIUM

`RefreshCustomerTokenUseCase.ts:44-88` verifies the JWT and mints a new pair with **no server-side consumption**: the same refresh token is replayable until expiry, gated only by a cache-backed logout blacklist. Asymmetric with the admin side, which at least rotates (badly — inventory #2). Disposition: backlog, pairs naturally with inventory #2.

### 6.5 `PasswordService` is unconstructible for tests — MEDIUM

`AdminAuthService.ts:46-48` `new`s `PasswordService`, `TokenService`, `SessionManager`. Not a #21 violation, but it is the structural cause of §1.3's zero coverage. Disposition: backlog; do **not** fix in this slice (it would balloon the diff), and route this slice's proof through the integration tier like the MFA precedent.

### 6.6 Enumeration timing fig leaf — LOW

`PasswordService.ts:182-184`. Disposition: backlog, with the `"reset_token_placeholder"` control-flow sentinel (`adminAuthRoutes.ts:253`).

## 7. Approaches

| #     | Approach                                                                                                                                                                  | Pros                                                                                                                      | Cons                                                                                                                                                                                                                                                         | Effort                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| **A** | **In-place claim** in `PasswordService`: replace `update` with a count-gated `updateMany`, fold the second read into the first, keep both non-consuming exits ahead of it | Smallest diff; matches the row's single-file intent; no port/DI churn; the proof is an integration racer that needs no DI | Leaves the service reaching for `PrismaClient` directly; the claim lives in an `@layer infrastructure` service rather than behind a port, so it is not reusable and not type-enforced                                                                        | **Low** (~60-90 CODE lines) |
| **B** | **Port-first**, mirroring the customer precedent: `claimPasswordReset` on `AdminUserRepository` + `PrismaAdminUserRepository`, inject the repo into `PasswordService`     | Symmetric with the shipped customer twin; claim becomes testable in isolation; reusable                                   | Touches port + adapter + `AdminAuthService` wiring + DI; drags in §6.5 as a prerequisite; the added surface is not what the defect needs                                                                                                                     | **Medium** (~200-300 CODE)  |
| **C** | **Redo**: lift admin reset into a `@core` use case mirroring `ResetPasswordUseCase`                                                                                       | Ends the admin/customer divergence structurally                                                                           | The two flows genuinely differ (admin has strength policy + history, customer has neither); a shared use case would have to carry both and would re-open the non-consuming-exit question it exists to preserve. Also pulls in the sentinel and the DI rework | **High**                    |

### Recommendation — **A**, with three additions

1. Claim predicate names `id`, `passwordResetToken`, `passwordResetExpires: { gt: now }` **and `isActive: true`** (liveness parity with the customer `deletedAt: null`), applied only at the consuming exit.
2. `count === 0 → INVALID_TOKEN`; a thrown error becomes an explicit `INTERNAL_ERROR`-shaped exit, never collapsed into `INVALID_TOKEN` — the customer comment at `PrismaCustomerUserRepository.ts:229-232` is the rationale and it applies verbatim.
3. Delete the second read (`:265-268`): select `passwordHash` in the first `findFirst`, which removes the round-trip and the `|| ""` poison in one move.

B is the canon-prettier answer, but it buys architecture this defect does not need and drags §6.5 in with it. Approach A leaves a _named_ residual (the service still holds `PrismaClient`) rather than an unnamed one — and that residual already has a home in §6.5.

**On EPQ:** the `mfa-backup-code-single-use` design capture proved Prisma emits plain `UPDATE … WHERE (<qual>)` for all three existing claim shapes, so atomicity is settled by evidence, not assumption. This would be the **first claim filtering on a non-unique, non-indexed column** — a new shape. One cheap `$on('query')` confirmation belongs in design rather than an assumption that the prior capture generalises.

## 8. Open questions for the pre-propose product gate

1. **Liveness in the predicate.** Adopt `isActive: true`? It is a behaviour change: a deactivated admin holding a live token stops being able to reset. Recommendation: **yes** — it is the admin parity of the customer claim's `deletedAt: null`. Related: should the confirm keep clearing `lockedUntil` / `failedLoginAttempts` (`:285-287`)?
2. **Gate #41 baseline.** Convert the refresh-rotation site (inventory #2) in the same slice for a hard-zero gate, or ship #41 as a documented ratchet at 1 with an owning backlog row? Edward's note says the pairing shrinks the baseline "toward hard-zero" — it does not reach it on this slice alone.
3. **`passwordHistory` CAS depth.** Minimum (single read, no history predicate — closes the poison and the extra round-trip, leaves the cross-operation lost update) or full snapshot CAS via `passwordHistory: { equals: snapshot }` (closes it, but needs count-0 disambiguation so a concurrent history move does not surface as a false `INVALID_TOKEN`)?
4. **Sentinel disposition.** Backlog row only (recommended), or in-slice? The `@unique` decision depends on it, and `@unique` is not required for the claim's soundness.
5. **`@unique` at all?** Without it, `count` is not capped at 1 by construction. Given tokens are `randomUUID()`, a >1 match is negligible — but the gate should be `count > 0` with the reasoning written down, or the constraint added once the sentinel dies.

## 9. Risks

- **Scope creep from §5.2/§6.1.** Both are more severe _in class_ than the subject. Both must stay reports, or this slice stops being provable in one diff.
- **Harness from zero.** No existing test touches this service, so the integration racer, its fixtures and its `run-tests.sh` wiring are built from nothing — an EVIDENCE-tier cost with no CODE analogue, and it must be forecast as its own line under the two-tier budget.
- **Fitness #30.** A new suite not named by a `run_batch` never executes while still reading as coverage.
- **Gate #41's own red.** Per the "new gates prove their red" rule: plant an unsound claim, observe a real non-zero exit, restore byte-exact, re-confirm zero. The gate's residual limits (cache-backed consumption, dynamically-built `data`/`where`, markers reached through a helper) must be written into the check itself — the #23 hole in §6.1 is what that discipline exists to prevent, discovered in this very explore.
