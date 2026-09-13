# Design: admin-password-reset-claim (SMELL-97) — rev 2

**Phase**: sdd-design · **Date**: 2026-09-12 · **Branch**: `workstream/admin-reset-claim` (tip = main `19fb9e6a`) · **Store**: openspec (+ Engram mirror `sdd/admin-password-reset-claim/design`)
**Inputs**: `proposal.md` (approved), `explore.md`, `pre-propose-decisions.md` (four signed decisions — honoured, none re-litigated), the three delta specs, and the design gate's rev 1 report (1 CRITICAL, 6 WARNING, 3 NOTE). Every load-bearing claim below was re-read from the tree at `19fb9e6a`.
**Size note**: the orchestrator's brief mandates the verbatim gate block, the capture script and both claim blueprints, so this artifact exceeds the skill's 800-word default by design; prose is kept to what decides.

**Change log — rev 1 → rev 2 (surgical; signatures and file:line claims unchanged):**

| Gate finding                                                                                                                                                                                                                     | Disposition                                                                                                                                                                                                                                                                                                                                                                        | Where                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **F1 CRITICAL** — without Redis the rotation CAS is a no-op in the same-second case (identical mints → `hash(new) === hash(presented)` → both racers `count === 1`)                                                              | **Remedied: NEW decision D9 — `jwtid: randomUUID()` on the refresh JWT** (unique per mint, Redis-independent). Alternatives (ii) `tokenVersion` out of the gate and (iii) `expiresAt` in the CAS rejected with reasons. No product blast radius (verified: no consumer parses the token). E4 and rev 1's defect row DF-5 re-concluded. CODE +9 lines across two mechanism files.   | D9; E4; DF-5; Testing Strategy; Budget |
| **F2** — verbatim #41 block missed the out-of-class boundary, the "floor may fall and must never rise" sentence, and the two converted sites; line-window reconciliation unwritten                                               | All three added to the comment (POPULATION and OUT OF CLASS paragraphs). Residual (7) states that the structural scan ELIMINATES line-window matching and names (6) as its replacement; exact spec amendment stated                                                                                                                                                                | Gate block; Spec amendments            |
| **F3** — capture ACCEPT rules were purely syntactic (nonexistent ids: count=0 proves zero-mutation, never that the predicate matches)                                                                                            | Capture v3: TWO POSITIVE CONTROLS against a real seeded row (true EMPTY snapshot and true two-entry snapshot → `count === 1`; moved history / moved hash / replayed rotation hash → `count === 0` with the row byte-untouched); the script exits 1 on any rule failure; rows created and deleted by the probe with a residue check. Errata 1-3 folded into the body                | Capture section                        |
| **F4** — budget under-counted (script 111, block 166, mirror ~185) and double-counted `run-tests.sh`                                                                                                                             | Recomputed from the measured numbers, F2 additions and D9 included; `run-tests.sh` counted ONCE, in EVIDENCE                                                                                                                                                                                                                                                                       | Budget impact                          |
| **F5** — count-0 re-read is exhaustive only as of the re-read instant                                                                                                                                                            | The interleaving residual named in one sentence at D1 and in the blueprint's site comment                                                                                                                                                                                                                                                                                          | D1; blueprint (a)                      |
| **F6** — blueprint (a) appended `user.passwordHash` unguarded; an empty stored hash would still produce a `""` entry                                                                                                             | Decided: filter non-hashes out of the composed history (1 line). "Absent" is unrepresentable (`String` NOT NULL, `schema.prisma:176`); "empty" has no production writer (grep) but the spec scenario is normative and the fake can hold it, so the invariant holds by construction; legacy `""` entries are purged on the next successful reset                                    | Blueprint (a); Testing Strategy        |
| **F7** — spec baseline says "7 write sites"; the shipped gate measures 8 (7 claims + 1 exempt issuance)                                                                                                                          | Recorded as "8 detected = 7 claims + 1 exempt"; exact one-line spec amendment stated                                                                                                                                                                                                                                                                                               | D7; Spec amendments                    |
| **N8** — `openspec/config.yaml` 40→41 is three lines (`:21-22`, `:62`, `:86`) and is THIS change's apply task                                                                                                                    | Reassigned to the gate's commit (PR 2) as an apply task; row added to File Changes                                                                                                                                                                                                                                                                                                 | Sequencing step 5; File Changes        |
| **N9** — caller-visible half of blacklist-after                                                                                                                                                                                  | One sentence in D3: a throw in `blacklistToken` after a committed CAS returns `DATABASE_ERROR` while the rotation persisted. The SHAPE pre-exists via the post-update audit write (`authServiceSession.ts:142-158`); what is NEW is that the blacklist becomes a second post-commit source of it, and that the old order's retry-recovery on the GET-ok/SETEX-fail path is deleted | D3                                     |
| **N10** — regex literal with an unbalanced brace mis-slices                                                                                                                                                                      | Half-sentence added to residual (6): fails CLOSED at a marker site (dropped site → floor breach → exit 1)                                                                                                                                                                                                                                                                          | Gate block residual (6)                |
| Design-found (rev 2) — `auth.test.ts:286-287` already sleeps 1 s to dodge F1                                                                                                                                                     | The sleep is the tree's own evidence for D9; deleted in this change, the `notEqual` assertion there becomes a no-sleep integration pin of D9                                                                                                                                                                                                                                       | DF-7; Testing Strategy                 |
| Design-found (rev 2) — D6 said "deciding read" for the service's pre-claim read; the specs (and the promoted MFA precedent, `openspec/specs/mfa-backup-code-claim/spec.md:64`) use "deciding read" for the claim's own row check | Vocabulary aligned in D6; no spec change (precedent-consistent)                                                                                                                                                                                                                                                                                                                    | D6                                     |

**New evidence that SHARPENS a signed premise (none contradicts one):**

| #                     | Evidence                                                                                                                                                                                                                                                                       | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1                    | `adminAuthMiddleware.ts:90` holds an EXHAUSTIVE `Record<AuthErrorCode, string>`                                                                                                                                                                                                | A new error code touches THREE files (types, middleware message, route status), not two. Still 3 lines.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| E2                    | `authServiceCore.ts:197` (`upgradePasswordHash` on login) writes `passwordHash` ALONE — no history move, no token move                                                                                                                                                         | A history-only snapshot CAS would let the confirm append a stale prior hash after a concurrent rehash. The claim predicate names `passwordHash` too (D4). Extends decision 3, does not contradict it.                                                                                                                                                                                                                                                                                                                                   |
| E3                    | `authServiceCore.ts:364-386` → `PrismaAdminSessionRepository.ts:57-62`: `createSession` inserts a throwaway hash, mints the JWT, then `updateRefreshTokenHash` keyed on `{ id }` with `data: { refreshTokenHash }` (property shorthand)                                        | An eighth `refreshTokenHash` write the explore inventory did not list. Classified ISSUANCE (nothing presented is consumed) — the gate's one named exception, held to exactly one site (D7). Shorthand is matched so the exemption is by decision, not by syntax.                                                                                                                                                                                                                                                                        |
| E4 (re-concluded, F1) | `generateTokens` (`authServiceCore.ts:396-442`) signs `{userId,email,role,sessionId}` with whole-second `iat`/`exp` and no `jti`; `deviceFingerprint`/`tokenVersion` enter the payload only under `hasRedis` (`:411-414`); `hashRefreshToken` is deterministic unsalted sha256 | Without Redis, two mints of one payload in the same second are byte-identical, and a login followed by a refresh in the same second mints the PRESENTED token again: `hash(new) === hash(presented)`, the CAS rewrites the row's hash with itself, `count === 1` for BOTH racers, and the replay is undetected. The tree already knows: `auth.test.ts:286-287` sleeps 1 s before asserting the refreshed token differs. Rev 1 read this as an assertion-shape problem; it is a soundness defect of the rotation CAS. Decided in **D9**. |
| E5                    | `mockPrisma.ts:140-143` falls an unknown operator through to `===`, so `{ equals: [...] }` answers "0 rows" — indistinguishable from a correct count gate                                                                                                                      | Decides fork 5: a dedicated fail-closed stateful fake (the customer precedent `statefulCustomerUserPrismaFake.ts`), not an extension of a helper 33 suites import.                                                                                                                                                                                                                                                                                                                                                                      |
| E6                    | `hasRedis` is `!!getRedisInstance()` (`authServiceCore.ts:75-77`); nothing in an integration suite calls `setRedisInstance`                                                                                                                                                    | The refresh racer is Redis-less BY CONSTRUCTION: the DB CAS is the only line, so Redis cannot mask the race there. Ordering is proven at unit tier with a recording Redis double. With D9 the Redis-less racer is deterministic (no second-boundary dependence).                                                                                                                                                                                                                                                                        |

## Technical Approach

Approach A as signed: both consuming writes become count-gated `updateMany` claims whose `where` names the credential's prior state; the read that precedes each claim is folded to one; the gate (#41) makes the shape structural. One mechanism addition the rotation CAS cannot be sound without (D9): every refresh JWT carries a per-mint `jti`, so a rotation always changes the row. Fix templates: `PrismaCustomerUserRepository.claimPasswordReset` (`:210-237`, count is the whole verdict, `INTERNAL_ERROR` never collapsed) and `PrismaAdminMfaUserRepository.claimTotpStep` (`:144-166`, count-0 disambiguated by a re-read). Evidence is the MFA racer template (`mfaBackupCodeSingleUse.integration.test.ts`, gate-decorator seam) plus fail-closed stateful client fakes.

## Architecture Decisions

### D1 — Retryable-conflict exit: a NEW code `CONCURRENT_MODIFICATION`, HTTP 409, no in-service retry

| Option                                                                        | Tradeoff                                                                                                                                                                                                                                                                                         | Decision   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| New `AuthErrorCode` + 409 mapping                                             | 3 lines in 3 files (E1); the verdict is truthful and the retry is the caller's                                                                                                                                                                                                                   | **Chosen** |
| One bounded in-service re-attempt (re-read → re-run reuse loop → retry claim) | Still needs a terminal code for the second miss, so it does not remove the contract surface; hides up to N+1 more argon2id ops inside one request (attacker-inflatable, the same window class this slice closes); the customer precedent forbids collapsing the second miss into `INVALID_TOKEN` | Rejected   |
| Reuse an existing code (`INVALID_REQUEST`, `INTERNAL_ERROR`)                  | Both lie: the request was valid and nothing failed                                                                                                                                                                                                                                               | Rejected   |

Reachability: `count === 0` → one `findUnique` by id selecting `passwordResetToken`, `passwordResetExpires`, `isActive`. Row gone, token ≠ presented, expiry ≤ now, or inactive → `INVALID_TOKEN`. Otherwise the token is still live and the owner live, so the only predicates that can have failed are `passwordHash`/`passwordHistory` → `CONCURRENT_MODIFICATION`. **Named residual (F5):** the deduction is exhaustive as of the re-read's own instant, not the claim's — a token consumed or an owner deactivated between the count-0 and the re-read is reported `INVALID_TOKEN` (true by then), and a history move landing after the re-read is invisible to this attempt and is caught by the retry's own CAS; the verdict names the row's state at the re-read. Route: `CONCURRENT_MODIFICATION: 409` in the `statusMap` at `adminAuthRoutes.ts:340-344`, which is retyped `Partial<Record<AuthErrorCode, number>>` so a future code without a mapping is visible at the type level rather than a silent 500. Middleware: one message line (E1). Portal: unchanged — `reset-password/page.tsx:97-99` renders whatever message the API returns, exactly as for today's codes.

### D2 — Replay rejection code for the rotation CAS: existing `TOKEN_BLACKLISTED`, no re-read

`AdminSession.refreshTokenHash` is `@unique` (`schema.prisma:231`), so `count ∈ {0, 1}` by construction and `count === 1` is the whole verdict (customer-precedent semantics). Count 0 means the presented hash no longer matches the row — rotated by a racer, or the session was deactivated/deleted concurrently — and every one of those is "this credential has been revoked", which is exactly what `TOKEN_BLACKLISTED` already means on the Redis path (`authServiceSession.ts:73`; route `authRoutes.ts:166` → 401 "Token has been revoked"). Choosing it makes the replay verdict independent of whether Redis is present. Rejected: `SESSION_EXPIRED` (the benign "log in again" code — a detected in-flight replay is a security event, and collapsing it there is the "never collapse" violation); a new `TOKEN_REPLAYED` (a route mapping and audit vocabulary for a distinction the route already renders identically). The count-0 branch writes the same HIGH audit the Redis branch writes (`writeAuditLogPublic`, `reason: "ROTATED_TOKEN_REPLAYED"`, token-hash prefix, fingerprint/ip when present) so detection is not silent when Redis is absent — **with one refinement adopted from the 4R review**: the CALLER-visible verdict stays `TOKEN_BLACKLISTED` for every count-0, but the branch re-reads the row first and audits a revocation that landed mid-flight (row gone, or `isActive` false) as `SESSION_REVOKED_MIDFLIGHT` at MEDIUM, raising no threat counter. A logout also matches zero rows, and reporting an ordinary sign-out as a replay is how the alarm below earns a reputation for crying wolf. The re-read names the row as of its own instant, so a revocation landing after it still reports as a replay — the conservative direction, chosen deliberately.

Named, unchanged: a SEQUENTIAL replay after rotation is refused today as `SESSION_EXPIRED` without Redis (`:89`, the old hash is gone from the table) and `TOKEN_BLACKLISTED` with Redis. That asymmetry is pre-existing, both map to 401, and it belongs to the act-on-detection lane (proposal's debatable point, pairs with SMELL-113).

### D3 — `blacklistToken` moves AFTER a successful CAS

Order becomes: read → liveness/fingerprint checks → mint → **CAS** → (count 1) `blacklistToken(presented)` → audit → return. Rationale: the CAS is the single source of truth; Redis is defence-in-depth. Failure mode of the rejected order (blacklist before the CAS, today's `:116-118`): (i) in the staggered race the LOSER's own `isTokenBlacklisted` pre-check would already have passed, but the WINNER's blacklist write lands before the loser's CAS, so a later sequential probe cannot tell whether the CAS or Redis refused — the race is masked for anyone reading verdicts; (ii) a loser whose CAS then throws (`DATABASE_ERROR`) has blacklisted a token that was never rotated, killing the legitimate holder's still-valid token. With blacklist-after, a token is blacklisted only when rotation actually committed; if Redis is down after the CAS, the row already holds the new hash and a replay fails at the read — the DB stays sound. **Caller-visible half (N9):** a throw inside `blacklistToken` after the CAS committed propagates to the method's catch and returns `DATABASE_ERROR` while the rotation persisted. The SHAPE — a throw after a committed write reporting failure over persisted state — pre-exists via today's audit write at `authServiceSession.ts:142-158`, which already runs after the `:134-140` update. Two things ARE new and are named rather than folded into "unchanged": the blacklist becomes a SECOND post-commit source of that shape, and on the narrow GET-ok/SETEX-fail path the old order's recovery property is DELETED — with the blacklist first, a caller who saw that failure could retry the SAME token and still rotate it, because nothing had committed; with blacklist-after the row has already moved, the retry is refused by the CAS, and the caller must re-authenticate while holding a pair that IS the stored credential. The trade stays net-favourable: the rejected order's failure blacklists a token the CAS never rotated, killing the legitimate holder's still-live session, which is the worse of the two outcomes.

### D4 — Reset claim predicate: `id` + token + strictly-future expiry + `isActive: true` + `passwordHash` snapshot + `passwordHistory` snapshot

The write derives its `data` from exactly two read values (`passwordHash`, `passwordHistory`), so the CAS names both (E2). The read mirrors `isActive: true` (proposal option taken) so a deactivated admin's token never reaches argon2 work and the read/claim predicates differ only by the two snapshot columns. Gate wording as signed: `count > 0` — and the site comment states that `id` in the predicate caps the match at one row anyway, so `> 0` and `=== 1` coincide; the token column has no unique index (blocked by the `"CHANGE_REQUIRED"` sentinel, SMELL-110) and is a claim predicate, not the row key. `randomUUID()` collision is not what caps the count; `id` is.

### D5 — Unit-tier fake: NEW `tests/unit/helpers/statefulAdminUserPrismaFake.ts` (customer precedent); rotation cases stay on `mockPrisma`

| Option                                                                                                                                                  | Tradeoff                                                                                                                                                                                                                        | Decision   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Dedicated fail-closed stateful `adminUser`/`adminSession` client fake, modelled on `statefulCustomerUserPrismaFake.ts` (unknown column/operator THROWS) | ~250-320 EVIDENCE lines; zero blast radius; the fake cannot answer a silent false zero                                                                                                                                          | **Chosen** |
| Add list `equals` to `mockPrisma.matchesWhere`                                                                                                          | ~15 lines, but 33 suites import it and its fall-through-to-`===` rule (E5) stays for every other operator; `auditLogger.ts:319` already sends `equals` through it, so a semantics change reaches suites this slice does not own | Rejected   |
| Add `adminUser.updateMany` + list `equals` to the hoisted fake in `adminAuthService.test.ts`                                                            | That suite never calls `confirmPasswordReset`; the fake would grow for a caller that is not there                                                                                                                               | Rejected   |

Rotation cases join `tests/unit/authService.test.ts`, already on `mockPrisma`, whose `matchesWhere` handles the CAS's plain equalities (`refreshTokenHash`, `isActive`) and `updateMany` — no helper change. That suite does not mock `jsonwebtoken`, so the D9 uniqueness case runs the real signer. The tenant guard is NOT routed through the admin fake: `adminUser`/`adminSession` are absent from `TENANT_SCOPED_MODELS`, so a guard check would decide nothing and prove nothing (the customer fake routes it because `customerUser` IS enrolled).

### D6 — Racer seam: a gated Prisma-client wrapper (function), gating EVERY consuming write, signalling on the pre-claim read

`PasswordService` and `AuthServiceSession` take `PrismaClient` directly, so the seam is the client, not a port (the `gateClaimSnapshot` form, `mfaBackupCodeSingleUse.integration.test.ts:167-201`). The wrapper: delegates pass-through; the service's pre-claim read (`adminUser.findFirst` / `adminSession.findUnique`) resolves normally and signals; `update` AND `updateMany` on the racing delegate `await gate` before delegating and record `{ op, count }`. Gating both write forms is what makes RED deterministic on `19fb9e6a` (the write there is `update`). Sequence: start loser → await `preClaimReadDone` → run winner to completion → capture row → release → await loser. **Vocabulary:** the specs' "the second's deciding read happens AFTER the first's claim has COMMITTED" is the claim's own row check — the `UPDATE … WHERE` that decides `count` — exactly as the promoted MFA precedent words the same mechanism; the service's `findFirst` passes BEFORE the winner runs, which is what makes the tree at `19fb9e6a` succeed twice. Redis: absent by construction (E6), so the loser's refusal can only come from the CAS — and the recorded `count === 0` proves the CAS executed rather than short-circuited. With D9 the loser's mint differs from the winner's, so the proof holds with login and race inside one second (the racer's natural timing) rather than only across a second boundary. The ordering property of D3 is proven at unit tier with a recording Redis double set through `setRedisInstance` (methods the helpers call: `get`, `setex`, `del`, `sadd`, `expire`, `scard`, `lpush`, `ltrim`): on the count-0 path no `setex` under `TOKEN_BLACKLIST_PREFIX` occurs; on success exactly one.

### D7 — Fitness #41: a STRUCTURAL scan (the #36 node form), allowlist-by-shape, one named issuance exception held to one site

A line window (#38's form) cannot tell a `select: { passwordResetToken: true }` in the same call from a `where` that names the column; slicing each call's argument to its balanced close and locating the `data:`/`where:` literals can. Full text in the Gate section. Shorthand `{ refreshTokenHash }` is a marker so E3's site is exempted by a decision that is written down, not by syntax. **Population (F7):** the gate detects **8 marker sites = 7 claim sites + 1 named issuance exception**; `SITE_FLOOR = 8` counts the exception because the scan increments `sites` before the exception test, so a moved exception is a floor breach too. The spec's "7 write sites" counts claims only; the one-line amendment is under Spec amendments.

### D8 — Exit shape for thrown errors, and scope of the try

`try` covers the read through the claim verdict (read, strength, reuse, hash, claim, re-read); a throw becomes `err("INTERNAL_ERROR")` and is logged via `authLogger` (`createLogger` factory — LOGGING_CANON; empty catch is forbidden). The post-claim side effects (security event, session revocation) stay OUTSIDE the try exactly as today: a throw there still surfaces as a 500 after the password changed — the pre-existing non-atomicity the proposal names and leaves unchanged. `INVALID_TOKEN` is reachable only from the read's null and the count-0 re-read: answers, never failures to ask.

### D9 (rev 2, F1) — Every refresh JWT carries a per-mint `jti` (`jwtid: randomUUID()`), Redis-independent

**The defect the CAS alone does not close.** A compare-and-swap on `refreshTokenHash` is sound only if the swap CHANGES the row. Without Redis the refresh payload is `{userId,email,role,sessionId}` with whole-second `iat`/`exp` (E4), so a refresh in the same second as the presented token's mint re-mints the presented token: `where: { refreshTokenHash: h(T0) }` → `data: { refreshTokenHash: h(T0) }`, `count === 1`, nothing rotated, T0 accepted again later — and two racers in that second both get `count === 1`. Running the racer with a Redis double would satisfy the racer but not the [MERGE-BLOCKING] "the claim, not the cache blacklist, is the authority" requirement, so it is not a remedy.

| Option                                                                                                            | Tradeoff                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Decision   |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| (i) `jwtid: randomUUID()` in the refresh `jwt.sign` options (`authServiceCore.ts:427-433`) → standard `jti` claim | Every mint is unique regardless of second, Redis, or payload; two racers mint DISTINCT pairs, so the spec's "the hash of the token the loser would have issued appears in no row" becomes satisfiable as written; the customer JWT already carries a `jti` (`customerJwt.ts:53`) so the shape is not new to the estate; +1 import member, +1 option, +1 optional `jti?: string` on `TokenPayload`, a site comment; deterministic proof (same-tick mints differ) | **Chosen** |
| (ii) Move `tokenVersion` (and `deviceFingerprint`) out of the `hasRedis` gate                                     | Fixes login-then-refresh in one second (v1 → v2) but two racers still mint IDENTICAL pairs (same version, same second), so the loser's would-be pair IS the winner's — the "appears in no row" scenario stays unsatisfiable; widens the Redis-less payload and the `AuthTokens.tokenVersion` return/audit surface                                                                                                                                               | Rejected   |
| (iii) Name the prior `expiresAt` in the CAS `where` so a contested column always changes                          | `expiresAt` is millisecond-resolved so it usually differs, but the HASH still does not: the row keeps `h(T0)`, the caller gets T0 back as its "new" token, and a later presentation of T0 matches the row again — the rotated token is accepted again, which is the requirement this slice exists to close                                                                                                                                                      | Rejected   |
| Do nothing; assert only the stored hash and the loser's verdict (rev 1's E4 reading)                              | Leaves the same-second no-op rotation live and the Redis-less racer red whenever login and race share a second — the racer's natural timing; the tree's own 1 s sleep at `auth.test.ts:286-287` is the measurement of this                                                                                                                                                                                                                                      | Rejected   |

**Blast radius, verified:** the refresh JWT is parsed in `apps/api/src` only at `authServiceSession.ts:82` (`jwt.verify` → cast to `TokenPayload`; an extra registered claim is ignored) and `:238` (`jwt.decode` for `exp`); `jti`/`jwtid` appear nowhere in the admin token path; `apps/admin` decodes no JWT (no `jwt-decode`/`atob`); the token grows by one UUID claim (~45 bytes) inside a cookie/header the client treats as opaque. No product-observable behaviour changes — replay refusal is the only new outcome, which is the signed one. The ACCESS token is left as is: nothing consumes it by a write, so uniqueness there is symmetry without a requirement. **Relation to signed decision 2:** the "TWO files" blast radius counted the two CLAIM sites; D9 is the mechanism that makes the second claim a claim (9 lines in `authServiceCore.ts` + `authTypes.ts`), sharpening the premise rather than re-opening a product choice. **Spec touch-point:** the refresh spec's non-goal "any change to … token issuance beyond the rotation write itself" needs the one-line amendment under Spec amendments — D9 is required by that spec's own [MERGE-BLOCKING] authority requirement.

```ts
// authServiceCore.ts — import extends `import { randomBytes } from "crypto";` (:9)
import { randomBytes, randomUUID } from "crypto";
// …:427 — the refresh token only; the rotation CAS consumes it, so every mint must differ
const refreshToken = jwt.sign(payload, this.refreshSecret, {
  expiresIn: this.refreshTokenTtl,
  // A per-mint `jti`: without it two mints of one payload in one second are byte-identical
  // (whole-second iat/exp), and a rotation that re-mints the presented token is a CAS that
  // swaps a hash for itself — replay undetected. Redis-independent by design.
  jwtid: randomUUID(),
  ...(this.hasRedis && { issuer: this.issuer, audience: this.audience }),
});
// authTypes.ts — TokenPayload gains `jti?: string;` (registered claim, present on refresh tokens)
```

## Claim blueprints

### (a) `PasswordService.confirmPasswordReset` — post-change shape

```ts
async confirmPasswordReset(token, newPassword, onSecurityEvent): Promise<Result<boolean, AuthErrorCode>> {
  let userId: string;
  try {
    // ONE read. `isActive: true` mirrors the claim so an inactive owner never reaches
    // argon2 work; `passwordHash` is selected here so the second read (and the `|| ""`
    // history poison it fed) is gone.
    const user = await this.prisma.adminUser.findFirst({
      where: { passwordResetToken: token, passwordResetExpires: { gt: new Date() }, isActive: true },
      select: { id: true, passwordHash: true, passwordHistory: true },
    });
    if (!user) return err("INVALID_TOKEN");

    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) return err("PASSWORD_TOO_WEAK");            // non-consuming, before the claim
    const keep = adminAuthConfig.passwordPolicy.preventPasswordReuse;
    for (const oldHash of user.passwordHistory.slice(-keep)) {
      const { valid: isReused } = await this.verifyPassword(newPassword, oldHash);
      if (isReused) return err("PASSWORD_REUSED");                      // non-consuming, before the claim
    }
    const { hash, algorithm } = await this.hashPassword(newPassword);
    // Only real stored hashes enter the history. The column is NOT NULL and no production
    // writer stores "", so the filter is unreachable from the tree today; it holds the
    // invariant by construction instead of by auditing writers, and it purges any "" the
    // retired `|| ""` fallback left behind on the next successful reset. The CAS below
    // still names the history exactly as READ (unfiltered) — the guard is on what is written.
    const updatedHistory = [...user.passwordHistory, user.passwordHash]
      .filter((entry) => entry.length > 0)
      .slice(-keep);

    // ONE conditional write — the claim. The predicate names the row (`id`), the
    // credential and its liveness (token, strictly-future expiry, live owner), and
    // BOTH values the data below derives from (`passwordHash`, `passwordHistory`),
    // so the database decides who consumes the token and whether the history this
    // write appends to is the one it read. `id` caps the match at one row, so
    // `count > 0` and `count === 1` coincide; the token column carries no unique
    // index (the "CHANGE_REQUIRED" sentinel blocks one — SMELL-110), which is why
    // the token is a claim predicate here and not the row key. Under Read
    // Committed a concurrent committed writer makes EvalPlanQual re-check exactly
    // these columns, and the loser matches zero rows. Typed `StringNullableListFilter`
    // equality, no raw SQL (fitness #23 untouched).
    const { count } = await this.prisma.adminUser.updateMany({
      where: {
        id: user.id,
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
        isActive: true,
        passwordHash: user.passwordHash,
        passwordHistory: { equals: user.passwordHistory },
      },
      data: {
        passwordHash: hash,
        passwordHashAlgo: algorithm,
        passwordHistory: updatedHistory,
        passwordChangedAt: new Date(),
        passwordResetToken: null,
        passwordResetExpires: null,
        mustChangePassword: false,
        // Clearing the lockout on a successful reset is DELIBERATE (signed): the
        // caller proved control of the mailbox. A refused claim never reaches here.
        failedLoginAttempts: 0,
        lockedUntil: null,
        lockReason: null,
      },
    });
    if (count === 0) {
      // Disambiguate, never retry in place: a dead/consumed/expired token or a
      // deactivated owner is INVALID_TOKEN; a token still live means only the
      // snapshot columns moved (a concurrent password write on this admin) — a
      // retryable conflict that must never read as a bad token. The verdict names
      // the row as of THIS read, not as of the claim: a consumption landing between
      // the two reads as INVALID_TOKEN (true by then), and a history move landing
      // after it is caught by the retry's own CAS.
      const now = await this.prisma.adminUser.findUnique({
        where: { id: user.id },
        select: { passwordResetToken: true, passwordResetExpires: true, isActive: true },
      });
      const tokenLive =
        now !== null && now.passwordResetToken === token && now.isActive &&
        now.passwordResetExpires !== null && now.passwordResetExpires > new Date();
      return err(tokenLive ? "CONCURRENT_MODIFICATION" : "INVALID_TOKEN");
    }
    userId = user.id;
  } catch (error: unknown) {
    // A throw is a failure to ASK the question, not an answer to it: it is never
    // reported as a bad token (the customer precedent's rule).
    authLogger.error({ err: error }, "confirmPasswordReset claim failed");
    return err("INTERNAL_ERROR");
  }
  // Post-claim side effects, outside the try, unchanged (pre-existing non-atomicity, named).
  await onSecurityEvent({ type: "PASSWORD_RESET_COMPLETED", userId, success: true, timestamp: new Date() });
  await this.prisma.adminSession.updateMany({ where: { userId, isActive: true }, data: { isActive: false, revokedAt: new Date(), revokeReason: "PASSWORD_RESET" } });
  return ok(true);
}
```

JSDoc landing: the method header states the guarantee (at most one success per token under every interleaving; non-consuming exits keep the token usable; the four exits) — guarantee, not mechanism. The four site comments above are the canon notes (the history guard, the claim, the disambiguation, the lockout clearing).

### (b) `AuthServiceSession.refreshTokens` — rotation CAS (replaces `:116-118` and `:134-140`)

```ts
const newTokens =
  await this.core.generateTokens(/* unchanged; each mint carries its own jti (D9) */);
// Compare-and-swap on the PRIOR hash: the rotation names the credential it consumes.
// `refreshTokenHash` is unique, so count is 0 or 1 and 1 is the whole verdict; 0 means
// the presented token was rotated (or the session revoked) between our read and this
// write — a replay in flight. The loser's freshly minted pair is never returned. A benign
// double-refresh (two tabs) costs the loser a re-login; the family is NOT revoked on a
// detected replay — a named follow-up (pairs with SMELL-113), not this change.
const { count } = await this.prisma.adminSession.updateMany({
  where: { id: session.id, refreshTokenHash: hashRefreshToken(refreshToken), isActive: true },
  data: {
    refreshTokenHash: hashRefreshToken(newTokens.refreshToken),
    expiresAt: newTokens.expiresAt,
  },
});
if (count !== 1) {
  // 4R refinement: re-read the row first; a mid-flight revocation audits
  // SESSION_REVOKED_MIDFLIGHT at MEDIUM and raises no threat counter.
  await this.core.writeAuditLogPublic({/* the :59-72 block, reason: "ROTATED_TOKEN_REPLAYED" */});
  return err("TOKEN_BLACKLISTED");
}
// Blacklist only what the CAS actually rotated: the row is the source of truth and
// Redis is defence-in-depth, so a losing or throwing attempt never kills a live token.
if (this.core.hasRedis && decoded.exp) await blacklistToken(refreshToken, decoded.exp);
```

`PrismaAdminSessionRepository.updateRefreshTokenHash` JSDoc gains the classification (issuance step of `createSession`; #41's named exception; remove-when: mint the session id before the insert).

## Data Flow (staggered races, post-change)

    Reset
    A: findFirst(token) ──argon2──▶ claim{id,token,exp,active,hash,hist} ──commit──▶ ok ──▶ event + revoke
    B: findFirst(token) [pre-commit, passes] ──argon2──▶ [gate] ──▶ claim ──▶ count 0
       ──▶ re-read: token null ──▶ INVALID_TOKEN ──▶ no event, no revoke, no column touched

    Refresh (Redis absent)
    A: findUnique(h(T0)) ──mint T1{jti a}──▶ CAS{id, h(T0), active} → h(T1) ──commit──▶ ok(T1)
    B: findUnique(h(T0)) [pre-commit, passes] ──mint T2{jti b}──▶ [gate] ──▶ CAS{id, h(T0)} ──▶ count 0
       ──▶ HIGH audit ──▶ TOKEN_BLACKLISTED; row = h(T1); h(T2) in no row

## File Changes

| File                                                                       | Action                        | PR  | Description                                                                                                                                          |
| -------------------------------------------------------------------------- | ----------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/admin/auth/PasswordService.ts`                               | Modify                        | 1   | Blueprint (a); `authLogger` import; method JSDoc                                                                                                     |
| `apps/api/src/auth/authServiceSession.ts`                                  | Modify                        | 1   | Blueprint (b); blacklist after CAS; count-0 audit + verdict                                                                                          |
| `apps/api/src/auth/authServiceCore.ts`                                     | Modify                        | 1   | D9: `randomUUID` import member; `jwtid` on the refresh sign; site comment (~7 lines)                                                                 |
| `apps/api/src/auth/authTypes.ts`                                           | Modify                        | 1   | D9: `jti?: string` on `TokenPayload` (1 line)                                                                                                        |
| `apps/api/src/admin/auth/adminAuthTypes.ts`                                | Modify                        | 1   | `\| "CONCURRENT_MODIFICATION"` (1 line)                                                                                                              |
| `apps/api/src/admin/auth/adminAuthMiddleware.ts`                           | Modify                        | 1   | One message entry (E1, exhaustive record)                                                                                                            |
| `apps/api/src/admin/auth/adminAuthRoutes.ts`                               | Modify                        | 1   | `CONCURRENT_MODIFICATION: 409`; `statusMap` typed `Partial<Record<AuthErrorCode, number>>`                                                           |
| `apps/api/src/infrastructure/repositories/PrismaAdminSessionRepository.ts` | Modify                        | 1   | JSDoc classification of `updateRefreshTokenHash` (E3)                                                                                                |
| `apps/api/tests/integration/adminPasswordResetClaim.integration.test.ts`   | Create                        | 1   | Reset racer (from zero)                                                                                                                              |
| `apps/api/tests/integration/adminRefreshRotationClaim.integration.test.ts` | Create                        | 1   | Refresh racer                                                                                                                                        |
| `apps/api/tests/unit/helpers/statefulAdminUserPrismaFake.ts`               | Create                        | 1   | D5 fake                                                                                                                                              |
| `apps/api/tests/unit/admin/auth/PasswordService.test.ts`                   | Create                        | 1   | Unit tier (a)                                                                                                                                        |
| `apps/api/tests/unit/authService.test.ts`                                  | Modify                        | 1   | Rotation cases + Redis-ordering cases (b) + D9 same-tick uniqueness case                                                                             |
| `apps/api/tests/auth.test.ts`                                              | Modify                        | 1   | Delete the 1 s sleep + its comment at `:286-287` (DF-7); the `notEqual` at `:294` becomes the no-sleep integration pin of D9                         |
| `apps/api/scripts/run-tests.sh`                                            | Modify                        | 1   | One batch naming both racers                                                                                                                         |
| `CLAUDE.md`                                                                | Modify                        | 2   | #41 block; "40 checks, numbered #1-#40" → 41                                                                                                         |
| `.github/workflows/fitness.yml`                                            | Modify (sensitive-edit token) | 2   | #41 step after #40; summary "40 architectural invariants (#1-#40)" → 41                                                                              |
| `openspec/config.yaml`                                                     | Modify                        | 2   | N8: `:21-22` "40 CI fitness functions" → 41; `:62` "(#1-#40)" → `#1-#41`; `:86` "all 40 fitness functions" → 41 — three lines, the gate's own commit |
| `docs/security/SECURITY_CANON.md`                                          | Modify                        | 2   | "How to extend" companion bullet: `#41` single-use claim shape                                                                                       |
| `docs/reports/roadmap-detected-smells-backlog.md`                          | Modify at close               | 2   | SMELL-97 DONE; rows 110-115 born; the design-found rows below                                                                                        |

## Interfaces / Contracts

```ts
// adminAuthTypes.ts — one member appended to AuthErrorCode
| "CONCURRENT_MODIFICATION";   // a concurrent password write moved the row; the token is still live — retry
// adminAuthRoutes.ts:340
const statusMap: Partial<Record<AuthErrorCode, number>> = {
  INVALID_TOKEN: 400, PASSWORD_TOO_WEAK: 400, PASSWORD_REUSED: 400, CONCURRENT_MODIFICATION: 409,
};
// adminAuthMiddleware.ts:90 — CONCURRENT_MODIFICATION: "Concurrent modification, retry the request",
// authTypes.ts — TokenPayload gains: jti?: string;   // per-mint id on refresh tokens (D9)
```

The `run-tests.sh` batch (fitness #30: each file named by exactly one `run_batch`):

```bash
# Admin single-use claim proofs (SMELL-97). DB-only: the reset suite drives
# PasswordService over the seed client and the refresh suite drives the real
# AuthService over real adapters — no live server, and no Redis on purpose: the
# rotation CAS is the subject, so the Redis blacklist stays structurally absent.
# ONE batch at CONCURRENCY=1: both suites race the SAME credential on purpose
# (staggered + simultaneous pairs) and a sibling suite sharing the runner would
# make which statement won ambiguous, which is the only thing those cases measure.
CONCURRENCY=1 run_batch "integration:admin-single-use-claims" \
  tests/integration/adminPasswordResetClaim.integration.test.ts \
  tests/integration/adminRefreshRotationClaim.integration.test.ts
```

## Testing Strategy

| Tier                                                                                                                            | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Approach                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Integration — reset racer (4 MFA layers: adapter-level claim, service simultaneous, service STAGGERED, refusal-changes-nothing) | staggered pair (D6 seam) → exactly one ok; simultaneous `Promise.all` pair with DISTINCT passwords → one ok; sequential replay → `INVALID_TOKEN`; stored hash verifies against the winner's password ONLY (both directions, the customer precedent); token columns null; row after loser deep-equals row after winner; `onSecurityEvent` spy fired once; sessions revoked once. Non-consuming: weak → `PASSWORD_TOO_WEAK`, reused (history seeded with the new password's hash) → `PASSWORD_REUSED`, expired (`passwordResetExpires` in the past) → `INVALID_TOKEN` with token columns intact; inactive owner with `lockedUntil` set → `INVALID_TOKEN`, lockout AND token intact; history moved while gated (direct `adminUser.update` appending to history; token live) → `CONCURRENT_MODIFICATION`, token intact, retry succeeds. Fixtures: `createSeedPrismaClient()`, `assertSeedChannelConfigured()` at module scope, `role.upsert({ where: { name: "ADMIN" } })` (backfill-suite recipe), per-case admin with a REAL argon2id `passwordHash`, `randomUUID()` token, +1h expiry; cleanup per case | RED on `19fb9e6a`: two oks (asserted on stored state, never call shape)                                                         |
| Integration — refresh racer                                                                                                     | `AuthService` built as `auth.test.ts:22-39` (real adapters); `registerAdmin` + `login` yield the token; loser over the D6-wrapped client; login and race run inside one second by construction (no sleep) — the case D9 makes sound. Staggered + simultaneous: exactly one ok; loser `TOKEN_BLACKLISTED`; recorded loser `count === 0`; stored hash = `hashRefreshToken(winner.refreshToken)` and ≠ presented; row after loser deep-equals row after winner; **loser's pair in no row**: the racer wraps `core.generateTokens` to RECORD every minted refresh token (values, not call counts) and asserts the hash of each non-winner mint matches no `adminSession` row — satisfiable only because D9 makes mints distinct; sequential replay refused (`!ok`, code observed = `SESSION_EXPIRED` without Redis — named in the assertion message); winner's new pair rotates normally. Redis absent by construction (E6)                                                                                                                                                                                | RED on `19fb9e6a`: two oks                                                                                                      |
| Integration — `auth.test.ts` (existing)                                                                                         | Delete the 1 s sleep and its comment at `:286-287`; the `notEqual(new, old)` at `:294` now pins D9 with no timing dependence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | RED on `19fb9e6a` whenever login and refresh share a second (the sleep's reason for existing); GREEN deterministically after D9 |
| Unit — `PasswordService.test.ts` over the D5 fake                                                                               | success (count 1: token null, history = prior + previous hash, lock cleared, event once, sessions revoked); **history guard (F6)**: fake seeded with `passwordHash: ""` and `passwordHistory: ["", "$h1"]` → stored history holds `$h1` only, no `""` entry, and the CAS predicate carried the UNFILTERED read snapshot; unknown/expired/inactive token → `INVALID_TOKEN` with `updateMany` never called and row byte-equal; inactive+locked → lockout intact; weak/reused → no write; count-0 with token nulled by a post-read hook → `INVALID_TOKEN`; count-0 with history moved (hook) → `CONCURRENT_MODIFICATION`, second call succeeds; count-0 with `passwordHash` moved alone (E2 hook) → `CONCURRENT_MODIFICATION`; owner deactivated after the read → `INVALID_TOKEN`; fake's failing-write hook → `INTERNAL_ERROR` logged, token intact; no event/revocation on any refusal                                                                                                                                                                                                                  | Strict TDD RED first; coverage floor 85 (config)                                                                                |
| Unit — `authService.test.ts` rotation + D9                                                                                      | rotation stores the new hash; replay refused; count-0 via a `findUnique.mockImplementationOnce` hook that rewrites the stored hash (the concurrent writer) → `TOKEN_BLACKLISTED`, HIGH audit written, stored hash untouched; session deactivated by the hook → `TOKEN_BLACKLISTED`; Redis-ordering with a recording double (D6): no `setex` under `TOKEN_BLACKLIST_PREFIX` on count 0, exactly one on success; **D9 uniqueness**: two `generateTokens` calls for one payload in the same tick (no await between them) → distinct `refreshToken`, distinct `hashRefreshToken`, each `jwt.decode(...).jti` a UUID — RED on `19fb9e6a` deterministically (identical strings)                                                                                                                                                                                                                                                                                                                                                                                                                              | RED first                                                                                                                       |
| Gate                                                                                                                            | #41 measured 0 on the fixed tree; red proof per the protocol below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | before the yml mirror                                                                                                           |

Racer seam sketch (test-local, no production hook):

```ts
function gateConsumingWrites(prisma: PrismaClient, gate: Promise<void>) {
  let signal = (): void => {};
  const preClaimReadDone = new Promise<void>((r) => {
    signal = r;
  });
  const writes: Array<{ op: string; count: number | null }> = [];
  const real = prisma.adminUser;
  const client = {
    adminUser: {
      findFirst: async (a: unknown) => {
        const row = await real.findFirst(a as never);
        signal();
        return row;
      },
      findUnique: (a: unknown) => real.findUnique(a as never),
      update: async (a: unknown) => {
        await gate;
        const r = await real.update(a as never);
        writes.push({ op: "update", count: null });
        return r;
      },
      updateMany: async (a: unknown) => {
        await gate;
        const r = await real.updateMany(a as never);
        writes.push({ op: "updateMany", count: r.count });
        return r;
      },
    },
    adminSession: prisma.adminSession,
  } as unknown as PrismaClient;
  return { client, preClaimReadDone, writes };
}
```

The refresh variant wraps `adminSession` (`findUnique` signals; `update`/`updateMany` gate) and passes `adminUser` through.

## Gate — fitness #41 exact text for `CLAUDE.md`

```bash
# 41. Single-use claim shape. An ALLOWLIST-by-shape gate in the #28/#40 form, and the
# CLASS gate the admin reset/rotation slice (SMELL-97) owes: a Prisma write whose `data`
# carries a CONSUMPTION MARKER for a single-use credential must name that credential's
# prior state in the SAME call's `where`.
#
# Threat, in one line: a consuming write that does not name the credential it consumes lets
# two callers consume it once each. Keyed on `{ id }` alone the write matches whether or not
# the credential still exists — EvalPlanQual re-checks only the columns the WHERE names, and
# `id` is never contested — so two presentations of ONE token both pass the read and both
# write, and the last writer owns the account. Named, the write is a compare-and-swap the
# database serialises, and `count` is the verdict.
#
# POPULATION, measured when the gate landed: 8 marker sites = 7 claim sites + 1 named issuance
# exception. Of the 7 claims, 2 were unsound before this gate's slice and 0 after —
# PasswordService.confirmPasswordReset and authServiceSession.refreshTokens are the two it
# converted; the customer reset claim and the four MFA claims were already sound. SITE_FLOOR
# holds that population: the floor may fall and must never rise — it falls only with the
# deliberate removal of a site, never to absorb a new violation.
# ALLOWLIST by shape: the dangerous set is open-ended, the admissible shape is one sentence.
# MARKERS are the literal `data` forms that consume a credential today:
#   passwordResetToken: null     admin reset consumed
#   resetToken: null             customer reset consumed
#   mfaBackupUsedAt: <value>     backup-code used-map extended (`{}` is a re-enrolment
#                                RESET, excluded by the lookahead)
#   mfaLastUsedTotpStep: <value> TOTP step advanced
#   refreshTokenHash <: , }>     refresh token rotated — the property-shorthand form
#                                `{ refreshTokenHash }` is matched too, so a rotation
#                                is never exempt by syntax
# STRUCTURAL, not line-windowed: each `.update(` / `.updateMany(` / `.upsert(` call's argument
# is sliced to its balanced close (the #36 string/comment-aware slicer); the `data:` literal
# (`update:` for upsert) is tested for a marker, whose column must then appear as a key in
# that SAME call's `where:` literal. A `select:` cannot satisfy the gate — a line window could
# not tell the two apart.
# NAMED EXCEPTION, exactly one, held to exactly ONE site so a second write in that file fails
# closed: PrismaAdminSessionRepository.updateRefreshTokenHash is the second step of session
# ISSUANCE — createSession inserts a throwaway hash nobody holds, mints the JWT that embeds
# the new session id, then swaps the real hash in — so no presented credential is consumed.
# Remove-when: the session id is minted before the insert and the final hash written on create.
# OUT OF CLASS by decision, not oversight — writes this gate is silent on, and why: idempotent
# session revocations (`isActive: false` keyed on `isActive: true`; revoking twice is one
# state); the outbox work-item lease (a lease, not a credential); the customer refresh flow (a
# stateless JWT with NO server-side consumption marker — SMELL-113's subject, not a marker
# site); the SECOND admin refresh flow (`AdminAuthService.refreshToken`, the ADMIN_JWT_*/
# TokenService family: compares the stored hash and issues only a new ACCESS token — it never
# rotates, so there is no consuming write for this gate to see; its lifetime-of-token
# non-rotation is its own backlog row, the admin twin of SMELL-113); and the admin reset
# ISSUANCE that writes the "CHANGE_REQUIRED" sentinel (an issuance, not a consumption —
# SMELL-110).
# FAIL-CLOSED: a missing scope directory, fewer than SITE_FLOOR marker sites, or an exception
# count other than 1 is a blind scan, not a clean one — exit 1. SCOPE: apps/api/src
# apps/workers/src packages infra/prisma/src, *.ts, minus node_modules/dist/tests/generated/
# .stryker. infra/prisma/scripts is OUT by path: the backfill's `data: { passwordResetToken:
# null }` keyed on id is the `migration` canon-exception scenario (a one-off over rows it
# selected itself), and so is every future script there — stated, not hidden.
# RESIDUAL LIMITS, stated rather than implied. (1) Textual, not a type-checker: `data` or
# `where` passed by identifier, spread, or built by a helper is invisible — the generic
# `update(id, data)` helpers on the admin-user and MFA adapters are exactly that shape; a claim
# routed through one must be enrolled by hand. (2) The gate proves the column is NAMED in
# `where`, not that the predicate is right (`refreshTokenHash: { not: null }` would pass); the
# racers own the predicate. (3) The marker list is enumerated, not derived from the schema —
# "single-use" is not a schema property — so a NEW credential column is invisible until its
# marker is added (the How-to-extend step). (4) Cache-backed consumption (`OAuthFlowStore.
# consume`, a read-then-delete outside Prisma) and raw SQL (fitness #23's domain, itself blind
# to tagged templates — SMELL-111) are outside. (5) `upsert`'s `create` arm is not checked:
# creation issues, never consumes. (6) The slicer keeps string-literal bytes and knows no regex
# literals: a marker inside a string is a false positive it does not filter, and a regex
# literal with an unbalanced brace or quote inside a write call mis-slices that call — at a
# marker site the site is dropped, which the floor turns into exit 1 (fail-closed); neither
# exists in scope today. (7) Line-window matching is NOT a limit here: the #38 form pairs
# `data` and `where` inside a bounded window and misses a call whose halves sit further apart;
# this gate slices the whole argument, so that residual is eliminated and (6) replaces it.
# Hard-zero.
set -uo pipefail
for d in apps/api/src apps/workers/src packages infra/prisma/src; do
  [ -d "$d" ] || { echo "fitness #41 scope error: '$d' does not exist — the scan would skip it silently and print 0."; exit 1; }
done
VIOLATIONS=$(node --input-type=module <<'EOF'
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

const SCOPE = ["apps/api/src", "apps/workers/src", "packages", "infra/prisma/src"];
const SKIP = /(^|\/)(node_modules|dist|tests|generated|\.stryker[^/]*)\//;
const MARKERS = [
  { column: "passwordResetToken", re: /\bpasswordResetToken\s*:\s*null\b/ },
  { column: "resetToken", re: /\bresetToken\s*:\s*null\b/ },
  { column: "mfaBackupUsedAt", re: /\bmfaBackupUsedAt\s*:\s*(?!\{\s*\})/ },
  { column: "mfaLastUsedTotpStep", re: /\bmfaLastUsedTotpStep\s*:/ },
  { column: "refreshTokenHash", re: /\brefreshTokenHash\s*[:,}]/ },
];
const SITE_FLOOR = 8;
const EXCEPTION = {
  file: "apps/api/src/infrastructure/repositories/PrismaAdminSessionRepository.ts",
  column: "refreshTokenHash",
};
// Slice from `open` at `from` to its balanced `close`, dropping comment bytes and
// skipping brackets inside string/template literals (the #36 slicer, generalised).
const sliceBalanced = (src, from, open, close) => {
  let depth = 0;
  let i = from;
  let body = "";
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      body += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === open) depth += 1;
    if (c === close && --depth === 0) return body + c;
    body += c;
    i += 1;
  }
  return null;
};
const literalOf = (args, key) => {
  const m = new RegExp(`(^|[{,\\s])${key}\\s*:\\s*\\{`).exec(args);
  return m === null ? null : sliceBalanced(args, m.index + m[0].length - 1, "{", "}");
};
const files = [];
for (const dir of SCOPE) {
  for await (const f of glob("**/*.ts", { cwd: dir })) {
    const path = `${dir}/${f}`;
    if (!SKIP.test(path) && !path.endsWith(".test.ts")) files.push(path);
  }
}
files.sort();
let sites = 0;
let exceptionHits = 0;
const violations = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const call = /\.(update|updateMany|upsert)\s*\(/g;
  let m;
  while ((m = call.exec(src)) !== null) {
    const args = sliceBalanced(src, m.index + m[0].length - 1, "(", ")");
    if (args === null) continue;
    const data = literalOf(args, m[1] === "upsert" ? "update" : "data");
    if (data === null) continue;
    const line = src.slice(0, m.index).split("\n").length;
    for (const { column, re } of MARKERS) {
      if (!re.test(data)) continue;
      sites += 1;
      if (file === EXCEPTION.file && column === EXCEPTION.column) {
        exceptionHits += 1;
        continue;
      }
      const where = literalOf(args, "where");
      if (where === null) {
        violations.push(`${file}:${line}: ${column} consumed in data, and the call has no where literal to name it`);
        continue;
      }
      if (!new RegExp(`\\b${column}\\s*:`).test(where)) {
        violations.push(`${file}:${line}: ${column} consumed in data but not named in where`);
      }
    }
  }
}
if (sites < SITE_FLOOR) {
  console.error(`fitness #41 scope error: ${sites} marker sites found against a floor of ${SITE_FLOOR} — a marker was renamed, a claim moved out of scope, or the scan stopped matching. Failing closed rather than reporting a clean zero over code it never read.`);
  process.exit(1);
}
if (exceptionHits !== 1) {
  console.error(`fitness #41 scope error: the named exception matched ${exceptionHits} site(s) in ${EXCEPTION.file}; it covers exactly one issuance write. A second write there is not covered by its reasoning, and zero means the site moved — delete the exception with it.`);
  process.exit(1);
}
console.log(violations.join("\n"));
EOF
) || { echo "fitness #41: the scan crashed or the scope is invalid — failing closed (needs node >= 22 for fs.glob)"; exit 1; }
COUNT=$(printf "%s" "$VIOLATIONS" | grep -c . || true)
COUNT=${COUNT:-0}
echo "$COUNT"   # expect 0
```

Companion edits in `CLAUDE.md`: "There are **40 checks, numbered #1-#40**" → 41 / `#1-#41`; the #41 line joins the companion lists in `SECURITY_CANON.md` "How to extend" (`#41` single-use claim shape) — one bullet (PR 2).

**`fitness.yml` mirror plan (the slice's one `omnipost-allow sensitive-edit` token).** A new step after #40 (`:1367-1452`), before "Fitness summary":

```yaml
- name: "#41 Single-use claim shape: a consumption marker in data names its credential in where"
  if: always()
  run: |
    # Mirrors CLAUDE.md #41. <the comment block above, pasted, re-indented>
    set -uo pipefail
    for d in ...; do ... echo "::error title=Fitness #41 scope error::..."; exit 1; }; done
    VIOLATIONS=$(node --input-type=module <<'EOF'
    <the node script above, byte-identical modulo the 10-space YAML indent>
    EOF
    ) || { echo "::error title=Fitness #41 scan error::the scan crashed or the scope is invalid — failing closed (needs node >= 22 for fs.glob)"; exit 1; }
    COUNT=$(printf "%s" "$VIOLATIONS" | grep -c . || true)
    COUNT=${COUNT:-0}
    echo "Fitness #41: $COUNT violations (expect 0)"
    if [ "$COUNT" -gt 0 ]; then
      echo "::error title=Fitness #41 violation::$COUNT single-use claim(s) consume a credential in data without naming it in where. A write keyed on id alone lets two presentations of one token both succeed (the SMELL-97 TOCTOU). Name the credential's prior state in the same call's where so the database serialises the claim and count is the verdict."
      printf "%s\n" "$VIOLATIONS"
      exit 1
    fi
```

Every `::error` pairs with an `exit 1` in the same step (fitness #34). Summary step `:1459`: "41 architectural invariants (#1-#41)". Drift check at verify: extract the heredoc body from both files (`sed -n "/^# 41\./,/^EOF$/p" CLAUDE.md` vs the step's range in the yml), strip leading whitespace per line (`sed 's/^[[:space:]]*//'`), `diff` → empty.

**Red-proof protocol (apply-time; the orchestrator executes, output recorded in the change):**

1. `cp apps/api/src/admin/auth/PasswordService.ts "$SCRATCH/PasswordService.orig"`; plant: reduce the claim's `where` to `where: { id: user.id },`.
2. Run the CLAUDE.md #41 block from the repo root → expected stdout ends with `1` and the line `apps/api/src/admin/auth/PasswordService.ts:<n>: passwordResetToken consumed in data but not named in where`. Run the yml step body via `bash -c` → expected exit code 1 with the `::error title=Fitness #41 violation::` line.
3. Restore: `cp "$SCRATCH/PasswordService.orig" apps/api/src/admin/auth/PasswordService.ts && cmp "$SCRATCH/PasswordService.orig" apps/api/src/admin/auth/PasswordService.ts` → exit 0. Re-run → `0`.
4. Repeat 1-3 on `authServiceSession.ts` with `where: { id: session.id },` → `1` naming `refreshTokenHash`; restore; `0`.
5. Floor plant: in `PrismaCustomerUserRepository.ts:226` rename `resetToken: null` to `resetTokenX: null` → expected `fitness #41 scope error: 7 marker sites ... floor of 8`, exit 1; restore, `cmp`, `0`.
6. Exception plant: duplicate the `updateRefreshTokenHash` write once inside the same file → expected exception-count scope error, exit 1; restore, `cmp`, `0`.

## The `$on('query')` EPQ capture — specification v3 (positive controls; the orchestrator executes at the design gate)

Purpose: the reset claim is the FIRST claim filtering on a non-unique, non-indexed column with a scalar-list `equals` in the predicate; the MFA capture (JSONB `equals`, `OR`/`lt`) does not cover it. **v3 (F3):** the v1/v2 probes named ids that do not exist, so `count = 0` proved zero-mutation and nothing about MATCHING — and the trap is total for the empty case: `passwordHistory String[] @default([])` (`schema.prisma:189`) means every new admin's FIRST reset carries an empty snapshot; had the emitted empty-equals predicate failed to match a real `'{}'` row, every first reset would have returned `CONCURRENT_MODIFICATION` forever while the capture still accepted. v3 seeds a real row (its own role, admin and session, deleted in `finally` with a residue check) and adds POSITIVE and NEGATIVE count controls; every capture is still held to the SQL-shape rules.

Location and run: the script is a probe, never committed. Run 2 executed it from the session scratchpad with the generated client resolved by absolute path (a declared, benign deviation); v3 keeps that recipe. If placed inside the repo instead, use `infra/prisma/.probe-reset-claim-sql.mts` (untracked; `infra/prisma` declares `@prisma/adapter-pg` directly) and delete it afterwards — `git status --porcelain` must show it gone.

```bash
cd /root/omni-post/infra/prisma && node --import tsx --env-file=/root/omni-post/.env.test <path-to-probe>.mts
```

```ts
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client/client.js";
import { PG_SESSION_OPTIONS } from "./src/client.js";

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL (or MIGRATE_DATABASE_URL) is required");

// Layer 2 (cross-check): record every SQL string handed to the driver adapter — on the
// connection AND on the Transaction returned by `startTransaction()`, which is where Prisma
// issues every write. Run 1 wrapped the connection only and recorded 0 statements (erratum 1).
type AnyFn = (...args: unknown[]) => unknown;
const driverSql: string[] = [];
const recordQueries = <T extends object>(target: T): T =>
  new Proxy(target, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (typeof v !== "function") return v;
      if (p === "executeRaw" || p === "queryRaw") {
        return (q: { sql: string }) => {
          driverSql.push(`${String(p)}: ${q.sql}`);
          return (v as AnyFn).call(t, q);
        };
      }
      if (p === "startTransaction") {
        return async (...a: unknown[]) => recordQueries((await (v as AnyFn).apply(t, a)) as object);
      }
      return (v as AnyFn).bind(t);
    },
  });
const factory = new PrismaPg({ connectionString: url, options: PG_SESSION_OPTIONS });
const recording = new Proxy(factory, {
  get(t, p, r) {
    const v = Reflect.get(t, p, r);
    if (p !== "connect" || typeof v !== "function") return v;
    return async (...a: unknown[]) => recordQueries((await (v as AnyFn).apply(t, a)) as object);
  },
});

// Layer 1 (primary, documented API): query events.
const events: string[] = [];
const prisma = new PrismaClient({ adapter: recording, log: [{ emit: "event", level: "query" }] });
prisma.$on("query", (e) => events.push(`${e.query}\n   -- params ${e.params}`));

const failures: string[] = [];
const must = (cond: boolean, msg: string): void => {
  if (!cond) failures.push(msg);
};
// `$on('query')` delivery is asynchronous; without a short flush, events smear across capture
// windows and read as a REJECT (run 2 measured this — a measurement artifact, not a decomposition).
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

async function capture(label: string, run: () => Promise<{ count: number }>): Promise<number> {
  events.length = 0;
  driverSql.length = 0;
  const { count } = await run();
  await flush();
  // "One DATA statement": the UPDATE. Prisma also emits BEGIN/COMMIT events for a write
  // (erratum 2 — the MFA precedent accepted the same pair); they are listed, not counted.
  const data = events.filter((e) => !/^(BEGIN|COMMIT)\b/.test(e));
  console.log(
    `\n### ${label}  (count=${count}, data statements=${data.length}, driver statements=${driverSql.length})`
  );
  for (const e of events) console.log(e);
  for (const s of driverSql) console.log(s);
  const stmt = data[0] ?? "";
  must(data.length === 1, `${label}: expected ONE data statement, saw ${data.length}`);
  must(
    /^UPDATE "public"\."Admin(User|Session)" SET /.test(stmt),
    `${label}: not a single plain UPDATE`
  );
  must(
    / WHERE \(/.test(stmt) && !/SELECT/.test(stmt) && !/@>|<@|&&/.test(stmt),
    `${label}: WHERE is not a bound-equality compare-and-swap`
  );
  must(
    driverSql.some((s) => s.includes('UPDATE "public"."Admin')),
    `${label}: layer 2 recorded no UPDATE — the transaction hop is not wrapped`
  );
  return count;
}

const tag = `probe-reset-claim-${randomUUID()}`;
const hour = 3_600_000;
const H = (s: string): string => `$argon2id$${s}`;
const token1 = randomUUID();
const role = await prisma.role.create({ data: { name: tag } });
const user = await prisma.adminUser.create({
  data: {
    email: `${tag}@probe.invalid`,
    name: "probe",
    roleId: role.id,
    passwordHash: H("prior"),
    passwordResetToken: token1,
    passwordResetExpires: new Date(Date.now() + hour),
    passwordHistory: [],
  },
});
const H0 = "0".repeat(64);
const H1 = "1".repeat(64);
const session = await prisma.adminSession.create({
  data: { userId: user.id, refreshTokenHash: H0, expiresAt: new Date(Date.now() + hour) },
});

try {
  const resetData = (next: string) => ({
    passwordHash: H(next),
    passwordHashAlgo: "argon2id",
    passwordChangedAt: new Date(),
    passwordResetToken: null,
    passwordResetExpires: null,
    mustChangePassword: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lockReason: null,
  });
  const claim = (token: string, hash: string, snapshot: string[], written: string[]) =>
    prisma.adminUser.updateMany({
      where: {
        id: user.id,
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
        isActive: true,
        passwordHash: hash,
        passwordHistory: { equals: snapshot },
      },
      data: { ...resetData("next"), passwordHistory: written },
    });
  const arm = (token: string, hash: string, history: string[]) =>
    prisma.adminUser.update({
      where: { id: user.id },
      data: {
        passwordResetToken: token,
        passwordResetExpires: new Date(Date.now() + hour),
        passwordHash: H(hash),
        passwordHistory: history,
      },
    });
  const row = () => prisma.adminUser.findUniqueOrThrow({ where: { id: user.id } });
  const sessionRow = () => prisma.adminSession.findUniqueOrThrow({ where: { id: session.id } });

  // P1 — POSITIVE, the empty case: a TRUE empty snapshot against a real '{}' row MUST match.
  let c = await capture("P1 reset claim, TRUE EMPTY history snapshot (real row)", () =>
    claim(token1, H("prior"), [], [H("prior")])
  );
  must(
    c === 1,
    "P1: `equals: []` did NOT match a real '{}' row — every first reset would be CONCURRENT_MODIFICATION (contingency: isEmpty arm)"
  );
  const after1 = await row();
  must(
    after1.passwordResetToken === null && after1.passwordHistory.length === 1,
    "P1: count 1 but the data was not applied"
  );

  // P2 — POSITIVE, two-entry snapshot.
  const token2 = randomUUID();
  await arm(token2, "prior2", [H("a"), H("b")]);
  c = await capture("P2 reset claim, TRUE two-entry history snapshot", () =>
    claim(token2, H("prior2"), [H("a"), H("b")], [H("a"), H("b"), H("prior2")])
  );
  must(c === 1, "P2: a true two-entry snapshot did not match");

  // P3 — NEGATIVE: the row holds [a, b]; the snapshot says [a] (a concurrent history move).
  const token3 = randomUUID();
  await arm(token3, "prior3", [H("a"), H("b")]);
  const before3 = JSON.stringify(await row());
  c = await capture("P3 reset claim, MOVED history snapshot", () =>
    claim(token3, H("prior3"), [H("a")], [H("a"), H("prior3")])
  );
  must(c === 0, "P3: a moved history snapshot matched — the predicate is not a compare-and-swap");
  must(
    JSON.stringify(await row()) === before3,
    "P3: a refused claim touched the row (updatedAt included)"
  );

  // P4 — NEGATIVE: history true, passwordHash moved alone (E2 — the login rehash).
  const before4 = JSON.stringify(await row());
  c = await capture("P4 reset claim, MOVED passwordHash snapshot", () =>
    claim(token3, H("stale"), [H("a"), H("b")], [H("a"), H("b"), H("stale")])
  );
  must(c === 0, "P4: a moved passwordHash matched");
  must(JSON.stringify(await row()) === before4, "P4: a refused claim touched the row");

  // S1 — POSITIVE: rotation CAS with the TRUE prior hash. S2 — NEGATIVE: the same hash replayed.
  const rotate = (presented: string) =>
    prisma.adminSession.updateMany({
      where: { id: session.id, refreshTokenHash: presented, isActive: true },
      data: { refreshTokenHash: H1, expiresAt: new Date(Date.now() + hour) },
    });
  c = await capture("S1 rotation CAS, TRUE prior hash", () => rotate(H0));
  must(c === 1, "S1: the true prior hash did not match");
  const s1 = JSON.stringify(await sessionRow());
  must(JSON.parse(s1).refreshTokenHash === H1, "S1: count 1 but the hash was not rotated");
  c = await capture("S2 rotation CAS, REPLAYED prior hash", () => rotate(H0));
  must(c === 0, "S2: a replayed hash matched — rotation is not a claim");
  must(JSON.stringify(await sessionRow()) === s1, "S2: a refused rotation touched the row");
} finally {
  await prisma.adminSession.deleteMany({ where: { userId: user.id } });
  await prisma.adminUser.delete({ where: { id: user.id } });
  await prisma.role.delete({ where: { id: role.id } });
  const residue =
    (await prisma.adminUser.count({ where: { email: { startsWith: "probe-reset-claim-" } } })) +
    (await prisma.role.count({ where: { name: { startsWith: "probe-reset-claim-" } } }));
  console.log(`\nresidue rows: ${residue}`);
  must(residue === 0, `cleanup left ${residue} probe row(s)`);
  await prisma.$disconnect();
}
if (failures.length > 0) {
  console.error(`\nREJECT\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nACCEPT: every shape rule and every count control holds");
```

Decision rules v3 (the script enforces them and exits 1 on any miss; the orchestrator reads the verdict from the exit code AND the printed statements — never from prose):

- **SHAPE, every capture (P1-P4, S1-S2):** exactly ONE DATA statement — the `UPDATE` (the BEGIN/COMMIT events Prisma emits around a write are listed, not counted: erratum 2); it begins `UPDATE "public"."AdminUser" SET` (or `"AdminSession"`); it contains ` WHERE (`; every predicate column is an equality/comparison against a bound parameter — `"id" = $n`, `"passwordResetToken" = $n`, `"passwordResetExpires" > $n`, `"isActive" = $n`, `"passwordHash" = $n`, `"passwordHistory" = $n` (an `= ARRAY[...]`/`::text[]` cast spelling is equivalent; for the EMPTY snapshot `= $n` with `[]` or `'{}'` bound); no `SELECT`, no `IN (SELECT`, no containment operator (`@>`, `<@`, `&&`). Layer 1 (query events) and layer 2 (driver adapter, transaction hop wrapped — erratum 1) must agree on the statement.
- **POSITIVE controls (P1, P2, S1):** `count === 1` AND the readback shows the data applied (token columns null / hash rotated). P1 alone decides the empty case.
- **NEGATIVE controls (P3, P4, S2):** `count === 0` AND the readback row is byte-equal to the pre-probe row, `updatedAt` included (a refused `updateMany` touches nothing — run 2 verified zero rows affected).
- **ACCEPT** iff every rule holds and the residue check prints 0. **REJECT (STOP, report to the orchestrator; the design gate consumes this)** on any miss.
- **Contingency, only if P1 alone fails its count rule** (the emitted empty-equals predicate does not match a real `'{}'` row): the empty arm becomes `passwordHistory: snapshot.length === 0 ? { isEmpty: true } : { equals: snapshot }`. Measured spelling (erratum 3): `isEmpty: true` compiles to the INLINED literal `"passwordHistory" = '{}'` — not a bound parameter and not `cardinality(...) = 0`; same semantics, still one UPDATE, still a CAS for the empty state. Re-run P1; a second miss is a STOP. Blueprint (a) gains that branch ONLY if the contingency fires.

### Capture results — run 2 (executed 2026-09-12, orchestrator-run, Prisma 7.9.1 + @prisma/adapter-pg against omnipost-infra): SHAPE ACCEPT

All three v1 captures (nonexistent ids) pass the shape rules; the `isEmpty` contingency was exercised for the record but is NOT consumed. Full verbatim logs: scratchpad `capture-output.txt` (script as written) and `capture-output-v2.txt` (layer-2 repaired, the authoritative run). The deciding statements, verbatim:

```
UPDATE "public"."AdminUser" SET ... WHERE ("public"."AdminUser"."id" = $12 AND "public"."AdminUser"."passwordResetToken" = $13 AND "public"."AdminUser"."passwordResetExpires" > $14 AND "public"."AdminUser"."isActive" = $15 AND "public"."AdminUser"."passwordHash" = $16 AND "public"."AdminUser"."passwordHistory" = $17)
-- params [..., "$argon2id$prior", []]  (two-entry-history variant binds ["$argon2id$a","$argon2id$b"])

UPDATE "public"."AdminSession" SET "refreshTokenHash" = $1, "expiresAt" = $2 WHERE ("public"."AdminSession"."id" = $3 AND "public"."AdminSession"."refreshTokenHash" = $4 AND "public"."AdminSession"."isActive" = $5)
```

One data statement per write, every predicate column bound as a parameter, no preceding `SELECT`, no `IN (SELECT`, no containment operator, `count = 0` on non-existent probe rows (zero-mutation; DB left as found). The scalar-list `equals` compiles to a single bound-array equality. `updateMany` on the `@unique` rotation column did NOT decompose into findUnique+update. **What run 2 does NOT prove (F3):** that `"passwordHistory" = $17` with `[]` bound MATCHES a real `'{}'` row, nor that a moved snapshot fails to match — v3's controls P1-P4/S1-S2 own that; the design gate consumes v3.

Blueprint notes from run 2 (for apply): the `AdminUser` claim UPDATE also sets `"updatedAt"` (`@updatedAt`); `AdminSession` has no such column — racer assertions on "no column changed" must account for `updatedAt` on refused claims NOT being touched (count-0 → no write at all, verified). Execution deviations, declared and benign: the probe ran from the session scratchpad (never inside the repo) resolving the generated client by absolute path; the 60 ms flush after each call is folded into v3.

**Capture results — v3**: _pending — the orchestrator runs v3 under the rules above and appends the exit code and the six captures' verbatim statements and counts here before the tasks phase._

### Environment finding (orchestrator disposition, outside this change)

`CLAUDE.md §Environment Setup`'s `postgresql://postgres:password123@localhost:5432/omnipostdb` is STALE for this dev box — no local listener; `pnpm db:up` is a reachability preflight against the `omnipost-infra` LXC, not a docker-compose bring-up. Fixing root CLAUDE.md needs a sensitive-edit token; disposition: docs micro-fix flagged to Edward, not this slice.

## Sequencing (strict TDD; the gate lands with-or-after both fixes)

1. Racers + batch wiring → run the batch on `19fb9e6a` → RED by two successes (record).
2. D5 fake + `PasswordService.test.ts` → RED → implement (a) + the three-file code → GREEN → reset racer GREEN.
3. `authService.test.ts` D9 uniqueness case → RED (identical strings) → implement D9 (`authServiceCore.ts` + `authTypes.ts`) → GREEN; delete the `auth.test.ts:286-287` sleep (DF-7). Then the rotation and Redis-ordering cases → RED → implement (b) → GREEN → refresh racer GREEN.
4. #41 in `CLAUDE.md` → measured `0` → red-proof protocol → `fitness.yml` mirror under the token → drift diff empty.
5. Close, in the gate's commit (PR 2): count sentences (`CLAUDE.md`, `fitness.yml` summary), `openspec/config.yaml` 40 → 41 at `:21-22`, `:62`, `:86` (N8 — this change's apply task, not the orchestrator's earlier staleness fix, which took the file from "#1-#26" to "#1-#40"), `SECURITY_CANON` companion bullet, backlog rows.

## Threat Matrix

All five rows N/A. Documentation-like paths: the gate reads `*.ts` sources with `readFileSync` and executes nothing it reads. Git repository selection / commit state / push state / PR commands: the change adds no git or PR automation — the check runs from the repo root as every fitness step does, and the red-proof protocol uses `cp`/`cmp`, never git (git stays with the orchestrator). The one shell boundary is the CI step itself: fixed argv, paths from `fs.glob` over four literal directories, violation lines emitted through `printf '%s'` — no user-controlled input reaches a shell.

## Migration / Rollout

No migration, no schema, no port, no DI token. Rollback = revert; if the gate ships in its own PR, revert the gate FIRST (else CI is red on the reverted fixes) — its yml revert is a second sensitive-edit token. D9 is forward-compatible: a refresh token minted before D9 (no `jti`) still verifies and rotates; the rotation then mints a `jti`-bearing token.

## Budget impact (for the tasks forecast) — recomputed (F4)

Measured by the gate on rev 1: #41 node script **111** lines, the whole `CLAUDE.md` block **166** (comment 55 + script 111), the yml mirror **~185** (block + step header + `::error` tail ≈ +19). Rev 2, MEASURED on this file (the fenced block, design.md lines 344-522): comment **68** (F2/N10 additions net of tightening), script **111** unchanged → block **179**; mirror **~198** (the +19 overhead measured on rev 1). `run-tests.sh` is counted ONCE, under EVIDENCE (wiring).

| Bucket             | Lines          | Content                                                                                                                                                                                                                 |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CODE, PR 1 (fixes) | **~145-177**   | `PasswordService.ts` ~90-110 · `authServiceSession.ts` ~35-45 · `authServiceCore.ts` ~8 (D9) · `authTypes.ts` 1 · types/middleware/route 4 · `PrismaAdminSessionRepository.ts` JSDoc ~5                                 |
| CODE, PR 2 (gate)  | **~383**       | `CLAUDE.md` ~179 + 1 · `fitness.yml` ~198 + 1 · `openspec/config.yaml` 3 · `SECURITY_CANON.md` 1                                                                                                                        |
| CODE total         | **~528-560**   | over the 400 hard budget → the two-PR seam is mandatory, stacked-to-main, the gate never preceding the fixes                                                                                                            |
| EVIDENCE           | **~1165-1510** | reset racer ~300-380 (from zero, own line) · refresh racer ~220-300 · D5 fake ~250-320 · `PasswordService.test.ts` ~250-320 · rotation + D9 cases ~130-175 · `auth.test.ts` sleep removal 3 · `run-tests.sh` wiring ~10 |

PR 2 sits ~17 lines under the hard budget by this estimate and the tasks phase MUST measure it (`wc -l` on the written block, ×2 plus overhead) before forecasting. If PR 2 measures over 400, the only lever is comment density in the #41 block (both copies move together); no required element (population, floor sentence, converted sites, out-of-class boundary, residuals) may be dropped, and the mirror overhead is fixed. The D5 fake remains the ONE Edward decision the EVIDENCE forecast carries.

## Spec amendments the orchestrator applies (exact lines; none touches a signed decision)

| Spec                                                                                                                                                                   | Current                                                                                                                                                                | Amended                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `single-use-claim-gate` — "The gate's population is MEASURED…" (F7)                                                                                                    | "The measured baseline SHALL be recorded: **7 write sites, of which 2 are unsound before this change and 0 after**"                                                    | "The measured baseline SHALL be recorded: **8 marker sites = 7 claim sites + 1 named issuance exception (`PrismaAdminSessionRepository.updateRefreshTokenHash`), of which 2 claim sites are unsound before this change and 0 after**"      |
| `single-use-claim-gate` — residual limits bullet 4 (F2, optional: the shipped comment names line-window matching in the negative, so a literal read passes either way) | "**line-window matching** — the check pairs `data` and `where` within a bounded window, so a call whose two halves are further apart than that window is not matched." | "**argument slicing** — the check slices each call's argument to its balanced close; a call the slicer cannot close (a regex literal with an unbalanced brace or quote) is dropped, and at a marker site the floor turns that into a red." |
| `admin-refresh-rotation-claim` — Non-goals (D9)                                                                                                                        | "any change to fingerprint checking, session revocation, or token issuance beyond the rotation write itself"                                                           | "any change to fingerprint checking, session revocation, or token issuance beyond the rotation write itself and the per-mint `jti` the rotation claim requires to be a claim (design D9)"                                                  |

## Defects found during design — disposition (DF-n; the gate's F-n numbering is the change log above)

| #                       | Finding                                                                                                                                                                                                          | Disposition                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DF-1                    | `createSession` two-step issuance rotates `refreshTokenHash` keyed on id (E3); between insert and swap the row holds a hash of a token nobody has                                                                | Not a consumption; gate exception with remove-when; no fix                                                                                                                                                |
| DF-2                    | The reuse check compares only `passwordHistory`, which receives the CURRENT hash only at write time, so a reset (and `changePassword`) can set the password to its current value                                 | LOW, pre-existing; NOT this slice (changes a non-consuming exit and adds an argon2 verify) → backlog row at close, SMELL-114's lane                                                                       |
| DF-3                    | Sequential-replay verdict asymmetry (`SESSION_EXPIRED` without Redis, `TOKEN_BLACKLISTED` with)                                                                                                                  | Pre-existing; documented in D2; act-on-detection lane (SMELL-113 pairing)                                                                                                                                 |
| DF-4                    | `statusMap: Record<string, number>` at `adminAuthRoutes.ts:340` lets an unmapped code fall to 500 without a type error                                                                                           | Retyped `Partial<Record<AuthErrorCode, number>>` in the file this slice edits (1 line)                                                                                                                    |
| DF-5 (re-concluded, F1) | No per-mint id in the refresh JWT (E4): same-second mints are identical, so a same-second rotation swaps a hash for itself and the CAS is a no-op — replay undetected, both racers `count === 1`                 | **HIGH impact on this slice's own guarantee; fixed by D9** (`jwtid: randomUUID()`), Redis-independent; unit-pinned (same-tick mints differ) and integration-pinned (`auth.test.ts:294` without its sleep) |
| DF-6                    | `mockPrisma.matchesWhere` answers a silent false zero for any operator it does not know (E5) — the defect class the customer fake was built against                                                              | Not touched here (33 importers); backlog row at close: "unit Prisma fake falls unknown operators through to equality"                                                                                     |
| DF-7 (rev 2)            | `apps/api/tests/auth.test.ts:286-287` sleeps 1 s "to ensure new JWT has different iat timestamp" before asserting the refreshed token differs — the tree's own record of DF-5, paid for with a timing dependence | Sleep and comment deleted in this change; the assertion becomes the no-sleep integration pin of D9                                                                                                        |

## Open Questions

- [x] Capture results, run 2 (shape) — EXECUTED. **Verdict: SHAPE ACCEPT.** The STOP branch does not fire on shape.
- [x] Capture v3 (positive/negative count controls, F3) — EXECUTED 2026-09-12, orchestrator-run. **Verdict: ACCEPT, exit 0, 40/40 assertions (gate pass-2 recount against the log), `isEmpty` contingency NOT fired.** See "Capture v3 results" below.
- [ ] Budget: tasks measures the written #41 block (both copies) and confirms PR 2 under 400; the two-PR seam (fixes + evidence / gate) is mandatory either way.

## Capture v3 results (executed 2026-09-12, orchestrator-run, seeded real rows on omnipost-infra)

**ACCEPT under the v3 rules.** Full verbatim log: scratchpad `capture-output-v3.txt`; script `probe-reset-claim-sql-v3.mts` beside it. Seed readback proved P1's subject was the schema-default `'{}'` row (not probe-written); cleanup `deleteMany` in `finally`, residue rows 0; repo untouched (filesystem-sweep evidence).

| Control                                   | Expectation                   | Result                                                                                                                                                                                    |
| ----------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 — reset claim, TRUE **EMPTY** snapshot | count = 1 + readback          | **PASS** — `$17` bound as `[]` (bound parameter, not inlined) MATCHES the real `'{}'` row; token nulled, history appended. **F3's trap closed: blueprint (a) needs NO `isEmpty` branch.** |
| P2 — reset claim, TRUE two-entry snapshot | count = 1 + readback          | PASS                                                                                                                                                                                      |
| P3 — reset claim, MOVED history           | count = 0, row byte-identical | PASS (`@updatedAt` NOT bumped — a refused `updateMany` performs no write at all)                                                                                                          |
| P4 — reset claim, MOVED passwordHash      | count = 0, row byte-identical | PASS                                                                                                                                                                                      |
| S1 — rotation, TRUE prior hash            | count = 1 + readback          | PASS (hash rotated)                                                                                                                                                                       |
| S2 — rotation, REPLAYED prior hash        | count = 0, row byte-identical | PASS                                                                                                                                                                                      |

Both layers agree byte-for-byte on all six captures (L1 `$on('query')`: 1 data statement + implicit COMMIT; L2 driver: `startTransaction → tx.executeRaw UPDATE → COMMIT → commit`). No SELECT, no decomposition on the `@unique` rotation column, no containment operators.

**Erratum to this design's v3 script body (fold into any revision):** the decision rules require a readback for EVERY positive control, but the script body spelled it out only for P1 and S1 — the executed probe added P2's readback, plus (all strengthening, none verdict-changing): a pre-flight (DB reachability, fixture-hash collision, prior-residue check), a seed readback, an S1 readback, and an auto-arming P1b contingency. The EXECUTED script and its full log are preserved in this change at `evidence/probe-reset-claim-sql-v3.mts` + `evidence/capture-output-v3.txt` — that script, not the body above, is the corrected form the tasks/apply phases carry. Precision fix (gate pass-2 N4): the seed passes `passwordHistory: []` explicitly, so "not probe-written" overstated it — the readback asserts length 0 and the stored value is `'{}'` either way, which is exactly what P1 tests.

**Racer design dividend (for apply):** "loser changed nothing" can be asserted as full-row byte-equality including `updatedAt`, since a refused claim performs no write whatsoever.
