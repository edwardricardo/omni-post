/**
 * @file deleteInvalidatesCachedFeed.test.ts
 * @description Live-shaped proof that a project/account delete drops the cached
 *              `GET /posts` feed. Exercises the REAL `autoCachePlugin` against the
 *              REAL registered route patterns (`/projects/:projectId`,
 *              `/accounts/:accountId`) — the spelling mismatch between those and the
 *              invalidation rule keys is precisely what let a deleted project's posts
 *              keep being served from cache for a full TTL.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import { autoCachePlugin } from "../../../src/middleware/autoCacheMiddleware.js";

/**
 * The cache write in `onSend` and the tag sweep in `onResponse` are both
 * fire-and-forget relative to `inject()` resolving. Yield long enough for them
 * to land before the next assertion reads the cache.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

interface FeedRow {
  id: string;
  projectId: string;
}

/**
 * Build an app whose `GET /posts` reads a mutable feed, plus the two delete
 * routes spelled EXACTLY as the application registers them.
 */
async function buildApp(feed: { rows: FeedRow[] }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("cache", new InMemoryCacheAdapter());

  await app.register(autoCachePlugin, {
    enableCaching: true,
    enableInvalidation: true,
  });

  app.get("/posts", async () => ({ posts: feed.rows }));

  // Registered spellings — see projectRoutes.ts / accountRoutes.ts.
  app.delete("/projects/:projectId", async () => {
    feed.rows = [];
    return { deleted: true };
  });
  app.delete("/accounts/:accountId", async () => {
    feed.rows = [];
    return { deleted: true };
  });

  await app.ready();
  return app;
}

describe("cached feed invalidation on soft delete", () => {
  let app: FastifyInstance;
  let feed: { rows: FeedRow[] };

  beforeEach(() => {
    feed = { rows: [{ id: "post-1", projectId: "project-1" }] };
  });

  it("serves the posts feed from cache on a repeated GET", async () => {
    app = await buildApp(feed);

    const first = await app.inject({ method: "GET", url: "/posts" });
    expect(first.headers["x-cache"]).toBe("MISS");
    await settle();

    const second = await app.inject({ method: "GET", url: "/posts" });
    expect(second.headers["x-cache"]).toBe("HIT");

    await app.close();
  });

  it("drops the cached posts feed when a project is soft-deleted", async () => {
    app = await buildApp(feed);

    await app.inject({ method: "GET", url: "/posts" });
    await settle();
    const warmed = await app.inject({ method: "GET", url: "/posts" });
    expect(warmed.headers["x-cache"]).toBe("HIT");

    const deleted = await app.inject({ method: "DELETE", url: "/projects/project-1" });
    expect(deleted.statusCode).toBe(200);
    await settle();

    const afterDelete = await app.inject({ method: "GET", url: "/posts" });
    expect(afterDelete.headers["x-cache"]).toBe("MISS");
    expect(JSON.parse(afterDelete.payload).posts).toEqual([]);

    await app.close();
  });

  it("drops the cached posts feed when an account is soft-deleted", async () => {
    app = await buildApp(feed);

    await app.inject({ method: "GET", url: "/posts" });
    await settle();
    const warmed = await app.inject({ method: "GET", url: "/posts" });
    expect(warmed.headers["x-cache"]).toBe("HIT");

    const deleted = await app.inject({ method: "DELETE", url: "/accounts/account-1" });
    expect(deleted.statusCode).toBe(200);
    await settle();

    const afterDelete = await app.inject({ method: "GET", url: "/posts" });
    expect(afterDelete.headers["x-cache"]).toBe("MISS");
    expect(JSON.parse(afterDelete.payload).posts).toEqual([]);

    await app.close();
  });
});
