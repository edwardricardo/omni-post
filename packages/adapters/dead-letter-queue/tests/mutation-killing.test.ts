/**
 * @file Dead Letter Queue — mutation-killing tests (Part 1)
 *
 * Targets surviving Stryker mutants:
 * ArithmeticOperator, ConditionalExpression
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

vi.mock("@adapters/queue-bullmq", () => ({
  QUEUE_NAMES: {
    PUBLISH: "publish",
    WEBHOOK_PROCESSING: "webhook-processing",
    WEBHOOK_DEAD_LETTER: "webhook-dead-letter",
    DEAD_LETTER_QUEUE: "dead-letter-queue",
    INTEGRATION_EVENTS: "integration-events",
    FAILED_OPERATIONS_DLQ: "failed-operations-dlq",
  },
}));

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
let calculateRetryDelay: typeof import("../src/index.js").calculateRetryDelay;
type DeadLetterQueueManagerType = import("../src/index.js").DeadLetterQueueManager;

beforeAll(async () => {
  const mod = await import("../src/index.js");
  createDeadLetterQueue = mod.createDeadLetterQueue;
  resetDeadLetterQueue = mod.resetDeadLetterQueue;
  calculateRetryDelay = mod.calculateRetryDelay;
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

function getLastAddedData(): Record<string, unknown> {
  const last = queueAddCalls[queueAddCalls.length - 1] as {
    data: Record<string, unknown>;
  };
  return last.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// ArithmeticOperator — exact delay values without jitter
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateRetryDelay — exact values without jitter", { concurrent: false }, () => {
  const BASE = 60000;
  const MAX = 3600000;
  const MULT = 2;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attempt=0 returns exactly 60000", () => {
    expect(calculateRetryDelay(0, BASE, MAX, MULT, false)).toBe(60000);
  });

  it("attempt=1 returns exactly 120000", () => {
    expect(calculateRetryDelay(1, BASE, MAX, MULT, false)).toBe(120000);
  });

  it("attempt=2 returns exactly 240000", () => {
    expect(calculateRetryDelay(2, BASE, MAX, MULT, false)).toBe(240000);
  });

  it("attempt=3 returns exactly 480000", () => {
    expect(calculateRetryDelay(3, BASE, MAX, MULT, false)).toBe(480000);
  });

  it("attempt=4 returns exactly 960000", () => {
    expect(calculateRetryDelay(4, BASE, MAX, MULT, false)).toBe(960000);
  });

  it("attempt=5 returns exactly 1920000", () => {
    expect(calculateRetryDelay(5, BASE, MAX, MULT, false)).toBe(1920000);
  });

  it("attempt=10 is capped at 3600000", () => {
    expect(calculateRetryDelay(10, BASE, MAX, MULT, false)).toBe(3600000);
  });

  it("attempt=20 is still capped at 3600000", () => {
    expect(calculateRetryDelay(20, BASE, MAX, MULT, false)).toBe(3600000);
  });

  it("multiplier=3 attempt=2 returns base * 9 = 540000", () => {
    expect(calculateRetryDelay(2, BASE, MAX, 3, false)).toBe(540000);
  });

  it("multiplier=1 always returns baseDelay regardless of attempt", () => {
    for (let a = 0; a < 5; a++) {
      expect(calculateRetryDelay(a, BASE, MAX, 1, false)).toBe(BASE);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ArithmeticOperator — exact deterministic jitter values
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateRetryDelay — exact deterministic jitter", { concurrent: false }, () => {
  const BASE = 60000;
  const MAX = 3600000;
  const MULT = 2;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attempt=0: factor=0.00, result=45000", () => {
    expect(calculateRetryDelay(0, BASE, MAX, MULT, true)).toBe(45000);
  });

  it("attempt=1: factor=0.61, result=126600", () => {
    expect(calculateRetryDelay(1, BASE, MAX, MULT, true)).toBe(126600);
  });

  it("attempt=2: factor=0.22, result=206400", () => {
    expect(calculateRetryDelay(2, BASE, MAX, MULT, true)).toBe(206400);
  });

  it("attempt=3: factor=0.83, result=559200", () => {
    expect(calculateRetryDelay(3, BASE, MAX, MULT, true)).toBe(559200);
  });

  it("attempt=4: factor=0.44, result=931200", () => {
    expect(calculateRetryDelay(4, BASE, MAX, MULT, true)).toBe(931200);
  });

  it("small base with attempt=0 triggers negative jitter guard", () => {
    expect(calculateRetryDelay(0, 100, 1000000, 2, true)).toBe(75);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConditionalExpression — processFailedOperation boundary conditions
// ─────────────────────────────────────────────────────────────────────────────

describe("processFailedOperation — retry boundaries", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    queueAddCalls.length = 0;
    uuidCounter = 0;
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("retryCount=4 with target registered retries (not abandon)", async () => {
    const dlq = makeDlq();
    dlq.registerRetryTarget("test-service", "publish");
    const op = makeFailedOp({
      context: { ...makeFailedOp().context, retryCount: 4 },
    });
    await callProcess(dlq, { data: op, id: "j4" });
    expect(op.status).toBe("retrying");
    expect(op.context.retryCount).toBe(5);
  });

  it("retryCount=5 (equals maxRetries) abandons", async () => {
    const dlq = makeDlq();
    dlq.registerRetryTarget("test-service", "publish");
    const op = makeFailedOp({
      context: { ...makeFailedOp().context, retryCount: 5 },
    });
    await callProcess(dlq, { data: op, id: "j5" });
    expect(op.status).toBe("abandoned");
  });

  it("retryCount=6 (exceeds maxRetries) abandons", async () => {
    const dlq = makeDlq();
    dlq.registerRetryTarget("test-service", "publish");
    const op = makeFailedOp({
      context: { ...makeFailedOp().context, retryCount: 6 },
    });
    await callProcess(dlq, { data: op, id: "j6" });
    expect(op.status).toBe("abandoned");
  });

  it("retryCount=0 with registered target retries", async () => {
    const dlq = makeDlq();
    dlq.registerRetryTarget("test-service", "publish");
    const op = makeFailedOp();
    await callProcess(dlq, { data: op, id: "j0" });
    expect(op.status).toBe("retrying");
    expect(op.context.retryCount).toBe(1);
  });

  it("retryCount=0 without registered target abandons", async () => {
    const dlq = makeDlq();
    const op = makeFailedOp();
    await callProcess(dlq, { data: op, id: "jn" });
    expect(op.status).toBe("abandoned");
  });

  it("sets updatedAt when abandoned due to max retries", async () => {
    const dlq = makeDlq();
    const oldDate = new Date("2020-01-01");
    const op = makeFailedOp({
      context: { ...makeFailedOp().context, retryCount: 5 },
      updatedAt: oldDate,
    });
    await callProcess(dlq, { data: op, id: "ju1" });
    expect(op.updatedAt.getTime()).toBeGreaterThan(oldDate.getTime());
  });

  it("sets updatedAt when abandoned due to missing target", async () => {
    const dlq = makeDlq();
    const oldDate = new Date("2020-01-01");
    const op = makeFailedOp({ updatedAt: oldDate });
    await callProcess(dlq, { data: op, id: "ju2" });
    expect(op.updatedAt.getTime()).toBeGreaterThan(oldDate.getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConditionalExpression — addFailedOperation metadata conditionals
// ─────────────────────────────────────────────────────────────────────────────

describe("addFailedOperation — metadata conditionals", { concurrent: false }, () => {
  beforeEach(() => {
    resetDeadLetterQueue();
    queueAddCalls.length = 0;
    uuidCounter = 0;
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetDeadLetterQueue();
  });

  it("includes fallbackError when provided", async () => {
    const dlq = makeDlq();
    const fbErr = new Error("fallback failed");
    fbErr.name = "FallbackError";
    await dlq.addFailedOperation("svc", "op", [{}], new Error("orig"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: true,
      fallbackError: fbErr,
    });
    const data = getLastAddedData() as {
      context: { fallbackError?: { name: string; message: string } };
    };
    expect(data.context.fallbackError).toBeDefined();
    expect(data.context.fallbackError!.name).toBe("FallbackError");
    expect(data.context.fallbackError!.message).toBe("fallback failed");
  });

  it("excludes fallbackError when not provided", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("orig"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
    });
    const data = getLastAddedData() as { context: { fallbackError?: unknown } };
    expect(data.context.fallbackError).toBeUndefined();
  });

  it("includes userId when provided", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
      metadata: { userId: "user-42" },
    });
    expect((getLastAddedData() as { metadata: { userId?: string } }).metadata.userId).toBe(
      "user-42"
    );
  });

  it("excludes userId when not provided", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
      metadata: {},
    });
    expect(
      (getLastAddedData() as { metadata: { userId?: string } }).metadata.userId
    ).toBeUndefined();
  });

  it("includes requestId when provided", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
      metadata: { requestId: "req-99" },
    });
    expect((getLastAddedData() as { metadata: { requestId?: string } }).metadata.requestId).toBe(
      "req-99"
    );
  });

  it("excludes requestId when not provided", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
      metadata: {},
    });
    expect(
      (getLastAddedData() as { metadata: { requestId?: string } }).metadata.requestId
    ).toBeUndefined();
  });

  it("defaults priority to 'normal'", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
      metadata: {},
    });
    expect((getLastAddedData() as { metadata: { priority: string } }).metadata.priority).toBe(
      "normal"
    );
  });

  it("uses explicit priority 'critical'", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
      metadata: { priority: "critical" },
    });
    expect((getLastAddedData() as { metadata: { priority: string } }).metadata.priority).toBe(
      "critical"
    );
  });

  it("defaults source to 'unknown'", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
      metadata: {},
    });
    expect((getLastAddedData() as { metadata: { source: string } }).metadata.source).toBe(
      "unknown"
    );
  });

  it("uses explicit source", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
      metadata: { source: "webhook-handler" },
    });
    expect((getLastAddedData() as { metadata: { source: string } }).metadata.source).toBe(
      "webhook-handler"
    );
  });

  it("defaults all metadata when metadata object omitted", async () => {
    const dlq = makeDlq();
    await dlq.addFailedOperation("svc", "op", [{}], new Error("e"), {
      retryCount: 0,
      firstAttempt: new Date(),
      fallbackAttempted: false,
    });
    const md = (getLastAddedData() as { metadata: Record<string, unknown> }).metadata;
    expect(md.priority).toBe("normal");
    expect(md.source).toBe("unknown");
    expect(md.userId).toBeUndefined();
    expect(md.requestId).toBeUndefined();
  });
});
