/**
 * @file consumer-adapter.test.ts
 * @description Tests for the parametrised `createBullMQConsumerAdapter`.
 *   Verifies queue name routing on the Worker, concurrency / removeOnComplete
 *   / removeOnFail pass-through, error handler hookup, and connection
 *   ownership semantics on close.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";

const workerInstances: Array<{
  name: string;
  options: {
    concurrency?: number;
    removeOnComplete?: { count: number };
    removeOnFail?: { count: number };
  };
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("bullmq", () => {
  return {
    Worker: vi.fn(function MockWorker(name: string, _handler: unknown, options: unknown) {
      const instance = {
        name,
        options: options as {
          concurrency?: number;
          removeOnComplete?: { count: number };
          removeOnFail?: { count: number };
        },
        on: vi.fn(),
        close: vi.fn(async () => {}),
      };
      workerInstances.push(instance);
      return instance;
    }),
  };
});

const mockRedisQuit = vi.fn(async () => "OK");
const redisConstructor = vi.fn();

vi.mock("ioredis", () => {
  return {
    default: vi.fn(function MockRedis(url: string, opts: unknown) {
      redisConstructor(url, opts);
      return { quit: mockRedisQuit };
    }),
  };
});

import { createBullMQConsumerAdapter } from "../src/consumer-adapter.js";

describe("createBullMQConsumerAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workerInstances.length = 0;
  });

  it("creates a Worker bound to the supplied queueName", async () => {
    const adapter = createBullMQConsumerAdapter({ queueName: "analytics-aggregation" });
    await adapter.subscribe(async () => {});
    expect(workerInstances).toHaveLength(1);
    expect(workerInstances[0]?.name).toBe("analytics-aggregation");
  });

  it("respects concurrency / removeOnComplete / removeOnFail when provided", async () => {
    const adapter = createBullMQConsumerAdapter({
      queueName: "publish",
      concurrency: 12,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 75 },
    });
    await adapter.subscribe(async () => {});
    expect(workerInstances[0]?.options.concurrency).toBe(12);
    expect(workerInstances[0]?.options.removeOnComplete).toEqual({ count: 200 });
    expect(workerInstances[0]?.options.removeOnFail).toEqual({ count: 75 });
  });

  it("falls back to defaults (concurrency=5, complete=100, fail=50) when options are omitted", async () => {
    const adapter = createBullMQConsumerAdapter({ queueName: "publish" });
    await adapter.subscribe(async () => {});
    expect(workerInstances[0]?.options.concurrency).toBe(5);
    expect(workerInstances[0]?.options.removeOnComplete).toEqual({ count: 100 });
    expect(workerInstances[0]?.options.removeOnFail).toEqual({ count: 50 });
  });

  it("registers an error handler on the Worker", async () => {
    const adapter = createBullMQConsumerAdapter({ queueName: "publish" });
    await adapter.subscribe(async () => {});
    expect(workerInstances[0]?.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("close() closes the worker; closes the connection only when adapter owns it", async () => {
    const owned = createBullMQConsumerAdapter({ queueName: "publish" });
    await owned.subscribe(async () => {});
    await owned.close();
    expect(workerInstances[0]?.close).toHaveBeenCalledTimes(1);
    expect(mockRedisQuit).toHaveBeenCalledTimes(1);

    workerInstances.length = 0;
    vi.clearAllMocks();
    const sharedConnection = { quit: mockRedisQuit } as unknown as import("ioredis").default;
    const shared = createBullMQConsumerAdapter({
      queueName: "publish",
      connection: sharedConnection,
    });
    await shared.subscribe(async () => {});
    await shared.close();
    expect(workerInstances[0]?.close).toHaveBeenCalledTimes(1);
    expect(mockRedisQuit).not.toHaveBeenCalled();
  });
});
