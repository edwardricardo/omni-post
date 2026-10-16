/**
 * @file in-memory-cache-adapter.test.ts
 * @description Tests for `InMemoryCacheAdapter` — verifies in-process Map +
 *              TTL semantics, tag-based invalidation, scheduler integration
 *              (cleanup task registration + teardown), `getOrSet`
 *              cache-aside behavior, and the exclusive `claim`.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { InMemoryCacheAdapter } from "../src/in-memory-cache-adapter.js";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

function makeFakeScheduler(): {
  scheduler: BackgroundTaskScheduler;
  callbacks: Map<string, () => void | Promise<void>>;
  triggerTask: (taskId: string) => void;
  unregister: ReturnType<typeof vi.fn>;
} {
  const callbacks = new Map<string, () => void | Promise<void>>();
  const unregister = vi.fn((taskId: string) => {
    callbacks.delete(taskId);
  });
  const scheduler: BackgroundTaskScheduler = {
    register: (taskId, callback) => {
      callbacks.set(taskId, callback);
    },
    unregister,
    shutdownAll: async () => {
      callbacks.clear();
    },
    getActiveTasks: () => [...callbacks.keys()],
  };
  const triggerTask = (taskId: string): void => {
    const cb = callbacks.get(taskId);
    if (cb) void cb();
  };
  return { scheduler, callbacks, triggerTask, unregister };
}

describe("InMemoryCacheAdapter", () => {
  let adapter: InMemoryCacheAdapter;

  beforeEach(() => {
    vi.useRealTimers();
    adapter = new InMemoryCacheAdapter();
  });

  afterEach(() => {
    adapter.close();
  });

  describe("set / get / delete", () => {
    it("returns null on miss", async () => {
      expect(await adapter.get("missing")).toBeNull();
    });

    it("returns the stored value after set", async () => {
      await adapter.set("k", { id: 1, name: "Alice" });
      expect(await adapter.get<{ id: number; name: string }>("k")).toEqual({
        id: 1,
        name: "Alice",
      });
    });

    it("delete removes the entry", async () => {
      await adapter.set("k", "v");
      await adapter.delete("k");
      expect(await adapter.get("k")).toBeNull();
    });
  });

  describe("TTL", () => {
    it("returns null after TTL elapses", async () => {
      vi.useFakeTimers();
      const a = new InMemoryCacheAdapter();
      await a.set("k", "v", { ttlSeconds: 1 });
      expect(await a.get("k")).toBe("v");
      vi.advanceTimersByTime(1500);
      expect(await a.get("k")).toBeNull();
      a.close();
    });

    it("uses defaultTtlSeconds when ttlSeconds is omitted", async () => {
      vi.useFakeTimers();
      const a = new InMemoryCacheAdapter({ defaultTtlSeconds: 2 });
      await a.set("k", "v");
      vi.advanceTimersByTime(1500);
      expect(await a.get("k")).toBe("v");
      vi.advanceTimersByTime(1000);
      expect(await a.get("k")).toBeNull();
      a.close();
    });
  });

  describe("getOrSet", () => {
    it("returns cached value without invoking the factory on hit", async () => {
      await adapter.set("k", "cached");
      const factory = vi.fn(async () => "computed");
      expect(await adapter.getOrSet("k", factory)).toBe("cached");
      expect(factory).not.toHaveBeenCalled();
    });

    it("invokes factory on miss, stores, and returns the value", async () => {
      const factory = vi.fn(async () => "computed");
      expect(await adapter.getOrSet("k", factory)).toBe("computed");
      expect(factory).toHaveBeenCalledTimes(1);
      expect(await adapter.get("k")).toBe("computed");
    });

    it("propagates factory errors to caller", async () => {
      const factory = vi.fn(async () => {
        throw new Error("boom");
      });
      await expect(adapter.getOrSet("k", factory)).rejects.toThrow("boom");
      expect(await adapter.get("k")).toBeNull();
    });
  });

  describe("invalidateByTag", () => {
    it("removes all keys associated with a tag", async () => {
      await adapter.set("a", 1, { tags: ["users"] });
      await adapter.set("b", 2, { tags: ["users", "active"] });
      await adapter.set("c", 3, { tags: ["posts"] });

      await adapter.invalidateByTag("users");

      expect(await adapter.get("a")).toBeNull();
      expect(await adapter.get("b")).toBeNull();
      expect(await adapter.get("c")).toBe(3);
    });

    it("is a no-op for an unknown tag", async () => {
      await adapter.set("a", 1, { tags: ["users"] });
      await adapter.invalidateByTag("nope");
      expect(await adapter.get("a")).toBe(1);
    });

    it("re-tagging a key replaces its previous tag set", async () => {
      await adapter.set("a", 1, { tags: ["users"] });
      await adapter.set("a", 2, { tags: ["posts"] });
      await adapter.invalidateByTag("users");
      expect(await adapter.get("a")).toBe(2);
      await adapter.invalidateByTag("posts");
      expect(await adapter.get("a")).toBeNull();
    });
  });

  describe("has", () => {
    it("returns true when key exists and is not expired", async () => {
      await adapter.set("k", "v");
      expect(await adapter.has("k")).toBe(true);
    });

    it("returns false when key is absent", async () => {
      expect(await adapter.has("k")).toBe(false);
    });

    it("returns false when key has expired", async () => {
      vi.useFakeTimers();
      const a = new InMemoryCacheAdapter();
      await a.set("k", "v", { ttlSeconds: 1 });
      vi.advanceTimersByTime(1500);
      expect(await a.has("k")).toBe(false);
      a.close();
    });
  });

  describe("claim", () => {
    it("resolves true for the first claim on a key, and the key is then held", async () => {
      expect(await adapter.claim("k", 60)).toBe(true);
      expect(await adapter.has("k")).toBe(true);
    });

    it("resolves false for a second claim on a key that is still held", async () => {
      await adapter.claim("k", 60);
      expect(await adapter.claim("k", 60)).toBe(false);
    });

    it("resolves false when set wrote the key and it has not expired", async () => {
      await adapter.set("k", "v", { ttlSeconds: 60 });
      expect(await adapter.claim("k", 60)).toBe(false);
      expect(await adapter.get("k")).toBe("v");
    });

    it("grants exactly one of many concurrent claims on one key", async () => {
      const verdicts = await Promise.all(Array.from({ length: 10 }, () => adapter.claim("k", 60)));
      expect(verdicts.filter(Boolean)).toHaveLength(1);
    });

    it("resolves true again once the claim's TTL has passed", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-16T00:00:00.000Z"));
      const a = new InMemoryCacheAdapter();
      expect(await a.claim("k", 1)).toBe(true);
      vi.setSystemTime(Date.now() + 999);
      expect(await a.claim("k", 1)).toBe(false);
      vi.setSystemTime(Date.now() + 1);
      expect(await a.claim("k", 1)).toBe(true);
      a.close();
    });

    it("resolves true for a key whose entry written by set has expired", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-16T00:00:00.000Z"));
      const a = new InMemoryCacheAdapter();
      await a.set("k", "v", { ttlSeconds: 1, tags: ["t"] });
      vi.setSystemTime(Date.now() + 1000);
      expect(await a.claim("k", 60)).toBe(true);
      await a.invalidateByTag("t");
      expect(await a.has("k")).toBe(true);
      a.close();
    });

    it("rejects a TTL that is not a positive whole number of seconds, and holds nothing", async () => {
      await expect(adapter.claim("k", 0)).rejects.toThrow(RangeError);
      await expect(adapter.claim("k", 1.5)).rejects.toThrow(RangeError);
      expect(await adapter.has("k")).toBe(false);
    });
  });

  describe("scheduler integration", () => {
    it("registers a cleanup task when a scheduler is provided", () => {
      const fake = makeFakeScheduler();
      const a = new InMemoryCacheAdapter({ scheduler: fake.scheduler });
      expect(fake.scheduler.getActiveTasks()).toContain("in-memory-cache-cleanup");
      a.close();
    });

    it("close() unregisters the cleanup task", () => {
      const fake = makeFakeScheduler();
      const a = new InMemoryCacheAdapter({ scheduler: fake.scheduler });
      a.close();
      expect(fake.unregister).toHaveBeenCalledWith("in-memory-cache-cleanup");
      expect(fake.scheduler.getActiveTasks()).not.toContain("in-memory-cache-cleanup");
    });

    it("triggering the cleanup task removes expired entries", async () => {
      vi.useFakeTimers();
      const fake = makeFakeScheduler();
      const a = new InMemoryCacheAdapter({ scheduler: fake.scheduler });
      await a.set("fresh", 1, { ttlSeconds: 60 });
      await a.set("stale", 2, { ttlSeconds: 1 });

      vi.advanceTimersByTime(2000);
      fake.triggerTask("in-memory-cache-cleanup");

      // fresh still readable; stale gone
      expect(await a.get("fresh")).toBe(1);
      expect(await a.get("stale")).toBeNull();
      a.close();
    });
  });
});
