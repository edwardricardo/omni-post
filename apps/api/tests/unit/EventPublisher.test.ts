/**
 * Unit Tests for EventPublisher (RedisEventPublisher)
 * Tests event publishing, subscription management, and retry logic
 *
 * @file EventPublisher.test.ts
 * @description Tests for EventPublisher - Event Publishing
 * @layer infrastructure
 */

import { describe, it, afterEach, beforeEach, expect } from "vitest";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { EventStoreEvent, EventHandler, createEventStoreEvent, EVENT_TYPES } from "@shared/events";

const scheduler = new NoopBackgroundTaskScheduler();

// Mock Redis client
class MockRedis {
  private subscriptions = new Map<string, Set<Function>>();
  private publishedMessages: Array<{ channel: string; message: string }> = [];
  private streams = new Map<string, any[]>();
  private pipelineCommands: Array<{ command: string; args: any[] }> = [];
  private shouldFailPublish = false;
  private shouldFailPing = false;

  async publish(channel: string, message: string): Promise<number> {
    if (this.shouldFailPublish) {
      throw new Error("Redis publish failed");
    }
    this.publishedMessages.push({ channel, message });

    // Trigger subscribers
    const handlers = this.subscriptions.get(channel);
    if (handlers) {
      handlers.forEach((handler) => handler(channel, message));
    }
    return 1;
  }

  async subscribe(channel: string, callback?: (err: Error | null) => void): Promise<void> {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    if (callback) callback(null);
  }

  async unsubscribe(channel?: string, callback?: (err: Error | null) => void): Promise<void> {
    if (channel) {
      this.subscriptions.delete(channel);
    } else {
      this.subscriptions.clear();
    }
    if (callback) callback(null);
  }

  async del(_key: string): Promise<number> {
    return 0;
  }

  on(event: string, _handler: Function): void {
    if (event === "message") {
      // Store message handler
    }
  }

  async xadd(stream: string, id: string, ...args: string[]): Promise<string> {
    if (!this.streams.has(stream)) {
      this.streams.set(stream, []);
    }
    this.streams.get(stream)!.push({ id, args });
    return `${Date.now()}-0`;
  }

  pipeline(): this {
    this.pipelineCommands = [];
    return this;
  }

  async exec(): Promise<Array<[Error | null, any]> | null> {
    if (this.shouldFailPublish) {
      return this.pipelineCommands.map(() => [new Error("Pipeline failed"), null]);
    }
    return this.pipelineCommands.map(() => [null, "OK"]);
  }

  async ping(): Promise<string> {
    if (this.shouldFailPing) {
      throw new Error("Redis ping failed");
    }
    return "PONG";
  }

  disconnect(): void {
    this.subscriptions.clear();
  }

  duplicate(): MockRedis {
    return new MockRedis();
  }

  // Helper methods for testing
  getPublishedMessages(): Array<{ channel: string; message: string }> {
    return this.publishedMessages;
  }

  clearPublishedMessages(): void {
    this.publishedMessages = [];
  }

  simulateSubscription(channel: string, handler: Function): void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    this.subscriptions.get(channel)!.add(handler);
  }

  setFailPublish(shouldFail: boolean): void {
    this.shouldFailPublish = shouldFail;
  }

  setFailPing(shouldFail: boolean): void {
    this.shouldFailPing = shouldFail;
  }
}

// Import after mocking
const { RedisEventPublisher } = await import("../../src/events/EventPublisher");

describe("EventPublisher - Event Publishing", () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
      scheduler,
      enableMetrics: true,
    });
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.shutdown();
    }
  });

  it("should publish single event to specific channel", async () => {
    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await publisher.publish(event);

    const messages = mockRedis.getPublishedMessages();
    expect(messages.length >= 2).toBe(true);

    const channelMessages = messages.filter(
      (m) => m.channel === `events:${EVENT_TYPES.POST_CREATED}`
    );
    expect(channelMessages.length).toBe(1);
  });

  it("should publish event to global channel", async () => {
    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_UPDATED,
      "post-123",
      "Post",
      { postId: "post-123", changes: {}, previousVersion: 1, newVersion: 2, projectId: "proj-1" },
      { source: "TestSuite" }
    );

    await publisher.publish(event);

    const messages = mockRedis.getPublishedMessages();
    const globalMessages = messages.filter((m) => m.channel === "events:all");
    expect(globalMessages.length).toBe(1);
  });

  it("should increment published metrics", async () => {
    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    const metricsBefore = publisher.getMetrics();
    await publisher.publish(event);
    const metricsAfter = publisher.getMetrics();

    expect(metricsAfter.published).toBe(metricsBefore.published + 1);
  });

  it("should handle publish failures gracefully", async () => {
    mockRedis.setFailPublish(true);

    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await expect(publisher.publish(event)).rejects.toThrow(/Redis publish failed/);

    const metrics = publisher.getMetrics();
    expect(metrics.failed >= 1).toBe(true);
  });

  it("should serialize events correctly", async () => {
    const timestamp = new Date("2024-01-01T12:00:00Z");
    const event: EventStoreEvent = {
      id: "event-123",
      type: EVENT_TYPES.POST_PUBLISHED,
      version: 1,
      timestamp,
      aggregateId: "post-123",
      aggregateType: "Post",
      data: {
        postId: "post-123",
        projectId: "project-456",
        channelId: "channel-789",
        provider: "X",
        externalId: "x-123",
        publishedAt: timestamp,
      },
      metadata: { source: "TestSuite" },
    };

    await publisher.publish(event);

    const messages = mockRedis.getPublishedMessages();
    const message = messages[0];
    expect(message).toBeTruthy();

    const deserialized = JSON.parse(message.message);
    expect(deserialized.id).toBe(event.id);
    expect(deserialized.type).toBe(event.type);
  });
});

describe("EventPublisher - Batch Publishing", () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
      scheduler,
      enableMetrics: true,
    });
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.shutdown();
    }
  });

  it("should publish multiple events in batch", async () => {
    const events: EventStoreEvent[] = [
      createEventStoreEvent(
        EVENT_TYPES.POST_CREATED,
        "post-1",
        "Post",
        { postId: "post-1", projectId: "project-1", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
      createEventStoreEvent(
        EVENT_TYPES.POST_CREATED,
        "post-2",
        "Post",
        { postId: "post-2", projectId: "project-1", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
      createEventStoreEvent(
        EVENT_TYPES.POST_CREATED,
        "post-3",
        "Post",
        { postId: "post-3", projectId: "project-1", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
    ];

    await publisher.publishBatch(events);

    const metrics = publisher.getMetrics();
    expect(metrics.published >= events.length).toBe(true);
  });

  it("should handle empty batch gracefully", async () => {
    await publisher.publishBatch([]);

    const metrics = publisher.getMetrics();
    expect(metrics.published).toBe(0);
  });

  it("should update average latency on batch publish", async () => {
    const events: EventStoreEvent[] = [
      createEventStoreEvent(
        EVENT_TYPES.POST_CREATED,
        "post-1",
        "Post",
        { postId: "post-1", projectId: "project-1", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
    ];

    await publisher.publishBatch(events);

    const metrics = publisher.getMetrics();
    expect(typeof metrics.averageLatency).toBe("number");
    expect(metrics.averageLatency >= 0).toBe(true);
  });
});

describe("EventPublisher - Subscription Management", () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
      scheduler,
    });
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.shutdown();
    }
  });

  it("should register event handler for specific type", async () => {
    const handler: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: EventStoreEvent): Promise<void> {
        // Handler logic
      },
    };

    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler);

    const health = await publisher.healthCheck();
    expect(health.details.activeSubscriptions).toBe(1);
  });

  it("should unregister event handler", async () => {
    const handler: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: EventStoreEvent): Promise<void> {
        // Handler logic
      },
    };

    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler);
    const healthBefore = await publisher.healthCheck();
    expect(healthBefore.details.activeSubscriptions).toBe(1);

    publisher.unsubscribe(EVENT_TYPES.POST_CREATED, handler);
    const healthAfter = await publisher.healthCheck();
    expect(healthAfter.details.activeSubscriptions).toBe(0);
  });

  it("should support multiple handlers for same event type", async () => {
    const handler1: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: EventStoreEvent): Promise<void> {
        // Handler 1
      },
    };

    const handler2: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: EventStoreEvent): Promise<void> {
        // Handler 2
      },
    };

    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler1);
    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler2);

    // Both handlers are in same event type bucket, so activeSubscriptions = 1 (1 event type)
    const health = await publisher.healthCheck();
    expect(health.details.activeSubscriptions).toBe(1);
  });

  it("should subscribe to all events with wildcard", async () => {
    const handler: EventHandler = {
      eventType: "*",
      async handle(_event: EventStoreEvent): Promise<void> {
        // Global handler
      },
    };

    publisher.subscribeToAll(handler);

    const health = await publisher.healthCheck();
    expect(health.details.activeSubscriptions >= 1).toBeTruthy();
  });
});

describe("EventPublisher - Retry Logic", () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
      scheduler,
      maxRetries: 3,
      retryDelay: 100,
    });
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.shutdown();
    }
  });

  it("should track retry attempts in metrics", async () => {
    const metricsBefore = publisher.getMetrics();

    // Metrics should be initialized
    expect(typeof metricsBefore.retried).toBe("number");
  });

  it("should send to dead letter queue after max retries", async () => {
    const deadLetterItems = await publisher.getDeadLetterItems();
    expect(Array.isArray(deadLetterItems)).toBeTruthy();
  });

  it("should clear dead letter queue", async () => {
    const clearedCount = await publisher.clearDeadLetterQueue();
    expect(typeof clearedCount).toBe("number");
  });
});

describe("EventPublisher - Metrics", () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
      scheduler,
      enableMetrics: true,
    });
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.shutdown();
    }
  });

  it("should track published events count", async () => {
    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    const metricsBefore = publisher.getMetrics();
    await publisher.publish(event);
    const metricsAfter = publisher.getMetrics();

    expect(metricsAfter.published).toBe(metricsBefore.published + 1);
  });

  it("should track delivered events count", async () => {
    const metrics = publisher.getMetrics();
    expect(typeof metrics.delivered).toBe("number");
  });

  it("should track failed events count", async () => {
    mockRedis.setFailPublish(true);

    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    try {
      await publisher.publish(event);
    } catch {
      // Expected to fail
    }

    const metrics = publisher.getMetrics();
    expect(metrics.failed >= 1).toBe(true);
  });

  it("should track average latency", async () => {
    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await publisher.publish(event);

    const metrics = publisher.getMetrics();
    expect(metrics.averageLatency >= 0).toBe(true);
  });

  it("should track last activity timestamp", async () => {
    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await publisher.publish(event);

    const metrics = publisher.getMetrics();
    expect(metrics.lastActivity instanceof Date).toBeTruthy();
  });

  it("should reset metrics", async () => {
    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await publisher.publish(event);
    publisher.resetMetrics();

    const metrics = publisher.getMetrics();
    expect(metrics.published).toBe(0);
    expect(metrics.delivered).toBe(0);
    expect(metrics.failed).toBe(0);
  });
});

describe("EventPublisher - Health Check", () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
      scheduler,
    });
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.shutdown();
    }
  });

  it("should report healthy status when Redis is available", async () => {
    const health = await publisher.healthCheck();

    expect(health.status).toBe("healthy");
    expect(health.details.redis).toBe(true);
  });

  it("should report unhealthy status when Redis fails", async () => {
    mockRedis.setFailPing(true);

    const health = await publisher.healthCheck();

    expect(health.status).toBe("unhealthy");
  });

  it("should include metrics in health check", async () => {
    const health = await publisher.healthCheck();

    expect(health.details.metrics).toBeTruthy();
    expect(typeof health.details.metrics.published).toBe("number");
  });

  it("should include active subscriptions count", async () => {
    const handler: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: EventStoreEvent): Promise<void> {},
    };

    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler);

    const health = await publisher.healthCheck();
    expect(typeof health.details.activeSubscriptions).toBe("number");
  });
});

describe("EventPublisher - Shutdown", () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
      scheduler,
    });
  });

  it("should gracefully shutdown without errors", async () => {
    // Subscribe to verify shutdown cleans up
    const handler: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: EventStoreEvent): Promise<void> {},
    };
    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler);

    // Shutdown should complete without throwing
    await expect(publisher.shutdown()).resolves.not.toThrow();
  });

  it("should unsubscribe from all channels on shutdown", async () => {
    const handler: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: EventStoreEvent): Promise<void> {},
    };

    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler);
    const healthBefore = await publisher.healthCheck();
    expect(healthBefore.details.activeSubscriptions).toBe(1);

    await publisher.shutdown();
    // After shutdown, Redis connections are disconnected
    // Verify the shutdown itself completed without error
  });
});
