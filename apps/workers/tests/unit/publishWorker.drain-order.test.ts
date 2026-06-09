/**
 * @file publishWorker.drain-order.test.ts
 * @description Drain-order regression guard: proves that worker.close() resolves
 *              BEFORE notifyRedis.quit() is called when gracefulShutdown drains
 *              a ShutdownTarget built like startPublishWorker's. This is the crux
 *              of the hardening — the old code had the order inverted (notifyRedis
 *              was in `connections` which drained BEFORE consumer.close() in
 *              `afterTeardown`), creating a window where an in-flight publish job
 *              could fire its saga-notify Redis command at a dead socket.
 * @layer infrastructure
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { drainTarget } from "../../src/lib/gracefulShutdown.js";
import type { ShutdownTarget, ShutdownLogger } from "../../src/lib/gracefulShutdown.js";

/** No-op logger — drain-order tests only care about call sequencing. */
const noopLogger: ShutdownLogger = {
  info() {},
  warn() {},
  error() {},
};

describe("publishWorker ShutdownTarget — drain order regression guard", () => {
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
  });

  it("worker.close() resolves BEFORE notifyRedis.quit() is called", async () => {
    // Simulate an in-flight publish job: worker.close() resolves only after
    // the deferred job promise settles (mimicking BullMQ's graceful drain).
    let resolveJob!: () => void;
    const inFlightJob = new Promise<void>((resolve) => {
      resolveJob = resolve;
    });

    const fakeWorker = {
      close: async (): Promise<void> => {
        // Drain in-flight job before close resolves.
        await inFlightJob;
        callOrder.push("worker.close");
      },
    } as unknown as import("bullmq").Worker;

    const fakeNotifyRedis = {
      quit: async (): Promise<void> => {
        callOrder.push("notifyRedis.quit");
      },
    };

    const fakePrisma = {
      $disconnect: async (): Promise<void> => {
        callOrder.push("prisma.$disconnect");
      },
    };

    // ShutdownTarget exactly as startPublishWorker (post-refactor) builds it:
    // worker in `workers` array, notifyRedis in `connections`, prisma on target.
    const target: ShutdownTarget = {
      workers: [fakeWorker],
      connections: [fakeNotifyRedis],
      prisma: fakePrisma,
      afterTeardown: async (): Promise<void> => {
        callOrder.push("afterTeardown");
      },
    };

    // Resolve the in-flight job after a short delay to prove drain waited.
    const drainPromise = drainTarget(target, noopLogger);
    // Let the event loop tick so drainTarget starts awaiting worker.close()
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    resolveJob();
    await drainPromise;

    // CRITICAL assertions:
    const workerIdx = callOrder.indexOf("worker.close");
    const redisIdx = callOrder.indexOf("notifyRedis.quit");
    const prismaIdx = callOrder.indexOf("prisma.$disconnect");

    assert.ok(workerIdx !== -1, "worker.close() must have been called");
    assert.ok(redisIdx !== -1, "notifyRedis.quit() must have been called");

    assert.ok(
      workerIdx < redisIdx,
      `worker.close() (idx ${workerIdx}) must resolve BEFORE notifyRedis.quit() (idx ${redisIdx}). ` +
        `Order: ${callOrder.join(" → ")}`
    );

    assert.ok(
      redisIdx < prismaIdx,
      `notifyRedis.quit() (idx ${redisIdx}) must complete BEFORE prisma.$disconnect() (idx ${prismaIdx}). ` +
        `Order: ${callOrder.join(" → ")}`
    );
  });
});
