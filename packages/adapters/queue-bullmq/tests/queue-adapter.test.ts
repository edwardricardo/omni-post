/**
 * @file queue-adapter.test.ts
 * @description Tests for the parametrised `createBullMQQueueAdapter` —
 *   verifies queue name routing, options pass-through, and close lifecycle.
 *   BullMQ `Queue` and `ioredis` are mocked at the module level so the tests
 *   stay hermetic.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";

const mockQueueAdd = vi.fn(async (_name: string, _payload: unknown, _opts: unknown) => ({
  id: "stub-job-id",
}));
const mockQueueClose = vi.fn(async () => {});
const mockQueueGetWaiting = vi.fn(async () => []);
const mockQueueGetActive = vi.fn(async () => []);
const mockQueueGetCompleted = vi.fn(async () => []);
const mockQueueGetFailed = vi.fn(async () => []);
const mockQueueGetJob = vi.fn(async (_id: string) => null);
const queueConstructor = vi.fn();

vi.mock("bullmq", () => {
  return {
    Queue: vi.fn(function MockQueue(name: string, opts: unknown) {
      queueConstructor(name, opts);
      return {
        add: mockQueueAdd,
        close: mockQueueClose,
        getWaiting: mockQueueGetWaiting,
        getActive: mockQueueGetActive,
        getCompleted: mockQueueGetCompleted,
        getFailed: mockQueueGetFailed,
        getJob: mockQueueGetJob,
      };
    }),
  };
});

const mockRedisPing = vi.fn(async () => "PONG");
const mockRedisQuit = vi.fn(async () => "OK");
const redisConstructor = vi.fn();

vi.mock("ioredis", () => {
  return {
    default: vi.fn(function MockRedis(url: string, opts: unknown) {
      redisConstructor(url, opts);
      return {
        ping: mockRedisPing,
        quit: mockRedisQuit,
      };
    }),
  };
});

import { createBullMQQueueAdapter, type BullMQQueueAdapterOptions } from "../src/queue-adapter.js";

/**
 * A minimal Redis double — the adapter forwards it to the BullMQ Queue and
 * only calls `ping()` on the health path. It never quits the injected socket.
 */
function makeConnectionDouble(): import("ioredis").default {
  return {
    ping: mockRedisPing,
    quit: mockRedisQuit,
  } as unknown as import("ioredis").default;
}

describe("createBullMQQueueAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires `connection` at the type level (no caller can omit it)", () => {
    // The options type makes `connection` REQUIRED — omitting it is a compile
    // error. This @ts-expect-error is the RED-able assertion: when `connection`
    // is optional, the directive is unused and tsc fails (TS2578); when it is
    // required, the directive is satisfied. Drives the real type, not a copy.
    const buildWithoutConnection = (): BullMQQueueAdapterOptions =>
      // @ts-expect-error — connection is required; omitting it must not type-check.
      ({ queueName: "publish" });
    expect(typeof buildWithoutConnection).toBe("function");
  });

  it("throws identifying the missing connection when none is injected (runtime safety net)", () => {
    // The runtime throw is belt-and-suspenders for non-TS callers passing an
    // undefined connection through a cast. Coerce past the required type to
    // exercise it. (test-fixture coercion — constructing invalid state.)
    expect(() =>
      createBullMQQueueAdapter({ queueName: "publish" } as BullMQQueueAdapterOptions)
    ).toThrow(/connection/i);
  });

  it("never constructs its own Redis (no env/localhost fallback) when no connection is injected", () => {
    expect(() =>
      createBullMQQueueAdapter({ queueName: "publish" } as BullMQQueueAdapterOptions)
    ).toThrow();
    expect(redisConstructor).not.toHaveBeenCalled();
  });

  it("creates the BullMQ Queue with the supplied queueName", async () => {
    createBullMQQueueAdapter({
      queueName: "analytics-aggregation",
      connection: makeConnectionDouble(),
    });
    expect(queueConstructor).toHaveBeenCalledTimes(1);
    expect(queueConstructor.mock.calls[0]?.[0]).toBe("analytics-aggregation");
  });

  it("calls queue.add with the supplied queueName when enqueueing", async () => {
    const adapter = createBullMQQueueAdapter({
      queueName: "inbox-sync",
      connection: makeConnectionDouble(),
    });
    const result = await adapter.enqueue({
      dedupeKey: "dedupe-1",
      payload: { foo: "bar" },
    });
    expect(result.ok).toBe(true);
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd.mock.calls[0]?.[0]).toBe("inbox-sync");
    expect(mockQueueAdd.mock.calls[0]?.[1]).toEqual({ foo: "bar" });
  });

  it("uses the injected connection without constructing a new Redis", async () => {
    createBullMQQueueAdapter({ queueName: "publish", connection: makeConnectionDouble() });
    expect(redisConstructor).not.toHaveBeenCalled();
  });

  it("computes delay from runAt when present", async () => {
    const adapter = createBullMQQueueAdapter({
      queueName: "publish",
      connection: makeConnectionDouble(),
    });
    const future = new Date(Date.now() + 60_000);
    await adapter.enqueue({ dedupeKey: "d2", payload: {}, runAt: future });
    const opts = mockQueueAdd.mock.calls[0]?.[2] as { delay?: number };
    expect(opts.delay).toBeGreaterThan(0);
    expect(opts.delay).toBeLessThanOrEqual(60_000);
  });

  it("returns an error Result when the queue.add path fails after retries", async () => {
    mockQueueAdd.mockRejectedValue(new Error("validation error"));
    const adapter = createBullMQQueueAdapter({
      queueName: "publish",
      connection: makeConnectionDouble(),
    });
    const result = await adapter.enqueue({ dedupeKey: "d3", payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either CONNECTION_ERROR or VALIDATION_ERROR is acceptable depending
      // on whether the circuit-breaker wraps the message; both are valid
      // failure modes the caller must handle.
      expect(["CONNECTION_ERROR", "VALIDATION_ERROR"]).toContain(result.error);
    }
  });

  it("close() closes the queue and never quits the injected connection (composition root owns it)", async () => {
    const adapter = createBullMQQueueAdapter({
      queueName: "publish",
      connection: makeConnectionDouble(),
    });
    await adapter.close();
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(mockRedisQuit).not.toHaveBeenCalled();
  });

  it("health() returns counts from BullMQ getters when reachable", async () => {
    mockQueueGetWaiting.mockResolvedValueOnce([1, 2, 3]);
    mockQueueGetActive.mockResolvedValueOnce([{}]);
    mockQueueGetCompleted.mockResolvedValueOnce([]);
    mockQueueGetFailed.mockResolvedValueOnce([{}, {}]);
    const adapter = createBullMQQueueAdapter({
      queueName: "publish",
      connection: makeConnectionDouble(),
    });
    const result = await adapter.health();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.waiting).toBe(3);
      expect(result.value.active).toBe(1);
      expect(result.value.failed).toBe(2);
      expect(result.value.connected).toBe(true);
    }
  });

  it("forwards defaultJobOptions to the BullMQ Queue constructor when provided", async () => {
    createBullMQQueueAdapter({
      queueName: "publish",
      connection: makeConnectionDouble(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    });
    const opts = queueConstructor.mock.calls[0]?.[1] as {
      defaultJobOptions?: { attempts: number; backoff: { type: string; delay: number } };
    };
    expect(opts.defaultJobOptions).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    });
  });

  it("omits defaultJobOptions from the Queue constructor when not provided", async () => {
    createBullMQQueueAdapter({ queueName: "publish", connection: makeConnectionDouble() });
    const opts = queueConstructor.mock.calls[0]?.[1] as { defaultJobOptions?: unknown };
    expect(opts.defaultJobOptions).toBeUndefined();
  });
});
