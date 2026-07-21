/**
 * @file AnalyticsStreamBroadcaster.test.ts
 * @description Unit tests for the analytics SSE broadcaster. Verifies per-post
 *              local dispatch (subscribe → broadcast → callback), tenant-scoped
 *              fan-out (only watchers of a post receive its event), unsubscribe
 *              cleanup, the watched-postIds set used by the metrics poller, multi-
 *              post subscriptions, and dead-callback auto-removal. Redis is stubbed
 *              (publisher + duplicated subscriber); local dispatch needs no I/O.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsStreamBroadcaster } from "../../../src/services/AnalyticsStreamBroadcaster.js";
import type { AnalyticsStreamEventPayload } from "../../../src/services/AnalyticsStreamBroadcaster.js";
import { duplicateForSubscriber } from "../../../src/lib/redis.js";

// The subscriber connection is built by the canonical duplicateForSubscriber
// helper (which does `new Redis(...)` off the parent's resolved options). Stub
// it to the parent's own `.duplicate()` so these hermetic unit tests keep their
// in-memory message wiring and never open a real socket.
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

const makeEvent = (postId: string): AnalyticsStreamEventPayload => ({
  timestamp: "2026-05-23T00:00:00.000Z",
  postId,
  provider: "X",
  metrics: { views: 100, likes: 10, comments: 2, shares: 1, engagementRate: 13 },
});

describe("AnalyticsStreamBroadcaster", () => {
  let broadcaster: AnalyticsStreamBroadcaster;

  beforeEach(() => {
    broadcaster = new AnalyticsStreamBroadcaster(makeRedis() as never, makeScheduler() as never);
  });

  it("delivers a broadcast event to a subscriber watching that post", async () => {
    const received: AnalyticsStreamEventPayload[] = [];
    broadcaster.subscribe("sub-1", ["post-1"], (e) => received.push(e));

    await broadcaster.broadcast(makeEvent("post-1"), "post-1");

    expect(received).toHaveLength(1);
    expect(received[0]?.postId).toBe("post-1");
    expect(received[0]?.metrics.views).toBe(100);
  });

  it("does not deliver a post's event to a subscriber not watching it (tenant-scoped fan-out)", async () => {
    const received: AnalyticsStreamEventPayload[] = [];
    broadcaster.subscribe("sub-1", ["post-1"], (e) => received.push(e));

    await broadcaster.broadcast(makeEvent("post-2"), "post-2");

    expect(received).toHaveLength(0);
  });

  it("delivers to every subscriber of a post", async () => {
    const a: AnalyticsStreamEventPayload[] = [];
    const b: AnalyticsStreamEventPayload[] = [];
    broadcaster.subscribe("sub-a", ["post-1"], (e) => a.push(e));
    broadcaster.subscribe("sub-b", ["post-1"], (e) => b.push(e));

    await broadcaster.broadcast(makeEvent("post-1"), "post-1");

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("delivers events for every post a multi-post subscription watches", async () => {
    const received: string[] = [];
    broadcaster.subscribe("sub-1", ["post-1", "post-2"], (e) => received.push(e.postId));

    await broadcaster.broadcast(makeEvent("post-1"), "post-1");
    await broadcaster.broadcast(makeEvent("post-2"), "post-2");

    expect(received).toEqual(["post-1", "post-2"]);
  });

  it("stops delivery after unsubscribe", async () => {
    const received: AnalyticsStreamEventPayload[] = [];
    broadcaster.subscribe("sub-1", ["post-1"], (e) => received.push(e));
    broadcaster.unsubscribe("sub-1");

    await broadcaster.broadcast(makeEvent("post-1"), "post-1");

    expect(received).toHaveLength(0);
  });

  it("exposes the set of watched postIds for the metrics poller", () => {
    broadcaster.subscribe("sub-1", ["post-1", "post-2"], () => {});
    broadcaster.subscribe("sub-2", ["post-2", "post-3"], () => {});

    expect(broadcaster.getWatchedPostIds().sort()).toEqual(["post-1", "post-2", "post-3"]);
  });

  it("drops a postId from the watched set once its last subscriber leaves", () => {
    broadcaster.subscribe("sub-1", ["post-1"], () => {});
    broadcaster.subscribe("sub-2", ["post-1"], () => {});
    broadcaster.unsubscribe("sub-1");
    expect(broadcaster.getWatchedPostIds()).toEqual(["post-1"]);
    broadcaster.unsubscribe("sub-2");
    expect(broadcaster.getWatchedPostIds()).toEqual([]);
  });

  it("auto-removes a subscription whose callback throws", async () => {
    broadcaster.subscribe("sub-bad", ["post-1"], () => {
      throw new Error("dead connection");
    });
    expect(broadcaster.getActiveConnectionCount()).toBe(1);

    await broadcaster.broadcast(makeEvent("post-1"), "post-1");

    expect(broadcaster.getActiveConnectionCount()).toBe(0);
    expect(broadcaster.getWatchedPostIds()).toEqual([]);
  });

  it("publishes to the post's Redis channel on broadcast (cross-pod fan-out)", async () => {
    const redis = makeRedis();
    const b = new AnalyticsStreamBroadcaster(redis as never, makeScheduler() as never);
    await b.broadcast(makeEvent("post-9"), "post-9");
    expect(redis.publish).toHaveBeenCalledTimes(1);
    expect(redis.publish.mock.calls[0]?.[0]).toBe("analytics-stream:post-9");
  });

  it("builds its subscriber connection via the canonical duplicateForSubscriber helper", () => {
    const redis = makeRedis();
    new AnalyticsStreamBroadcaster(redis as never, makeScheduler() as never);
    expect(duplicateForSubscriber).toHaveBeenCalledWith(redis);
  });
});
