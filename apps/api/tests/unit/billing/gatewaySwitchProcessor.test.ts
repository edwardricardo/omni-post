/**
 * @file gatewaySwitchProcessor.test.ts
 * @description Pins that the gateway switch processor's BullMQ worker logs an error it emits
 *   through the throttled listener instead of leaving it unhandled, and that the worker is still
 *   built on the gateway switch queue with the injected connection and a concurrency of 1.
 *   BullMQ's Worker is stubbed with a plain EventEmitter: an `error` with no listener throws
 *   here, where the real worker would catch it and write it with console.error, outside the
 *   structured logger.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { workers, apiLogger } = vi.hoisted(() => ({
  workers: [] as Array<{
    name: string;
    options: unknown;
    emitter: import("node:events").EventEmitter;
  }>,
  apiLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bullmq")>();
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    ...actual,
    Worker: vi.fn(function MockWorker(name: string, _processor: unknown, options: unknown) {
      const emitter = new Emitter();
      workers.push({ name, options, emitter });
      return emitter;
    }),
  };
});

vi.mock("../../../src/lib/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/logger.js")>();
  return { ...actual, logger: apiLogger };
});

const { GatewaySwitchProcessor } = await import("../../../src/billing/gatewaySwitchProcessor.js");

const CONNECTION = { role: "gateway-switch-worker-connection" };

function buildProcessor() {
  return new GatewaySwitchProcessor(CONNECTION as never, {} as never, {} as never);
}

describe("GatewaySwitchProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workers.length = 0;
  });

  it("logs one worker-error line for two identical errors its worker emits", () => {
    buildProcessor();
    const worker = workers[0];
    const error = new Error("connect ECONNREFUSED 127.0.0.1:6379");

    expect(() => {
      worker?.emitter.emit("error", error);
      worker?.emitter.emit("error", error);
    }).not.toThrow();
    expect(apiLogger.error.mock.calls).toEqual([
      [
        {
          err: expect.objectContaining({ type: "Error", message: error.message }),
          worker: "bullmq-worker:gateway-switch",
          suppressed: 0,
        },
        "Worker error",
      ],
    ]);
  });

  it("writes a different job-level error instead of counting it behind a connection error", () => {
    buildProcessor();
    const worker = workers[0];

    worker?.emitter.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:6379"));
    worker?.emitter.emit("error", new Error("Missing lock for job 42. moveToFinished"));

    expect(
      apiLogger.error.mock.calls.map(
        ([context]) => (context as { err: { message: unknown } }).err.message
      )
    ).toEqual(["connect ECONNREFUSED 127.0.0.1:6379", "Missing lock for job 42. moveToFinished"]);
  });

  it("builds its worker on the gateway switch queue with the injected connection", () => {
    buildProcessor();

    expect(workers.map(({ name, options }) => ({ name, options }))).toEqual([
      { name: "gateway-switch", options: { connection: CONNECTION, concurrency: 1 } },
    ]);
  });
});
