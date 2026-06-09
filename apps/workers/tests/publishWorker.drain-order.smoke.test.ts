/**
 * @file publishWorker.drain-order.smoke.test.ts
 * @description E2E smoke — proves in-flight publish jobs drain before Redis
 *              closes on SIGTERM (no job loss on graceful shutdown). LXC-safe:
 *              uses a controlled fake (stubbed Worker + Redis), no real BullMQ
 *              load, no live Redis connection.
 *
 *              The critical assertions:
 *              1. The in-flight job promise settled BEFORE notifyRedis.quit()
 *                 was called — no job loss in the drain window.
 *              2. prisma.$disconnect() was called AFTER notifyRedis.quit().
 *              3. afterTeardown ran last (consumer.close + scheduler.shutdownAll).
 *
 *              Design match: The PublishWorkerHandle.target places the BullMQ
 *              Worker in `target.workers` (drains first in gracefulShutdown.ts)
 *              and notifyRedis in `target.connections` (quits second). This is
 *              the inversion that the old code had backwards.
 * @layer infrastructure
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { drainTarget } from "../src/lib/gracefulShutdown.js";
import type { ShutdownTarget, ShutdownLogger } from "../src/lib/gracefulShutdown.js";

/** No-op logger for smoke tests — we only care about drain ordering, not log output. */
const noopLogger: ShutdownLogger = {
  info() {},
  warn() {},
  error() {},
};

describe("publishWorker drain-order — e2e smoke (SIGTERM drain guard)", () => {
  let events: Array<{ event: string; timestamp: number }>;

  beforeEach(() => {
    events = [];
  });

  /**
   * Record an event with a monotonic counter.
   * Using simple array index as order-of-call proxy.
   */
  function record(event: string): void {
    events.push({ event, timestamp: events.length });
  }

  it("in-flight job settles BEFORE notifyRedis.quit() — no job loss on SIGTERM", async () => {
    // Simulate a publish job that is still running when the shutdown signal arrives.
    let resolveInFlightJob!: () => void;
    const inFlightJob = new Promise<void>((resolve) => {
      resolveInFlightJob = resolve;
    });

    // Fake BullMQ Worker — its close() blocks until the in-flight job settles,
    // exactly as BullMQ's real Worker.close() does during graceful shutdown.
    const fakeWorker = {
      close: async (): Promise<void> => {
        await inFlightJob; // blocks until the job resolves
        record("worker.close");
      },
    } as unknown as import("bullmq").Worker;

    const fakeNotifyRedis = {
      quit: async (): Promise<void> => {
        record("notifyRedis.quit");
      },
    };

    const fakePrisma = {
      $disconnect: async (): Promise<void> => {
        record("prisma.$disconnect");
      },
    };

    const afterTeardownLog: string[] = [];
    const target: ShutdownTarget = {
      workers: [fakeWorker], // ← drains first (the fix)
      connections: [fakeNotifyRedis], // ← quit second
      prisma: fakePrisma, // ← disconnect third
      afterTeardown: async (): Promise<void> => {
        afterTeardownLog.push("consumer.close");
        afterTeardownLog.push("scheduler.shutdownAll");
        record("afterTeardown");
      },
    };

    // Start the drain. The drain is blocked on inFlightJob inside worker.close().
    const drainPromise = drainTarget(target, noopLogger);

    // Let the event loop tick so drainTarget starts processing workers.
    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    // At this point, worker.close() is awaiting inFlightJob.
    // notifyRedis.quit() has NOT been called yet — prove it:
    const redisQuitBeforeJobSettle = events.some((e) => e.event === "notifyRedis.quit");
    assert.ok(
      !redisQuitBeforeJobSettle,
      "notifyRedis.quit() MUST NOT be called before in-flight job settles. " +
        `Events so far: ${events.map((e) => e.event).join(", ")}`
    );

    // Now settle the in-flight job (simulating the publish handler completing).
    resolveInFlightJob();
    await drainPromise;

    // Verify the complete drain order.
    const order = events.map((e) => e.event);

    assert.deepStrictEqual(
      order,
      ["worker.close", "notifyRedis.quit", "prisma.$disconnect", "afterTeardown"],
      `Expected drain order: worker.close → notifyRedis.quit → prisma.$disconnect → afterTeardown\n` +
        `Actual: ${order.join(" → ")}`
    );

    // Verify afterTeardown ran consumer + scheduler cleanup.
    assert.deepStrictEqual(afterTeardownLog, ["consumer.close", "scheduler.shutdownAll"]);
  });

  it("notifyRedis.quit() is NOT called before worker drains (regression guard)", async () => {
    // This proves that putting notifyRedis in target.connections (not afterTeardown)
    // does NOT cause a premature quit — the Worker drains first because gracefulShutdown
    // processes `workers` before `connections`.
    let redisQuitCalledBeforeWorkerClose = false;
    let workerCloseComplete = false;

    const fakeWorker = {
      close: async (): Promise<void> => {
        // Simulate a short job taking 10ms.
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        workerCloseComplete = true;
      },
    } as unknown as import("bullmq").Worker;

    const fakeNotifyRedis = {
      quit: async (): Promise<void> => {
        redisQuitCalledBeforeWorkerClose = !workerCloseComplete;
      },
    };

    const target: ShutdownTarget = {
      workers: [fakeWorker],
      connections: [fakeNotifyRedis],
    };

    await drainTarget(target, noopLogger);

    assert.ok(
      !redisQuitCalledBeforeWorkerClose,
      "notifyRedis.quit() was called before worker.close() completed — drain order is broken"
    );
    assert.ok(workerCloseComplete, "worker.close() must have completed");
  });
});
