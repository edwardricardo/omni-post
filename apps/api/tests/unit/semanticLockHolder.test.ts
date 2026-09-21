/**
 * @file semanticLockHolder.test.ts
 * @description Pins the holder read the publish admission needs: a caller must be able to
 *              ask WHO holds a semantic lock without trying to take it, because attempting
 *              an acquire to find out would either steal the lock or leave a key behind.
 *              Covers the Redis-backed store and the in-memory double the unit tier uses.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { RedisSemanticLockStore } from "../../src/infrastructure/saga/RedisSemanticLockStore.js";
import { InMemorySemanticLockStore } from "./doubles/InMemorySemanticLockStore.js";

/** The prefix the Redis store namespaces every lock key with. */
const LOCK_KEY = "saga:semlock:post-publishing:post-1";

interface RedisGetStub {
  get: (key: string) => Promise<string | null>;
  readKeys: string[];
}

/**
 * @function createRedisStub
 * @description A Redis double narrow enough to answer only what `holder` uses, so a test
 *              that passes proves the read went through `GET` rather than through a second
 *              command the real client happens to expose.
 * @param answer - What `GET` resolves to, or a rejection to drive the failure arm.
 * @returns The stub and the keys it was asked for.
 */
function createRedisStub(answer: string | null | Error): RedisGetStub {
  const readKeys: string[] = [];
  return {
    readKeys,
    get: async (key: string): Promise<string | null> => {
      readKeys.push(key);
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  };
}

describe("RedisSemanticLockStore.holder", () => {
  it("answers the saga id the lock key holds", async () => {
    const redis = createRedisStub("saga-holding-it");
    const store = new RedisSemanticLockStore(redis as never);

    const result = await store.holder("post-publishing:post-1");

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe("saga-holding-it");
    expect(redis.readKeys).toEqual([LOCK_KEY]);
  });

  it("answers null when nothing holds the key", async () => {
    const redis = createRedisStub(null);
    const store = new RedisSemanticLockStore(redis as never);

    const result = await store.holder("post-publishing:post-1");

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBeNull();
  });

  it("answers a connection error instead of an empty holder when the read fails", async () => {
    const redis = createRedisStub(new Error("redis is down"));
    const store = new RedisSemanticLockStore(redis as never);

    const result = await store.holder("post-publishing:post-1");

    // A failed read reported as `null` would read as "nothing holds it" — the one
    // answer a failed observation cannot support, and the one that would let a second
    // publish through while the first is still running.
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe("CONNECTION_ERROR");
  });
});

describe("InMemorySemanticLockStore", () => {
  let store: InMemorySemanticLockStore;

  beforeEach(() => {
    store = new InMemorySemanticLockStore();
  });

  it("reports no holder for a key nobody took", async () => {
    const result = await store.holder("post-publishing:post-1");

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBeNull();
  });

  it("reports the acquiring saga as the holder", async () => {
    await store.acquire("post-publishing:post-1", "saga-a", 60_000);

    const result = await store.holder("post-publishing:post-1");

    expect(result.ok && result.value).toBe("saga-a");
  });

  it("refuses a second acquire and keeps the first holder", async () => {
    await store.acquire("post-publishing:post-1", "saga-a", 60_000);

    const second = await store.acquire("post-publishing:post-1", "saga-b", 60_000);

    expect(second.ok && second.value).toBe(false);
    const result = await store.holder("post-publishing:post-1");
    expect(result.ok && result.value).toBe("saga-a");
  });

  it("releases only for the holder, never for another saga", async () => {
    await store.acquire("post-publishing:post-1", "saga-a", 60_000);

    await store.release("post-publishing:post-1", "saga-b");
    const stillHeld = await store.holder("post-publishing:post-1");
    expect(stillHeld.ok && stillHeld.value).toBe("saga-a");

    await store.release("post-publishing:post-1", "saga-a");
    const released = await store.holder("post-publishing:post-1");
    expect(released.ok && released.value).toBeNull();
  });

  it("drops every key a saga holds on terminal cleanup", async () => {
    await store.acquire("post-publishing:post-1", "saga-a", 60_000);
    await store.acquire("post-publishing:post-2", "saga-a", 60_000);
    await store.acquire("post-publishing:post-3", "saga-b", 60_000);

    await store.releaseAllForSaga("saga-a");

    expect((await store.holder("post-publishing:post-1")).ok).toBe(true);
    expect(await holderValue(store, "post-publishing:post-1")).toBeNull();
    expect(await holderValue(store, "post-publishing:post-2")).toBeNull();
    expect(await holderValue(store, "post-publishing:post-3")).toBe("saga-b");
  });

  it("plants a holder without an acquire, so a test can start from a contended key", async () => {
    store.plantHolder("post-publishing:post-1", "saga-already-running");

    expect(await holderValue(store, "post-publishing:post-1")).toBe("saga-already-running");
  });

  it("lets a hold LAPSE at its TTL, so the key frees itself as the Redis one does", async () => {
    // The double claims the lapse behaves as production's does. Every other case here reads
    // immediately, so nothing crossed the expiry and the branch that applies it was
    // unproved. The clock is advanced rather than slept on: expiry is checked on read, so a
    // fake clock reaches it without holding the run open for half an hour.
    vi.useFakeTimers();
    try {
      store.plantHolder("post-publishing:post-1", "saga-already-running");
      expect(await holderValue(store, "post-publishing:post-1")).toBe("saga-already-running");

      // One millisecond short of the default 30-minute hold: still held.
      vi.advanceTimersByTime(30 * 60 * 1000 - 1);
      expect(await holderValue(store, "post-publishing:post-1")).toBe("saga-already-running");

      vi.advanceTimersByTime(1);
      expect(await holderValue(store, "post-publishing:post-1")).toBeNull();

      // And the key is genuinely free, not merely unreported: a lapsed hold must let the
      // next saga take it, which is the deadlock guard the TTL exists for.
      const retaken = await store.acquire("post-publishing:post-1", "saga-next", 60_000);
      expect(retaken.ok && retaken.value).toBe(true);
      expect(await holderValue(store, "post-publishing:post-1")).toBe("saga-next");
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * @function holderValue
 * @description Reads the holder and unwraps it, so a case asserting WHO holds a key is not
 *              written twice — once for the Result and once for the value.
 * @param store - The store under test.
 * @param key - The lock key.
 * @returns The holding saga id, or null.
 */
async function holderValue(store: InMemorySemanticLockStore, key: string): Promise<string | null> {
  const result = await store.holder(key);
  if (!result.ok) {
    throw new Error(`holder(${key}) failed: ${result.error}`);
  }
  return result.value;
}
