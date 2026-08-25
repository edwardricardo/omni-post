/**
 * @file publishQueueAttendance.test.ts
 * @description Pins the two series that make a publish-consumer outage visible
 *              before the saga horizon terminalizes the cohort under it. The
 *              distinction these series exist to preserve is between "nobody is
 *              consuming" and "we could not tell": collapsing the second into a
 *              zero would page for an outage nobody observed, and collapsing it
 *              into a positive count would hide one that is real. `-1` is the
 *              sentinel because a Prometheus gauge has no null.
 * @layer infrastructure
 */
import { describe, it, expect, afterEach } from "vitest";
import client from "prom-client";
import { ok, err, type Result } from "@shared/types";
import type { QueueHealth } from "@ports/core";
import {
  PUBLISH_QUEUE_UNKNOWN_CONSUMERS,
  setPublishQueueHealthProvider,
} from "../../../src/metrics/sagaRecoveryMetrics.js";

/** Reads one gauge's current value through a scrape. */
async function scrape(name: string): Promise<number | undefined> {
  const gauge = client.register.getSingleMetric(name);
  expect(gauge).toBeDefined();
  const collected = await gauge!.get();
  return collected.values[0]?.value;
}

/** A queue-health snapshot with the fields under test. */
function health(consumers: number | null, waiting: number): QueueHealth {
  return { connected: true, waiting, active: 0, completed: 0, failed: 0, consumers };
}

afterEach(() => {
  setPublishQueueHealthProvider(undefined);
});

describe("publish queue attendance series", () => {
  it("reports the registered consumer count and the waiting depth at scrape time", async () => {
    setPublishQueueHealthProvider(async () => ok(health(2, 5)));

    expect({
      consumers: await scrape("publish_queue_consumers"),
      waiting: await scrape("publish_queue_waiting"),
    }).toEqual({ consumers: 2, waiting: 5 });
  });

  it("reports zero consumers as zero, so an unattended queue is visible", async () => {
    setPublishQueueHealthProvider(async () => ok(health(0, 3)));

    expect({
      consumers: await scrape("publish_queue_consumers"),
      waiting: await scrape("publish_queue_waiting"),
    }).toEqual({ consumers: 0, waiting: 3 });
  });

  it("reports an unreadable client registry as the unknown sentinel, never as zero", async () => {
    // The alert fires on `== 0`. If unknown were published as 0, a broker that
    // cannot answer would page as an outage that was never observed.
    setPublishQueueHealthProvider(async () => ok(health(null, 3)));

    expect(await scrape("publish_queue_consumers")).toBe(PUBLISH_QUEUE_UNKNOWN_CONSUMERS);
    expect(PUBLISH_QUEUE_UNKNOWN_CONSUMERS).toBeLessThan(0);
  });

  it("reports the unknown sentinel when the port itself fails", async () => {
    setPublishQueueHealthProvider(async () => err("CONNECTION_ERROR"));

    expect(await scrape("publish_queue_consumers")).toBe(PUBLISH_QUEUE_UNKNOWN_CONSUMERS);
  });

  it("does not fail the scrape when the provider throws", async () => {
    setPublishQueueHealthProvider(async (): Promise<Result<QueueHealth, "CONNECTION_ERROR">> => {
      throw new Error("redis gone");
    });

    await expect(scrape("publish_queue_consumers")).resolves.toBeDefined();
  });

  it("reports unknown once the provider is detached, so a dead API cannot read as attended", async () => {
    setPublishQueueHealthProvider(async () => ok(health(2, 0)));
    await scrape("publish_queue_consumers");

    setPublishQueueHealthProvider(undefined);

    expect(await scrape("publish_queue_consumers")).toBe(PUBLISH_QUEUE_UNKNOWN_CONSUMERS);
  });
});
