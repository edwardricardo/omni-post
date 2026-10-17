/**
 * @file cacheRouteCoverage.test.ts
 * @description Pins the two structural guards over the cache rule table. The first
 *              closes the "dead cache rule" class: a cache rule keyed to a path
 *              pattern no route registers is silently inert, and the tree gives no
 *              signal — the same "dead scope = infallible gate" failure fitness #36
 *              exists to prevent, one layer down. The second closes the "cached before
 *              auth" class: a HIT is sent before the route's handler and its ownership
 *              check, so a cached GET rule whose key does not name the caller serves one
 *              caller's response to every other caller the route admits.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import {
  findCacheRouteViolations,
  assertCacheRoutesCovered,
  findCachePrincipalViolations,
  assertCachedResponsesVaryByPrincipal,
  type RegisteredRoute,
} from "../../../../src/lib/cache/cacheRouteCoverage.js";
import { CACHE_CONFIG, type RouteCacheOptions } from "../../../../src/lib/cache/cacheConfig.js";
import { autoCachePlugin } from "../../../../src/middleware/autoCacheMiddleware.js";
import { requireClientAuth } from "../../../../src/auth/customerAuthMiddleware.js";

const NO_BASELINE: ReadonlySet<string> = new Set();

function routes(...specs: string[]): RegisteredRoute[] {
  return specs.map((spec) => {
    const separator = spec.indexOf(":");
    return {
      method: spec.slice(0, separator),
      url: spec.slice(separator + 1),
      authenticated: false,
    };
  });
}

/** A route behind an authenticating hook, as the plugin's `onRoute` collector records it. */
function authenticatedRoute(spec: string): RegisteredRoute {
  const separator = spec.indexOf(":");
  return { method: spec.slice(0, separator), url: spec.slice(separator + 1), authenticated: true };
}

/** A cached GET rule with the given vary parameters and nothing else of note. */
function cachedRule(varyBy: string[], extra: Partial<RouteCacheOptions> = {}): RouteCacheOptions {
  return { enabled: true, ttl: 60, tags: ["test"], varyBy, ...extra };
}

describe("findCacheRouteViolations", () => {
  describe("param-rename detection (decidable without the full route surface)", () => {
    it("returns no violations when every rule key matches a registered route exactly", () => {
      const violations = findCacheRouteViolations({
        registered: routes("DELETE:/projects/:projectId", "GET:/posts"),
        keysByMap: [
          { map: "CACHE_INVALIDATION_RULES", keys: ["DELETE:/projects/:projectId"] },
          { map: "CACHE_CONFIG", keys: ["GET:/posts"] },
        ],
        baseline: NO_BASELINE,
        checkOrphans: true,
      });

      expect(violations).toEqual([]);
    });

    it("reports a param-rename when a rule key differs from a registered route only in its parameter name", () => {
      const violations = findCacheRouteViolations({
        registered: routes("DELETE:/projects/:projectId"),
        keysByMap: [{ map: "CACHE_INVALIDATION_RULES", keys: ["DELETE:/projects/:id"] }],
        baseline: NO_BASELINE,
        checkOrphans: false,
      });

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        kind: "param-rename",
        key: "DELETE:/projects/:id",
        registered: ["DELETE:/projects/:projectId"],
      });
    });

    it("reports a param-rename even when orphan checking is off, because a colliding route proves the surface exists", () => {
      const violations = findCacheRouteViolations({
        registered: routes("PUT:/channels/:channelId"),
        keysByMap: [{ map: "CACHE_INVALIDATION_RULES", keys: ["PUT:/channels/:id"] }],
        baseline: NO_BASELINE,
        checkOrphans: false,
      });

      expect(violations.map((violation) => violation.kind)).toEqual(["param-rename"]);
    });

    it("does not report a param-rename for a key the baseline exempts", () => {
      const violations = findCacheRouteViolations({
        registered: routes("GET:/projects/:projectId"),
        keysByMap: [{ map: "CACHE_CONFIG", keys: ["GET:/projects/:id"] }],
        baseline: new Set(["GET:/projects/:id"]),
        checkOrphans: false,
      });

      expect(violations).toEqual([]);
    });

    it("distinguishes methods: a rule key only collides with a route of the same method", () => {
      const violations = findCacheRouteViolations({
        registered: routes("GET:/projects/:projectId"),
        keysByMap: [{ map: "CACHE_INVALIDATION_RULES", keys: ["DELETE:/projects/:id"] }],
        baseline: NO_BASELINE,
        checkOrphans: false,
      });

      expect(violations).toEqual([]);
    });
  });

  describe("orphan detection (needs the full route surface)", () => {
    it("reports an orphan when no registered route shares the rule key's shape", () => {
      const violations = findCacheRouteViolations({
        registered: routes("GET:/posts"),
        keysByMap: [{ map: "CACHE_INVALIDATION_RULES", keys: ["POST:/analytics/refresh"] }],
        baseline: NO_BASELINE,
        checkOrphans: true,
      });

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ kind: "orphan", key: "POST:/analytics/refresh" });
    });

    it("stays silent about orphans on a partial app, where an absent route proves nothing", () => {
      const violations = findCacheRouteViolations({
        registered: routes("GET:/posts"),
        keysByMap: [{ map: "CACHE_INVALIDATION_RULES", keys: ["POST:/analytics/refresh"] }],
        baseline: NO_BASELINE,
        checkOrphans: false,
      });

      expect(violations).toEqual([]);
    });

    it("does not report an orphan for a key the baseline exempts", () => {
      const violations = findCacheRouteViolations({
        registered: routes("GET:/posts"),
        keysByMap: [{ map: "CACHE_INVALIDATION_RULES", keys: ["POST:/analytics/refresh"] }],
        baseline: new Set(["POST:/analytics/refresh"]),
        checkOrphans: true,
      });

      expect(violations).toEqual([]);
    });
  });

  describe("baseline rot (an exemption that outlived its defect)", () => {
    it("reports a stale baseline entry once the key it excuses is registered for real", () => {
      const violations = findCacheRouteViolations({
        registered: routes("DELETE:/projects/:projectId"),
        keysByMap: [{ map: "CACHE_INVALIDATION_RULES", keys: ["DELETE:/projects/:projectId"] }],
        baseline: new Set(["DELETE:/projects/:projectId"]),
        checkOrphans: true,
      });

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        kind: "stale-baseline",
        key: "DELETE:/projects/:projectId",
      });
    });

    it("reports a baseline entry that names a key no cache map declares", () => {
      const violations = findCacheRouteViolations({
        registered: routes("GET:/posts"),
        keysByMap: [{ map: "CACHE_CONFIG", keys: ["GET:/posts"] }],
        baseline: new Set(["DELETE:/ghost/:id"]),
        checkOrphans: true,
      });

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ kind: "stale-baseline", key: "DELETE:/ghost/:id" });
    });
  });

  describe("assertCacheRoutesCovered", () => {
    it("throws naming the offending key and the route it should have matched", () => {
      expect(() =>
        assertCacheRoutesCovered({
          registered: routes("DELETE:/projects/:projectId"),
          keysByMap: [{ map: "CACHE_INVALIDATION_RULES", keys: ["DELETE:/projects/:id"] }],
          baseline: NO_BASELINE,
          checkOrphans: false,
        })
      ).toThrow(/DELETE:\/projects\/:id[\s\S]*DELETE:\/projects\/:projectId/);
    });

    it("does not throw when there are no violations", () => {
      expect(() =>
        assertCacheRoutesCovered({
          registered: routes("DELETE:/projects/:projectId"),
          keysByMap: [{ map: "CACHE_INVALIDATION_RULES", keys: ["DELETE:/projects/:projectId"] }],
          baseline: NO_BASELINE,
          checkOrphans: true,
        })
      ).not.toThrow();
    });
  });
});

describe("autoCachePlugin route-coverage guard", () => {
  it("refuses to boot an app that registers a cached resource under a renamed parameter", async () => {
    const app = Fastify({ logger: false });
    app.decorate("cache", new InMemoryCacheAdapter());
    await app.register(autoCachePlugin, { enableCaching: true, enableInvalidation: true });

    // The pre-fix spelling. `DELETE:/projects/:projectId` is a real invalidation
    // rule, so this route collides with it by shape and differs by parameter name
    // — exactly the mutation that silently killed invalidation before.
    app.delete("/projects/:id", async () => ({ deleted: true }));

    await expect(app.ready()).rejects.toThrow(/param-rename|:projectId/);
    await app.close();
  });

  it("boots a partial app whose routes collide with nothing", async () => {
    const app = Fastify({ logger: false });
    app.decorate("cache", new InMemoryCacheAdapter());
    await app.register(autoCachePlugin, { enableCaching: true, enableInvalidation: true });

    app.get("/item/:id", async () => ({ ok: true }));

    await expect(app.ready()).resolves.toBeDefined();
    await app.close();
  });
});

describe("findCachePrincipalViolations", () => {
  it("reports a cached GET rule whose route authenticates but whose key does not name the caller", () => {
    const violations = findCachePrincipalViolations({
      registered: [authenticatedRoute("GET:/analytics/dashboard")],
      rules: { "GET:/analytics/dashboard": cachedRule(["query:projectId", "query:timeRange"]) },
    });

    expect(violations).toEqual([
      { kind: "unvaried-authenticated", key: "GET:/analytics/dashboard", declaredPublic: false },
    ]);
  });

  it("refutes a public declaration on a route that carries an authenticating hook", () => {
    const violations = findCachePrincipalViolations({
      registered: [authenticatedRoute("GET:/providers/active")],
      rules: { "GET:/providers/active": cachedRule([], { public: true }) },
    });

    expect(violations).toEqual([
      { kind: "unvaried-authenticated", key: "GET:/providers/active", declaredPublic: true },
    ]);
  });

  it("reports a cached GET rule that neither names the caller nor declares its route public", () => {
    const violations = findCachePrincipalViolations({
      registered: routes("GET:/users/:id"),
      rules: { "GET:/users/:id": cachedRule(["id"]) },
    });

    expect(violations).toEqual([{ kind: "undeclared-public", key: "GET:/users/:id" }]);
  });

  it("accepts a rule that names the caller on an authenticated route", () => {
    const violations = findCachePrincipalViolations({
      registered: [authenticatedRoute("GET:/posts/:id")],
      rules: { "GET:/posts/:id": cachedRule(["header:authorization", "id"]) },
    });

    expect(violations).toEqual([]);
  });

  it("accepts a public rule on a route that carries no authenticating hook", () => {
    const violations = findCachePrincipalViolations({
      registered: routes("GET:/providers"),
      rules: { "GET:/providers": cachedRule([], { public: true }) },
    });

    expect(violations).toEqual([]);
  });

  it("ignores a rule whose route the app does not register, a disabled rule and a non-GET key", () => {
    const violations = findCachePrincipalViolations({
      registered: [authenticatedRoute("GET:/disabled"), authenticatedRoute("POST:/written")],
      rules: {
        "GET:/not-mounted": cachedRule([]),
        "GET:/disabled": cachedRule([], { enabled: false }),
        "POST:/written": cachedRule([]),
      },
    });

    expect(violations).toEqual([]);
  });

  it("holds the production rule table against the hooks of the routes it caches", () => {
    // Mirrors the hooks of the eight cached routes as their plugins register them
    // (providerRoutes.ts, analyticsRoutes.ts, postRoutes.ts). The same claim is held
    // against the real registrations by the createApp boot of
    // tests/integration/cacheHitBeforeAuth.integration.test.ts.
    const violations = findCachePrincipalViolations({
      registered: [
        ...routes("GET:/providers"),
        authenticatedRoute("GET:/providers/active"),
        authenticatedRoute("GET:/providers/by-capability/:capability"),
        authenticatedRoute("GET:/providers/:id"),
        authenticatedRoute("GET:/providers/health/all"),
        authenticatedRoute("GET:/analytics/dashboard"),
        authenticatedRoute("GET:/posts"),
        authenticatedRoute("GET:/posts/:id"),
      ],
      rules: CACHE_CONFIG,
    });

    expect(violations).toEqual([]);
  });

  it("throws naming the rule and the discriminator it lacks", () => {
    expect(() =>
      assertCachedResponsesVaryByPrincipal({
        registered: [authenticatedRoute("GET:/analytics/dashboard")],
        rules: { "GET:/analytics/dashboard": cachedRule(["query:projectId"]) },
      })
    ).toThrow(/GET:\/analytics\/dashboard[\s\S]*header:authorization/);
  });
});

describe("autoCachePlugin principal guard", () => {
  const PLANTED_KEY = "GET:/planted/cached-before-auth";

  it("refuses to boot an app that caches an authenticated route without naming the caller", async () => {
    CACHE_CONFIG[PLANTED_KEY] = cachedRule(["query:projectId"]);
    const app = Fastify({ logger: false });
    try {
      app.decorate("cache", new InMemoryCacheAdapter());
      await app.register(autoCachePlugin, { enableCaching: true, enableInvalidation: true });
      app.get("/planted/cached-before-auth", { preHandler: [requireClientAuth] }, async () => ({
        secret: "account A",
      }));

      await expect(app.ready()).rejects.toThrow(
        /GET:\/planted\/cached-before-auth[\s\S]*header:authorization/
      );
    } finally {
      delete CACHE_CONFIG[PLANTED_KEY];
      await app.close();
    }
  });

  it("sees an authenticating hook registered at onRequest and refutes a public claim with it", async () => {
    CACHE_CONFIG[PLANTED_KEY] = cachedRule([], { public: true });
    const app = Fastify({ logger: false });
    try {
      app.decorate("cache", new InMemoryCacheAdapter());
      await app.register(autoCachePlugin, { enableCaching: true, enableInvalidation: true });
      app.get("/planted/cached-before-auth", { onRequest: requireClientAuth }, async () => ({
        secret: "account A",
      }));

      await expect(app.ready()).rejects.toThrow(/unvaried-authenticated/);
    } finally {
      delete CACHE_CONFIG[PLANTED_KEY];
      await app.close();
    }
  });

  it("boots an app that caches the dashboard behind requireClientAuth with the production rule", async () => {
    const app = Fastify({ logger: false });
    app.decorate("cache", new InMemoryCacheAdapter());
    await app.register(autoCachePlugin, { enableCaching: true, enableInvalidation: true });
    app.get("/analytics/dashboard", { preHandler: [requireClientAuth] }, async () => ({}));

    await expect(app.ready()).resolves.toBeDefined();
    await app.close();
  });
});
