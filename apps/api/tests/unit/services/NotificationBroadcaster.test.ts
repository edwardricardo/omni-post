/**
 * @file NotificationBroadcaster.test.ts
 * @description Unit tests for the notification SSE broadcaster. Verifies recipient-
 *              scoped local dispatch (subscribe → broadcast → callback), fan-out
 *              isolation (only a recipient's subscribers receive its events),
 *              unsubscribe cleanup, dead-callback auto-removal, cross-pod Redis
 *              publish, and that the subscribe-mode connection is built via the
 *              canonical duplicateForSubscriber helper. Redis is stubbed; local
 *              dispatch needs no I/O.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationBroadcaster } from "../../../src/services/NotificationBroadcaster.js";
import type { NotificationEventPayload } from "../../../src/services/NotificationBroadcaster.js";
import { duplicateForSubscriber } from "../../../src/lib/redis.js";

// The subscriber connection is built by the canonical duplicateForSubscriber
// helper. Stub it to the parent's own `.duplicate()` so these hermetic unit
// tests keep the in-memory stub and never open a real socket.
vi.mock("../../../src/lib/redis.js", () => ({
  duplicateForSubscriber: vi.fn((parent: { duplicate: () => unknown }) => parent.duplicate()),
}));

interface StubRedis {
  duplicate: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  psubscribe: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
}

function makeRedis(): StubRedis {
  const subscriber: StubRedis = {
    duplicate: vi.fn(),
    on: vi.fn(),
    publish: vi.fn(async () => 1),
    psubscribe: vi.fn(),
    quit: vi.fn(async () => "OK"),
  };
  const publisher: StubRedis = {
    duplicate: vi.fn(() => subscriber),
    on: vi.fn(),
    publish: vi.fn(async () => 1),
    psubscribe: vi.fn(),
    quit: vi.fn(async () => "OK"),
  };
  return publisher;
}

function makeScheduler() {
  return { register: vi.fn(), unregister: vi.fn() };
}

const makeNotification = (id: string): NotificationEventPayload => ({
  id,
  type: "POST_PUBLISHED",
  title: "Published",
  body: "Your post is live",
  createdAt: "2026-07-20T00:00:00.000Z",
});

describe("NotificationBroadcaster", () => {
  let broadcaster: NotificationBroadcaster;

  beforeEach(() => {
    vi.mocked(duplicateForSubscriber).mockClear();
    broadcaster = new NotificationBroadcaster(makeRedis() as never, makeScheduler() as never);
  });

  it("delivers a broadcast notification to a subscriber for that recipient", async () => {
    const received: NotificationEventPayload[] = [];
    broadcaster.subscribe("sub-1", "recipient-1", (n) => received.push(n));

    await broadcaster.broadcast(makeNotification("n-1"), "recipient-1");

    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe("n-1");
  });

  it("does not deliver a recipient's notification to a subscriber for another recipient", async () => {
    const received: NotificationEventPayload[] = [];
    broadcaster.subscribe("sub-1", "recipient-1", (n) => received.push(n));

    await broadcaster.broadcast(makeNotification("n-1"), "recipient-2");

    expect(received).toHaveLength(0);
  });

  it("delivers to every subscriber of a recipient", async () => {
    const a: NotificationEventPayload[] = [];
    const b: NotificationEventPayload[] = [];
    broadcaster.subscribe("sub-a", "recipient-1", (n) => a.push(n));
    broadcaster.subscribe("sub-b", "recipient-1", (n) => b.push(n));

    await broadcaster.broadcast(makeNotification("n-1"), "recipient-1");

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("stops delivery after unsubscribe", async () => {
    const received: NotificationEventPayload[] = [];
    broadcaster.subscribe("sub-1", "recipient-1", (n) => received.push(n));
    broadcaster.unsubscribe("sub-1");

    await broadcaster.broadcast(makeNotification("n-1"), "recipient-1");

    expect(received).toHaveLength(0);
  });

  it("auto-removes a subscription whose callback throws", async () => {
    broadcaster.subscribe("sub-bad", "recipient-1", () => {
      throw new Error("dead connection");
    });
    expect(broadcaster.getActiveConnectionCount()).toBe(1);

    await broadcaster.broadcast(makeNotification("n-1"), "recipient-1");

    expect(broadcaster.getActiveConnectionCount()).toBe(0);
  });

  it("publishes to the recipient's Redis channel on broadcast (cross-pod fan-out)", async () => {
    const redis = makeRedis();
    const b = new NotificationBroadcaster(redis as never, makeScheduler() as never);
    await b.broadcast(makeNotification("n-9"), "recipient-9");
    expect(redis.publish).toHaveBeenCalledTimes(1);
    expect(redis.publish.mock.calls[0]?.[0]).toBe("notifications:recipient-9");
  });

  it("builds its subscriber connection via the canonical duplicateForSubscriber helper", () => {
    const redis = makeRedis();
    new NotificationBroadcaster(redis as never, makeScheduler() as never);
    expect(duplicateForSubscriber).toHaveBeenCalledWith(redis);
  });
});
