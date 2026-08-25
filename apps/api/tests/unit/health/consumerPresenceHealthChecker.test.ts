/**
 * @file consumerPresenceHealthChecker.test.ts
 * @description Pins the verdict table of `ConsumerPresenceHealthChecker`, the
 *              probe a readiness gate mounts to answer "is anything actually
 *              consuming this queue". Every case here is a way the probe could
 *              report a green that nobody earned: an unknown answer read as a
 *              present consumer, a port failure read as "fine", or a count of
 *              zero read as anything other than an outage.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { ConsumerPresenceHealthChecker } from "@monitoring/health-checks";
import type { QueuePort, QueueHealth } from "@ports/core";
import { ok, err, type Result } from "@shared/types";

/** A QueuePort double whose only meaningful method is `health()`. */
function makePort(
  health: () => Promise<Result<QueueHealth, "CONNECTION_ERROR">>
): Pick<QueuePort, "health"> {
  return { health };
}

/** A healthy snapshot with the consumer count under test. */
function snapshot(consumers: number | null): QueueHealth {
  return { connected: true, waiting: 0, active: 0, completed: 0, failed: 0, consumers };
}

describe("ConsumerPresenceHealthChecker", () => {
  it("is healthy when at least one consumer is registered for the queue", async () => {
    const checker = new ConsumerPresenceHealthChecker(
      "publish",
      makePort(async () => ok(snapshot(1)))
    );

    const result = await checker.check();

    expect({ status: result.status, consumers: result.details?.consumers }).toEqual({
      status: "healthy",
      consumers: 1,
    });
  });

  it("is unhealthy and names the queue when no consumer is registered", async () => {
    const checker = new ConsumerPresenceHealthChecker(
      "publish",
      makePort(async () => ok(snapshot(0)))
    );

    const result = await checker.check();

    expect(result.status).toBe("unhealthy");
    expect(result.message).toContain("publish");
  });

  it("is unhealthy when the broker cannot answer, and says unknown rather than zero", async () => {
    // `null` means the broker refused `CLIENT LIST`. Reporting that as "no
    // consumer" would send an operator to restart a worker that is running; the
    // probe fails closed AND says which of the two it observed.
    const checker = new ConsumerPresenceHealthChecker(
      "publish",
      makePort(async () => ok(snapshot(null)))
    );

    const result = await checker.check();

    expect({ status: result.status, consumers: result.details?.consumers }).toEqual({
      status: "unhealthy",
      consumers: null,
    });
    expect(result.message).toMatch(/unknown|could not be read|cannot be read/i);
  });

  it("is unhealthy when the port itself fails", async () => {
    const checker = new ConsumerPresenceHealthChecker(
      "publish",
      makePort(async () => err("CONNECTION_ERROR"))
    );

    const result = await checker.check();

    expect(result.status).toBe("unhealthy");
  });

  it("is unhealthy when the port throws rather than returning a Result", async () => {
    const checker = new ConsumerPresenceHealthChecker(
      "publish",
      makePort(async () => {
        throw new Error("socket closed");
      })
    );

    const result = await checker.check();

    expect({ status: result.status, error: result.error }).toEqual({
      status: "unhealthy",
      error: "socket closed",
    });
  });
});
