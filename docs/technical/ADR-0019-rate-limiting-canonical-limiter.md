# ADR-0019: Rate Limiting — single canonical HTTP limiter (RateLimiterPort + preHandler), dead @fastify/rate-limit path removed, fail-open + alerting

- **Status**: Accepted
- **Date**: 2026-06-28
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

The codebase carried **two HTTP rate-limit mechanisms for one concern**, only one of which actually ran:

1. **The dead route-config path.** `@fastify/rate-limit@10.3.0` is a declared dependency (`apps/api/package.json`), and the auth routes declared per-route caps via that plugin's config syntax — `config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }` on `/auth/login`, `/auth/refresh`, `/auth/logout` (`authRoutes.ts`) and `/auth/customer/{register,login,refresh,request-password-reset,reset-password}` (`customerAuthRoutes.ts`). **The plugin is never registered in production** — there is no `app.register(fastifyRateLimit)` anywhere in `apps/api/src`. Fastify silently ignores an unknown `config.rateLimit` key when the plugin that reads it is absent. So every one of those declarations was **dead config**: it looked like protection in code review but enforced nothing.

2. **The real limiter.** `createHttpRateLimitPreHandler` (`apps/api/src/security/httpRateLimitPreHandler.ts`) is a global Fastify `preHandler` wired in `index.ts` behind `if (env.ENABLE_RATE_LIMITING)` (defaults `true`). It enforces a token bucket through the technology-free `RateLimiterPort`, backed in production by `RedisTokenBucketRateLimiter` (cross-pod — not the per-instance-Map class of bug, cf. fitness #14). It keys by `ip:url` and **fails open** on a limiter error.

The bug (`PENDING_WORK_INVENTORY §2C`, RATELIMIT-DEAD) is the gap between the two: the real limiter's rule table (`STANDARD_ROUTE_RULES`) covered only `/health`, `/publish/`, `/media/`, and a broken `/accounts$` (a literal `$` that never matches a real URL under `startsWith`, so account routes silently resolved to the default). **The auth endpoints were in neither table** — they relied entirely on the unregistered plugin — so they degraded to the STANDARD default (100 req/min) instead of the intended 5/15min. Worse, `trustProxy: true` makes Fastify's `req.ip` derive from the leftmost `X-Forwarded-For` entry, which any client can spoof, so even the 100/min global cap was per-request evadable.

Two partial mitigations DO work and are unaffected by this ADR:

- Customer login is gated by the account-based `BruteForceProtectionPort` (ADR-0015), so credential-stuffing on customer login is covered regardless of the HTTP cap.
- The admin `/auth/*` flow uses its own `rateLimit()` preHandler backed by the real `RateLimiterPort`.

A test made the dead path look healthy: `apps/api/tests/unit/authRateLimit.test.ts` **registered `@fastify/rate-limit` inside its own minimal app** and asserted 5/15min worked — green while production registered nothing. A classic "test passes without the real wiring" deception.

This is a security control, so per `SECURITY_CANON.md §How to extend` it requires a SECURITY_CANON entry + this ADR before the fix lands. There was no rate-limiting entry in SECURITY_CANON and no ADR; that gap is what blocked the fix until Edward authorized establishing the canon.

External canon consulted (already internally validated for ADR-0015; reused here):

- **NIST SP 800-63B-4 §Rate Limiting (Throttling)** (finalised 2025-07): the verifier SHALL limit consecutive failed authentication attempts; prefer progressive throttling over hard lockout (DoS-conscious).
- **OWASP API Security Top 10 — API4:2023 Unrestricted Resource Consumption**: enforce rate limits on all endpoints, stricter on authentication and expensive operations; respond `429` with `Retry-After`.
- **OWASP Authentication Cheat Sheet**: rate-limit auth endpoints; account-based counter is the primary control, IP-based is supplementary; rate-limiting and account-lockout are DISTINCT controls (which is why the IP HTTP cap and the account BF gate coexist as defence-in-depth).

## Decision

**One canonical HTTP rate-limit mechanism: the `RateLimiterPort` + `createHttpRateLimitPreHandler` token bucket. The dead `@fastify/rate-limit` route-config path is removed.**

Concretely:

1. **Auth endpoints get explicit AUTH-class rules** in the limiter's rule table. A new `AUTH_ROUTE_RULES` array (concatenated FIRST into `STANDARD_ROUTE_RULES` so it wins the first-`startsWith`-match) covers the sensitive credential endpoints at the AUTH preset (`RateLimitConfigs.AUTH` = 5 requests / 15 minutes):
   - Customer: `/auth/customer/login`, `/auth/customer/register`, `/auth/customer/refresh`, `/auth/customer/request-password-reset`, `/auth/customer/reset-password`.
   - Core: `/auth/login`, `/auth/refresh`.
   - `/auth/logout` deliberately is NOT capped at AUTH (it is not a credential-guessing surface); it falls through to STANDARD.
   - The privilege-escalating admin `/auth/register` route was removed in a prior slice and is intentionally NOT listed.

2. **The dead `config.rateLimit` blocks are removed** from `authRoutes.ts` and `customerAuthRoutes.ts`. They targeted the unregistered plugin and enforced nothing; leaving them would keep advertising protection that does not exist.

3. **The broken `/accounts$` rule is fixed** to `/accounts` so account-management routes actually receive the intended stricter cap instead of silently resolving to the default.

4. **trustProxy hardening (env-configurable).** A new env var `TRUSTED_PROXY_HOP_COUNT` (Zod `z.coerce.number().int().min(1).max(10).default(1)`) controls how many trusted reverse-proxy hops sit in front of the API. The limiter's key now derives the client IP from the `X-Forwarded-For` entry at `len - TRUSTED_PROXY_HOP_COUNT` (a trusted, non-forgeable hop) via the exported pure function `resolveClientIp`, rather than the spoofable leftmost entry. `X-Forwarded-For` is built left-to-right (original client leftmost, each proxy appends on the right), so the rightmost `N` entries are the only ones an attacker cannot forge. Default 1 = exactly one trusted proxy/LB. A value of 0 is rejected (it would collapse every client behind a proxy into one bucket).

5. **Fail-OPEN is preserved, with alerting made REQUIRED.** Consistent with ADR-0015, a limiter/store outage must NOT block traffic — a fail-closed limiter turns one Redis blip into a full outage of every protected route, which is itself a DoS amplifier. The fail-open path emits a loud, structured `WARN` carrying a stable `threat_type: "http_rate_limit_failopen"` so operational alerting can fire on it (the path is silent by design otherwise).

6. **The `@fastify/rate-limit` dependency is FLAGGED for removal as a follow-up**, not removed in this slice — dropping it needs a lockfile update, and this slice avoids install/lockfile churn. The decision is that the project standardises on the port-based limiter and the plugin is dead weight to be dropped once the lockfile change is sequenced.

### Why the port-based limiter is the canon (not the plugin)

- It already aligns with the codebase's hexagonal shape: a technology-free `RateLimiterPort` (ADR-0007 composition-root wiring) with a swappable adapter (`RedisTokenBucketRateLimiter` in prod, `InMemoryTokenBucketRateLimiter` in tests). The same shape the cache, brute-force, and email concerns already use.
- It is already cross-pod (Redis) — the multi-pod coherence problem (fitness #14) does not apply.
- It is already wired and running. The plugin never was. Standardising on the running mechanism removes the dead artifact rather than reviving a second one.

## Rationale

- **One canon beats two divergent paths.** Two mechanisms for one concern is the duplication-by-divergence smell (`feedback/audit-deletion.md §pattern-not-instance`). Keeping both — one dead — is strictly worse than one working one: the dead path misleads reviewers into thinking auth is protected.
- **Trusted-hop keying beats blind `X-Forwarded-For`.** An IP-keyed cap whose key the client controls is no cap at all. Deriving the key from a trusted hop is the OWASP-recommended posture for proxied deployments.
- **Fail-open + alerting beats fail-closed**, identical reasoning to ADR-0015 §7: the gate is defence-in-depth, not the only line; a fail-closed gate is a single point of total failure for every protected route. The HTTP cap, the admin preHandler, and the account-based BF gate (ADR-0015) are layered, so degrading one open does not remove all protection.
- **AUTH preset (5/15min) for credential endpoints** matches the route authors' original intent (the dead config used 5/15min for login) and OWASP API4:2023 ("stricter on authentication").

## Alternatives considered

- **Register `@fastify/rate-limit` and keep the route-config path.** Rejected: it would introduce a SECOND live limiter (the global preHandler still runs), splitting one concern across two mechanisms with different stores (the plugin's in-memory `LocalStore` is per-pod — the fitness #14 class of bug — unless wired to Redis separately). The port-based limiter is already cross-pod and already wired.
- **Keep the dead config as documentation.** Rejected: dead security config is the opposite of documentation — it asserts protection that is not enforced and survives `grep`-based review as if real.
- **Per-account HTTP rate-limit key.** Rejected for the HTTP layer: the HTTP cap is an IP-based supplementary control (OWASP); the per-account primary control is the `BruteForceProtectionPort` (ADR-0015). Mixing account identity into the HTTP key would duplicate the BF gate's responsibility.
- **trustProxy CIDR allowlist instead of a hop count.** Considered. A hop count is simpler to configure correctly for the common single-proxy/single-LB ingress and has no risk of a misconfigured CIDR silently trusting the wrong subnet. A CIDR allowlist can be added later if a deployment needs heterogeneous proxy sources; the env var shape allows it as a follow-up without breaking the hop-count default.
- **Remove the `@fastify/rate-limit` dependency in this slice.** Deferred: needs a lockfile update; flagged as a follow-up to keep this slice free of install churn.

## Consequences

### Positive

- The sensitive auth endpoints are now actually rate-limited at 5/15min by a running, cross-pod limiter — closing RATELIMIT-DEAD.
- One canonical mechanism. No dead config advertising phantom protection.
- The IP key is no longer blindly spoofable; an attacker cannot evade the cap by forging `X-Forwarded-For`.
- The `/accounts` rule works for the first time.
- The test now drives the REAL production path (`createHttpRateLimitPreHandler` + production `STANDARD_ROUTE_RULES` + a `RateLimiterPort`), so it fails when the wiring regresses — the deception is gone.
- Fail-open remains, so a Redis outage degrades the cap without taking the API down, and the new structured `threat_type` makes that degradation alertable.

### Negative

- `TRUSTED_PROXY_HOP_COUNT` is a new operational knob that MUST be set to the real number of proxies in the ingress path. A wrong value mis-derives the client IP (too low → keys off a proxy IP, collapsing clients; too high → keys off a spoofable entry). Documented in `.env.example` and SECURITY_CANON.
- The `@fastify/rate-limit` dependency remains installed until the follow-up lockfile change, a small amount of dead weight.
- The generated OpenAPI spec previously carried no rate-limit metadata for these routes (the plugin's config never surfaced there), so no spec regen is required for this change.

## Revisit if

- A deployment introduces heterogeneous proxy sources where a fixed hop count is insufficient → add the CIDR-allowlist variant of trusted-proxy resolution (the env shape allows it without breaking the hop-count default).
- Fail-open events (`threat_type: "http_rate_limit_failopen"`) become frequent → harden Redis (cluster + replicas) before considering a stale-while-error fail-closed window, mirroring ADR-0015 §Revisit-if.
- The HTTP cap proves insufficient against distributed (botnet) credential stuffing → the per-account `BruteForceProtectionPort` (ADR-0015) is the primary control for that threat; raise its sensitivity rather than tightening the IP cap into false-positive territory on shared NAT.

## Risks

- **Trusted-hop misconfiguration** — mitigated by a conservative default (1), a rejected 0, and explicit documentation.
- **Shared NAT / corporate proxy false-positives** — multiple legitimate users behind one egress IP share an AUTH bucket. Accepted: the account-based BF gate (ADR-0015) is the precise per-account control; the HTTP cap is a coarse supplementary layer, and 5/15min per IP is generous enough for normal interactive auth from a shared egress.
- **Fail-open silent degradation** — mitigated by the REQUIRED alert on `threat_type: "http_rate_limit_failopen"` (same posture and obligation as ADR-0015's `bf_adapter_failure`).

## References

- NIST SP 800-63B-4 §Rate Limiting (finalised 2025-07): <https://pages.nist.gov/800-63-4/sp800-63b/authenticators/>
- OWASP API Security Top 10 — API4:2023 Unrestricted Resource Consumption: <https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/>
- OWASP Authentication Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- ADR-0015's §Risks "Fastify route rate-limit fallback (5/15min)" referred to the dead `config.rateLimit` route-config that THIS change removed; it never enforced anything. The real fallback during a Redis brute-force-store outage is the HTTP preHandler AUTH cap defined here — which itself fails open — so a Redis blip degrades both the account-based BF gate and this IP cap to open, not to a working 5/15min route-level fallback. (ADR-0015 is not edited; this note records the correction.)- Affected code: `apps/api/src/security/httpRateLimitPreHandler.ts`, `apps/api/src/auth/authRoutes.ts`, `apps/api/src/auth/customerAuthRoutes.ts`, `apps/api/src/config/env.ts`.
- Tests: `apps/api/tests/unit/authRateLimit.test.ts` (rewritten to drive the real preHandler path).
- Related ADRs: ADR-0015 (brute-force protection — fail-open + alerting posture this ADR stays consistent with), ADR-0007 (DI composition root — the limiter port is wired there), ADR-0013 (3-logger factory — the fail-open warning uses the `createLogger` factory).
