/**
 * Tests for RealtimeWebhookBroadcaster — Filtering Logic, Connection Statistics, and Shutdown
 * Covers: multi-connection broadcasts, combined filters, system alerts, stats tracking, shutdown behavior
 *
 * @file realtimeWebhookBroadcaster.stats-shutdown.test.ts
 * @description Tests for RealtimeWebhookBroadcaster - Broadcast Filtering Logic
 * @layer infrastructure
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { type WebhookEventBroadcast } from "../../src/webhooks/realtimeWebhookBroadcaster.js";
import type { Provider, WebhookEventType } from "@infra/prisma";
import {
  MockWebSocket,
  state,
  setupBroadcaster,
  teardownBroadcaster,
} from "./realtimeWebhookBroadcaster.test-helpers.js";

// The broadcaster's Redis subscriber is built by the canonical
// duplicateForSubscriber helper. Stub it to the parent's `.duplicate()` so the
// MockRedis wiring is preserved and no real socket is opened.
vi.mock("../../src/lib/redis.js", () => ({
  duplicateForSubscriber: vi.fn((parent: { duplicate: () => unknown }) => parent.duplicate()),
}));

describe("RealtimeWebhookBroadcaster - Broadcast Filtering Logic", () => {
  beforeAll(async () => {
    setupBroadcaster();
  });

  afterAll(async () => {
    teardownBroadcaster();
  });

  beforeEach(() => {
    setupBroadcaster();
  });

  it("should broadcast to multiple matching connections", async () => {
    const socket1 = new MockWebSocket();
    const socket2 = new MockWebSocket();
    const socket3 = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket1 as any, {
      projectIds: ["project-1"],
    });
    state.broadcaster!.addConnection("conn-2", "user-2", "account-1", socket2 as any, {
      projectIds: ["project-1"],
    });
    state.broadcaster!.addConnection("conn-3", "user-3", "account-2", socket3 as any);

    socket1.clearMessages();
    socket2.clearMessages();
    socket3.clearMessages();

    const event: WebhookEventBroadcast = {
      eventId: "event-123",
      eventType: "POST_PUBLISHED" as WebhookEventType,
      provider: "X" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      projectId: "project-1",
      data: {
        type: "post_status",
        payload: {},
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(event);

    const events1 = socket1.getAllMessages().filter((m) => m.type === "webhook_event");
    const events2 = socket2.getAllMessages().filter((m) => m.type === "webhook_event");
    const events3 = socket3.getAllMessages().filter((m) => m.type === "webhook_event");

    expect(events1.length >= 1).toBeTruthy();
    expect(events2.length >= 1).toBeTruthy();
    expect(events3.length).toBe(0);
  });

  it("should filter by combined event type and provider", async () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      eventTypes: ["POST_PUBLISHED" as WebhookEventType, "POST_UPDATED" as WebhookEventType],
      providers: ["X" as Provider, "INSTAGRAM" as Provider],
    });
    socket.clearMessages();

    const matchingEvent: WebhookEventBroadcast = {
      eventId: "event-1",
      eventType: "POST_PUBLISHED" as WebhookEventType,
      provider: "X" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      data: {
        type: "post_status",
        payload: {},
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(matchingEvent);

    let messages = socket.getAllMessages().filter((m) => m.type === "webhook_event");
    expect(messages.length >= 1).toBeTruthy();

    socket.clearMessages();

    const nonMatchingEvent: WebhookEventBroadcast = {
      eventId: "event-2",
      eventType: "POST_PUBLISHED" as WebhookEventType,
      provider: "FACEBOOK" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      data: {
        type: "post_status",
        payload: {},
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(nonMatchingEvent);

    messages = socket.getAllMessages().filter((m) => m.type === "webhook_event");
    expect(messages.length).toBe(0);
  });

  it("should broadcast system alert to account", async () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);
    socket.clearMessages();

    await state.broadcaster!.broadcastSystemAlert(
      "account-1",
      "rate_limit",
      "API rate limit exceeded",
      {
        provider: "X",
        resetAt: new Date(),
      }
    );

    const messages = socket.getAllMessages().filter((m) => m.type === "webhook_event");
    expect(messages.length >= 1).toBeTruthy();
    expect(messages[0].event.type).toBe("RATE_LIMIT_REACHED");
    expect(messages[0].event.data.type).toBe("system_alert");
    expect(messages[0].event.data.payload.alertType).toBe("rate_limit");
  });
});

describe("RealtimeWebhookBroadcaster - Connection Statistics", () => {
  beforeAll(async () => {
    setupBroadcaster();
  });

  afterAll(async () => {
    teardownBroadcaster();
  });

  beforeEach(() => {
    setupBroadcaster();
  });

  it("should track total connections", () => {
    const socket1 = new MockWebSocket();
    const socket2 = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket1 as any);
    state.broadcaster!.addConnection("conn-2", "user-2", "account-2", socket2 as any);

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.totalConnections).toBe(2);
  });

  it("should track connections by account", () => {
    const socket1 = new MockWebSocket();
    const socket2 = new MockWebSocket();
    const socket3 = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket1 as any);
    state.broadcaster!.addConnection("conn-2", "user-2", "account-1", socket2 as any);
    state.broadcaster!.addConnection("conn-3", "user-3", "account-2", socket3 as any);

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.connectionsByAccount["account-1"]).toBe(2);
    expect(stats.connectionsByAccount["account-2"]).toBe(1);
  });

  it("should track connections by project", () => {
    const socket1 = new MockWebSocket();
    const socket2 = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket1 as any, {
      projectIds: ["project-1", "project-2"],
    });
    state.broadcaster!.addConnection("conn-2", "user-2", "account-1", socket2 as any, {
      projectIds: ["project-2", "project-3"],
    });

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.connectionsByProject["project-1"]).toBe(1);
    expect(stats.connectionsByProject["project-2"]).toBe(2);
    expect(stats.connectionsByProject["project-3"]).toBe(1);
  });
});

describe("RealtimeWebhookBroadcaster - Shutdown", () => {
  beforeAll(async () => {
    setupBroadcaster();
  });

  afterAll(async () => {
    teardownBroadcaster();
  });

  beforeEach(() => {
    setupBroadcaster();
  });

  it("should close all connections on shutdown", () => {
    const socket1 = new MockWebSocket();
    const socket2 = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket1 as any);
    state.broadcaster!.addConnection("conn-2", "user-2", "account-2", socket2 as any);

    state.broadcaster!.shutdown();

    expect(socket1.readyState).toBe(socket1.CLOSED);
    expect(socket2.readyState).toBe(socket2.CLOSED);
  });

  it("should clear all connection data on shutdown", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      projectIds: ["project-1"],
    });

    state.broadcaster!.shutdown();

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.totalConnections).toBe(0);
    expect(stats.connectionsByAccount).toStrictEqual({});
    expect(stats.connectionsByProject).toStrictEqual({});
  });
});
