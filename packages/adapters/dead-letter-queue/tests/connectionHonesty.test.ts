/**
 * @file connectionHonesty.test.ts
 * @description Pins the manager's obligations for the case where a composition root DOES build
 *              it, so the connection it owns is observable instead of silent.
 *
 *              Three invariants:
 *
 *              1. `Queue` and `QueueEvents` each carry an `error` listener. BullMQ's `QueueBase`
 *                 re-emits every connection error on itself; with no listener, Node's EventEmitter
 *                 throws `ERR_UNHANDLED_ERROR`, BullMQ's own `emit` override swallows it and falls
 *                 through to `console.error`. Under Vitest that raw console write is buffered over
 *                 the worker RPC, and a short-lived test file can tear the channel down mid-flush.
 *                 A registered listener keeps the error on the structured logger.
 *              2. `QueueEvents` is built with `autorun: false`. Otherwise its constructor starts an
 *                 event-consuming loop immediately, which no caller asked for and nothing stops
 *                 until `close()`.
 *              3. The event loop starts when the manager starts consuming, not before.
 *
 * Tier 0: bullmq, ioredis, uuid and the logger are all mocked; no Redis is contacted.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

/** One constructed BullMQ object, captured so the test can inspect it from outside. */
interface RecordedBullmqObject {
  name: string;
  opts: Record<string, unknown>;
  emitter: EventEmitter;
}

const queueInstances: RecordedBullmqObject[] = [];
const queueEventsInstances: RecordedBullmqObject[] = [];
const workerInstances: RecordedBullmqObject[] = [];
const queueEventsRunCalls: string[] = [];

// ── Mock ioredis — never connects, records nothing ───────────────────────────

const redisStub = {
  on: () => redisStub,
  quit: async () => "OK",
  disconnect: () => undefined,
};

class MockRedis {
  constructor() {
    return redisStub as unknown as MockRedis;
  }
}

vi.mock("ioredis", () => ({ default: MockRedis, Redis: MockRedis }));

// ── Mock bullmq — every constructed object is recorded with its options ──────

/**
 * Builds a recording constructor for one BullMQ class. Each instance delegates
 * `on`/`emit` to its own `EventEmitter` so the test can count listeners and fire
 * events exactly as BullMQ would.
 */
function recordingBullmqClass(bucket: RecordedBullmqObject[]) {
  return class {
    readonly name: string;
    readonly emitter = new EventEmitter();

    constructor(name: string, opts: Record<string, unknown> = {}) {
      this.name = name;
      bucket.push({ name, opts, emitter: this.emitter });
    }

    on(event: string, listener: (...args: unknown[]) => void): this {
      this.emitter.on(event, listener);
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      return this.emitter.emit(event, ...args);
    }

    async run(): Promise<void> {
      queueEventsRunCalls.push(this.name);
    }

    async close(): Promise<void> {
      return undefined;
    }
  };
}

vi.mock("bullmq", () => ({
  Queue: recordingBullmqClass(queueInstances),
  QueueEvents: recordingBullmqClass(queueEventsInstances),
  Worker: recordingBullmqClass(workerInstances),
  Job: class {},
}));

vi.mock("uuid", () => ({ v4: () => "mock-uuid" }));

// ── Mock the shared logger factory so routed errors are observable ───────────

const loggerError = vi.fn();
const loggerWarn = vi.fn();
const loggerInfo = vi.fn();

vi.mock("@observability/logger", () => ({
  createLogger: () => ({
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError,
    debug: vi.fn(),
  }),
}));

const { DeadLetterQueueManager } = await import("../src/index.js");

/** A Redis URL that is syntactically valid and deliberately unreachable. */
const UNREACHABLE_REDIS_URL = "redis://127.0.0.1:1";

function buildManager() {
  return new DeadLetterQueueManager({
    redisUrl: UNREACHABLE_REDIS_URL,
    queueName: "test-dlq",
  });
}

describe("DeadLetterQueueManager — connection honesty", { concurrent: false }, () => {
  beforeEach(() => {
    queueInstances.length = 0;
    queueEventsInstances.length = 0;
    workerInstances.length = 0;
    queueEventsRunCalls.length = 0;
    vi.clearAllMocks();
  });

  it("registers an error listener on the Queue", () => {
    buildManager();

    const queue = queueInstances[0];
    assert.ok(queue, "a Queue must have been constructed");
    assert.ok(
      queue.emitter.listenerCount("error") >= 1,
      "without an error listener BullMQ falls through to console.error"
    );
  });

  it("registers an error listener on the QueueEvents", () => {
    buildManager();

    const queueEvents = queueEventsInstances[0];
    assert.ok(queueEvents, "a QueueEvents must have been constructed");
    assert.ok(
      queueEvents.emitter.listenerCount("error") >= 1,
      "without an error listener BullMQ falls through to console.error"
    );
  });

  it("routes a Queue error to the logger instead of throwing", () => {
    buildManager();

    const queue = queueInstances[0];
    assert.ok(queue, "a Queue must have been constructed");

    assert.doesNotThrow(() => {
      queue.emitter.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:1"));
    }, "an unlistened error event throws ERR_UNHANDLED_ERROR");

    expect(loggerError).toHaveBeenCalled();
  });

  it("routes a QueueEvents error to the logger instead of throwing", () => {
    buildManager();

    const queueEvents = queueEventsInstances[0];
    assert.ok(queueEvents, "a QueueEvents must have been constructed");

    assert.doesNotThrow(() => {
      queueEvents.emitter.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:1"));
    }, "an unlistened error event throws ERR_UNHANDLED_ERROR");

    expect(loggerError).toHaveBeenCalled();
  });

  it("constructs QueueEvents with autorun disabled", () => {
    buildManager();

    const queueEvents = queueEventsInstances[0];
    assert.ok(queueEvents, "a QueueEvents must have been constructed");
    assert.strictEqual(
      queueEvents.opts.autorun,
      false,
      "the constructor must not start an event-consuming loop nobody asked for"
    );
  });

  it("does not start the event loop until processing starts", () => {
    buildManager();

    assert.strictEqual(
      queueEventsRunCalls.length,
      0,
      "constructing the manager must not start consuming events"
    );
  });

  it("starts the event loop when processing starts", async () => {
    const manager = buildManager();

    await manager.startProcessing();

    assert.deepStrictEqual(
      queueEventsRunCalls,
      ["test-dlq"],
      "startProcessing must start the event stream it disabled at construction"
    );
  });

  it("registers an error listener on a retry queue too", () => {
    const manager = buildManager();

    // `getRetryQueue` is private and is reached on the re-enqueue path. Calling it directly
    // keeps this test on the listener contract rather than on the whole retry flow.
    const retryQueue = (
      manager as unknown as { getRetryQueue: (queueName: string) => unknown }
    ).getRetryQueue("publish");

    assert.ok(retryQueue, "a retry queue must have been constructed");

    const recorded = queueInstances.find((candidate) => candidate.name === "publish");
    assert.ok(recorded, "the retry queue must be a BullMQ Queue");
    assert.ok(
      recorded.emitter.listenerCount("error") >= 1,
      "a retry queue falls through to console.error exactly like the main queue"
    );

    assert.doesNotThrow(() => {
      recorded.emitter.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:1"));
    }, "an unlistened error event throws ERR_UNHANDLED_ERROR");

    expect(loggerError).toHaveBeenCalled();
  });
});
