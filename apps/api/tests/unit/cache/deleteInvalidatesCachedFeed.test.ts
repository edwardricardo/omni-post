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
import { until } from "@packages/vitest-shared/determinism";
import { autoCachePlugin } from "../../../src/middleware/autoCacheMiddleware.js";

/**
 * The cache write in `onSend` and the tag sweep in `onResponse` are both
 * fire-and-forget relative to `inject()` resolving, so each test waits on the
 * cache itself: the entry under the key the response named. The bound sits
 * under vitest's 5 s test timeout, so a wait that fails names what it waited for.
 */
const CACHE_WAIT_TIMEOUT_MS = 2_000;

/** The key the plugin stored a response under, as its `X-Cache-Key` header names it. */
function cacheKeyOf(headers: Readonly<Record<string, unknown>>): string {
  const key = headers["x-cache-key"];
  expect(typeof key).toBe("string");
  return String(key);
}

interface FeedRow {
  id: string;
  projectId: string;
}

/**
 * Build an app whose `GET /posts` reads a mutable feed, plus the two delete
 * routes spelled EXACTLY as the application registers them.
 */
async function buildApp(
  feed: { rows: FeedRow[] },
  cache: InMemoryCacheAdapter
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("cache", cache);

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
  let cache: InMemoryCacheAdapter;
  let feed: { rows: FeedRow[] };

  beforeEach(() => {
    cache = new InMemoryCacheAdapter();
    feed = { rows: [{ id: "post-1", projectId: "project-1" }] };
  });

  /**
   * Caches the feed with a first GET, waits for its background write, and proves the
   * second GET is served from the cache.
   * @returns The key the feed is cached under.
   */
  async function warmFeed(): Promise<string> {
    const first = await app.inject({ method: "GET", url: "/posts" });
    expect(first.headers["x-cache"]).toBe("MISS");
    const feedKey = cacheKeyOf(first.headers);
    await until(() => cache.has(feedKey), {
      description: `the feed response to be cached under ${feedKey}`,
      timeoutMs: CACHE_WAIT_TIMEOUT_MS,
    });

    const second = await app.inject({ method: "GET", url: "/posts" });
    expect(second.headers["x-cache"]).toBe("HIT");
    return feedKey;
  }

  /**
   * Soft-deletes through `url`, waits for the tag sweep to drop the cached feed, and
   * proves the next GET reaches the route and sees the emptied feed.
   */
  async function deleteAndExpectFeedDropped(url: string, feedKey: string): Promise<void> {
    const deleted = await app.inject({ method: "DELETE", url });
    expect(deleted.statusCode).toBe(200);
    await until(async () => !(await cache.has(feedKey)), {
      description: `the cached feed under ${feedKey} to be dropped after DELETE ${url}`,
      timeoutMs: CACHE_WAIT_TIMEOUT_MS,
    });

    const afterDelete = await app.inject({ method: "GET", url: "/posts" });
    expect(afterDelete.headers["x-cache"]).toBe("MISS");
    expect(JSON.parse(afterDelete.payload).posts).toEqual([]);
  }

  it("serves the posts feed from cache on a repeated GET", async () => {
    app = await buildApp(feed, cache);

    await warmFeed();

    await app.close();
  });

  it("drops the cached posts feed when a project is soft-deleted", async () => {
    app = await buildApp(feed, cache);

    const feedKey = await warmFeed();
    await deleteAndExpectFeedDropped("/projects/project-1", feedKey);

    await app.close();
  });

  it("drops the cached posts feed when an account is soft-deleted", async () => {
    app = await buildApp(feed, cache);

    const feedKey = await warmFeed();
    await deleteAndExpectFeedDropped("/accounts/account-1", feedKey);

    await app.close();
  });
});
