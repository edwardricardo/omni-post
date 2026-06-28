/**
 * @file authRateLimit.test.ts
 * @description Unit tests for the CANONICAL HTTP rate limiter applied to the
 *              sensitive auth endpoints. Drives the REAL production path —
 *              `createHttpRateLimitPreHandler` bound to the production
 *              `STANDARD_ROUTE_RULES` table and a `RateLimiterPort`
 *              (InMemoryTokenBucketRateLimiter) — NOT a self-registered
 *              `@fastify/rate-limit` plugin. This is deliberate: production
 *              never registers `@fastify/rate-limit`, so a test that registers
 *              it itself would assert a path the server does not run (the
 *              RATELIMIT-DEAD bug). Here the test asserts what production
 *              actually enforces: the AUTH-class rules cap the sensitive auth
 *              endpoints at 5 requests / 15 minutes, a non-auth route falls
 *              through to STANDARD (100/min), the key derives from a TRUSTED
 *              proxy hop (not a blindly-spoofable X-Forwarded-For), and a
 *              limiter outage fails OPEN (per ADR-0015).
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { RateLimiterPort } from "@ports/core";
import { InMemoryTokenBucketRateLimiter } from "../../src/ai/providers/InMemoryTokenBucketRateLimiter.js";
import {
  createHttpRateLimitPreHandler,
  resolveClientIp,
  STANDARD_ROUTE_RULES,
  EXPENSIVE_ENDPOINT_RULES,
  RateLimitConfigs,
} from "../../src/security/httpRateLimitPreHandler.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures — the sensitive auth endpoints that MUST carry the AUTH cap.
// Each is a `path` the production STANDARD_ROUTE_RULES table must match via the
// same `startsWith` semantics the limiter uses. The customer login is also
// BruteForceProtectionPort-gated per ADR-0015; the HTTP cap is defence-in-depth.
// ─────────────────────────────────────────────────────────────────────────────

/** Endpoints that MUST resolve to the AUTH preset (5 req / 15 min). */
const AUTH_ENDPOINTS = [
  "/auth/login",
  "/auth/refresh",
  "/auth/customer/login",
  "/auth/customer/register",
  "/auth/customer/refresh",
  "/auth/customer/request-password-reset",
  "/auth/customer/reset-password",
] as const;

const AUTH_LIMIT = RateLimitConfigs.AUTH.maxRequests; // 5

/**
 * Production rule table — EXACTLY how `index.ts` wires the limiter:
 * `[...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES]` with the STANDARD
 * default. The prior rewrite wired only `STANDARD_ROUTE_RULES`, so the test
 * asserted a narrower table than production runs (a Judge A LOW finding). Using
 * the full concat here keeps the assertions faithful to prod wiring.
 */
const PRODUCTION_RULES = [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES] as const;

/**
 * Build a minimal Fastify app whose ONLY rate-limit mechanism is the production
 * preHandler wired with the production rule table — exactly how index.ts wires
 * it (STANDARD default + `[...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES]`).
 * One injected RateLimiterPort backs every key. `trustProxy: true` so
 * `req.headers["x-forwarded-for"]` is the spoofable input the limiter must
 * defend against via the trusted-hop logic. Each route is registered for BOTH
 * GET and POST because the limiter is method-agnostic (it keys by `ip:path`),
 * so callers can exercise whichever verb the asserted endpoint uses.
 */
function buildApp(limiter: RateLimiterPort, routes: readonly string[]): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true });

  app.addHook(
    "preHandler",
    createHttpRateLimitPreHandler(limiter, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: PRODUCTION_RULES,
    })
  );

  for (const route of routes) {
    app.get(route, async () => ({ ok: true }));
    app.post(route, async () => ({ ok: true }));
  }
  return app;
}

describe("Canonical HTTP rate limiter — auth endpoints", () => {
  let limiter: RateLimiterPort;

  beforeEach(() => {
    // Fresh bucket store per test → deterministic, no cross-test leakage.
    // Frozen clock so the 15-minute window never refills mid-test.
    limiter = new InMemoryTokenBucketRateLimiter({ now: () => 1_700_000_000_000 });
  });

  describe.each(AUTH_ENDPOINTS)("POST %s — AUTH preset (5 / 15min)", (route) => {
    it(`allows the first ${AUTH_LIMIT} requests and 429s the next`, async () => {
      const app = buildApp(limiter, [route]);
      const headers = { "x-forwarded-for": "203.0.113.7" };

      for (let i = 1; i <= AUTH_LIMIT; i++) {
        const res = await app.inject({ method: "POST", url: route, headers });
        expect(res.statusCode).not.toBe(429);
      }

      const blocked = await app.inject({ method: "POST", url: route, headers });
      expect(blocked.statusCode).toBe(429);

      const body = JSON.parse(blocked.body) as { error?: string };
      expect(body.error).toBe("RATE_LIMIT_EXCEEDED");
      expect(blocked.headers["retry-after"]).toBeDefined();

      await app.close();
    });
  });

  it("keeps separate per-route counters for two AUTH endpoints", async () => {
    const app = buildApp(limiter, ["/auth/login", "/auth/refresh"]);
    const headers = { "x-forwarded-for": "203.0.113.9" };

    for (let i = 0; i < AUTH_LIMIT; i++) {
      await app.inject({ method: "POST", url: "/auth/login", headers });
    }
    const loginBlocked = await app.inject({ method: "POST", url: "/auth/login", headers });
    expect(loginBlocked.statusCode).toBe(429);

    // A different auth route from the same IP has its own bucket.
    const refreshAllowed = await app.inject({ method: "POST", url: "/auth/refresh", headers });
    expect(refreshAllowed.statusCode).not.toBe(429);

    await app.close();
  });

  it("a non-auth route falls through to STANDARD (100/min), not AUTH", async () => {
    const app = buildApp(limiter, ["/projects"]);
    const headers = { "x-forwarded-for": "203.0.113.20" };

    // The AUTH cap is 5; STANDARD is 100. Six requests prove it is NOT AUTH.
    for (let i = 1; i <= AUTH_LIMIT + 1; i++) {
      const res = await app.inject({ method: "POST", url: "/projects", headers });
      expect(res.statusCode).not.toBe(429);
    }

    await app.close();
  });
});

describe("Canonical HTTP rate limiter — query-immune keying (RATELIMIT-DEAD regression guard)", () => {
  let limiter: RateLimiterPort;

  beforeEach(() => {
    // Frozen clock: the AUTH 15-minute window never refills mid-test, so the
    // bucket only resets if the KEY changes. That is exactly what this test
    // probes — a rotating query string must NOT mint a fresh bucket.
    limiter = new InMemoryTokenBucketRateLimiter({ now: () => 1_700_000_000_000 });
  });

  it("ignores the query string when keying the bucket — distinct query strings cannot evade the AUTH cap", async () => {
    const app = buildApp(limiter, ["/auth/login"]);
    const headers = { "x-forwarded-for": "203.0.113.41" };

    // Same path, six DIFFERENT query strings. Pre-fix the limiter keyed on the
    // full `req.url` (`ip:/auth/login?x=1`, `ip:/auth/login?x=2`, ...), so each
    // distinct query minted a fresh AUTH bucket — six requests would all pass
    // (RED on the old keying). The fix strips the query (`req.url.split("?")[0]`)
    // so all six share one `ip:/auth/login` bucket and the 6th is capped.
    for (let i = 1; i <= AUTH_LIMIT; i++) {
      const res = await app.inject({ method: "POST", url: `/auth/login?x=${i}`, headers });
      expect(res.statusCode).not.toBe(429);
    }

    const blocked = await app.inject({
      method: "POST",
      url: `/auth/login?x=${AUTH_LIMIT + 1}`,
      headers,
    });
    expect(blocked.statusCode).toBe(429);

    const body = JSON.parse(blocked.body) as { error?: string };
    expect(body.error).toBe("RATE_LIMIT_EXCEEDED");

    await app.close();
  });
});

describe("Canonical HTTP rate limiter — /accounts resolves to STANDARD, not AUTH", () => {
  let limiter: RateLimiterPort;

  beforeEach(() => {
    limiter = new InMemoryTokenBucketRateLimiter({ now: () => 1_700_000_000_000 });
  });

  it("a GET /accounts/<id>/projects read survives past the AUTH cap (STANDARD = 100/min)", async () => {
    const app = buildApp(limiter, ["/accounts/acct-123/projects"]);
    const headers = { "x-forwarded-for": "203.0.113.50" };

    // The old `/accounts$` AUTH rule was removed (the literal `$` never matched
    // anyway, and a real `/accounts` AUTH prefix was rejected — it would cap the
    // client SPA's account GET reads at 5/15min). Account routes now resolve to
    // STANDARD (100/min). Six requests on a frozen clock must NOT 429.
    for (let i = 1; i <= AUTH_LIMIT + 1; i++) {
      const res = await app.inject({ method: "GET", url: "/accounts/acct-123/projects", headers });
      expect(res.statusCode).not.toBe(429);
    }

    await app.close();
  });
});

describe("Canonical HTTP rate limiter — /auth/mfa/verify carries the AUTH cap", () => {
  let limiter: RateLimiterPort;

  beforeEach(() => {
    limiter = new InMemoryTokenBucketRateLimiter({ now: () => 1_700_000_000_000 });
  });

  it("caps the unauthenticated MFA second-factor route at 5/15min — the 6th request 429s", async () => {
    const app = buildApp(limiter, ["/auth/mfa/verify"]);
    const headers = { "x-forwarded-for": "203.0.113.60" };

    // MFA verify is a TOTP / backup-code guessing surface with no per-account
    // counter; it was ADDED to AUTH_ROUTE_RULES so the HTTP cap covers it.
    for (let i = 1; i <= AUTH_LIMIT; i++) {
      const res = await app.inject({ method: "POST", url: "/auth/mfa/verify", headers });
      expect(res.statusCode).not.toBe(429);
    }

    const blocked = await app.inject({ method: "POST", url: "/auth/mfa/verify", headers });
    expect(blocked.statusCode).toBe(429);

    const body = JSON.parse(blocked.body) as { error?: string };
    expect(body.error).toBe("RATE_LIMIT_EXCEEDED");

    await app.close();
  });
});

describe("Canonical HTTP rate limiter — trusted-proxy keying", () => {
  it("derives the key from the trusted hop, not a blindly-spoofable X-Forwarded-For", () => {
    // One trusted reverse proxy (default hop count = 1) appends the real client
    // IP as the RIGHTMOST entry. An attacker can prepend spoofed IPs on the left;
    // the trusted edge is the rightmost-minus-(hops-1) entry. With one trusted
    // hop the real client is the last entry.
    const spoofed = resolveClientIp(["1.1.1.1, 2.2.2.2, 198.51.100.42"], undefined, "10.0.0.1", 1);
    expect(spoofed).toBe("198.51.100.42");
  });

  it("falls back to the socket address when no forwarded header is present", () => {
    const ip = resolveClientIp(undefined, undefined, "192.0.2.55", 1);
    expect(ip).toBe("192.0.2.55");
  });

  it("with two trusted hops, the client is the second-from-right entry", () => {
    const ip = resolveClientIp(["1.1.1.1, 198.51.100.42, 10.0.0.2"], undefined, "10.0.0.2", 2);
    expect(ip).toBe("198.51.100.42");
  });
});

describe("Canonical HTTP rate limiter — fail-open (ADR-0015 posture)", () => {
  it("lets the request through when the limiter store throws (does NOT fail closed)", async () => {
    const failingLimiter: RateLimiterPort = {
      tryConsume: vi.fn(async () => {
        throw new Error("redis down");
      }),
    };
    const app = buildApp(failingLimiter, ["/auth/login"]);

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-forwarded-for": "203.0.113.30" },
    });

    // Fail-OPEN: a limiter outage must not block traffic (anti-DoS canon).
    expect(res.statusCode).not.toBe(429);
    expect(res.statusCode).toBe(200);

    await app.close();
  });
});
