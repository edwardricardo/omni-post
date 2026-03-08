/**
 * Tests for RealtimeWebhookBroadcaster — Filtering Logic, Connection Statistics, and Shutdown
 * Covers: multi-connection broadcasts, combined filters, system alerts, stats tracking, shutdown behavior
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

describe("RealtimeWebhookBroadcaster - Broadcast Filtering Logic", { concurrency: 1 }, () => {
  before(async () => {
    setupBroadcaster();
  });

  after(async () => {
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

    assert.ok(events1.length >= 1, "Account 1 connection 1 should receive event");
    assert.ok(events2.length >= 1, "Account 1 connection 2 should receive event");
    assert.strictEqual(events3.length, 0, "Account 2 connection should not receive event");
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
    assert.ok(messages.length >= 1, "Should receive matching event");

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
    assert.strictEqual(messages.length, 0, "Should not receive non-matching event");
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
    assert.ok(messages.length >= 1, "Should receive system alert");
    assert.strictEqual(messages[0].event.type, "RATE_LIMIT_REACHED");
    assert.strictEqual(messages[0].event.data.type, "system_alert");
    assert.strictEqual(messages[0].event.data.payload.alertType, "rate_limit");
  });
});

describe("RealtimeWebhookBroadcaster - Connection Statistics", { concurrency: 1 }, () => {
  before(async () => {
    setupBroadcaster();
  });

  after(async () => {
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
    assert.strictEqual(stats.totalConnections, 2);
  });

  it("should track connections by account", () => {
    const socket1 = new MockWebSocket();
    const socket2 = new MockWebSocket();
    const socket3 = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket1 as any);
    state.broadcaster!.addConnection("conn-2", "user-2", "account-1", socket2 as any);
    state.broadcaster!.addConnection("conn-3", "user-3", "account-2", socket3 as any);

    const stats = state.broadcaster!.getConnectionStats();
    assert.strictEqual(stats.connectionsByAccount["account-1"], 2);
    assert.strictEqual(stats.connectionsByAccount["account-2"], 1);
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
    assert.strictEqual(stats.connectionsByProject["project-1"], 1);
    assert.strictEqual(stats.connectionsByProject["project-2"], 2);
    assert.strictEqual(stats.connectionsByProject["project-3"], 1);
  });
});

describe("RealtimeWebhookBroadcaster - Shutdown", { concurrency: 1 }, () => {
  before(async () => {
    setupBroadcaster();
  });

  after(async () => {
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

    assert.strictEqual(socket1.readyState, socket1.CLOSED);
    assert.strictEqual(socket2.readyState, socket2.CLOSED);
  });

  it("should clear all connection data on shutdown", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      projectIds: ["project-1"],
    });

    state.broadcaster!.shutdown();

    const stats = state.broadcaster!.getConnectionStats();
    assert.strictEqual(stats.totalConnections, 0);
    assert.deepStrictEqual(stats.connectionsByAccount, {});
    assert.deepStrictEqual(stats.connectionsByProject, {});
  });
});
