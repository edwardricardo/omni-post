/**
 * @file Dead Letter Queue — mutation-killing tests (Part 2)
 *
 * Targets surviving Stryker mutants:
 * ObjectLiteral, BlockStatement, StringLiteral, BooleanLiteral
 *
 * Framework: vitest
 */

import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";

// ── Mock infrastructure ──────────────────────────────────────────────────────

const redisStub = {
  on: () => redisStub,
  quit: async () => "OK",
  disconnect: () => undefined,
};

vi.mock("ioredis", () => ({
  default: class MockRedis {
    constructor() {
      return redisStub as unknown as MockRedis;
    }
  },
}));

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

vi.mock("@adapters/queue-bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/queue-bullmq")>();
  return { ...actual };
});

let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `mock-uuid-${++uuidCounter}`,
}));

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

// ── Import source ────────────────────────────────────────────────────────────

let createDeadLetterQueue: typeof import("../src/index.js").createDeadLetterQueue;
let resetDeadLetterQueue: typeof import("../src/index.js").resetDeadLetterQueue;
type DeadLetterQueueManagerType = import("../src/index.js").DeadLetterQueueManager;

beforeAll(async () => {
  const mod = await import("../src/index.js");
  createDeadLetterQueue = mod.createDeadLetterQueue;
  resetDeadLetterQueue = mod.resetDeadLetterQueue;
});

afterAll(() => {
  resetDeadLetterQueue?.();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDlq() {
  return createDeadLetterQueue({ redisUrl: "redis://localhost:6379" });
}

function callProcess(dlq: DeadLetterQueueManagerType, job: unknown) {
  return (
    dlq as unknown as { processFailedOperation: (j: unknown) => Promise<void> }
  ).processFailedOperation(job);
}

function makeFailedOp(overrides: Record<string, unknown> = {}) {
  return {
    id: "op-test",
    service: "test-service",
    operation: "test-op",
    args: [{ postId: "123" }],
    context: {
      originalError: { name: "Error", message: "test error", stack: "" },
      retryCount: 0,
      firstAttempt: new Date(),
      lastAttempt: new Date(),
      fallbackAttempted: false,
    },
    metadata: { priority: "normal" as const, source: "test" },
    status: "pending" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ObjectLiteral — exact structure of queue.add() calls
// ─────────────────────────────────────────────────────────────────────────────

describe("addFailedOperation — exact queue.add() structure", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    queueAddCalls.length = 0;
    uuidCounter = 0;
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("passes correct job name, full data shape, and options", async () => {
    const dlq = makeDlq();
    const originalError = new Error("connection timeout");
    originalError.name = "TimeoutError";

    await dlq.addFailedOperation("publishing", "publish-post", [{ postId: "p1" }], originalError, {
      retryCount: 3,
      firstAttempt: new Date("2024-06-01T00:00:00Z"),
      fallbackAttempted: true,
      metadata: { userId: "u1", requestId: "r1", priority: "high", source: "api" },
    });

    expect(queueAddCalls.length).toBe(1);
    const call = queueAddCalls[0] as {
      jobName: string;
      data: Record<string, unknown>;
      opts: { priority: number; delay: number; jobId: string };
    };

    expect(call.jobName).toBe("process-failed-operation");

    const data = call.data as {
      id: string;
      service: string;
      operation: string;
      args: unknown[];
      status: string;
      context: {
        originalError: { name: string; message: string };
        retryCount: number;
        fallbackAttempted: boolean;
      };
      metadata: { userId: string; requestId: string; priority: string; source: string };
    };
    expect(data.id).toBe("mock-uuid-1");
    expect(data.service).toBe("publishing");
    expect(data.operation).toBe("publish-post");
    expect(data.args).toEqual([{ postId: "p1" }]);
    expect(data.status).toBe("pending");
    expect(data.context.originalError.name).toBe("TimeoutError");
    expect(data.context.originalError.message).toBe("connection timeout");
    expect(data.context.retryCount).toBe(3);
    expect(data.context.fallbackAttempted).toBe(true);
    expect(data.metadata.userId).toBe("u1");
    expect(data.metadata.requestId).toBe("r1");
    expect(data.metadata.priority).toBe("high");
    expect(data.metadata.source).toBe("api");
    expect(call.opts.priority).toBe(75);
    expect(call.opts.delay).toBe(30000);
    expect(call.opts.jobId).toBe("mock-uuid-1");
  });

  it("sets correct initial delay per priority level", async () => {
    const dlq = makeDlq();
    const expected: Record<string, number> = {
      critical: 0,
      high: 30000,
      normal: 300000,
      low: 900000,
    };
    for (const [priority, expectedDelay] of Object.entries(expected)) {
      queueAddCalls.length = 0;
      await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
        retryCount: 0,
        firstAttempt: new Date(),
        fallbackAttempted: false,
        metadata: { priority: priority as "critical" | "high" | "normal" | "low" },
      });
      const call = queueAddCalls[0] as { opts: { delay: number } };
      expect(call.opts.delay).toBe(expectedDelay);
    }
  });
});

describe("processFailedOperation — exact re-enqueue structure", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    queueAddCalls.length = 0;
    uuidCounter = 0;
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("re-enqueues with correct _dlqRetry payload and jobId pattern", async () => {
    const dlq = makeDlq();
    dlq.registerRetryTarget("test-service", "publish");

    const op = {
      id: "op-struct",
      service: "test-service",
      operation: "publish-post",
      args: [{ postId: "p1", channelId: "c1" }],
      context: {
        originalError: { name: "Error", message: "API timeout", stack: "" },
        retryCount: 2,
        firstAttempt: new Date(),
        lastAttempt: new Date(),
        fallbackAttempted: false,
      },
      metadata: { priority: "normal" as const, source: "test" },
      status: "pending" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    queueAddCalls.length = 0;
    await callProcess(dlq, { data: op, id: "job-struct" });

    expect(queueAddCalls.length).toBeGreaterThanOrEqual(1);
    const retryCall = queueAddCalls[queueAddCalls.length - 1] as {
      jobName: string;
      data: {
        postId: string;
        channelId: string;
        _dlqRetry: { dlqJobId: string; retryCount: number; originalError: string };
      };
      opts: { delay: number; jobId: string };
    };

    expect(retryCall.jobName).toBe("publish-post");
    expect(retryCall.data.postId).toBe("p1");
    expect(retryCall.data.channelId).toBe("c1");
    expect(retryCall.data._dlqRetry.dlqJobId).toBe("op-struct");
    expect(retryCall.data._dlqRetry.retryCount).toBe(3);
    expect(retryCall.data._dlqRetry.originalError).toBe("API timeout");
    expect(retryCall.opts.jobId).toBe("op-struct-retry-3");
    expect(retryCall.opts.delay).toBeGreaterThan(0);
  });

  it("increments retryCount and updates lastAttempt and updatedAt", async () => {
    const dlq = makeDlq();
    dlq.registerRetryTarget("test-service", "publish");
    const oldDate = new Date("2020-01-01");
    const op = makeFailedOp({
      context: { ...makeFailedOp().context, retryCount: 1, lastAttempt: oldDate },
      updatedAt: new Date("2020-01-01"),
    });
    await callProcess(dlq, { data: op, id: "job-inc" });
    expect(op.context.retryCount).toBe(2);
    expect(op.context.lastAttempt.getTime()).toBeGreaterThan(oldDate.getTime());
    expect(op.updatedAt.getTime()).toBeGreaterThan(new Date("2020-01-01").getTime());
    expect(op.status).toBe("retrying");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BlockStatement — error paths
// ─────────────────────────────────────────────────────────────────────────────

describe("addFailedOperation — error path", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    queueAddCalls.length = 0;
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("returns err('QUEUE_ERROR') when queue.add throws", async () => {
    const dlq = makeDlq();
    const q = (dlq as unknown as { queue: { add: (...a: unknown[]) => Promise<unknown> } }).queue;
    const origAdd = q.add.bind(q);
    q.add = async () => {
      throw new Error("Redis connection refused");
    };

    const result = await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("QUEUE_ERROR");
    }
    q.add = origAdd;
  });
});

describe("processFailedOperation — re-enqueue failure", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    queueAddCalls.length = 0;
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("resets status to 'pending' and rethrows on retryQueue.add error", async () => {
    const dlq = makeDlq();
    dlq.registerRetryTarget("test-service", "publish");
    const getRetryQueue = (
      dlq as unknown as {
        getRetryQueue: (n: string) => { add: (...a: unknown[]) => Promise<unknown> };
      }
    ).getRetryQueue.bind(dlq);
    const retryQueue = getRetryQueue("publish");
    retryQueue.add = async () => {
      throw new Error("Queue full");
    };

    const op = makeFailedOp();
    await expect(callProcess(dlq, { data: op, id: "jf" })).rejects.toThrow("Queue full");
    expect(op.status).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// StringLiteral — exact Result error values and status strings
// ─────────────────────────────────────────────────────────────────────────────

describe("StringLiteral — exact Result error values", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    queueAddCalls.length = 0;
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("addFailedOperation success returns ok with the uuid", async () => {
    uuidCounter = 0;
    const dlq = makeDlq();
    const result = await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("mock-uuid-1");
    }
  });

  it("manualRetry returns exactly 'NOT_FOUND' when job missing", async () => {
    const dlq = makeDlq();
    const result = await dlq.manualRetry("nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("manualRetry returns exactly 'QUEUE_ERROR' on exception", async () => {
    const dlq = makeDlq();
    (dlq as unknown as { queue: { getJobs: () => Promise<unknown[]> } }).queue.getJobs =
      async () => {
        throw new Error("Redis down");
      };
    const result = await dlq.manualRetry("x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("QUEUE_ERROR");
    }
  });

  it("addFailedOperation sets status to exactly 'pending'", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
    });
    const call = queueAddCalls[queueAddCalls.length - 1] as { data: { status: string } };
    expect(call.data.status).toBe("pending");
  });

  it("processFailedOperation sets status 'retrying' on success", async () => {
    const dlq = makeDlq();
    dlq.registerRetryTarget("svc", "q");
    const op = makeFailedOp({ service: "svc" });
    await callProcess(dlq, { data: op, id: "j" });
    expect(op.status).toBe("retrying");
  });

  it("processFailedOperation sets status 'abandoned' on max retries", async () => {
    const dlq = makeDlq();
    dlq.registerRetryTarget("svc", "q");
    const op = makeFailedOp({
      service: "svc",
      context: { ...makeFailedOp().context, retryCount: 5 },
    });
    await callProcess(dlq, { data: op, id: "j" });
    expect(op.status).toBe("abandoned");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BooleanLiteral — isProcessing state management
// ─────────────────────────────────────────────────────────────────────────────

describe("startProcessing / stopProcessing", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("isProcessing starts false", () => {
    const dlq = makeDlq();
    expect((dlq as unknown as { isProcessing: boolean }).isProcessing).toBe(false);
  });

  it("isProcessing becomes true after startProcessing()", async () => {
    const dlq = makeDlq();
    await dlq.startProcessing();
    expect((dlq as unknown as { isProcessing: boolean }).isProcessing).toBe(true);
  });

  it("isProcessing becomes false after stopProcessing()", async () => {
    const dlq = makeDlq();
    await dlq.startProcessing();
    await dlq.stopProcessing();
    expect((dlq as unknown as { isProcessing: boolean }).isProcessing).toBe(false);
  });

  it("worker is not null after start, null after stop", async () => {
    const dlq = makeDlq();
    await dlq.startProcessing();
    expect((dlq as unknown as { worker: unknown }).worker).not.toBeNull();
    await dlq.stopProcessing();
    expect((dlq as unknown as { worker: unknown }).worker).toBeNull();
  });

  it("second startProcessing call is a no-op (same worker)", async () => {
    const dlq = makeDlq();
    await dlq.startProcessing();
    const w1 = (dlq as unknown as { worker: unknown }).worker;
    await dlq.startProcessing();
    expect((dlq as unknown as { worker: unknown }).worker).toBe(w1);
  });

  it("stopProcessing when not started is a safe no-op", async () => {
    const dlq = makeDlq();
    await dlq.stopProcessing();
    expect((dlq as unknown as { isProcessing: boolean }).isProcessing).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getQueueStats, getFailedOperations, manualRetry, cleanup, close
// ─────────────────────────────────────────────────────────────────────────────

describe("getQueueStats()", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });
  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("returns correct shape with zero-length arrays", async () => {
    const dlq = makeDlq();
    expect(await dlq.getQueueStats()).toEqual({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    });
  });
});

describe("getFailedOperations()", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });
  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("returns empty array when no jobs exist", async () => {
    expect(await makeDlq().getFailedOperations()).toEqual([]);
  });

  it("returns empty when filtering by status with no matches", async () => {
    expect(await makeDlq().getFailedOperations("abandoned")).toEqual([]);
  });

  it("filters by status and sorts by createdAt descending", async () => {
    const dlq = makeDlq();
    const q = (
      dlq as unknown as { queue: { getJobs: () => Promise<{ data: Record<string, unknown> }[]> } }
    ).queue;
    q.getJobs = async () => [
      { data: { status: "pending", createdAt: new Date("2024-01-03") } },
      { data: { status: "abandoned", createdAt: new Date("2024-01-02") } },
      { data: { status: "pending", createdAt: new Date("2024-01-01") } },
    ];
    const ops = await dlq.getFailedOperations("pending");
    expect(ops.length).toBe(2);
    expect(ops[0].createdAt.getTime()).toBeGreaterThan(ops[1].createdAt.getTime());
  });

  it("returns all operations when no status filter given", async () => {
    const dlq = makeDlq();
    const q = (
      dlq as unknown as { queue: { getJobs: () => Promise<{ data: Record<string, unknown> }[]> } }
    ).queue;
    q.getJobs = async () => [
      { data: { status: "pending", createdAt: new Date("2024-01-01") } },
      { data: { status: "abandoned", createdAt: new Date("2024-01-02") } },
    ];
    expect((await dlq.getFailedOperations()).length).toBe(2);
  });
});

describe("manualRetry()", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    queueAddCalls.length = 0;
    vi.clearAllMocks();
  });
  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("finds job, resets status, re-enqueues with priority 100", async () => {
    const dlq = makeDlq();
    const opData = { id: "op-manual", status: "abandoned", updatedAt: new Date("2020-01-01") };
    const q = (
      dlq as unknown as { queue: { getJobs: () => Promise<{ data: Record<string, unknown> }[]> } }
    ).queue;
    q.getJobs = async () => [{ data: opData }];

    queueAddCalls.length = 0;
    const result = await dlq.manualRetry("op-manual");

    expect(result.ok).toBe(true);
    expect(opData.status).toBe("pending");
    expect(opData.updatedAt.getTime()).toBeGreaterThan(new Date("2020-01-01").getTime());
    expect(queueAddCalls.length).toBe(1);
    const call = queueAddCalls[0] as { jobName: string; opts: { priority: number; jobId: string } };
    expect(call.jobName).toBe("process-failed-operation");
    expect(call.opts.priority).toBe(100);
    expect(call.opts.jobId).toMatch(/^op-manual-manual-/);
  });
});

describe("cleanup()", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });
  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("calls queue.clean with correct retention ms", async () => {
    resetDeadLetterQueue();
    const dlq = createDeadLetterQueue({ redisUrl: "redis://localhost:6379", maxRetentionDays: 7 });
    const cleanCalls: unknown[] = [];
    const q = (dlq as unknown as { queue: { clean: (...a: unknown[]) => Promise<unknown[]> } })
      .queue;
    q.clean = async (...args: unknown[]) => {
      cleanCalls.push(args);
      return [];
    };

    await dlq.cleanup();

    const expectedMs = 7 * 24 * 60 * 60 * 1000;
    expect(cleanCalls.length).toBe(2);
    expect(cleanCalls[0]).toEqual([expectedMs, 0, "completed"]);
    expect(cleanCalls[1]).toEqual([expectedMs, 0, "failed"]);
  });
});

describe("close()", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });
  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("clears retryQueues and sets isProcessing false", async () => {
    const dlq = makeDlq();
    dlq.registerRetryTarget("svc", "q");
    const grq = (dlq as unknown as { getRetryQueue: (n: string) => unknown }).getRetryQueue.bind(
      dlq
    );
    grq("q");
    const retryQueues = (dlq as unknown as { retryQueues: Map<string, unknown> }).retryQueues;
    expect(retryQueues.size).toBe(1);
    await dlq.close();
    expect(retryQueues.size).toBe(0);
    expect((dlq as unknown as { isProcessing: boolean }).isProcessing).toBe(false);
  });

  it("continues closing even if a retry queue close throws", async () => {
    const dlq = makeDlq();
    const retryQueues = (
      dlq as unknown as {
        retryQueues: Map<string, { close: () => Promise<void> }>;
      }
    ).retryQueues;
    retryQueues.set("bad", {
      close: async () => {
        throw new Error("close failed");
      },
    });
    retryQueues.set("good", { close: async () => undefined });
    await expect(dlq.close()).resolves.toBeUndefined();
    expect(retryQueues.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getRetryQueue — cache behavior
// ─────────────────────────────────────────────────────────────────────────────

describe("getRetryQueue — lazy caching", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    vi.clearAllMocks();
  });
  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("reuses the same queue instance on repeated calls", () => {
    const dlq = makeDlq();
    const grq = (dlq as unknown as { getRetryQueue: (n: string) => unknown }).getRetryQueue.bind(
      dlq
    );
    expect(grq("q")).toBe(grq("q"));
  });

  it("creates separate instances for different names", () => {
    const dlq = makeDlq();
    const grq = (dlq as unknown as { getRetryQueue: (n: string) => unknown }).getRetryQueue.bind(
      dlq
    );
    expect(grq("a")).not.toBe(grq("b"));
  });
});
