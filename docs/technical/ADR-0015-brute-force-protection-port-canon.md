# ADR-0015: Brute-Force Protection — single canon port + Redis adapter (account-based, fail-open)

- **Status**: Accepted
- **Date**: 2026-05-30
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

Pre-S4.4 the codebase held **three divergent brute-force protection implementations** for what is conceptually one cross-cutting concern:

1. `apps/api/src/auth/bruteForceProtection.ts` — orphan, Redis-based, ~707 LOC. Never imported by the application code; survived as dead-but-canon-correct logic (the closest implementation to NIST/OWASP, but unwired).
2. `apps/api/src/admin/auth/BruteForceProtection.ts` — Prisma-based, ~138 LOC. Wired into `AdminAuthService.login()` via inline `new BruteForceProtection(this.prisma)` construction (SMELL-37 Control Freak).
3. `LoginCustomerUseCase` — **no protection**. Customer login only relied on the Fastify route-level rate-limit (5 attempts / 15 min / IP). An attacker rotating IPs against a target customer account had effectively no throttle.

This is the classic "duplication-by-divergence" smell (`feedback/audit-deletion.md §pattern-not-instance`): three local implementations of one global concern, none in agreement, with customer auth carrying the only one that actually _needs_ the canon protection in 2026 (customer flows handle the user-data the platform monetises).

The remediation must close three problems at once:

- **Functional gap** — customer auth must not be brute-forceable.
- **Architectural drift** — one canon, one port, one adapter (Hexagonal §Ports & Adapters).
- **Operational footprint** — no per-instance state machines (`new BF(...)` inside a service constructor); the port is composed in the DI root and injected.

External canon consulted (research 2026-05-30, after Edward's correction on "research first, no patches"):

- **NIST SP 800-63B-4** §rate-limiting (finalised 2025-07): verifier SHALL implement per-account rate-limiting; prefers progressive throttling over hard lockout (DoS-conscious).
- **OWASP Authentication Cheat Sheet** §Account Lockout: counter per **account** (not IP — IP rotation evades IP-based counters); auto-expiry; CAPTCHA after few failures; MFA is the primary defence, BF protection is the secondary layer.
- **OWASP A07:2021** Identification & Authentication Failures: unprotected credential-based auth is in the top 10.
- The BF-HOMOLOG design pass (2026-05-24) captured the 6 alignment rules — account-primary counter (IP supplementary), DoS-conscious lockout/auto-expiry with forgot-password bypass, CAPTCHA after N, no O(N) `redis.keys()`, an explicit fail-open-vs-fail-closed decision, and audit via the injected `AuditService`; this ADR records, supersedes, and acts on all six (see §Decision for the canon-aligned behaviour).

## Decision

**One port (`BruteForceProtectionPort` in `packages/ports/`) + one adapter (`RedisBruteForceAdapter` in `apps/api/src/infrastructure/adapters/`) + wired into both customer and admin login through the DI composition root.**

### Port surface

Six methods, two read (`checkLoginAttempt`, `getStats`), four write (`recordFailedAttempt`, `recordSuccessfulAttempt`, `unlockAccount`, `unblockIp`). Inputs are `identifier` (account-primary key — email/username), `ip`, `userAgent`. Outputs from `checkLoginAttempt` carry `allowed`, `delaySeconds`, `captchaRequired`, optional `lockoutExpiresAt`, optional `reason`. The port is the canonical surface for _both_ customer and admin login flows.

### Adapter behaviour (canon-aligned)

1. **Account-based primary counter** — keyed by `identifier`. Default lockout threshold = 10 failures inside a rolling 15-minute window; auto-expiry after 30 minutes (DoS-conscious). An attacker rotating IPs against a single account still trips the lockout — IP rotation does NOT bypass.
2. **IP throttle supletoria** — default block threshold = 200 failures, much higher than the per-identifier threshold to avoid false-positives on shared NAT / proxies. Auto-expiry 60 min.
3. **Exponential backoff** — `1s → 2s → 4s → 8s → ...` capped at 300s (5 min). Caller honours the returned `delaySeconds` before answering, throttling the attacker without indefinitely locking the legitimate user.
4. **CAPTCHA threshold = 3** — after 3 failures, `checkLoginAttempt` returns `captchaRequired=true`. Defence-in-depth, not preventive on first attempt.
5. **No `redis.keys()` O(N)** — `getStats` reads explicit counters (`bf:stats:lockout-total`, `bf:stats:ip-block-total`, `bf:stats:recent-failures`) maintained atomically on each lockout/block emit.
6. **AuditService injection** — every state-changing call (failed attempt, successful auth, account locked, IP blocked, account/IP admin override) emits an `AuditLog` entry through the canon audit service. Cross-link to S4.3: `AuditLog.accountId` now persists, so the admin dashboard can scope BF events per account.
7. **Fail-open on Redis outage** — every Redis call is wrapped in `try/catch`. On error: `authLogger.warn` + `securityThreats{threat_type=bf_adapter_failure}` metric increment + return `{allowed: true, delaySeconds: 0, captchaRequired: false}`. Anti-DoS canon (OWASP): a fail-closed posture would let one Redis blip lock every user out — a worse DoS surface than the protection itself. **Operational alerting on the warning metric is REQUIRED**, since fail-open is silent by design.

### Wiring

- `BruteForceProtectionPort` token registered in `apps/api/src/infrastructure/container/setupServices.ts` as a singleton with its own Redis connection (separate from the cache port to avoid command queue blocking on health-critical traffic).
- `LoginCustomerUseCase` constructor takes the port as its 5th parameter. Calls `checkLoginAttempt` before the password verification, `recordFailedAttempt` on USER_NOT_FOUND / INVALID_PASSWORD / USER_INACTIVE, `recordSuccessfulAttempt` on success. Honours `delaySeconds`. Surfaces `RATE_LIMITED` → HTTP 429 + `captchaRequired` to the client.
- `AdminAuthService` constructor takes the port as its 2nd parameter (the inline `new BruteForceProtection(this.prisma)` construction is removed — fixes SMELL-37 partial). Six legacy call sites in `login()` consolidated to the port API.

### Hybrid persistence

Redis owns the ephemeral state (counters, lockout flags, delay). The durable trail is the `AuditLog` table — the adapter emits one row per `LOGIN_FAILURE` / `LOGIN_SUCCESS` / `ACCOUNT_LOCKED` / `IP_BLOCKED` / `ACCOUNT_UNLOCKED` / `IP_UNBLOCKED` event. The pre-existing `adminLoginAttempt` table and `adminUser.lockedUntil` column are kept untouched — `adminLoginAttempt` for backwards-compat with the admin dashboard, `adminUser.lockedUntil` for _admin manual locks_ (admin UI can lock a user independent of the BF gate, and the admin login path honours that lock).

## Rationale

- **Account-based counter beats IP-based counter** for credential-stuffing and targeted brute-force. IP-based-only is trivially evaded with a rotating proxy / Tor exit node. NIST 800-63B-4 + OWASP both name the per-account counter as the primary control.
- **Port + adapter beats inline service construction** because (a) it composes in the DI root once, (b) the same port works for both customer and admin flows without code duplication, (c) tests inject an `InMemoryBruteForceAdapter` deterministic stub instead of mocking Prisma + Redis behaviour per-call site.
- **Fail-open beats fail-closed** in this domain. A fail-closed adapter turns every Redis hiccup into a full outage of the login surface — which is itself a DoS amplifier (one Redis blip = no one can log in). Industry consensus (OWASP, NIST guidance, Cloudflare/AWS WAF defaults) is to fail-open with loud telemetry: the gate is a defence-in-depth layer, not the only line.
- **Exponential backoff over hard lockout** for the throttle path because it forces the attacker to slow down without giving them a denial-of-service handle: an attacker can lock a victim out of their account at will if the policy is "5 failures → 1 hour lockout".

## Alternatives considered

- **Redis-only, no AuditService injection**. Rejected: the admin dashboard needs durable history. Without `AuditLog` rows, operators would lose visibility on past lockouts after Redis TTL expires (~30 min).
- **Per-IP primary, account secondary**. Rejected: see Rationale §1. IP-based is the easier-to-evade gate and OWASP explicitly de-prioritises it.
- **Fail-closed (return `allowed=false` on Redis outage)**. Rejected: turns one Redis instance into a single point of total auth failure. Anti-DoS canon prefers fail-open + alerting.
- **Move BF into a CQRS command handler**. Rejected: BF is a cross-cutting _gate_ on the login flow, not a domain event-producing operation. A port + adapter aligns it with how rate-limit, cache, and email are already shaped in this codebase.
- **Reuse the route-level rate-limit only**. Rejected: route rate-limit is IP-based and 5/15-min — both the wrong granularity (per-IP, not per-account) and the wrong threshold for a credential-stuffing attacker rotating proxies.
- **Add MFA to customer auth in the same workstream**. Deferred: MFA is the primary defence per OWASP but is a UX-and-onboarding change that needs its own design pass. S4.4 closes the BF gap; an MFA workstream is scheduled separately.

## Consequences

### Positive

- Customer auth is no longer brute-forceable past 10 attempts per account (NIST/OWASP-aligned threshold).
- Single canon: one port, one adapter, two consumers (admin + customer). No more divergence between admin and customer auth on a core security control.
- DI-composed: `AdminAuthService` no longer constructs a BF instance inline (closes SMELL-37 partial). Tests inject `InMemoryBruteForceAdapter` deterministically.
- `RATE_LIMITED` (HTTP 429) and `captchaRequired` surface to the client, enabling client-side CAPTCHA / lockout UX without further server-side coordination.
- Audit trail consolidated: BF events flow through `AuditService` → `AuditLog`, scoped per account via the column added in S4.3.
- 845 LOC of dead/divergent code deleted (orphan + admin legacy).

### Negative

- Redis is now a dependency of the auth path. Mitigated by the fail-open posture: a Redis outage degrades the BF gate but does not block login. **Operational alerting on `securityThreats{threat_type=bf_adapter_failure}` is REQUIRED** to avoid the fail-open path going silent.
- The adapter's Redis connection is separate from the cache port's connection, so the BF gate has its own connection-pool cost (~1 idle TCP socket per process).
- Existing `adminLoginAttempt` rows are still written by the legacy admin flow until the admin dashboard is migrated to read from `AuditLog`. That migration is tracked as a follow-up; the schema column stays for backwards-compat.

## Revisit if

- Redis fail-open events become frequent (a dozen+ per day per pod). Then reconsider: either harden Redis (cluster mode + replicas) or switch the gate to **fail-closed during high-confidence sustained outages** (a stale-while-error pattern at the adapter layer).
- Customer MFA ships. The BF lockout threshold can be raised once MFA exists (NIST: MFA-protected accounts tolerate higher BF thresholds since the password counter is no longer the only gate).
- Aggregate `getStats` cost crosses ~10ms p95 at peak. Then promote the explicit counters to a TS-side cache in front of Redis, or move the dashboard to read directly from `AuditLog`.

## Risks

- **Single point of failure on Redis** — mitigated by fail-open + alerting. Worst case: a sustained Redis outage means no BF protection. The Fastify route rate-limit (defence-in-depth, KEPT) still throttles at 5 attempts / 15 min / IP during such an outage.
- **CAPTCHA threshold = 3 may UX-degrade legitimate flows** (typed-wrong password 3 times → CAPTCHA on the next attempt). Trade-off accepted: OWASP guidance is explicit that a few-failures CAPTCHA threshold is correct, and the client can show a `captchaRequired` hint before the user re-types.
- **Identifier enumeration via `RATE_LIMITED` response** — the use case returns `RATE_LIMITED` only after `checkLoginAttempt` says `!allowed`, which fires on any identifier. The 429 response itself does not leak account existence (an attacker rotating identifiers gets one 429 per identifier-IP pair, not the per-account distinction). Mitigated by canon.
- **Time-of-check / time-of-use** between `checkLoginAttempt` and `recordFailedAttempt` — under high contention an attacker could parallelise N concurrent attempts past the canon threshold. Acceptable: the canon already says "post-window threshold" so a single extra burst is bounded; the audit trail captures the over-threshold events.

## References

- NIST SP 800-63B-4 §Rate Limiting (finalised 2025-07): <https://pages.nist.gov/800-63-4/sp800-63b/authenticators/>
- OWASP Authentication Cheat Sheet §Account Lockout: <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- OWASP A07:2021 Identification & Authentication Failures: <https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/>- Implementation commits: `fcf351f5` (Phase 1 — port), `598696e6` (Phase 2 — adapter), `d7c67ec0` (Phase 3 — DI), `3a11a013` (Phase 4 — customer wire), `649fe40f` (Phase 5 — admin refactor), `1ae514b4` (Phase 6 — legacy delete), `2705df66` (Phase 7 — tests).
- Related ADRs: ADR-0007 (DI composition root) — port wiring follows the canon there. ADR-0013 (3-logger factory) — adapter uses `authLogger` from the factory. ADR-0014 (Multi-tenant isolation) — `AuditLog.accountId` persists per S4.3.
