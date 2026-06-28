#!/usr/bin/env tsx
/**
 * @file autoCacheMiddleware.tenant-isolation.test.ts
 * @description RED→GREEN integration tests for CACHE-XTENANT-HTTP (CWE-639).
 *   Exercises the autoCache onRequest/onSend hooks end-to-end through Fastify
 *   with REAL customer bearer tokens. Proves:
 *     - cross-tenant: tenant B never receives tenant A's cached body;
 *     - same-tenant: a second identical request HITS;
 *     - no-tenant on a tenant-scoped route BYPASSES the cache (no serve/store);
 *     - auth-bypass-on-hit is closed (a HIT requires a verified token);
 *     - tenant-neutral routes (provider catalog) stay shared across tenants.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { autoCachePlugin } from "../../src/middleware/autoCacheMiddleware.js";
import { requireClientAuth } from "../../src/auth/customerAuthMiddleware.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";

const tokenFor = (userId: string, accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: userId,
    accountId,
    roleId: "role-1",
    roleName: "OWNER",
    permissions: [],
  })}`;

/**
 * Builds a Fastify app with the autoCache plugin and a /posts route guarded by
 * the real requireClientAuth preHandler, plus a tenant-neutral /providers route.
 * Each invocation returns a body that encodes the resolved tenant so a leak is
 * directly observable in the response payload.
 */
async function buildApp(cache: InMemoryCacheAdapter): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("cache", cache);
  await app.register(autoCachePlugin, { cache, enableCaching: true });

  app.get("/posts", { preHandler: [requireClientAuth] }, async (request) => ({
    tenant: request.customerUser?.accountId,
    posts: [],
  }));

  app.get("/providers", async () => ({ providers: ["x", "instagram"] }));

  await app.ready();
  return app;
}

describe("CACHE-XTENANT-HTTP — autoCache hook tenant isolation", () => {
  it("does NOT serve tenant A's cached body to tenant B (cross-tenant)", async () => {
    const cache = new InMemoryCacheAdapter();
    const app = await buildApp(cache);

    const a = await app.inject({
      method: "GET",
      url: "/posts",
      headers: { authorization: tokenFor("user-A", "acct-A") },
    });
    expect(a.statusCode).toBe(200);
    expect(JSON.parse(a.payload).tenant).toBe("acct-A");

    const b = await app.inject({
      method: "GET",
      url: "/posts",
      headers: { authorization: tokenFor("user-B", "acct-B") },
    });
    expect(b.statusCode).toBe(200);
    // The leak: if B sees acct-A this is the CWE-639 cross-tenant collision.
    expect(JSON.parse(b.payload).tenant).toBe("acct-B");
    expect(b.headers["x-cache"]).not.toBe("HIT");

    cache.close();
    await app.close();
  });

  it("serves a HIT for the same tenant on an identical request", async () => {
    const cache = new InMemoryCacheAdapter();
    const app = await buildApp(cache);

    const first = await app.inject({
      method: "GET",
      url: "/posts",
      headers: { authorization: tokenFor("user-A", "acct-A") },
    });
    expect(first.statusCode).toBe(200);

    // The onSend cache write is fire-and-forget; let it settle before the
    // second request so the HIT is deterministic.
    await new Promise((resolve) => setImmediate(resolve));

    const second = await app.inject({
      method: "GET",
      url: "/posts",
      headers: { authorization: tokenFor("user-A", "acct-A") },
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(JSON.parse(second.payload).tenant).toBe("acct-A");

    cache.close();
    await app.close();
  });

  it("BYPASSES the cache on a tenant-scoped route with no resolvable tenant", async () => {
    const cache = new InMemoryCacheAdapter();
    const app = await buildApp(cache);

    // No Authorization header -> requireClientAuth will 401, but the cache hook
    // must FAIL CLOSED: never store under a tenant-agnostic shared key.
    const first = await app.inject({ method: "GET", url: "/posts" });
    expect(first.statusCode).toBe(401);

    // Nothing tenant-agnostic should have been cached.
    expect(await cache.has("api:GET:/posts")).toBe(false);

    // A subsequent valid request must reach the handler (MISS), not a stale
    // shared body cached from the anonymous request.
    const valid = await app.inject({
      method: "GET",
      url: "/posts",
      headers: { authorization: tokenFor("user-A", "acct-A") },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.headers["x-cache"]).not.toBe("HIT");

    cache.close();
    await app.close();
  });

  it("closes the auth-bypass-on-hit hole: an unauthenticated request never gets a HIT", async () => {
    const cache = new InMemoryCacheAdapter();
    const app = await buildApp(cache);

    // Warm the cache as tenant A.
    await app.inject({
      method: "GET",
      url: "/posts",
      headers: { authorization: tokenFor("user-A", "acct-A") },
    });

    // An unauthenticated attacker must NOT be served the warmed body.
    const anon = await app.inject({ method: "GET", url: "/posts" });
    expect(anon.statusCode).toBe(401);
    expect(anon.headers["x-cache"]).not.toBe("HIT");

    // A request with an invalid token also must not be served from cache.
    const bad = await app.inject({
      method: "GET",
      url: "/posts",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.headers["x-cache"]).not.toBe("HIT");

    cache.close();
    await app.close();
  });

  it("keeps tenant-neutral routes shared across tenants (provider catalog)", async () => {
    const cache = new InMemoryCacheAdapter();
    const app = await buildApp(cache);

    const a = await app.inject({
      method: "GET",
      url: "/providers",
      headers: { authorization: tokenFor("user-A", "acct-A") },
    });
    expect(a.statusCode).toBe(200);

    // The onSend cache write is fire-and-forget; let it settle before the
    // second tenant's request so the shared HIT is deterministic.
    await new Promise((resolve) => setImmediate(resolve));

    const b = await app.inject({
      method: "GET",
      url: "/providers",
      headers: { authorization: tokenFor("user-B", "acct-B") },
    });
    expect(b.statusCode).toBe(200);
    // Same global catalog -> tenant B SHOULD get the shared cached body.
    expect(b.headers["x-cache"]).toBe("HIT");
    expect(JSON.parse(b.payload)).toStrictEqual(JSON.parse(a.payload));

    cache.close();
    await app.close();
  });
});
