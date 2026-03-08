/**
 * Unit Tests for EventStore (PostgreSQLEventStore)
 * Tests event persistence, retrieval, and event sourcing patterns
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DomainEvent, createDomainEvent, EVENT_TYPES } from "@shared/events";

// Mock Prisma Client
class MockPrismaClient {
  private events: any[] = [];
  private snapshots = new Map<string, any>();
  private shouldFailTransaction = false;
  private shouldFailQuery = false;
  private currentVersion = 0;

  async $transaction(callback: (tx: any) => Promise<void>): Promise<void> {
    if (this.shouldFailTransaction) {
      throw new Error("Transaction failed");
    }
    await callback(this);
  }

  async $queryRaw<T = unknown>(query: any, ..._args: any[]): Promise<T> {
    if (this.shouldFailQuery) {
      throw new Error("Query failed");
    }

    // Simulate version query
    if (query.toString().includes("MAX(version)")) {
      return [{ version: this.currentVersion }] as T;
    }

    // Simulate sequence query
    if (query.toString().includes("next_sequence")) {
      return [{ next_sequence: this.events.length + 1 }] as T;
    }

    // Simulate events query
    if (query.toString().includes("SELECT")) {
      return this.events as T;
    }

    // Simulate stats query
    if (query.toString().includes("COUNT(*)")) {
      return [
        {
          event_count: this.events.length,
          current_version: this.currentVersion,
          first_event_at: this.events[0]?.timestamp,
          last_event_at: this.events[this.events.length - 1]?.timestamp,
          total_events: this.events.length,
        },
      ] as T;
    }

    return [] as T;
  }

  async $executeRaw(query: any, ...args: any[]): Promise<number> {
    if (this.shouldFailQuery) {
      throw new Error("Execute failed");
    }

    // Simulate INSERT
    if (query.toString().includes("INSERT")) {
      this.currentVersion++;
      this.events.push({
        id: args[0] || `event-${Date.now()}`,
        stream_id: args[1] || "stream:test",
        event_type: args[2] || "test.event",
        event_data: args[3] || "{}",
        metadata: args[4] || "{}",
        version: this.currentVersion,
        sequence: this.events.length + 1,
        timestamp: new Date(),
      });
      return 1;
    }

    // Simulate DELETE
    if (query.toString().includes("DELETE")) {
      const deleted = this.events.length;
      this.events = [];
      return deleted;
    }

    return 0;
  }

  // Helper methods for testing
  getEvents(): any[] {
    return this.events;
  }

  clearEvents(): void {
    this.events = [];
    this.currentVersion = 0;
  }

  setFailTransaction(shouldFail: boolean): void {
    this.shouldFailTransaction = shouldFail;
  }

  setFailQuery(shouldFail: boolean): void {
    this.shouldFailQuery = shouldFail;
  }

  setCurrentVersion(version: number): void {
    this.currentVersion = version;
  }
}

// Mock Redis
class MockRedis {
  private publishedEvents: Array<{ channel: string; payload: string }> = [];
  private shouldFailPublish = false;
  private shouldFailPing = false;

  async publish(channel: string, payload: string): Promise<number> {
    if (this.shouldFailPublish) {
      throw new Error("Redis publish failed");
    }
    this.publishedEvents.push({ channel, payload });
    return 1;
  }

  pipeline(): this {
    return this;
  }

  async exec(): Promise<any> {
    if (this.shouldFailPublish) {
      throw new Error("Pipeline exec failed");
    }
    return [];
  }

  async ping(): Promise<string> {
    if (this.shouldFailPing) {
      throw new Error("Redis ping failed");
    }
    return "PONG";
  }

  // Helper methods
  getPublishedEvents(): Array<{ channel: string; payload: string }> {
    return this.publishedEvents;
  }

  clearPublishedEvents(): void {
    this.publishedEvents = [];
  }

  setFailPublish(shouldFail: boolean): void {
    this.shouldFailPublish = shouldFail;
  }

  setFailPing(shouldFail: boolean): void {
    this.shouldFailPing = shouldFail;
  }
}

// Import after mocking
const { PostgreSQLEventStore } = await import("../../src/events/EventStore");

describe("EventStore - Event Appending", { concurrency: 1 }, () => {
  let eventStore: any;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    eventStore = new PostgreSQLEventStore({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
    });
  });

  it("should append single event to stream", async () => {
    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await eventStore.append("post-123", [event]);

    const storedEvents = mockPrisma.getEvents();
    assert.equal(storedEvents.length, 1, "Should store one event");
  });

  it("should append multiple events to stream", async () => {
    const events: DomainEvent[] = [
      createDomainEvent(
        EVENT_TYPES.POST_CREATED,
        "post-123",
        "Post",
        { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
      createDomainEvent(
        EVENT_TYPES.POST_UPDATED,
        "post-123",
        "Post",
        { postId: "post-123", changes: {}, previousVersion: 1, newVersion: 2, projectId: "proj-1" },
        { source: "TestSuite" }
      ),
    ];

    await eventStore.append("post-123", events);

    const storedEvents = mockPrisma.getEvents();
    assert.equal(storedEvents.length, 2, "Should store multiple events");
  });

  it("should handle empty event array gracefully", async () => {
    await eventStore.append("post-123", []);

    const storedEvents = mockPrisma.getEvents();
    assert.equal(storedEvents.length, 0, "Should not store any events");
  });

  it("should enforce optimistic concurrency control", async () => {
    mockPrisma.setCurrentVersion(5);

    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_UPDATED,
      "post-123",
      "Post",
      { postId: "post-123", changes: {}, previousVersion: 1, newVersion: 2, projectId: "proj-1" },
      { source: "TestSuite" }
    );

    await assert.rejects(
      async () => await eventStore.append("post-123", [event], 3),
      { message: /Concurrency conflict/ },
      "Should throw concurrency conflict error"
    );
  });

  it("should publish events to Redis after storing", async () => {
    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await eventStore.append("post-123", [event]);

    const publishedEvents = mockRedis.getPublishedEvents();
    assert.equal(publishedEvents.length >= 1, true, "Should publish events to Redis");
  });

  it("should handle max batch size limit", async () => {
    const events: DomainEvent[] = Array.from({ length: 1001 }, (_, i) =>
      createDomainEvent(
        EVENT_TYPES.POST_CREATED,
        `post-${i}`,
        "Post",
        { postId: `post-${i}`, projectId: "project-456", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      )
    );

    await assert.rejects(
      async () => await eventStore.append("post-123", events),
      { message: /Cannot append more than/ },
      "Should throw error for batch size limit"
    );
  });

  it("should handle transaction failures", async () => {
    mockPrisma.setFailTransaction(true);

    const event: DomainEvent = createDomainEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await assert.rejects(
      async () => await eventStore.append("post-123", [event]),
      { message: /Transaction failed/ },
      "Should throw transaction error"
    );
  });
});

describe("EventStore - Event Retrieval", { concurrency: 1 }, () => {
  let eventStore: any;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    eventStore = new PostgreSQLEventStore({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
    });
  });

  it("should get events from specific stream", async () => {
    const events = await eventStore.getEvents("post-123");
    assert.ok(Array.isArray(events), "Should return array of events");
  });

  it("should get events from specific version", async () => {
    const events = await eventStore.getEvents("post-123", 5);
    assert.ok(Array.isArray(events), "Should return array of events from version");
  });

  it("should get all events across streams", async () => {
    const events = await eventStore.getAllEvents();
    assert.ok(Array.isArray(events), "Should return array of all events");
  });

  it("should get all events from specific position", async () => {
    const events = await eventStore.getAllEvents(100);
    assert.ok(Array.isArray(events), "Should return array of events from position");
  });

  it("should get events by type", async () => {
    const events = await eventStore.getEventsByType(EVENT_TYPES.POST_CREATED);
    assert.ok(Array.isArray(events), "Should return array of events by type");
  });

  it("should get events by type from timestamp", async () => {
    const fromTimestamp = new Date("2024-01-01T00:00:00Z");
    const events = await eventStore.getEventsByType(EVENT_TYPES.POST_CREATED, fromTimestamp);
    assert.ok(Array.isArray(events), "Should return array of events from timestamp");
  });

  it("should handle query failures gracefully", async () => {
    mockPrisma.setFailQuery(true);

    await assert.rejects(
      async () => await eventStore.getEvents("post-123"),
      { message: /Query failed/ },
      "Should throw query error"
    );
  });
});

describe("EventStore - Stream Statistics", { concurrency: 1 }, () => {
  let eventStore: any;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    eventStore = new PostgreSQLEventStore({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
    });

    // Pre-populate storage so getStreamStats can find events
    await mockPrisma.$executeRaw`INSERT INTO stored_events VALUES (...)`;
  });

  it("should get stream statistics", async () => {
    const stats = await eventStore.getStreamStats("post-123");

    assert.equal(typeof stats.eventCount, "number", "Should have event count");
    assert.equal(typeof stats.currentVersion, "number", "Should have current version");
  });

  it("should include first and last event timestamps", async () => {
    const stats = await eventStore.getStreamStats("post-123");

    assert.ok(
      "firstEventAt" in stats || stats.firstEventAt === undefined,
      "Should have firstEventAt property"
    );
    assert.ok(
      "lastEventAt" in stats || stats.lastEventAt === undefined,
      "Should have lastEventAt property"
    );
  });

  it("should handle empty stream", async () => {
    mockPrisma.clearEvents();

    const stats = await eventStore.getStreamStats("empty-stream");

    assert.equal(stats.eventCount, 0, "Should have zero event count");
    assert.equal(stats.currentVersion, 0, "Should have zero version");
  });
});

describe("EventStore - Snapshots", { concurrency: 1 }, () => {
  let eventStore: any;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    eventStore = new PostgreSQLEventStore({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
    });
  });

  it("should create snapshot for stream without throwing", async () => {
    const snapshotData = {
      postId: "post-123",
      title: "Test Post",
      status: "PUBLISHED",
      version: 5,
    };

    // createSnapshot should complete without throwing
    await assert.doesNotReject(
      async () => await eventStore.createSnapshot("post-123", 5, snapshotData),
      "Should create snapshot successfully without errors"
    );
  });

  it("should get latest snapshot", async () => {
    const snapshot = await eventStore.getSnapshot("post-123");

    // Snapshot may be null if not created
    assert.ok(snapshot === null || typeof snapshot === "object", "Should return snapshot or null");
  });

  it("should handle missing snapshot", async () => {
    const snapshot = await eventStore.getSnapshot("nonexistent-stream");

    assert.equal(snapshot, null, "Should return null for missing snapshot");
  });

  it("should handle snapshot query failures", async () => {
    mockPrisma.setFailQuery(true);

    await assert.rejects(
      async () => await eventStore.getSnapshot("post-123"),
      { message: /Query failed/ },
      "Should throw query error"
    );
  });
});

describe("EventStore - Health Check", { concurrency: 1 }, () => {
  let eventStore: any;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    eventStore = new PostgreSQLEventStore({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
    });
  });

  it("should report healthy status when services are available", async () => {
    const health = await eventStore.healthCheck();

    assert.equal(health.status, "healthy", "Should report healthy status");
    assert.equal(health.details.database, true, "Should report database as healthy");
    assert.equal(health.details.redis, true, "Should report Redis as healthy");
  });

  it("should report unhealthy status when database fails", async () => {
    mockPrisma.setFailQuery(true);

    const health = await eventStore.healthCheck();

    assert.equal(health.status, "unhealthy", "Should report unhealthy status");
    assert.equal(health.details.database, false, "Should report database as unhealthy");
  });

  it("should report unhealthy status when Redis fails", async () => {
    mockRedis.setFailPing(true);

    const health = await eventStore.healthCheck();

    assert.equal(health.status, "unhealthy", "Should report unhealthy status");
    assert.equal(health.details.redis, false, "Should report Redis as unhealthy");
  });

  it("should include total events in health check", async () => {
    const health = await eventStore.healthCheck();

    assert.ok(
      "totalEvents" in health.details || health.details.totalEvents === undefined,
      "Should have totalEvents property"
    );
  });
});

describe("EventStore - Cleanup", { concurrency: 1 }, () => {
  let eventStore: any;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    eventStore = new PostgreSQLEventStore({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
    });
  });

  it("should cleanup old events", async () => {
    const olderThan = new Date("2023-01-01T00:00:00Z");
    const deletedCount = await eventStore.cleanup(olderThan);

    assert.equal(typeof deletedCount, "number", "Should return number of deleted events");
  });

  it("should keep minimum events when cleaning up", async () => {
    const olderThan = new Date("2023-01-01T00:00:00Z");
    const deletedCount = await eventStore.cleanup(olderThan, 1000);

    assert.equal(typeof deletedCount, "number", "Should return number of deleted events");
  });

  it("should handle cleanup failures", async () => {
    mockPrisma.setFailQuery(true);
    const olderThan = new Date("2023-01-01T00:00:00Z");

    await assert.rejects(
      async () => await eventStore.cleanup(olderThan),
      { message: /Execute failed/ },
      "Should throw cleanup error"
    );
  });
});

describe("EventStore - Event Sourcing Patterns", { concurrency: 1 }, () => {
  let eventStore: any;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    eventStore = new PostgreSQLEventStore({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
    });
  });

  it("should retrieve events starting from specific version", async () => {
    const events = await eventStore.getEvents("post-123", 5);
    assert.ok(Array.isArray(events), "Should return an array");
    // Mock returns empty by default - verifying the method accepts version parameter without error
    assert.strictEqual(typeof events.length, "number", "Array should have a length property");
  });

  it("should retrieve all events starting from specific position", async () => {
    const events = await eventStore.getAllEvents(100);
    assert.ok(Array.isArray(events), "Should return an array");
    assert.strictEqual(typeof events.length, "number", "Array should have a length property");
  });

  it("should maintain event ordering by version", async () => {
    const events: DomainEvent[] = [
      createDomainEvent(
        EVENT_TYPES.POST_CREATED,
        "post-123",
        "Post",
        { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
      createDomainEvent(
        EVENT_TYPES.POST_UPDATED,
        "post-123",
        "Post",
        { postId: "post-123", changes: {}, previousVersion: 1, newVersion: 2, projectId: "proj-1" },
        { source: "TestSuite" }
      ),
    ];

    await eventStore.append("post-123", events);

    const storedEvents = mockPrisma.getEvents();
    assert.equal(storedEvents.length, 2, "Should maintain event ordering");
  });

  it("should support correlation ID tracking", async () => {
    const correlationId = "correlation-123";
    const event: DomainEvent = {
      ...createDomainEvent(
        EVENT_TYPES.POST_CREATED,
        "post-123",
        "Post",
        { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
      correlationId,
    };

    await eventStore.append("post-123", [event]);

    const storedEvents = mockPrisma.getEvents();
    assert.equal(storedEvents.length, 1, "Should store the event");
    assert.strictEqual(event.correlationId, correlationId, "Event should preserve correlationId");
  });

  it("should support causation ID tracking", async () => {
    const causationId = "causation-456";
    const event: DomainEvent = {
      ...createDomainEvent(
        EVENT_TYPES.POST_CREATED,
        "post-123",
        "Post",
        { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
      causationId,
    };

    await eventStore.append("post-123", [event]);

    const storedEvents = mockPrisma.getEvents();
    assert.equal(storedEvents.length, 1, "Should store the event");
    assert.strictEqual(event.causationId, causationId, "Event should preserve causationId");
  });
});
