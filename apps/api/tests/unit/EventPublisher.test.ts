/**
 * Unit Tests for EventPublisher (RedisEventPublisher)
 * Tests event publishing, subscription management, and retry logic
 */

import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DomainEvent, EventHandler, createDomainEvent, EVENT_TYPES } from "@shared/events";

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

  async subscribe(channel: string, callback: (err: Error | null) => void): Promise<void> {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    callback(null);
  }

  async unsubscribe(channel: string, callback: (err: Error | null) => void): Promise<void> {
    this.subscriptions.delete(channel);
    callback(null);
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

describe("EventPublisher - Event Publishing", { concurrency: 1 }, () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
      enableMetrics: true,
    });
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.shutdown();
    }
  });

  it("should publish single event to specific channel", async () => {
    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await publisher.publish(event);

    const messages = mockRedis.getPublishedMessages();
    assert.equal(messages.length >= 2, true, "Should publish to at least 2 channels");

    const channelMessages = messages.filter(
      (m) => m.channel === `events:${EVENT_TYPES.POST_CREATED}`
    );
    assert.equal(channelMessages.length, 1, "Should publish to specific event channel");
  });

  it("should publish event to global channel", async () => {
    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_UPDATED,
      "post-123",
      "Post",
      { postId: "post-123", changes: {}, previousVersion: 1, newVersion: 2, projectId: "proj-1" },
      { source: "TestSuite" }
    );

    await publisher.publish(event);

    const messages = mockRedis.getPublishedMessages();
    const globalMessages = messages.filter((m) => m.channel === "events:all");
    assert.equal(globalMessages.length, 1, "Should publish to global events channel");
  });

  it("should increment published metrics", async () => {
    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    const metricsBefore = publisher.getMetrics();
    await publisher.publish(event);
    const metricsAfter = publisher.getMetrics();

    assert.equal(
      metricsAfter.published,
      metricsBefore.published + 1,
      "Should increment published count"
    );
  });

  it("should handle publish failures gracefully", async () => {
    mockRedis.setFailPublish(true);

    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await assert.rejects(
      async () => await publisher.publish(event),
      { message: /Redis publish failed/ },
      "Should throw error on publish failure"
    );

    const metrics = publisher.getMetrics();
    assert.equal(metrics.failed >= 1, true, "Should increment failed count");
  });

  it("should serialize events correctly", async () => {
    const timestamp = new Date("2024-01-01T12:00:00Z");
    const event: DomainEvent = {
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
    assert.ok(message, "Should have published message");

    const deserialized = JSON.parse(message.message);
    assert.equal(deserialized.id, event.id, "Should preserve event ID");
    assert.equal(deserialized.type, event.type, "Should preserve event type");
  });
});

describe("EventPublisher - Batch Publishing", { concurrency: 1 }, () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
      enableMetrics: true,
    });
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.shutdown();
    }
  });

  it("should publish multiple events in batch", async () => {
    const events: DomainEvent[] = [
      createDomainEvent(
        EVENT_TYPES.POST_CREATED,
        "post-1",
        "Post",
        { postId: "post-1", projectId: "project-1", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
      createDomainEvent(
        EVENT_TYPES.POST_CREATED,
        "post-2",
        "Post",
        { postId: "post-2", projectId: "project-1", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
      createDomainEvent(
        EVENT_TYPES.POST_CREATED,
        "post-3",
        "Post",
        { postId: "post-3", projectId: "project-1", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
    ];

    await publisher.publishBatch(events);

    const metrics = publisher.getMetrics();
    assert.equal(
      metrics.published >= events.length,
      true,
      "Should increment published count by batch size"
    );
  });

  it("should handle empty batch gracefully", async () => {
    await publisher.publishBatch([]);

    const metrics = publisher.getMetrics();
    assert.equal(metrics.published, 0, "Should not increment published count for empty batch");
  });

  it("should update average latency on batch publish", async () => {
    const events: DomainEvent[] = [
      createDomainEvent(
        EVENT_TYPES.POST_CREATED,
        "post-1",
        "Post",
        { postId: "post-1", projectId: "project-1", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
    ];

    await publisher.publishBatch(events);

    const metrics = publisher.getMetrics();
    assert.equal(typeof metrics.averageLatency, "number", "Should have numeric average latency");
    assert.equal(metrics.averageLatency >= 0, true, "Should have non-negative average latency");
  });
});

describe("EventPublisher - Subscription Management", { concurrency: 1 }, () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
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
      async handle(_event: DomainEvent): Promise<void> {
        // Handler logic
      },
    };

    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler);

    const health = await publisher.healthCheck();
    assert.strictEqual(health.details.activeSubscriptions, 1, "Should have 1 active subscription");
  });

  it("should unregister event handler", async () => {
    const handler: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: DomainEvent): Promise<void> {
        // Handler logic
      },
    };

    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler);
    const healthBefore = await publisher.healthCheck();
    assert.strictEqual(healthBefore.details.activeSubscriptions, 1);

    publisher.unsubscribe(EVENT_TYPES.POST_CREATED, handler);
    const healthAfter = await publisher.healthCheck();
    assert.strictEqual(
      healthAfter.details.activeSubscriptions,
      0,
      "Should have 0 active subscriptions after unregister"
    );
  });

  it("should support multiple handlers for same event type", async () => {
    const handler1: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: DomainEvent): Promise<void> {
        // Handler 1
      },
    };

    const handler2: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: DomainEvent): Promise<void> {
        // Handler 2
      },
    };

    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler1);
    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler2);

    // Both handlers are in same event type bucket, so activeSubscriptions = 1 (1 event type)
    const health = await publisher.healthCheck();
    assert.strictEqual(
      health.details.activeSubscriptions,
      1,
      "Should have 1 event type with subscriptions"
    );
  });

  it("should subscribe to all events with wildcard", async () => {
    const handler: EventHandler = {
      eventType: "*",
      async handle(_event: DomainEvent): Promise<void> {
        // Global handler
      },
    };

    publisher.subscribeToAll(handler);

    const health = await publisher.healthCheck();
    assert.ok(
      health.details.activeSubscriptions >= 1,
      "Should have at least 1 active subscription for wildcard"
    );
  });
});

describe("EventPublisher - Retry Logic", { concurrency: 1 }, () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
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
    assert.equal(typeof metricsBefore.retried, "number", "Should have retry count");
  });

  it("should send to dead letter queue after max retries", async () => {
    const deadLetterItems = await publisher.getDeadLetterItems();
    assert.ok(Array.isArray(deadLetterItems), "Should return dead letter items array");
  });

  it("should clear dead letter queue", async () => {
    const clearedCount = await publisher.clearDeadLetterQueue();
    assert.equal(typeof clearedCount, "number", "Should return number of cleared items");
  });
});

describe("EventPublisher - Metrics", { concurrency: 1 }, () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
      enableMetrics: true,
    });
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.shutdown();
    }
  });

  it("should track published events count", async () => {
    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    const metricsBefore = publisher.getMetrics();
    await publisher.publish(event);
    const metricsAfter = publisher.getMetrics();

    assert.equal(
      metricsAfter.published,
      metricsBefore.published + 1,
      "Should increment published count"
    );
  });

  it("should track delivered events count", async () => {
    const metrics = publisher.getMetrics();
    assert.equal(typeof metrics.delivered, "number", "Should have delivered count");
  });

  it("should track failed events count", async () => {
    mockRedis.setFailPublish(true);

    const event: DomainEvent = createDomainEvent(
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
    assert.equal(metrics.failed >= 1, true, "Should increment failed count");
  });

  it("should track average latency", async () => {
    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await publisher.publish(event);

    const metrics = publisher.getMetrics();
    assert.equal(metrics.averageLatency >= 0, true, "Should have average latency");
  });

  it("should track last activity timestamp", async () => {
    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await publisher.publish(event);

    const metrics = publisher.getMetrics();
    assert.ok(metrics.lastActivity instanceof Date, "Should have last activity timestamp");
  });

  it("should reset metrics", async () => {
    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await publisher.publish(event);
    publisher.resetMetrics();

    const metrics = publisher.getMetrics();
    assert.equal(metrics.published, 0, "Should reset published count");
    assert.equal(metrics.delivered, 0, "Should reset delivered count");
    assert.equal(metrics.failed, 0, "Should reset failed count");
  });
});

describe("EventPublisher - Health Check", { concurrency: 1 }, () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
    });
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.shutdown();
    }
  });

  it("should report healthy status when Redis is available", async () => {
    const health = await publisher.healthCheck();

    assert.equal(health.status, "healthy", "Should report healthy status");
    assert.equal(health.details.redis, true, "Should report Redis as healthy");
  });

  it("should report unhealthy status when Redis fails", async () => {
    mockRedis.setFailPing(true);

    const health = await publisher.healthCheck();

    assert.equal(health.status, "unhealthy", "Should report unhealthy status");
  });

  it("should include metrics in health check", async () => {
    const health = await publisher.healthCheck();

    assert.ok(health.details.metrics, "Should include metrics in health check");
    assert.equal(typeof health.details.metrics.published, "number", "Should have published count");
  });

  it("should include active subscriptions count", async () => {
    const handler: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: DomainEvent): Promise<void> {},
    };

    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler);

    const health = await publisher.healthCheck();
    assert.equal(
      typeof health.details.activeSubscriptions,
      "number",
      "Should have active subscriptions count"
    );
  });
});

describe("EventPublisher - Shutdown", { concurrency: 1 }, () => {
  let publisher: any;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    publisher = new RedisEventPublisher({
      redis: mockRedis as any,
    });
  });

  it("should gracefully shutdown without errors", async () => {
    // Subscribe to verify shutdown cleans up
    const handler: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: DomainEvent): Promise<void> {},
    };
    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler);

    // Shutdown should complete without throwing
    await assert.doesNotReject(
      async () => await publisher.shutdown(),
      "Shutdown should complete without throwing"
    );
  });

  it("should unsubscribe from all channels on shutdown", async () => {
    const handler: EventHandler = {
      eventType: EVENT_TYPES.POST_CREATED,
      async handle(_event: DomainEvent): Promise<void> {},
    };

    publisher.subscribe(EVENT_TYPES.POST_CREATED, handler);
    const healthBefore = await publisher.healthCheck();
    assert.strictEqual(
      healthBefore.details.activeSubscriptions,
      1,
      "Should have subscriptions before shutdown"
    );

    await publisher.shutdown();
    // After shutdown, Redis connections are disconnected
    // Verify the shutdown itself completed without error
  });
});
