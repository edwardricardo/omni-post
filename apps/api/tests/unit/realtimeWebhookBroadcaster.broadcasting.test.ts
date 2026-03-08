/**
 * Tests for RealtimeWebhookBroadcaster — Event Broadcasting
 * Covers: broadcasting to accounts/projects, event type/provider filtering, dead connections, Redis pub/sub
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { type WebhookEventBroadcast } from "../../src/webhooks/realtimeWebhookBroadcaster.js";
import type { Provider, WebhookEventType } from "@infra/prisma";
import {
  MockWebSocket,
  state,
  setupBroadcaster,
  teardownBroadcaster,
} from "./realtimeWebhookBroadcaster.test-helpers.js";

describe("RealtimeWebhookBroadcaster - Event Broadcasting", { concurrency: 1 }, () => {
  before(async () => {
    setupBroadcaster();
  });

  after(async () => {
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
    assert.ok(webhookEvents.length >= 1, "Should have at least 1 webhook_event message");
    assert.strictEqual(webhookEvents[0].event.id, "event-123");
    assert.strictEqual(webhookEvents[0].event.type, "POST_PUBLISHED");
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
    assert.ok(webhookEvents.length >= 1, "Should have at least 1 webhook_event message");
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
    assert.strictEqual(messages.length, 0);
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
    assert.strictEqual(messages.length, 0);
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
    assert.strictEqual(messages.length, 0);
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
    assert.ok(webhookEvents.length >= 1, "Should have at least 1 webhook_event message");
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
    assert.ok(webhookEvents.length >= 1, "Should have at least 1 webhook_event message");
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
    assert.strictEqual(stats.totalConnections, 0);
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
    assert.strictEqual(publishCount, 1);
    assert.strictEqual(state.mockRedis!.publishedMessages[0].channel, "webhook_events");
  });
});
