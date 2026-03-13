import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import {
  MockWebSocket,
  state,
  setupBroadcaster,
  teardownBroadcaster,
} from "./realtimeWebhookBroadcaster.test-helpers.js";

describe("RealtimeWebhookBroadcaster - Connection Management", () => {
  beforeAll(async () => {
    setupBroadcaster();
  });

  afterAll(async () => {
    teardownBroadcaster();
  });

  beforeEach(() => {
    setupBroadcaster();
  });

  it("should accept new WebSocket connections", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      projectIds: ["project-1"],
    });

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.totalConnections).toBe(1);
    expect(stats.connectionsByAccount["account-1"]).toBe(1);
    expect(stats.connectionsByProject["project-1"]).toBe(1);
  });

  it("should send connection_established message on new connection", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);

    const message = socket.getLastMessage();
    expect(message.type).toBe("connection_established");
    expect(message.connectionId).toBe("conn-1");
    expect(message.timestamp).toBeTruthy();
  });

  it("should handle multiple connections from same account", () => {
    const socket1 = new MockWebSocket();
    const socket2 = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket1 as any);
    state.broadcaster!.addConnection("conn-2", "user-2", "account-1", socket2 as any);

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.totalConnections).toBe(2);
    expect(stats.connectionsByAccount["account-1"]).toBe(2);
  });

  it("should handle multiple projects in single connection", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      projectIds: ["project-1", "project-2", "project-3"],
    });

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.connectionsByProject["project-1"]).toBe(1);
    expect(stats.connectionsByProject["project-2"]).toBe(1);
    expect(stats.connectionsByProject["project-3"]).toBe(1);
  });

  it("should remove connection when disconnected", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      projectIds: ["project-1"],
    });

    state.broadcaster!.removeConnection("conn-1");

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.totalConnections).toBe(0);
    expect(stats.connectionsByAccount["account-1"]).toBe(undefined);
    expect(stats.connectionsByProject["project-1"]).toBe(undefined);
  });

  it("should clean up indexes when removing connection", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      projectIds: ["project-1", "project-2"],
    });

    state.broadcaster!.removeConnection("conn-1");

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.connectionsByProject["project-1"]).toBe(undefined);
    expect(stats.connectionsByProject["project-2"]).toBe(undefined);
  });

  it("should handle socket close event", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);

    socket.close();

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.totalConnections).toBe(0);
  });

  it("should handle socket error event", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);

    socket.simulateError(new Error("WebSocket error"));

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.totalConnections).toBe(0);
  });
});

describe("RealtimeWebhookBroadcaster - WebSocket Message Handling", () => {
  beforeAll(async () => {
    setupBroadcaster();
  });

  afterAll(async () => {
    teardownBroadcaster();
  });

  beforeEach(() => {
    setupBroadcaster();
  });

  it("should respond to ping with pong", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);
    socket.clearMessages();

    socket.simulateMessage(JSON.stringify({ type: "ping" }));

    const message = socket.getLastMessage();
    expect(message.type).toBe("pong");
    expect(message.timestamp).toBeTruthy();
  });

  it("should update project subscriptions", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any, {
      projectIds: ["project-1"],
    });
    socket.clearMessages();

    socket.simulateMessage(
      JSON.stringify({
        type: "subscribe_projects",
        projectIds: ["project-2", "project-3"],
      })
    );

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.connectionsByProject["project-1"]).toBe(undefined);
    expect(stats.connectionsByProject["project-2"]).toBe(1);
    expect(stats.connectionsByProject["project-3"]).toBe(1);

    const message = socket.getLastMessage();
    expect(message.type).toBe("subscription_updated");
    expect(message.subscriptions.projects).toStrictEqual(["project-2", "project-3"]);
  });

  it("should update event type subscriptions", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);
    socket.clearMessages();

    socket.simulateMessage(
      JSON.stringify({
        type: "subscribe_events",
        eventTypes: ["POST_PUBLISHED", "POST_ENGAGEMENT_UPDATE"],
      })
    );

    const message = socket.getLastMessage();
    expect(message.type).toBe("subscription_updated");
    expect(message.subscriptions.eventTypes).toStrictEqual([
      "POST_PUBLISHED",
      "POST_ENGAGEMENT_UPDATE",
    ]);
  });

  it("should update provider subscriptions", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);
    socket.clearMessages();

    socket.simulateMessage(
      JSON.stringify({
        type: "subscribe_providers",
        providers: ["X", "INSTAGRAM"],
      })
    );

    const message = socket.getLastMessage();
    expect(message.type).toBe("subscription_updated");
    expect(message.subscriptions.providers).toStrictEqual(["X", "INSTAGRAM"]);
  });

  it("should handle malformed JSON messages gracefully", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);

    socket.simulateMessage("invalid json {{{");

    const stats = state.broadcaster!.getConnectionStats();
    expect(stats.totalConnections).toBe(1);
  });

  it("should ignore unknown message types", () => {
    const socket = new MockWebSocket();

    state.broadcaster!.addConnection("conn-1", "user-1", "account-1", socket as any);
    socket.clearMessages();

    socket.simulateMessage(
      JSON.stringify({
        type: "unknown_type",
        data: "test",
      })
    );

    const messages = socket.getAllMessages();
    expect(messages.length).toBe(0);
  });
});
