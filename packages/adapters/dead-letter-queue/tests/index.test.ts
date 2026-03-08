/**
 * @file Dead Letter Queue — unit tests
 *
 * Tier 0: No Redis, no BullMQ connectivity.
 * All external dependencies are mocked via mock.module() before importing
 * the source module.
 *
 * Framework: node:test + node:assert/strict
 */

import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ── Mock infrastructure modules BEFORE importing the source ──────────────────

// Stub ioredis — constructor returns an object with .on() and .quit()
const redisStub = {
  on: () => redisStub,
  quit: async () => "OK",
  disconnect: () => undefined,
};

mock.module("ioredis", {
  defaultExport: class MockRedis {
    constructor() {
      return redisStub as any;
    }
  },
});

// Stub bullmq — Queue, Worker, QueueEvents, Job
const queueAddCalls: any[] = [];

mock.module("bullmq", {
  namedExports: {
    Queue: class MockQueue {
      name: string;
      constructor(name: string) {
        this.name = name;
      }
      async add(_jobName: string, data: any, opts?: any) {
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
  },
});

// Stub @adapters/queue-bullmq (only QUEUE_NAMES is used)
mock.module("@adapters/queue-bullmq", {
  namedExports: {
    QUEUE_NAMES: {
      PUBLISH: "publish",
      WEBHOOK_PROCESSING: "webhook-processing",
      WEBHOOK_DEAD_LETTER: "webhook-dead-letter",
      DEAD_LETTER_QUEUE: "dead-letter-queue",
      INTEGRATION_EVENTS: "integration-events",
      FAILED_OPERATIONS_DLQ: "failed-operations-dlq",
    },
  },
});

// Stub uuid
let uuidCounter = 0;
mock.module("uuid", {
  namedExports: {
    v4: () => `mock-uuid-${++uuidCounter}`,
  },
});

// Stub pino
mock.module("pino", {
  defaultExport: () => ({
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
});

// ── Now import the source (mocks are in place) ──────────────────────────────

let createDeadLetterQueue: typeof import("../src/index.js").createDeadLetterQueue;
let getDeadLetterQueue: typeof import("../src/index.js").getDeadLetterQueue;
let resetDeadLetterQueue: typeof import("../src/index.js").resetDeadLetterQueue;
let calculateRetryDelay: typeof import("../src/index.js").calculateRetryDelay;
let DeadLetterQueueManager: typeof import("../src/index.js").DeadLetterQueueManager;

before(async () => {
  const mod = await import("../src/index.js");
  createDeadLetterQueue = mod.createDeadLetterQueue;
  getDeadLetterQueue = mod.getDeadLetterQueue;
  resetDeadLetterQueue = mod.resetDeadLetterQueue;
  calculateRetryDelay = mod.calculateRetryDelay;
  DeadLetterQueueManager = mod.DeadLetterQueueManager;
});

after(() => {
  // Ensure the singleton is cleared so other tests start clean
  resetDeadLetterQueue?.();
});

// ─────────────────────────────────────────────────────────────────────────────
// Factory / Singleton tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createDeadLetterQueue()", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
  });

  after(() => {
    resetDeadLetterQueue();
  });

  it("returns a DeadLetterQueueManager instance", () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    assert.ok(dlq instanceof DeadLetterQueueManager, "should return a DeadLetterQueueManager");
  });

  it("is idempotent — returns the SAME instance on repeated calls", () => {
    const dlq1 = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    const dlq2 = createDeadLetterQueue({ redisUrl: "redis://other-host:6379" });
    assert.strictEqual(dlq1, dlq2, "should return the same singleton instance");
  });
});

describe("getDeadLetterQueue()", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
  });

  after(() => {
    resetDeadLetterQueue();
  });

  it("returns null when no manager has been created yet", () => {
    assert.strictEqual(getDeadLetterQueue(), null);
  });

  it("returns the manager after createDeadLetterQueue() is called", () => {
    const created = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    const retrieved = getDeadLetterQueue();
    assert.strictEqual(retrieved, created);
  });
});

describe("resetDeadLetterQueue()", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
  });

  it("resets the singleton so getDeadLetterQueue() returns null", () => {
    createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    assert.ok(getDeadLetterQueue() !== null, "should have a manager before reset");
    resetDeadLetterQueue();
    assert.strictEqual(getDeadLetterQueue(), null);
  });

  it("allows a new instance to be created after reset", () => {
    const first = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    resetDeadLetterQueue();
    const second = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    assert.notStrictEqual(first, second, "should create a fresh instance after reset");
  });

  it("is safe to call multiple times", () => {
    resetDeadLetterQueue();
    resetDeadLetterQueue();
    assert.strictEqual(getDeadLetterQueue(), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateRetryDelay — pure function tests
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateRetryDelay()", { concurrency: 1 }, () => {
  const BASE_DELAY = 1000; // 1 second
  const MAX_DELAY = 60000; // 60 seconds
  const MULTIPLIER = 2;

  it("returns deterministic values for the same inputs (jitter enabled)", () => {
    const delay1 = calculateRetryDelay(3, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
    const delay2 = calculateRetryDelay(3, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
    assert.strictEqual(delay1, delay2, "same inputs must produce identical output");
  });

  it("returns different delays for different attempt numbers (jitter enabled)", () => {
    const delay0 = calculateRetryDelay(0, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
    const delay5 = calculateRetryDelay(5, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
    assert.notStrictEqual(delay0, delay5, "different attempts should produce different delays");
  });

  it("applies exponential backoff correctly (jitter disabled)", () => {
    // Without jitter: delay = min(baseDelay * multiplier^attempt, maxDelay)
    const delay0 = calculateRetryDelay(0, BASE_DELAY, MAX_DELAY, MULTIPLIER, false);
    const delay1 = calculateRetryDelay(1, BASE_DELAY, MAX_DELAY, MULTIPLIER, false);
    const delay2 = calculateRetryDelay(2, BASE_DELAY, MAX_DELAY, MULTIPLIER, false);
    const delay3 = calculateRetryDelay(3, BASE_DELAY, MAX_DELAY, MULTIPLIER, false);

    // attempt 0: 1000 * 2^0 = 1000
    assert.strictEqual(delay0, 1000, "attempt 0 should be 1000ms");
    // attempt 1: 1000 * 2^1 = 2000
    assert.strictEqual(delay1, 2000, "attempt 1 should be 2000ms");
    // attempt 2: 1000 * 2^2 = 4000
    assert.strictEqual(delay2, 4000, "attempt 2 should be 4000ms");
    // attempt 3: 1000 * 2^3 = 8000
    assert.strictEqual(delay3, 8000, "attempt 3 should be 8000ms");
  });

  it("caps delay at maxDelay (jitter disabled)", () => {
    // attempt 10: 1000 * 2^10 = 1024000, capped to 60000
    const delay = calculateRetryDelay(10, BASE_DELAY, MAX_DELAY, MULTIPLIER, false);
    assert.strictEqual(delay, MAX_DELAY, "delay should be capped at maxDelay");
  });

  it("caps delay at maxDelay (jitter enabled)", () => {
    // With jitter the base exponential is capped first, then jitter is applied.
    // Jitter can reduce but never exceed 25% of the capped delay.
    // So the result should be <= maxDelay * 1.25 and > 0.
    const delay = calculateRetryDelay(10, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
    assert.ok(delay > 0, "delay must be positive");
    // The deterministic jitter formula: exponentialDelay + (factor - 0.5) * 2 * (exponentialDelay * 0.25)
    // Max possible jitter: exponentialDelay + 1 * (exponentialDelay * 0.25) = 1.25 * exponentialDelay
    assert.ok(
      delay <= MAX_DELAY * 1.25,
      `delay (${delay}) should not exceed maxDelay * 1.25 (${MAX_DELAY * 1.25})`
    );
  });

  it("returns exactly baseDelay for attempt 0 with multiplier 2 (jitter disabled)", () => {
    const delay = calculateRetryDelay(0, 5000, 100000, 2, false);
    assert.strictEqual(delay, 5000, "attempt 0 should equal baseDelay");
  });

  it("never returns a negative value (jitter enabled)", () => {
    // Test several attempts to ensure the Math.max(0, ...) guard works
    for (let attempt = 0; attempt < 20; attempt++) {
      const delay = calculateRetryDelay(attempt, BASE_DELAY, MAX_DELAY, MULTIPLIER, true);
      assert.ok(delay >= 0, `attempt ${attempt}: delay (${delay}) must be non-negative`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Default configuration values
// ─────────────────────────────────────────────────────────────────────────────

describe("DeadLetterQueueManager — default config", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
  });

  after(() => {
    resetDeadLetterQueue();
  });

  it("applies correct default values when only redisUrl is provided", () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });

    // Access internal config via type assertion
    const config = (dlq as any).config;
    assert.strictEqual(config.queueName, "dead-letter-queue");
    assert.strictEqual(config.maxRetentionDays, 30);
    assert.strictEqual(config.batchSize, 10);
    assert.strictEqual(config.processingConcurrency, 3);
  });

  it("allows overriding default values", () => {
    const dlq = createDeadLetterQueue({
      redisUrl: "redis://localhost:6379",
      queueName: "custom-dlq",
      maxRetentionDays: 7,
      batchSize: 25,
      processingConcurrency: 5,
    });

    const config = (dlq as any).config;
    assert.strictEqual(config.queueName, "custom-dlq");
    assert.strictEqual(config.maxRetentionDays, 7);
    assert.strictEqual(config.batchSize, 25);
    assert.strictEqual(config.processingConcurrency, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Priority ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("Priority ordering", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    queueAddCalls.length = 0;
    uuidCounter = 0;
  });

  after(() => {
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

      assert.ok(queueAddCalls.length >= 1, `should have added a job for priority ${priority}`);
      const addCall = queueAddCalls[queueAddCalls.length - 1]!;
      assert.strictEqual(
        addCall.opts.priority,
        expectedScores[priority],
        `priority score for "${priority}" should be ${expectedScores[priority]}`
      );
    }
  });

  it("assigns higher initial delay for lower priorities", () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });

    // Access the private calculateInitialDelay method
    const calcDelay = (dlq as any).calculateInitialDelay.bind(dlq);

    const criticalDelay = calcDelay("critical") as number;
    const highDelay = calcDelay("high") as number;
    const normalDelay = calcDelay("normal") as number;
    const lowDelay = calcDelay("low") as number;

    assert.strictEqual(criticalDelay, 0, "critical should have 0ms delay");
    assert.strictEqual(highDelay, 30000, "high should have 30s delay");
    assert.strictEqual(normalDelay, 300000, "normal should have 5min delay");
    assert.strictEqual(lowDelay, 900000, "low should have 15min delay");

    assert.ok(criticalDelay < highDelay, "critical < high");
    assert.ok(highDelay < normalDelay, "high < normal");
    assert.ok(normalDelay < lowDelay, "normal < low");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Max retries (shouldRetryNow logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("Max retries enforcement", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
  });

  after(() => {
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
    await (dlq as any).processFailedOperation(mockJob);

    // The operation status should be set to "abandoned"
    assert.strictEqual(
      failedOp.status,
      "abandoned",
      "operation should be abandoned when retryCount >= maxRetries"
    );
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

    await (dlq as any).processFailedOperation(mockJob);

    assert.strictEqual(
      failedOp.status,
      "abandoned",
      "operation should be abandoned when no retry target is registered"
    );
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

    await (dlq as any).processFailedOperation(mockJob);

    assert.strictEqual(failedOp.status, "retrying", "status should be 'retrying'");
    assert.strictEqual(failedOp.context.retryCount, 3, "retryCount should be incremented");
    assert.ok(queueAddCalls.length >= 1, "should have re-enqueued the job");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerRetryTarget
// ─────────────────────────────────────────────────────────────────────────────

describe("registerRetryTarget()", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
  });

  after(() => {
    resetDeadLetterQueue();
  });

  it("registers a retry target for a service", () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    dlq.registerRetryTarget("publishing", "publish");

    const targets = (dlq as any).retryTargets as Map<string, string>;
    assert.strictEqual(targets.get("publishing"), "publish");
  });

  it("overwrites an existing target for the same service", () => {
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
    dlq.registerRetryTarget("publishing", "publish-v1");
    dlq.registerRetryTarget("publishing", "publish-v2");

    const targets = (dlq as any).retryTargets as Map<string, string>;
    assert.strictEqual(targets.get("publishing"), "publish-v2");
  });
});
