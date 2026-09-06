/**
 * @file cacheRouteCoverage.test.ts
 * @description Pins the guard that closes the "dead cache rule" class: a cache
 *              rule keyed to a path pattern no route registers is silently inert,
 *              and the tree gives no signal — the same "dead scope = infallible
 *              gate" failure fitness #36 exists to prevent, one layer down.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import {
  findCacheRouteViolations,
  assertCacheRoutesCovered,
  type RegisteredRoute,
} from "../../../../src/lib/cache/cacheRouteCoverage.js";
import { autoCachePlugin } from "../../../../src/middleware/autoCacheMiddleware.js";

const NO_BASELINE: ReadonlySet<string> = new Set();

function routes(...specs: string[]): RegisteredRoute[] {
  return specs.map((spec) => {
    const separator = spec.indexOf(":");
    return { method: spec.slice(0, separator), url: spec.slice(separator + 1) };
  });
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
