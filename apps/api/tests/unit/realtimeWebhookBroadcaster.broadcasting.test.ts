/**
 * Tests for RealtimeWebhookBroadcaster — Event Broadcasting
 * Covers: broadcasting to accounts/projects, event type/provider filtering, dead connections, Redis pub/sub
 *
 * @file realtimeWebhookBroadcaster.broadcasting.test.ts
 * @description Tests for RealtimeWebhookBroadcaster - Event Broadcasting
 * @layer infrastructure
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { type WebhookEventBroadcast } from "../../src/webhooks/realtimeWebhookBroadcaster.js";
import type { Provider, WebhookEventType } from "@infra/prisma";
import {
  MockWebSocket,
  state,
  setupBroadcaster,
  teardownBroadcaster,
} from "./realtimeWebhookBroadcaster.test-helpers.js";

describe("RealtimeWebhookBroadcaster - Event Broadcasting", () => {
  beforeAll(async () => {
    setupBroadcaster();
  });

  afterAll(async () => {
    teardownBroadcaster();
  });

  beforeEach(() => {
    setupBroadcaster();
  });

  it("should broadcast event to account connections", async () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);
    socket.clearMessages();

    const event: WebhookEventBroadcast = {
      eventId: "event-123",
      eventType: "POST_PUBLISHED" as WebhookEventType,
      provider: "X" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      data: {
        type: "post_status",
        payload: { postId: "post-123", status: "PUBLISHED" },
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(event);

    const messages = socket.getAllMessages();
    const webhookEvents = messages.filter((msg) => msg.type === "webhook_event");
    expect(webhookEvents.length >= 1).toBeTruthy();
    expect(webhookEvents[0].event.id).toBe("event-123");
    expect(webhookEvents[0].event.type).toBe("POST_PUBLISHED");
  });

  it("should broadcast event to project connections", async () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      projectIds: ["project-1"],
    });
    socket.clearMessages();

    const event: WebhookEventBroadcast = {
      eventId: "event-123",
      eventType: "POST_PUBLISHED" as WebhookEventType,
      provider: "X" as Provider,
      timestamp: new Date(),
      projectId: "project-1",
      data: {
        type: "post_status",
        payload: { postId: "post-123", status: "PUBLISHED" },
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(event);

    const messages = socket.getAllMessages();
    const webhookEvents = messages.filter((msg) => msg.type === "webhook_event");
    expect(webhookEvents.length >= 1).toBeTruthy();
  });

  it("should not broadcast to unrelated connections", async () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-2", socket as any);
    socket.clearMessages();

    const event: WebhookEventBroadcast = {
      eventId: "event-123",
      eventType: "POST_PUBLISHED" as WebhookEventType,
      provider: "X" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      data: {
        type: "post_status",
        payload: {},
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(event);

    const messages = socket.getAllMessages();
    expect(messages.length).toBe(0);
  });

  it("should filter by event type", async () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      eventTypes: ["POST_PUBLISHED" as WebhookEventType],
    });
    socket.clearMessages();

    const event: WebhookEventBroadcast = {
      eventId: "event-123",
      eventType: "POST_ENGAGEMENT_UPDATE" as WebhookEventType,
      provider: "X" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      data: {
        type: "engagement_update",
        payload: {},
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(event);

    const messages = socket.getAllMessages();
    expect(messages.length).toBe(0);
  });

  it("should filter by provider", async () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      providers: ["INSTAGRAM" as Provider],
    });
    socket.clearMessages();

    const event: WebhookEventBroadcast = {
      eventId: "event-123",
      eventType: "POST_PUBLISHED" as WebhookEventType,
      provider: "X" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      data: {
        type: "post_status",
        payload: {},
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(event);

    const messages = socket.getAllMessages();
    expect(messages.length).toBe(0);
  });

  it("should broadcast when filters match", async () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      eventTypes: ["POST_PUBLISHED" as WebhookEventType],
      providers: ["X" as Provider],
    });
    socket.clearMessages();

    const event: WebhookEventBroadcast = {
      eventId: "event-123",
      eventType: "POST_PUBLISHED" as WebhookEventType,
      provider: "X" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      data: {
        type: "post_status",
        payload: {},
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(event);

    const messages = socket.getAllMessages();
    const webhookEvents = messages.filter((msg) => msg.type === "webhook_event");
    expect(webhookEvents.length >= 1).toBeTruthy();
  });

  it("should broadcast to all when no filters set", async () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);
    socket.clearMessages();

    const event: WebhookEventBroadcast = {
      eventId: "event-123",
      eventType: "POST_ENGAGEMENT_UPDATE" as WebhookEventType,
      provider: "INSTAGRAM" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      data: {
        type: "engagement_update",
        payload: {},
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(event);

    const messages = socket.getAllMessages();
    const webhookEvents = messages.filter((msg) => msg.type === "webhook_event");
    expect(webhookEvents.length >= 1).toBeTruthy();
  });

  it("should remove dead connections during broadcast", async () => {
    const socket = new MockWebSocket();
    socket.readyState = socket.CLOSED;

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);

    const event: WebhookEventBroadcast = {
      eventId: "event-123",
      eventType: "POST_PUBLISHED" as WebhookEventType,
      provider: "X" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      data: {
        type: "post_status",
        payload: {},
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(event);

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.totalConnections).toBe(0);
  });

  it("should publish to Redis for cross-server broadcasting", async () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);

    const event: WebhookEventBroadcast = {
      eventId: "event-123",
      eventType: "POST_PUBLISHED" as WebhookEventType,
      provider: "X" as Provider,
      timestamp: new Date(),
      accountId: "account-1",
      data: {
        type: "post_status",
        payload: {},
      },
    };

    await state.broadcaster!.broadcastWebhookEvent(event);

    const publishCount = state.mockRedis!.getPublishedCount("webhook_events");
    expect(publishCount).toBe(1);
    expect(state.mockRedis!.publishedMessages[0].channel).toBe("webhook_events");
  });
});
