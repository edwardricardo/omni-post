/**
 * @file queue-port-registry.test.ts
 * @description Tests for `BullMQQueuePortRegistry` — verifies memoisation
 *   per queue name, connection sharing semantics, idempotent close, and
 *   post-close behaviour.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";

const queueConstructor = vi.fn();
const mockQueueClose = vi.fn(async () => {});

vi.mock("bullmq", () => ({
  Queue: vi.fn(function MockQueue(name: string, opts: unknown) {
    queueConstructor(name, opts);
    return {
      add: vi.fn(),
      close: mockQueueClose,
      getWaiting: vi.fn(async () => []),
      getActive: vi.fn(async () => []),
      getCompleted: vi.fn(async () => []),
      getFailed: vi.fn(async () => []),
      getJob: vi.fn(),
    };
  }),
}));

vi.mock("ioredis", () => ({
  default: vi.fn(function MockRedis() {
    return { ping: vi.fn(async () => "PONG"), quit: vi.fn(async () => "OK") };
  }),
}));

import { BullMQQueuePortRegistry } from "../src/queue-port-registry.js";
import type { Redis } from "ioredis";

const fakeConnection = {
  ping: async () => "PONG",
  quit: async () => "OK",
} as unknown as Redis;

describe("BullMQQueuePortRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a QueuePort for the requested queue name", () => {
    const registry = new BullMQQueuePortRegistry({ connection: fakeConnection });
    const port = registry.forQueue("publish");
    expect(typeof port.enqueue).toBe("function");
    expect(typeof port.health).toBe("function");
    expect(typeof port.remove).toBe("function");
  });

  it("memoises by queue name (same instance across repeated calls)", () => {
    const registry = new BullMQQueuePortRegistry({ connection: fakeConnection });
    const a = registry.forQueue("publish");
    const b = registry.forQueue("publish");
    expect(a).toBe(b);
    expect(queueConstructor).toHaveBeenCalledTimes(1);
  });

  it("creates a distinct QueuePort per queue name", () => {
    const registry = new BullMQQueuePortRegistry({ connection: fakeConnection });
    const publish = registry.forQueue("publish");
    const inbox = registry.forQueue("inbox-sync");
    expect(publish).not.toBe(inbox);
    expect(queueConstructor).toHaveBeenCalledTimes(2);
    expect(queueConstructor.mock.calls[0]?.[0]).toBe("publish");
    expect(queueConstructor.mock.calls[1]?.[0]).toBe("inbox-sync");
  });

  it("close() invokes underlying adapter close for each registered queue", async () => {
    const registry = new BullMQQueuePortRegistry({ connection: fakeConnection });
    registry.forQueue("publish");
    registry.forQueue("inbox-sync");
    await registry.close();
    expect(mockQueueClose).toHaveBeenCalledTimes(2);
  });

  it("close() is idempotent — second call is a no-op", async () => {
    const registry = new BullMQQueuePortRegistry({ connection: fakeConnection });
    registry.forQueue("publish");
    await registry.close();
    await registry.close();
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
  });

  it("forQueue() throws after close()", async () => {
    const registry = new BullMQQueuePortRegistry({ connection: fakeConnection });
    await registry.close();
    expect(() => registry.forQueue("publish")).toThrow(/closed/i);
  });

  it("applies defaultJobOptionsByQueue lookup when constructing per-queue adapters", () => {
    const registry = new BullMQQueuePortRegistry({
      connection: fakeConnection,
      defaultJobOptionsByQueue: {
        publish: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
        "inbox-sync": { attempts: 2 },
      },
    });
    registry.forQueue("publish");
    registry.forQueue("inbox-sync");
    registry.forQueue("no-config");
    // The Queue constructor receives the looked-up options, undefined when no entry.
    const callOpts = queueConstructor.mock.calls.map(
      (c) => c[1] as { defaultJobOptions?: { attempts?: number } }
    );
    expect(callOpts[0]?.defaultJobOptions).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    });
    expect(callOpts[1]?.defaultJobOptions).toEqual({ attempts: 2 });
    expect(callOpts[2]?.defaultJobOptions).toBeUndefined();
  });
});
