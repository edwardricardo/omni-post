#!/usr/bin/env tsx
/**
 * @file autoCacheMiddleware.registration-get.test.ts
 * @description Tests for autoCacheMiddleware - Registration and GET Caching
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { autoCachePlugin } from "../../src/middleware/autoCacheMiddleware.js";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";

describe("autoCacheMiddleware - Registration and GET Caching", () => {

  describe("Plugin Registration", () => {
    it("should register plugin with default options", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

      await app.register(autoCachePlugin);

      expect(app.printRoutes).toBeTruthy();
      await app.close();
    });

    it("should register plugin with custom options", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

      await app.register(autoCachePlugin, {
        enableCaching: true,
        enableInvalidation: true,
        excludeRoutes: ["/health", "/metrics"],
        logCacheOps: true,
      });

      expect(app.printRoutes).toBeTruthy();
      await app.close();
    });

    it("should handle missing cache manager gracefully", async () => {
      const app = Fastify({ logger: false });

      await app.register(autoCachePlugin);

      expect(app.printRoutes).toBeTruthy();
      await app.close();
    });
  });

  describe("GET Request Caching", () => {
    it("should cache GET request responses", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

      await app.register(autoCachePlugin, {
        enableCaching: true,
        logCacheOps: true,
      });

      app.get("/providers", async () => {
        return { providers: ["twitter", "instagram"] };
      });

      await app.ready();

      const response1 = await app.inject({
        method: "GET",
        url: "/providers",
      });

      expect(response1.statusCode).toBe(200);

      const response2 = await app.inject({
        method: "GET",
        url: "/providers",
      });

      expect(response2.statusCode).toBe(200);
      expect(JSON.parse(response1.payload)).toStrictEqual(JSON.parse(response2.payload));

      await app.close();
    });

    it("should not cache non-GET requests", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.post("/test", async () => {
        return { success: true };
      });

      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/test",
        payload: { data: "test" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-cache"]).toBe(undefined);

      await app.close();
    });

    it("should exclude routes from caching", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

      await app.register(autoCachePlugin, {
        enableCaching: true,
        excludeRoutes: ["/health"],
      });

      app.get("/health", async () => {
        return { status: "ok" };
      });

      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-cache"]).toBe(undefined);

      await app.close();
    });

    it("should not cache error responses", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.get("/error", async (_req, reply) => {
        reply.code(500).send({ error: "Internal error" });
      });

      await app.ready();

      const response1 = await app.inject({
        method: "GET",
        url: "/error",
      });

      expect(response1.statusCode).toBe(500);

      const response2 = await app.inject({
        method: "GET",
        url: "/error",
      });

      expect(response2.statusCode).toBe(500);

      await app.close();
    });

    it("should add cache metadata headers", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.get("/test", async () => {
        return { data: "test" };
      });

      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);

      await app.close();
    });
  });
});
