/**
 * @file realtimeWebhookBroadcaster.subscriberErrors.test.ts
 * @description Pins that the realtime webhook broadcaster's subscribe-mode connection logs an
 *   error it emits through the throttled listener on the webhook logger. The subscriber is an
 *   EventEmitter, as an ioredis client is, and is handed out by the stubbed
 *   duplicateForSubscriber, so no socket opens.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";

const { subscribers, webhookLogger } = vi.hoisted(() => ({
  subscribers: [] as Array<import("node:events").EventEmitter>,
  webhookLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/lib/redis.js", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    duplicateForSubscriber: vi.fn(() => {
      const subscriber = Object.assign(new Emitter(), { subscribe: vi.fn() });
      subscribers.push(subscriber);
      return subscriber;
    }),
  };
});

vi.mock("../../src/lib/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/logger.js")>();
  return { ...actual, webhookLogger };
});

const { RealtimeWebhookBroadcaster } =
  await import("../../src/webhooks/realtimeWebhookBroadcaster.js");

describe("RealtimeWebhookBroadcaster subscriber errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribers.length = 0;
  });

  it("logs one line for two errors of its subscriber connection", () => {
    const broadcaster = new RealtimeWebhookBroadcaster(
      {} as never,
      {} as never,
      new NoopBackgroundTaskScheduler()
    );
    const subscriber = subscribers[0];
    const error = new Error("connect ECONNREFUSED 127.0.0.1:6379");

    expect(() => {
      subscriber?.emit("error", error);
      subscriber?.emit("error", error);
    }).not.toThrow();
    expect(webhookLogger.error.mock.calls).toEqual([
      [
        {
          err: expect.objectContaining({ type: "Error", message: error.message }),
          connection: "redis:realtime-webhook-broadcaster-subscriber",
          suppressed: 0,
        },
        "Connection error",
      ],
    ]);
    broadcaster.shutdown();
  });
});
