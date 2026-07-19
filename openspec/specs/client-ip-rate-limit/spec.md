# Client-IP Forwarding & Rate-Limit Keying — Living Spec

> Living specification for the **client-ip-rate-limit** capability: the per-IP AUTH rate
> limiter MUST bucket by the real inbound client IP, not by the Next server's IP, so the
> limiter is per-user again — while staying resistant to a spoofed leftmost
> `X-Forwarded-For` and keeping the existing AUTH policy and fail-open posture.
>
> Established by change `cross-tenant-criticals` (Cluster A / Nivelación, slice C2 /
> N-SEC-2), archived 2026-07-19, merged via **PR #125** (branch
> `workstream/cluster-a-client-ip-ratelimit`). Companion capability:
> `circuit-breaker-isolation` (slice C1, PR #124). Source of truth: the keying logic lives in
> `apps/api/src/security/httpRateLimitPreHandler.ts` + `apps/api/src/security/resolveClientIp.ts`,
> the topology invariant and the canonical resolver contract in
> `docs/security/SECURITY_CANON.md §Rate Limiting`.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** MUST be proven green before merge — their failure is an
> authentication DoS or a spoofable rate-limit key.
>
> Behavior-first: these requirements state WHAT must be guaranteed (per-user buckets, spoof
> resistance, complete egress coverage), not the exact header-forwarding helper shape or the
> precise numeric value of `TRUSTED_PROXY_HOP_COUNT`. The shipped design RELAYS the inbound
> forwarding headers verbatim (it does NOT append the portal's own hop), so the backend's
> `resolveClientIp` hop-count math stays the sole authority; the topology invariant in
> `SECURITY_CANON` (each portal's front edge strips/overwrites inbound `X-Forwarded-For`)
> MUST hold for this to be sound.
>
> Verification method: the distinct-bucket and spoof-resistance scenarios are **vitest** unit
> tests in `apps/api/tests/unit/` exercising `resolveClientIp` against crafted header chains;
> the cross-egress forwarding is exercised as a **node:test** integration scenario in
> `apps/api/tests/integration/` plus per-app forwarding-helper unit tests. Each executed
> scenario is LXC-safe: single test file, heap-capped, under a `timeout` wrapper.

---

## Requirements

### Requirement: The AUTH rate-limit bucket is keyed by the real client IP [MERGE-BLOCKING]

The per-IP AUTH rate limiter MUST bucket requests by the real inbound client IP, so
that distinct clients occupy distinct buckets. After the Next portals forward the true
inbound IP, `resolveClientIp` MUST select that real client IP for the bucket key rather
than collapsing every request onto the Next server's `socket.remoteAddress`. Exhausting
one client's AUTH allowance MUST NOT affect a different client.

#### Scenario: Distinct clients occupy distinct per-IP buckets (no portal-wide lockout)

- **Given** two real clients with distinct source IPs both reach the backend through the Next proxy
- **And** the AUTH limit is 5 requests / 15 minutes per IP
- **When** client-1 exhausts its AUTH allowance (6th login attempt is rate-limited)
- **Then** client-2's login attempt is NOT rate-limited (client-2 has its own bucket)
- **And** client-2's request proceeds to authentication

#### Scenario: resolveClientIp selects the real client IP after the proxy appends it

- **Given** the Next proxy appends the real inbound client IP to the forwarded `X-Forwarded-For` chain
- **And** `TRUSTED_PROXY_HOP_COUNT` is aligned to the resulting hop topology (the added proxy hop is accounted for)
- **When** `resolveClientIp` derives the rate-limit key
- **Then** the key reflects the real client IP (the `X-Forwarded-For` entry at `len - TRUSTED_PROXY_HOP_COUNT`)
- **And** the key is NOT the Next server's `socket.remoteAddress`

---

### Requirement: The rate-limit key is resistant to a spoofed leftmost X-Forwarded-For [MERGE-BLOCKING]

The rate-limit key MUST be derived from a TRUSTED hop, not from the client-spoofable
leftmost `X-Forwarded-For` entry. An attacker who controls the leftmost entry MUST NOT
be able to steer their own bucket key or evade the limiter by injecting arbitrary
values there. The selection MUST use the entry at `len - TRUSTED_PROXY_HOP_COUNT`.

#### Scenario: Attacker-controlled leftmost XFF entry is ignored for keying

- **Given** an inbound request whose leftmost `X-Forwarded-For` entry is an attacker-controlled value
- **And** the trusted proxy chain has appended the real hops after it
- **When** the backend derives the rate-limit key via `resolveClientIp`
- **Then** the key is taken from the trusted hop at `len - TRUSTED_PROXY_HOP_COUNT`
- **And** the attacker-controlled leftmost entry is NOT used as the key
- **And** an attacker cannot rotate the leftmost entry to obtain unlimited fresh buckets

#### Scenario: Hop-count off-by-one does not re-open spoofing or re-collapse the bucket

- **Given** the exact hop topology after adding the Next proxy hop is stated by design
- **And** `TRUSTED_PROXY_HOP_COUNT` (env, min 1, default 1) is set to that topology
- **When** the key is derived
- **Then** it selects the real client hop (neither the spoofable leftmost entry — under-count — nor the Next server hop — over-count)

---

### Requirement: The real inbound IP is forwarded from all four Next egress points

The true inbound client IP MUST be forwarded to the backend from every Next egress
point that proxies backend calls, so no auth or session-refresh path collapses to the
Next server's IP. The four egress points are the client backend proxy
(`apps/client/app/api/backend/[...path]/route.ts`), the admin backend proxy
(`apps/admin/app/api/backend/[...path]/route.ts`), the admin refresh route
(`apps/admin/app/api/auth/refresh/route.ts`), and the auth server actions in both apps
(`apps/client/app/actions/auth.ts`, `apps/admin/lib/auth/backend-client.ts`).

#### Scenario: Each egress point forwards the inbound IP

- **Given** an inbound request with a known real client IP reaches a Next egress point
- **When** that egress point proxies the request to the backend
- **Then** the outbound request carries the real inbound client IP in `X-Forwarded-For`
- **And** this holds for all four egress points: client proxy, admin proxy, admin refresh route, and the auth server actions in both apps

#### Scenario: Session-refresh path is per-user (no cross-user de-authentication)

- **Given** more than four active users refresh their auth context concurrently through the admin refresh route
- **When** each refresh reaches the backend with its own forwarded client IP
- **Then** each user's refresh is bucketed under its own IP
- **And** one user exhausting the limit does not force another user's refresh to fail and log them out

---

### Requirement: AUTH policy and fail-open posture are unchanged (do-not-regress)

This change MUST NOT introduce a second HTTP rate limiter, change the AUTH policy
numbers, or flip the limiter to fail-closed. `RateLimitConfigs.AUTH` MUST stay at
5 requests / 15 minutes, and the limiter MUST remain fail-open with loud telemetry on
a limiter/store outage (per `SECURITY_CANON §Rate Limiting`).

#### Scenario: AUTH numbers and single-limiter invariant preserved

- **Given** the canonical `RateLimiterPort` HTTP limiter and its `RateLimitConfigs.AUTH` preset
- **When** the change is applied
- **Then** `RateLimitConfigs.AUTH` remains 5 requests / 15 minutes
- **And** no second HTTP limiter (e.g. a `config: { rateLimit: {...} }` route-config) is introduced
- **And** fitness check #28 remains hard-zero

#### Scenario: Limiter stays fail-open under store outage

- **Given** the rate-limit backing store is unavailable
- **When** a request hits a rate-limited route
- **Then** the request is allowed through (fail-open)
- **And** a structured warning with `threat_type: "http_rate_limit_failopen"` is emitted (the posture is not changed to fail-closed)
