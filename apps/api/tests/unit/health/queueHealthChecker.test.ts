/**
 * @file queueHealthChecker.test.ts
 * @description Pins what `QueueHealthChecker` REPORTS and what it deliberately
 *              does NOT decide. It must surface the broker-registered consumer
 *              count in `details` so every reader can apply its own policy, and
 *              it must leave `status` alone: the API registers this checker
 *              among its readiness criticals, and the API is a PRODUCER on the
 *              publish queue. Flipping its status on a consumer count would
 *              503 the API's readiness for a producer that is perfectly healthy
 *              — an outage manufactured out of an observation.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { QueueHealthChecker } from "@monitoring/health-checks";

type QueueSnapshot = {
  connected: boolean;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  consumers: number | null;
};

/** A queue adapter double returning one fixed health snapshot. */
function makeQueue(overrides: Partial<QueueSnapshot> = {}) {
  const value: QueueSnapshot = {
    connected: true,
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    consumers: 1,
    ...overrides,
  };
  return { health: async () => ({ ok: true as const, value }) };
}

describe("QueueHealthChecker reports the consumer count without deciding on it", () => {
  it("surfaces the registered consumer count in details", async () => {
    const result = await new QueueHealthChecker(makeQueue({ consumers: 3 })).check();

    expect(result.details?.consumers).toBe(3);
  });

  it("stays healthy with zero consumers, because this process is a producer", async () => {
    // The API holds the publish queue to ENQUEUE. Zero consumers is a fact about
    // the deployment, not about this process's ability to serve traffic.
    const result = await new QueueHealthChecker(makeQueue({ consumers: 0 })).check();

    expect({ status: result.status, consumers: result.details?.consumers }).toEqual({
      status: "healthy",
      consumers: 0,
    });
  });

  it("stays healthy and reports null when the broker cannot answer", async () => {
    // Unknown is carried verbatim so a reader can fail closed on it. Collapsing
    // it to 0 here would page for an outage that was never observed.
    const result = await new QueueHealthChecker(makeQueue({ consumers: null })).check();

    expect({ status: result.status, consumers: result.details?.consumers }).toEqual({
      status: "healthy",
      consumers: null,
    });
  });

  it("keeps reporting the disconnected and backlog verdicts it already owned", async () => {
    const disconnected = await new QueueHealthChecker(
      makeQueue({ connected: false, consumers: 2 })
    ).check();
    const backlogged = await new QueueHealthChecker(
      makeQueue({ waiting: 1001, consumers: 2 })
    ).check();

    expect({ disconnected: disconnected.status, backlogged: backlogged.status }).toEqual({
      disconnected: "unhealthy",
      backlogged: "degraded",
    });
  });
});
