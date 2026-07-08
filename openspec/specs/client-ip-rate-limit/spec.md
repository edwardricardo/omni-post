# Client-IP Rate-Limit Keying — Specification

> Living specification for the **client-ip-rate-limit** capability: the per-IP AUTH rate
> limiter buckets by the real inbound client IP, not by the Next server's IP, so the
> limiter is per-user — while staying resistant to a spoofed leftmost
> `X-Forwarded-For` and keeping the existing AUTH policy and fail-open posture.
>
> Source of truth: `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md §3.1` (the original
> finding — the Next portals dropped `X-Forwarded-For`/`X-Real-IP`, collapsing the AUTH
> limiter to one portal-wide bucket), closed by change `cross-tenant-criticals`
> (N-SEC-2), commit `95b4ec66`.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement
> carries Given/When/Then acceptance scenarios. Requirements marked
> **[MERGE-BLOCKING]** are the acceptance criteria that gated the closing change — their
> failure is an authentication DoS or a spoofable key and must never regress.

---

## Requirements

### Requirement: The AUTH rate-limit bucket is keyed by the real client IP **[MERGE-BLOCKING]**

The per-IP AUTH rate limiter buckets requests by the real inbound client IP, so that
distinct clients occupy distinct buckets. The Next portals forward the true inbound IP
(relay, not append — see the egress requirement below), and `resolveClientIp` selects
that real client IP for the bucket key rather than collapsing every request onto the
Next server's `socket.remoteAddress`. Exhausting one client's AUTH allowance MUST NOT
affect a different client.

#### Scenario: Distinct clients occupy distinct per-IP buckets (no portal-wide lockout)

- **Given** two real clients with distinct source IPs both reach the backend through the Next proxy
- **And** the AUTH limit is 5 requests / 15 minutes per IP
- **When** client-1 exhausts its AUTH allowance (6th login attempt is rate-limited)
- **Then** client-2's login attempt is NOT rate-limited (client-2 has its own bucket)
- **And** client-2's request proceeds to authentication

#### Scenario: resolveClientIp selects the real client IP from the relayed chain

- **Given** the Next proxy relays the inbound `X-Forwarded-For` chain unchanged (it does not append its own address)
- **And** `TRUSTED_PROXY_HOP_COUNT` is aligned to the number of trusted proxies in front of Next
- **When** `resolveClientIp` derives the rate-limit key
- **Then** the key reflects the real client IP (the `X-Forwarded-For` entry at `len - TRUSTED_PROXY_HOP_COUNT`)
- **And** the key is NOT the Next server's `socket.remoteAddress`

---

### Requirement: The rate-limit key is resistant to a spoofed leftmost X-Forwarded-For **[MERGE-BLOCKING]**

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

#### Scenario: Hop-count topology neither re-opens spoofing nor re-collapses the bucket

- **Given** the exact hop topology (direct dev, single trusted edge, or edge+LB) is documented per deployment shape
- **And** `TRUSTED_PROXY_HOP_COUNT` (env, min 1, default 1) is set to match that topology
- **When** the key is derived
- **Then** it selects the real client hop (neither the spoofable leftmost entry — under-count — nor the Next server hop — over-count)

---

### Requirement: The real inbound IP is forwarded from all four Next egress points

The true inbound client IP is forwarded to the backend from every Next egress
point that proxies backend calls (a RELAY of the inbound headers, not an appended hop),
so no auth or session-refresh path collapses to the Next server's IP. The four egress
points are the client backend proxy (`apps/client/app/api/backend/[...path]/route.ts`),
the admin backend proxy (`apps/admin/app/api/backend/[...path]/route.ts`), the admin
refresh route (`apps/admin/app/api/auth/refresh/route.ts`), and the auth server actions
in both apps (`apps/client/app/actions/auth.ts`, `apps/admin/lib/auth/backend-client.ts`).

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

This capability MUST NOT introduce a second HTTP rate limiter, change the AUTH policy
numbers, or flip the limiter to fail-closed. `RateLimitConfigs.AUTH` MUST stay at
5 requests / 15 minutes, and the limiter MUST remain fail-open with loud telemetry on
a limiter/store outage (per `SECURITY_CANON §Rate Limiting`).

#### Scenario: AUTH numbers and single-limiter invariant preserved

- **Given** the canonical `RateLimiterPort` HTTP limiter and its `RateLimitConfigs.AUTH` preset
- **When** the system is inspected
- **Then** `RateLimitConfigs.AUTH` remains 5 requests / 15 minutes
- **And** no second HTTP limiter (e.g. a `config: { rateLimit: {...} }` route-config) is introduced
- **And** fitness check #28 remains hard-zero

#### Scenario: Limiter stays fail-open under store outage

- **Given** the rate-limit backing store is unavailable
- **When** a request hits a rate-limited route
- **Then** the request is allowed through (fail-open)
- **And** a structured warning with `threat_type: "http_rate_limit_failopen"` is emitted (the posture is not changed to fail-closed)

---

## How to extend

1. **New Next egress point that proxies to the backend** — apply the per-app
   `forwardedForHeaders(inbound: Headers)` relay helper (`apps/{client,admin}/lib/http/forwardedFor.ts`)
   to the outbound `fetch` headers so the new surface does not silently collapse the
   AUTH bucket. Do not introduce a shared `packages/*` version of the helper (deliberate
   per-app duplication — see ADR-0017 module-resolution constraints).
2. **New trusted-proxy hop added in front of Next** — update `TRUSTED_PROXY_HOP_COUNT`
   to match the new topology (see the deployment-shape table in
   `openspec/changes/archive/cross-tenant-criticals/design.md` §D3) and re-run the
   spoof-resistance scenario against the new chain shape.
3. **New credential/auth endpoint** — add its URL prefix to `AUTH_ROUTE_RULES`
   (`apps/api/src/security/httpRateLimitPreHandler.ts`), never a route-level
   `config: { rateLimit: {...} }` (dead while `@fastify/rate-limit` stays unregistered).
4. **Amending a MERGE-BLOCKING requirement** — requires an ADR; these are the acceptance
   criteria that closed N-SEC-2 and must not silently regress.

Deployment precondition (operational, not code): an internet-facing deployment MUST
place at least one trusted proxy in front of Next; otherwise the inbound
`X-Forwarded-For` is client-forgeable one tier up. Set `TRUSTED_PROXY_HOP_COUNT` to the
real number of trusted hops in the ingress path.
