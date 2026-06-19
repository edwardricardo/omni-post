/**
 * @file Dead Letter Queue — unit tests
 *
 * Tier 0: No Redis, no BullMQ connectivity.
 * All external dependencies are mocked via vi.mock() before importing
 * the source module.
 *
 * Framework: vitest
 */

import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";

// ── Mock infrastructure modules BEFORE importing the source ──────────────────

// Stub ioredis — constructor returns an object with .on() and .quit()
const redisStub = {
  on: () => redisStub,
  quit: async () => "OK",
  disconnect: () => undefined,
};

// ioredis exposes Redis both as the default export and as a named export.
// The source imports the named `{ Redis }` (ADR-0017 §1), so the mock MUST
// return it under that name too — not only `default`.
class MockRedis {
  constructor() {
    return redisStub as unknown as MockRedis;
  }
}

vi.mock("ioredis", () => ({
  default: MockRedis,
  Redis: MockRedis,
}));

// Stub bullmq — Queue, Worker, QueueEvents, Job
const queueAddCalls: unknown[] = [];

vi.mock("bullmq", () => ({
  Queue: class MockQueue {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    async add(_jobName: string, data: unknown, opts?: { jobId?: string; priority?: number }) {
      queueAddCalls.push({ jobName: _jobName, data, opts });
      return { id: opts?.jobId ?? "mock-job-id", data };
    }
    async getWaiting() {
      return [];
    }
    async getActive() {
      return [];
    }
    async getCompleted() {
      return [];
    }
    async getFailed() {
      return [];
    }
    async getDelayed() {
      return [];
    }
    async getJobs() {
      return [];
    }
    async clean() {
      return [];
    }
    async close() {
      return undefined;
    }
  },
  Worker: class MockWorker {
    constructor() {
      /* no-op */
    }
    on() {
      return this;
    }
    async close() {
      return undefined;
    }
  },
  QueueEvents: class MockQueueEvents {
    constructor() {
      /* no-op */
    }
    on() {
      return this;
    }
    async close() {
      return undefined;
    }
  },
  Job: class MockJob {},
}));

// Use real QUEUE_NAMES + any future exports — the package has zero side effects
// at import time, so importOriginal is safe and prevents drift when keys are added.
vi.mock("@adapters/queue-bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/queue-bullmq")>();
  return { ...actual };
});

// Stub uuid
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `mock-uuid-${++uuidCounter}`,
}));

// Stub pino
vi.mock("pino", () => ({
  default: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => ({
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    }),
  }),
}));

// ── Now import the source (mocks are in place) ──────────────────────────────

let createDeadLetterQueue: typeof import("../src/index.js").createDeadLetterQueue;
let getDeadLetterQueue: typeof import("../src/index.js").getDeadLetterQueue;
let resetDeadLetterQueue: typeof import("../src/index.js").resetDeadLetterQueue;
let calculateRetryDelay: typeof import("../src/index.js").calculateRetryDelay;
let DeadLetterQueueManager: typeof import("../src/index.js").DeadLetterQueueManager;

beforeAll(async () => {
  const mod = await import("../src/index.js");
  createDeadLetterQueue = mod.createDeadLetterQueue;
  getDeadLetterQueue = mod.getDeadLetterQueue;
  resetDeadLetterQueue = mod.resetDeadLetterQueue;
  calculateRetryDelay = mod.calculateRetryDelay;
  DeadLetterQueueManager = mod.DeadLetterQueueManager;
});

afterAll(() => {
  // Ensure the singleton is cleared so other tests start clean
  resetDeadLetterQueue?.();
});

// ─────────────────────────────────────────────────────────────────────────────
// Factory / Singleton tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createDeadLetterQueue()", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("returns a DeadLetterQueueManager instance", () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    expect(dlq instanceof DeadLetterQueueManager).toBeTruthy();
  });

  it("is idempotent — returns the SAME instance on repeated calls", () => {
    const dlq1 = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    const dlq2 = createDeadLetterQueue({ redisUrl: "redis://other-host:6379" });
    expect(dlq1).toBe(dlq2);
  });
});

describe("getDeadLetterQueue()", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("returns null when no manager has been created yet", () => {
    expect(getDeadLetterQueue()).toBe(null);
  });

  it("returns the manager after createDeadLetterQueue() is called", () => {
    const created = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    const retrieved = getDeadLetterQueue();
    expect(retrieved).toBe(created);
  });
});

describe("resetDeadLetterQueue()", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });

  it("resets the singleton so getDeadLetterQueue() returns null", () => {
    createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    assert.ok(getDeadLetterQueue() !== null, "should have a manager before reset");
    resetDeadLetterQueue();
    expect(getDeadLetterQueue()).toBe(null);
  });

  it("allows a new instance to be created after reset", () => {
    const first = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    resetDeadLetterQueue();
    const second = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    expect(first).not.toBe(second);
  });

  it("is safe to call multiple times", () => {
    resetDeadLetterQueue();
    resetDeadLetterQueue();
    expect(getDeadLetterQueue()).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateRetryDelay — pure function tests
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateRetryDelay()", { concurrent: false }, () => {
  const BASE_DELAY = 1000; // 1 second
  const MAX_DELAY = 60000; // 60 seconds
  const MULTIPLIER = 2;

  it("returns deterministic values for the same inputs (jitter enabled)", () => {
    const delay1 = calculateRetryDelay(3, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
    const delay2 = calculateRetryDelay(3, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
    expect(delay1).toBe(delay2);
  });

  it("returns different delays for different attempt numbers (jitter enabled)", () => {
    const delay0 = calculateRetryDelay(0, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
    const delay5 = calculateRetryDelay(5, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
    expect(delay0).not.toBe(delay5);
  });

  it("applies exponential backoff correctly (jitter disabled)", () => {
    // Without jitter: delay = min(baseDelay * multiplier^attempt, maxDelay)
    const delay0 = calculateRetryDelay(0, BASE_DELAY, MAX_DELAY, MULTIPLIER, false);
    const delay1 = calculateRetryDelay(1, BASE_DELAY, MAX_DELAY, MULTIPLIER, false);
    const delay2 = calculateRetryDelay(2, BASE_DELAY, MAX_DELAY, MULTIPLIER, false);
    const delay3 = calculateRetryDelay(3, BASE_DELAY, MAX_DELAY, MULTIPLIER, false);

    // attempt 0: 1000 * 2^0 = 1000
    expect(delay0).toBe(1000);
    // attempt 1: 1000 * 2^1 = 2000
    expect(delay1).toBe(2000);
    // attempt 2: 1000 * 2^2 = 4000
    expect(delay2).toBe(4000);
    // attempt 3: 1000 * 2^3 = 8000
    expect(delay3).toBe(8000);
  });

  it("caps delay at maxDelay (jitter disabled)", () => {
    // attempt 10: 1000 * 2^10 = 1024000, capped to 60000
    const delay = calculateRetryDelay(10, BASE_DELAY, MAX_DELAY, MULTIPLIER, false);
    expect(delay).toBe(MAX_DELAY);
  });

  it("caps delay at maxDelay (jitter enabled)", () => {
    // With jitter the base exponential is capped first, then jitter is applied.
    // Jitter can reduce but never exceed 25% of the capped delay.
    // So the result should be <= maxDelay * 1.25 and > 0.
    const delay = calculateRetryDelay(10, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
    expect(delay > 0).toBeTruthy();
    // The deterministic jitter formula: exponentialDelay + (factor - 0.5) * 2 * (exponentialDelay * 0.25)
    // Max possible jitter: exponentialDelay + 1 * (exponentialDelay * 0.25) = 1.25 * exponentialDelay
    expect(delay <= MAX_DELAY * 1.25).toBeTruthy();
  });

  it("returns exactly baseDelay for attempt 0 with multiplier 2 (jitter disabled)", () => {
    const delay = calculateRetryDelay(0, 5000, 100000, 2, false);
    expect(delay).toBe(5000);
  });

  it("never returns a negative value (jitter enabled)", () => {
    // Test several attempts to ensure the Math.max(0, ...) guard works
    for (let attempt = 0; attempt < 20; attempt++) {
      const delay = calculateRetryDelay(attempt, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
      expect(delay >= 0).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Default configuration values
// ─────────────────────────────────────────────────────────────────────────────

describe("DeadLetterQueueManager — default config", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("applies correct default values when only redisUrl is provided", () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });

    // Access internal config via type assertion
    const config = (dlq as unknown as { config: Record<string, unknown> }).config;
    expect(config.queueName).toBe("dead-letter-queue");
    expect(config.maxRetentionDays).toBe(30);
    expect(config.batchSize).toBe(10);
    expect(config.processingConcurrency).toBe(3);
  });

  it("allows overriding default values", () => {
    const dlq = createDeadLetterQueue({
      redisUrl: "redis://localhost:6379",
      queueName: "custom-dlq",
      maxRetentionDays: 7,
      batchSize: 25,
      processingConcurrency: 5,
    });

    const config = (dlq as unknown as { config: Record<string, unknown> }).config;
    expect(config.queueName).toBe("custom-dlq");
    expect(config.maxRetentionDays).toBe(7);
    expect(config.batchSize).toBe(25);
    expect(config.processingConcurrency).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Priority ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("Priority ordering", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    queueAddCalls.length = 0;
    uuidCounter = 0;
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("assigns correct priority scores (critical > high > normal > low)", async () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });

    const priorities = ["critical", "high", "normal", "low"] as const;
    const expectedScores: Record<string, number> = {
      critical: 100,
      high: 75,
      normal: 50,
      low: 25,
    };

    for (const priority of priorities) {
      queueAddCalls.length = 0;
      await dlq.addFailedOperation("test-service", "test-op", [{}], new Error("test error"), {
        retryCount: 0,
        firstAttempt: new Date(),
        fallbackAttempted: false,
        metadata: { priority, source: "test" },
      });

      expect(queueAddCalls.length >= 1).toBeTruthy();
      const addCall = queueAddCalls[queueAddCalls.length - 1] as {
        opts: { priority: number };
      };
      expect(addCall.opts.priority).toBe(expectedScores[priority]);
    }
  });

  it("assigns higher initial delay for lower priorities", () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });

    // Access the private calculateInitialDelay method
    const calcDelay = (
      dlq as unknown as { calculateInitialDelay: (p: string) => number }
    ).calculateInitialDelay.bind(dlq);

    const criticalDelay = calcDelay("critical");
    const highDelay = calcDelay("high");
    const normalDelay = calcDelay("normal");
    const lowDelay = calcDelay("low");

    expect(criticalDelay).toBe(0);
    expect(highDelay).toBe(30000);
    expect(normalDelay).toBe(300000);
    expect(lowDelay).toBe(900000);

    expect(criticalDelay < highDelay).toBeTruthy();
    expect(highDelay < normalDelay).toBeTruthy();
    expect(normalDelay < lowDelay).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Max retries (shouldRetryNow logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("Max retries enforcement", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("processFailedOperation abandons when retryCount >= maxRetries", async () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });

    // Build a mock Job whose data has retryCount >= 5 (default maxRetries)
    const failedOp = {
      id: "op-abandoned",
      service: "test-service",
      operation: "test-op",
      args: [{}],
      context: {
        originalError: { name: "Error", message: "test", stack: "" },
        retryCount: 5, // equals maxRetries (5)
        firstAttempt: new Date(),
        lastAttempt: new Date(),
        fallbackAttempted: false,
      },
      metadata: {
        priority: "normal" as const,
        source: "test",
      },
      status: "pending" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockJob = { data: failedOp, id: "job-123" };

    // Call the private processFailedOperation method
    await (
      dlq as unknown as { processFailedOperation: (job: unknown) => Promise<void> }
    ).processFailedOperation(mockJob);

    // The operation status should be set to "abandoned"
    expect(failedOp.status).toBe("abandoned");
  });

  it("processFailedOperation abandons when no retry target is registered", async () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });

    const failedOp = {
      id: "op-no-target",
      service: "unregistered-service",
      operation: "test-op",
      args: [{}],
      context: {
        originalError: { name: "Error", message: "test", stack: "" },
        retryCount: 0,
        firstAttempt: new Date(),
        lastAttempt: new Date(),
        fallbackAttempted: false,
      },
      metadata: {
        priority: "normal" as const,
        source: "test",
      },
      status: "pending" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockJob = { data: failedOp, id: "job-456" };

    await (
      dlq as unknown as { processFailedOperation: (job: unknown) => Promise<void> }
    ).processFailedOperation(mockJob);

    expect(failedOp.status).toBe("abandoned");
  });

  it("processFailedOperation re-enqueues when retryCount < maxRetries and target is registered", async () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });

    // Register a retry target
    dlq.registerRetryTarget("test-service", "publish");

    queueAddCalls.length = 0;

    const failedOp = {
      id: "op-retry",
      service: "test-service",
      operation: "test-op",
      args: [{ postId: "123" }],
      context: {
        originalError: { name: "Error", message: "test error", stack: "" },
        retryCount: 2, // less than maxRetries (5)
        firstAttempt: new Date(),
        lastAttempt: new Date(),
        fallbackAttempted: false,
      },
      metadata: {
        priority: "normal" as const,
        source: "test",
      },
      status: "pending" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockJob = { data: failedOp, id: "job-789" };

    await (
      dlq as unknown as { processFailedOperation: (job: unknown) => Promise<void> }
    ).processFailedOperation(mockJob);

    expect(failedOp.status).toBe("retrying");
    expect(failedOp.context.retryCount).toBe(3);
    expect(queueAddCalls.length >= 1).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerRetryTarget
// ─────────────────────────────────────────────────────────────────────────────

describe("registerRetryTarget()", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("registers a retry target for a service", () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    dlq.registerRetryTarget("publishing", "publish");

    const targets = (dlq as unknown as { retryTargets: Map<string, string> }).retryTargets;
    expect(targets.get("publishing")).toBe("publish");
  });

  it("overwrites an existing target for the same service", () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    dlq.registerRetryTarget("publishing", "publish-v1");
    dlq.registerRetryTarget("publishing", "publish-v2");

    const targets = (dlq as unknown as { retryTargets: Map<string, string> }).retryTargets;
    expect(targets.get("publishing")).toBe("publish-v2");
  });
});
