/**
 * @file redis-cache-adapter.test.ts
 * @description Tests for `RedisCacheAdapter` — verifies the wrapper correctly
 *              translates `Result<T, E>` returns from `RedisCacheManager` into
 *              the plain `CachePort` shape, propagates factory errors from
 *              `getOrSet`, and degrades gracefully on cache failures.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { ok, err } from "@shared/types";
import { RedisCacheAdapter } from "../src/redis-cache-adapter.js";
import type { RedisCacheManager } from "../src/cache-manager.js";

function makeFakeManager(): {
  manager: RedisCacheManager;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  invalidateByTag: ReturnType<typeof vi.fn>;
  has: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn();
  const set = vi.fn();
  const del = vi.fn();
  const invalidateByTag = vi.fn();
  const has = vi.fn();
  const manager = { get, set, del, invalidateByTag, has } as unknown as RedisCacheManager;
  return { manager, get, set, del, invalidateByTag, has };
}

describe("RedisCacheAdapter", () => {
  let fake: ReturnType<typeof makeFakeManager>;
  let adapter: RedisCacheAdapter;

  beforeEach(() => {
    fake = makeFakeManager();
    adapter = new RedisCacheAdapter(fake.manager);
  });

  describe("get()", () => {
    it("returns the value when manager returns ok(value)", async () => {
      fake.get.mockResolvedValue(ok("hello"));
      expect(await adapter.get<string>("k")).toBe("hello");
      expect(fake.get).toHaveBeenCalledWith("k");
    });

    it("returns null when manager returns ok(null)", async () => {
      fake.get.mockResolvedValue(ok(null));
      expect(await adapter.get("missing")).toBeNull();
    });

    it("returns null and degrades silently when manager returns err()", async () => {
      fake.get.mockResolvedValue(err("CACHE_ERROR"));
      expect(await adapter.get("k")).toBeNull();
    });
  });

  describe("set()", () => {
    it("forwards ttlSeconds → ttl and tags to the manager", async () => {
      fake.set.mockResolvedValue(ok(undefined));
      await adapter.set("k", { v: 1 }, { ttlSeconds: 60, tags: ["t1", "t2"] });
      expect(fake.set).toHaveBeenCalledWith("k", { v: 1 }, { ttl: 60, tags: ["t1", "t2"] });
    });

    it("omits ttl/tags entirely when not provided (uses manager defaults)", async () => {
      fake.set.mockResolvedValue(ok(undefined));
      await adapter.set("k", "v");
      expect(fake.set).toHaveBeenCalledWith("k", "v", {});
    });

    it("does not throw when manager returns err() (best-effort write)", async () => {
      fake.set.mockResolvedValue(err("CACHE_ERROR"));
      await expect(adapter.set("k", "v")).resolves.toBeUndefined();
    });
  });

  describe("getOrSet()", () => {
    it("returns the cached value without invoking the factory on hit", async () => {
      fake.get.mockResolvedValue(ok("cached"));
      const factory = vi.fn();
      expect(await adapter.getOrSet("k", factory)).toBe("cached");
      expect(factory).not.toHaveBeenCalled();
      expect(fake.set).not.toHaveBeenCalled();
    });

    it("invokes factory on miss, stores the result, and returns it", async () => {
      fake.get.mockResolvedValue(ok(null));
      fake.set.mockResolvedValue(ok(undefined));
      const factory = vi.fn(async () => "computed");
      const result = await adapter.getOrSet("k", factory, { ttlSeconds: 30 });
      expect(result).toBe("computed");
      expect(factory).toHaveBeenCalledTimes(1);
      expect(fake.set).toHaveBeenCalledWith("k", "computed", { ttl: 30 });
    });

    it("propagates factory errors to the caller", async () => {
      fake.get.mockResolvedValue(ok(null));
      const factory = vi.fn(async () => {
        throw new Error("factory blew up");
      });
      await expect(adapter.getOrSet("k", factory)).rejects.toThrow("factory blew up");
    });

    it("treats a get error as a miss and runs the factory", async () => {
      fake.get.mockResolvedValue(err("CACHE_ERROR"));
      fake.set.mockResolvedValue(ok(undefined));
      const factory = vi.fn(async () => "fallback");
      expect(await adapter.getOrSet("k", factory)).toBe("fallback");
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe("delete() / invalidateByTag() / has()", () => {
    it("delete forwards to manager.del and swallows errors", async () => {
      fake.del.mockResolvedValue(err("CACHE_ERROR"));
      await expect(adapter.delete("k")).resolves.toBeUndefined();
      expect(fake.del).toHaveBeenCalledWith("k");
    });

    it("invalidateByTag forwards to manager and swallows errors", async () => {
      fake.invalidateByTag.mockResolvedValue(err("CACHE_ERROR"));
      await expect(adapter.invalidateByTag("posts")).resolves.toBeUndefined();
      expect(fake.invalidateByTag).toHaveBeenCalledWith("posts");
    });

    it("has() returns the manager value on success", async () => {
      fake.has.mockResolvedValue(ok(true));
      expect(await adapter.has("k")).toBe(true);
    });

    it("has() returns false on manager error (treated as absent)", async () => {
      fake.has.mockResolvedValue(err("CACHE_ERROR"));
      expect(await adapter.has("k")).toBe(false);
    });
  });
});
