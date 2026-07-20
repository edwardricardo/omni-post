# Exploration: PR2b — Customer Login MFA Challenge (mfa-consolidation, N-SEC-5, Cluster B)

Feeds the PR2b design phase (a NEW customer auth flow). All claims verified at source with file:line. Read-only investigation.

## Current State

### The gap

A customer with `mfaEnabled = true` logs in with password ALONE. `LoginCustomerUseCase.execute` (`packages/core/customer-auth/src/LoginCustomerUseCase.ts:75-216`) never reads `mfaEnabled`, never returns `mfaRequired`; it signs access+refresh tokens directly after password verify (`:195-212`). Its output DTO (`:40-48`) has no `mfaRequired`/challenge field. So the second factor is collected and stored (PR1/PR2) but NEVER challenged at login. The original `mfa-consolidation` proposal put "MFA UX redesign (frontend flows unchanged beyond endpoint correctness)" OUT OF SCOPE (`proposal.md:23`) — PR2b is genuinely new work; `tasks.md:61-67` stubs it (2b.1-2b.3).

### Incumbent admin flow (the pattern to compare against)

`authServiceCore.login` (`apps/api/src/auth/authServiceCore.ts:131-146`, MFA branch `:255-292`): return type is `{user,tokens} | {mfaRequired:true, userId}`. If `mfaEnabled && !mfaToken` → returns `ok({mfaRequired:true, userId})` (`:257`). If `mfaToken` present → `mfaSvc.verifyMfaToken({type:ADMIN,id:user.id}, mfaToken)` (`:260-263`) then `createSession`. So the admin flow completes MFA INLINE inside `/admin/auth/login`, requiring the client to RE-SUBMIT email+password+mfaToken on step 2.

### The admin `mfaSessionToken` is a PHANTOM (verified)

Frontend plumbs `mfaSessionToken` (`apps/admin/lib/auth/types.ts:41-54`; login-form hidden field `apps/admin/components/auth/login-form.tsx:70`; server action `apps/admin/app/actions/auth.ts:68-72`), but the BACKEND never issues it — `authServiceCore.login` returns only `{mfaRequired,userId}`. `authenticateAdmin` reads `data.data.mfaSessionToken ?? ""` (`apps/admin/lib/auth/backend-client.ts:119-124`) → empty string, then re-submits email+password (hidden fields `login-form.tsx:68-69`) + mfaToken, passing the empty token as `deviceId` (`auth.ts:65`). CONCLUSION: the real incumbent mechanism is **re-transmit password + mfaToken**; the password is retained in client memory and re-sent. This is the weakness PR2b must avoid.

### `/auth/mfa/verify` is an ORPHAN (verified)

`mfaRoutes.ts:191-233` (registered `:524-528`): hardcoded `MFA_SUBJECT_TYPE.ADMIN` (`:205`), UNAUTHENTICATED (no preHandler), body `{userId, token}`, returns `{verified, usedBackupCode}` — issues NO session/token. `rg '/auth/mfa/verify' **/*.tsx` → zero callers. It is dead for login completion (admin completes via `/admin/auth/login`). Covered by `AUTH_ROUTE_RULES` (`httpRateLimitPreHandler.ts:126`) per-IP only. Its fate (retire vs repurpose for the customer step-2) is a design decision; `tasks.md:66` proposes repointing it to the customer subject.

### Customer frontend is partially scaffolded but backend-blind

`authApi.login` (`apps/client/lib/auth/authApi.ts:108-141`) ALREADY maps `data.mfaRequired` → `MfaChallenge {requiresMfa,message,methods}` (`:66-70, :129-135`), but there is NO step-2 verify method in `authApi`, and the backend never emits `mfaRequired` → dead scaffolding. A frontend slice (challenge UI + step-2 call) is needed but is separable from the backend gate.

### Domain entity is ready

`CustomerUser` carries `mfaEnabled` (getter `packages/core/domain/src/entities/CustomerUser.ts:275`), safely exposed in `toJSON` (`:522`). `LoginCustomerUseCase` already holds `targetUser` — the branch point exists at zero cost.

## Infra available for a challenge

- **JWT**: `jsonwebtoken` confined to `apps/api/src/auth/customerJwt.ts`; secret `env.CUSTOMER_JWT_SECRET`, HS256, issuer/audience pinned. Three type-discriminated tokens exist (`customer` access `:48`, `customer-refresh` `:78`, decode `:106`). Adding a `customer-mfa-challenge` token is a natural 4th, via the `CustomerTokenService` port (`packages/core/domain/src/repositories/CustomerTokenService.ts`) + `CustomerTokenServiceAdapter` (`apps/api/src/infrastructure/adapters/CustomerTokenServiceAdapter.ts`) — the sanctioned seam that keeps `jsonwebtoken` in one module.
- **CachePort** (`packages/ports/src/CachePort.ts:20-69`): `get / set(ttlSeconds) / getOrSet / delete / has`. NO atomic get-and-delete (GETDEL) / no SETNX consume. Single-use over CachePort = get+delete with a race window unless the port is extended with an atomic consume. Backed by `RedisCacheManager` (ioredis) but that atomicity is not exposed on the port.
- **DB single-use token precedent**: password reset — `CustomerUser.setResetToken/clearResetToken/isResetTokenExpired` (`CustomerUser.ts:477-502`), 32-byte hex + 1h expiry stored on the row (`RequestPasswordResetUseCase.ts:54-55`), cleared on use. Existing single-use pattern, but persisted (row write per issue) — heavier than desired for a high-frequency login step.
- **BackgroundTaskScheduler**: NOT needed. JWT `exp` and Redis TTL both auto-expire; no sweep required.

## Rate-limit + brute-force coverage

- `/auth/customer/login` IS covered by `AUTH_ROUTE_RULES` → AUTH preset 5 req/15min per IP (`httpRateLimitPreHandler.ts:107`). `/auth/mfa/verify` also covered (`:126`), per-IP only. A NEW customer step-2 endpoint MUST be added to `AUTH_ROUTE_RULES` (first-startsWith-match, `findConfig` `:205-214`).
- **Brute-force ORDERING BUG-in-waiting**: `LoginCustomerUseCase` calls `recordSuccessfulAttempt` at `:179` right after password verify, BEFORE any MFA. If MFA is bolted on naively, success is recorded pre-MFA and MFA failures never count. The port already documents `failureReason: "MFA_FAILED"` (`BruteForceProtectionPort.ts:83`) as an intended reason — the hook exists, unused for customer. Design MUST move success-recording to AFTER MFA completion and record MFA failures via `recordFailedAttempt({failureReason:"MFA_FAILED"})`. NIST 800-63B §5.2.2 — the MFA step is a VERIFIER and SHALL be throttled per-account.

## Tenant context on the pre-auth verify step

Customer login runs under `withSystemContext("customer-login", ...)` (`customerAuthRoutes.ts:137`) because login is pre-identity (no TenantContext). `PrismaCustomerMfaUserRepository.findById` hits the tenant-scoped `customerUser` (`PrismaCustomerMfaUserRepository.ts:44-67`), so the step-2 verify — also pre-auth — MUST run under `withSystemContext(...)`. Sanctioned precedent: `adminForceDisableCustomerMfa` wraps the customer MFA op in `withSystemContext` (`mfaRoutes.ts:443`). PR2b MUST reuse this path, NOT invent a tenant bypass.

## CRITICAL FINDING — TOTP is NOT single-use (canon violation)

`MfaService.verifyMfaToken` (`apps/api/src/admin/auth/MfaService.ts:186-225`): the TOTP path (`:197-199`) accepts a valid TOTP and returns immediately with NO used-marking. Only BACKUP CODES are single-use (`:201-217`, marked by index). TOTP window is ±2 steps (`TOTP_WINDOW=2`, `:31`) ≈ up to ~5 accepted steps (~150s) in which the SAME TOTP can be replayed.

Canon:

- NIST SP 800-63B §5.1.5.2 (multi-factor OTP verifiers): "verifiers SHALL accept a given time-based OTP only once during the validity period."
- OWASP MFA Cheat Sheet: "Ensure OTPs are single use"; "Invalidate the OTP on successful verification."

This affects BOTH admin and customer (shared `verifyMfaToken`). PR2b's login gate does not fix it by itself; it should be fixed as a companion correctness item (mark the last-used TOTP step per subject in a single-use store, reject reuse). FLAG PROMINENTLY.

## Approaches

### A. Mirror admin re-submit

Step 1 returns `{mfaRequired,userId}`; client re-submits email+password+mfaToken to the SAME `/auth/customer/login`; use case verifies MFA inline then issues tokens.

- Pros: consistency with admin; minimal surface (no new endpoint/token); reuses `withSystemContext`; frontend already has partial `mfaRequired` handling.
- Cons: inherits ALL incumbent weaknesses — password retained + RE-TRANSMITTED on every MFA attempt (extra exposure); argon2 re-runs on each attempt (CPU/DoS amplifier); pre-MFA state is not a bounded, single-use, expiring artifact; does NOT address TOTP replay.
- Effort: Low-Med.

### B. Short-lived single-use challenge token (JWT) + new verify endpoint [RECOMMENDED, hybrid with C]

Step 1 (`/auth/customer/login`): on `mfaEnabled`, DON'T mint a session; issue a signed `customer-mfa-challenge` JWT (type-discriminated, short exp ~5min, carries `sub`+`accountId`+`jti`) and return `{mfaRequired:true, challengeToken}`. NEW endpoint (e.g. `POST /auth/customer/login/mfa`) verifies the challenge token + the TOTP/backup code under `withSystemContext`, marks the `jti` consumed (single-use), then mints the real access+refresh tokens.

- Pros: password NOT retained/re-transmitted (fixes the core weakness — decisive over A); partial-auth state is a bounded, expiring artifact that grants nothing but the right to present a 2nd factor; argon2 runs once; per-account throttle keyed by challenge `sub` + per-IP AUTH rule; aligns OWASP Session Management "regenerate session ID on privilege change" (fresh session minted only after MFA — the customer flow already mints a new `sessionId`+tokens at the end, `LoginCustomerUseCase.ts:196-204`); JWT fits existing `customerJwt`/`CustomerTokenService` infra; frontend change is additive.
- Cons: single-use enforcement needs a consumed-`jti` store — CachePort lacks atomic getdel (options below); new endpoint + token type = more surface (MUST be in AUTH_ROUTE_RULES + feed BF); a self-contained challenge JWT stolen pre-consumption is replayable within TTL unless bound to IP/UA (OWASP recommends binding).
- Effort: Med.

### C. Server-side pending-login state in Redis keyed by an opaque nonce

Step 1 stores pending-login state (sub, accountId, issuedAt, ip/ua) under an opaque CSPRNG nonce, short TTL; returns `{mfaRequired:true, challengeId}`. Step 2 atomically consumes the nonce, verifies MFA, mints tokens.

- Pros: matches OWASP Session Management verbatim — "session ID content must be meaningless… sensitive data stored server-side only"; opaque nonce ≥64-bit entropy; truly single-use if consumed atomically (Redis GETDEL/Lua); trivially revocable; server-side IP/UA binding.
- Cons: needs a Redis-backed store with atomic consume — CachePort can't do it today (new port method or dedicated adapter); adds a hard Redis dependency on the login-completion path with a FAIL-CLOSED requirement (you cannot fail-open an MFA gate — contrast the rate-limiter's fail-open posture at `httpRateLimitPreHandler.ts:262`), so a Redis outage blocks MFA logins by design; most moving parts.
- Effort: Med-High.

## Recommendation

**Approach B (single-use challenge token) with server-side single-use enforcement — a B/C hybrid — AND fix the TOTP single-use finding as a companion item.**

- Issue a short-lived signed `customer-mfa-challenge` JWT via the `CustomerTokenService` port (happy path needs no new store), but enforce single-use + revocability with a server-side consumed-`jti` marker; if CachePort's get+delete race is unacceptable, extend the cache/limiter port with an atomic consume (small, well-scoped) — do NOT trust a self-contained JWT alone for replay.
- Bind the challenge to IP/UA (OWASP Session Management) and keep TTL tight (2-5min per OWASP high-value idle-timeout guidance).
- Move BF success-recording to the step-2 use case; record `MFA_FAILED` on failures (NIST verifier throttling).
- Mint the real session only AFTER MFA (OWASP "regenerate session on privilege change" — already the customer pattern).
- Companion: fix TOTP single-use in `verifyMfaToken` (NIST §5.1.5.2 / OWASP MFA) so the 2nd factor itself is replay-resistant regardless of the wrapper.

Rationale is canon-grounded: OWASP MFA (OTP single-use, invalidate on success), OWASP Session Management (meaningless token → server-side single-use marker preferred over trusting a JWT; regenerate on privilege change; bind to client attrs), NIST 800-63B (§5.2.2 verifier throttling ≤100 consecutive fails; §5.1.5.2 TOTP single-use). B's decisive advantage over A: no password retention/re-transmission.

**Admin migration**: the admin flow SHOULD eventually adopt the same challenge-token shape (retire the phantom `mfaSessionToken` + password re-transmit), but that is a FOLLOW-UP, not PR2b. PR2b scopes the customer gate only, to bound blast radius on live auth.

**`/auth/mfa/verify:205`**: prefer a DEDICATED customer step-2 endpoint under `/auth/customer/*` (clean rate-limit/BF wiring, subject clarity) over repurposing the admin-hardcoded orphan; retire or subject-type the orphan separately.

## Open questions for design

1. Challenge TTL value (proposed 2-5min per OWASP high-value idle timeout).
2. Single-use mechanism: extend CachePort with atomic consume vs get+delete-with-race vs DB-persisted (reset-token style). Prefer atomic Redis consume.
3. Does the challenge token carry `accountId` (tenant binding) — yes, so step-2 can bind `withSystemContext` + resolve the `CustomerUser` without a cross-account lookup.
4. Fate of `/auth/mfa/verify:205`: retire vs repurpose (recommend dedicated `/auth/customer/*` endpoint; retire orphan).
5. Frontend scope: is the client-portal challenge UI + step-2 `authApi` method part of PR2b or a separate slice? (Backend gate is separable and testable alone.)
6. Companion TOTP single-use fix: same PR (shared `verifyMfaToken`, affects admin too) or a sibling correctness slice?
7. BF/throttle: confirm step-2 feeds per-account BF AND is added to AUTH_ROUTE_RULES per-IP.
8. Fail-closed posture on the MFA gate store (MUST NOT fail-open) vs the rate-limiter's fail-open — explicit decision needed.
9. PR2b ordering: base = main after PR2 (per tasks.md); companion TOTP fix may need to land before/with the gate.

## Risks

- Shared `verifyMfaToken` change for TOTP single-use touches the ADMIN path too — regression surface on live admin auth. Contract tests both subjects.
- Single-use race if implemented as get+delete over CachePort — two concurrent step-2 requests could both consume one challenge.
- Fail-open temptation: the MFA gate store MUST be fail-closed; copying the rate-limiter's fail-open would silently bypass MFA.
- BF ordering: forgetting to move success-recording past MFA leaves the counter cleared pre-MFA (MFA brute-force ungated at the account level).
- Tenant context: step-2 MUST use `withSystemContext`; a missing binding throws `TenantContextMissingError` on the `customerUser` read.

## Ready for Design: YES

Recommendation (Approach B/C hybrid + TOTP single-use companion) is canon-grounded and fits existing hexagonal seams (use case returns challenge; new use case completes it; both under withSystemContext; token via CustomerTokenService port). Next: sdd-design for PR2b.
