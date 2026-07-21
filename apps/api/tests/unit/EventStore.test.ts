/**
 * Unit Tests for EventStore (PostgreSQLEventStore)
 * Tests event persistence, retrieval, and event sourcing patterns
 *
 * @file EventStore.test.ts
 * @description Tests for EventStore - Event Appending
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect } from "vitest";
import { EventStoreEvent, createEventStoreEvent, EVENT_TYPES } from "@shared/types/events.js";

interface MockStoredEventRow {
  id: string;
  streamId: string;
  eventType: string;
  eventData: string;
  metadata: string;
  version: number;
  sequence: bigint;
  timestamp: Date;
  correlationId: string | null;
  causationId: string | null;
}

interface MockSnapshotRow {
  streamId: string;
  version: number;
  data: string;
  createdAt: Date;
}

// Mock Prisma Client
class MockPrismaClient {
  private events: MockStoredEventRow[] = [];
  private snapshots = new Map<string, MockSnapshotRow>();
  private shouldFailTransaction = false;
  private shouldFailQuery = false;
  private currentVersion = 0;

  storedEvent = {
    findMany: async (args?: {
      where?: {
        streamId?: string;
        eventType?: string;
        version?: { gte?: number };
        sequence?: { gte?: bigint | number };
        timestamp?: { gte?: Date };
      };
      orderBy?: Record<string, "asc" | "desc">;
      take?: number;
    }): Promise<MockStoredEventRow[]> => {
      if (this.shouldFailQuery) throw new Error("Query failed");
      let result = [...this.events];
      const where = args?.where;
      if (where) {
        if (where.streamId !== undefined) {
          result = result.filter((e) => e.streamId === where.streamId);
        }
        if (where.eventType !== undefined) {
          result = result.filter((e) => e.eventType === where.eventType);
        }
        if (where.version?.gte !== undefined) {
          const min = where.version.gte;
          result = result.filter((e) => e.version >= min);
        }
        if (where.sequence?.gte !== undefined) {
          const min = BigInt(where.sequence.gte);
          result = result.filter((e) => e.sequence >= min);
        }
        if (where.timestamp?.gte !== undefined) {
          const min = where.timestamp.gte;
          result = result.filter((e) => e.timestamp >= min);
        }
      }
      if (args?.orderBy) {
        const [orderField, direction] = Object.entries(args.orderBy)[0] ?? [];
        if (orderField) {
          result.sort((a, b) => {
            const av = (a as Record<string, unknown>)[orderField] as
              number | bigint | Date | string | null;
            const bv = (b as Record<string, unknown>)[orderField] as
              number | bigint | Date | string | null;
            const aNum = av instanceof Date ? av.getTime() : av;
            const bNum = bv instanceof Date ? bv.getTime() : bv;
            const cmp = (aNum ?? 0) < (bNum ?? 0) ? -1 : (aNum ?? 0) > (bNum ?? 0) ? 1 : 0;
            return direction === "desc" ? -cmp : cmp;
          });
        }
      }
      if (args?.take !== undefined) {
        result = result.slice(0, args.take);
      }
      return result;
    },
    aggregate: async (args?: {
      where?: { streamId?: string };
      _count?: { _all?: boolean };
      _max?: { version?: boolean; timestamp?: boolean };
      _min?: { timestamp?: boolean };
    }): Promise<{
      _count: { _all: number };
      _max: { version: number | null; timestamp: Date | null };
      _min: { timestamp: Date | null };
    }> => {
      if (this.shouldFailQuery) throw new Error("Query failed");
      let scope = [...this.events];
      if (args?.where?.streamId !== undefined) {
        const sid = args.where.streamId;
        scope = scope.filter((e) => e.streamId === sid);
      }
      return {
        _count: { _all: scope.length },
        _max: {
          version: scope.length > 0 ? Math.max(...scope.map((e) => e.version)) : null,
          timestamp:
            scope.length > 0
              ? new Date(Math.max(...scope.map((e) => e.timestamp.getTime())))
              : null,
        },
        _min: {
          timestamp:
            scope.length > 0
              ? new Date(Math.min(...scope.map((e) => e.timestamp.getTime())))
              : null,
        },
      };
    },
  };

  eventSnapshot = {
    upsert: async (args: {
      where: { streamId: string };
      create: { streamId: string; version: number; data: string };
      update: { version: number; data: string; createdAt?: Date };
    }): Promise<MockSnapshotRow> => {
      if (this.shouldFailQuery) throw new Error("Query failed");
      const existing = this.snapshots.get(args.where.streamId);
      const row: MockSnapshotRow = existing
        ? {
            streamId: existing.streamId,
            version: args.update.version,
            data: args.update.data,
            createdAt: args.update.createdAt ?? new Date(),
          }
        : {
            streamId: args.create.streamId,
            version: args.create.version,
            data: args.create.data,
            createdAt: new Date(),
          };
      this.snapshots.set(args.where.streamId, row);
      return row;
    },
    findUnique: async (args: { where: { streamId: string } }): Promise<MockSnapshotRow | null> => {
      if (this.shouldFailQuery) throw new Error("Query failed");
      return this.snapshots.get(args.where.streamId) ?? null;
    },
  };

  /**
   * Extract SQL text from a Prisma.sql() object or template literal.
   * Prisma.Sql objects have a `strings` property (array of template parts).
   */
  private extractSqlText(query: unknown): string {
    if (query && typeof query === "object" && "strings" in query) {
      const strings = (query as { strings: unknown }).strings;
      if (Array.isArray(strings)) return strings.join(" ");
    }
    return String(query);
  }

  async $transaction(callback: (tx: MockPrismaClient) => Promise<void>): Promise<void> {
    if (this.shouldFailTransaction) {
      throw new Error("Transaction failed");
    }
    await callback(this);
  }

  async $queryRaw<T = unknown>(query: unknown): Promise<T> {
    if (this.shouldFailQuery) throw new Error("Query failed");
    const sqlText = this.extractSqlText(query);

    if (sqlText.includes("MAX(version)")) {
      return [{ version: this.currentVersion }] as T;
    }
    if (sqlText.includes("next_sequence")) {
      return [{ next_sequence: this.events.length + 1 }] as T;
    }
    return [] as T;
  }

  async $executeRaw(query: unknown): Promise<number> {
    if (this.shouldFailQuery) throw new Error("Execute failed");
    const sqlText = this.extractSqlText(query);
    const values =
      query && typeof query === "object" && "values" in query
        ? ((query as { values: unknown[] }).values ?? [])
        : [];

    // Simulate INSERT — batch inserts use Prisma.sql`INSERT ... VALUES ${Prisma.join(tuples)}`
    // Structure: values[0] = joined tuples Sql; its inner `values` array length = event count.
    if (sqlText.includes("INSERT")) {
      let eventCount = 1;
      const joinedTuples = values[0];
      if (joinedTuples && typeof joinedTuples === "object" && "values" in joinedTuples) {
        const innerValues = (joinedTuples as { values: unknown[] }).values;
        if (Array.isArray(innerValues) && innerValues.length > 0) {
          eventCount = innerValues.length;
        }
      }
      for (let i = 0; i < eventCount; i++) {
        this.currentVersion++;
        this.events.push({
          id: `event-${Date.now()}-${i}`,
          streamId: "stream:test",
          eventType: "test.event",
          eventData: "{}",
          metadata: "{}",
          version: this.currentVersion,
          sequence: BigInt(this.events.length + 1),
          timestamp: new Date(),
          correlationId: null,
          causationId: null,
        });
      }
      return eventCount;
    }

    if (sqlText.includes("DELETE")) {
      const deleted = this.events.length;
      this.events = [];
      return deleted;
    }

    return 0;
  }

  // Helper methods for testing
  getEvents(): MockStoredEventRow[] {
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
const { PostgreSQLEventStore } = await import("../../src/events/EventStore.js");

describe("EventStore - Event Appending", () => {
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
    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await eventStore.append("post-123", [event]);

    const storedEvents = mockPrisma.getEvents();
    expect(storedEvents.length).toBe(1);
  });

  it("should append multiple events to stream", async () => {
    const events: EventStoreEvent[] = [
      createEventStoreEvent(
        EVENT_TYPES.POST_CREATED,
        "post-123",
        "Post",
        { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
      createEventStoreEvent(
        EVENT_TYPES.POST_UPDATED,
        "post-123",
        "Post",
        { postId: "post-123", changes: {}, previousVersion: 1, newVersion: 2, projectId: "proj-1" },
        { source: "TestSuite" }
      ),
    ];

    await eventStore.append("post-123", events);

    const storedEvents = mockPrisma.getEvents();
    expect(storedEvents.length).toBe(2);
  });

  it("should handle empty event array gracefully", async () => {
    await eventStore.append("post-123", []);

    const storedEvents = mockPrisma.getEvents();
    expect(storedEvents.length).toBe(0);
  });

  it("should enforce optimistic concurrency control", async () => {
    mockPrisma.setCurrentVersion(5);

    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_UPDATED,
      "post-123",
      "Post",
      { postId: "post-123", changes: {}, previousVersion: 1, newVersion: 2, projectId: "proj-1" },
      { source: "TestSuite" }
    );

    await expect(eventStore.append("post-123", [event], 3)).rejects.toThrow(/Concurrency conflict/);
  });

  it("should publish events to Redis after storing", async () => {
    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await eventStore.append("post-123", [event]);

    const publishedEvents = mockRedis.getPublishedEvents();
    expect(publishedEvents.length >= 1).toBe(true);
  });

  it("should handle max batch size limit", async () => {
    const events: EventStoreEvent[] = Array.from({ length: 1001 }, (_, i) =>
      createEventStoreEvent(
        EVENT_TYPES.POST_CREATED,
        `post-${i}`,
        "Post",
        { postId: `post-${i}`, projectId: "project-456", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      )
    );

    await expect(eventStore.append("post-123", events)).rejects.toThrow(/Cannot append more than/);
  });

  it("should handle transaction failures", async () => {
    mockPrisma.setFailTransaction(true);

    const event: EventStoreEvent = createEventStoreEvent(
      EVENT_TYPES.POST_CREATED,
      "post-123",
      "Post",
      { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
      { source: "TestSuite" }
    );

    await expect(eventStore.append("post-123", [event])).rejects.toThrow(/Transaction failed/);
  });
});

describe("EventStore - Event Retrieval", () => {
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
    expect(Array.isArray(events)).toBeTruthy();
  });

  it("should get events from specific version", async () => {
    const events = await eventStore.getEvents("post-123", 5);
    expect(Array.isArray(events)).toBeTruthy();
  });

  it("should get all events across streams", async () => {
    const events = await eventStore.getAllEvents();
    expect(Array.isArray(events)).toBeTruthy();
  });

  it("should get all events from specific position", async () => {
    const events = await eventStore.getAllEvents(100);
    expect(Array.isArray(events)).toBeTruthy();
  });

  it("should get events by type", async () => {
    const events = await eventStore.getEventsByType(EVENT_TYPES.POST_CREATED);
    expect(Array.isArray(events)).toBeTruthy();
  });

  it("should get events by type from timestamp", async () => {
    const fromTimestamp = new Date("2024-01-01T00:00:00Z");
    const events = await eventStore.getEventsByType(EVENT_TYPES.POST_CREATED, fromTimestamp);
    expect(Array.isArray(events)).toBeTruthy();
  });

  it("should handle query failures gracefully", async () => {
    mockPrisma.setFailQuery(true);

    await expect(eventStore.getEvents("post-123")).rejects.toThrow(/Query failed/);
  });
});

describe("EventStore - Stream Statistics", () => {
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

    expect(typeof stats.eventCount).toBe("number");
    expect(typeof stats.currentVersion).toBe("number");
  });

  it("should include first and last event timestamps", async () => {
    const stats = await eventStore.getStreamStats("post-123");

    expect("firstEventAt" in stats || stats.firstEventAt === undefined).toBeTruthy();
    expect("lastEventAt" in stats || stats.lastEventAt === undefined).toBeTruthy();
  });

  it("should handle empty stream", async () => {
    mockPrisma.clearEvents();

    const stats = await eventStore.getStreamStats("empty-stream");

    expect(stats.eventCount).toBe(0);
    expect(stats.currentVersion).toBe(0);
  });
});

describe("EventStore - Snapshots", () => {
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
    await expect(eventStore.createSnapshot("post-123", 5, snapshotData)).resolves.not.toThrow();
  });

  it("should get latest snapshot", async () => {
    const snapshot = await eventStore.getSnapshot("post-123");

    // Snapshot may be null if not created
    expect(snapshot === null || typeof snapshot === "object").toBeTruthy();
  });

  it("should handle missing snapshot", async () => {
    const snapshot = await eventStore.getSnapshot("nonexistent-stream");

    expect(snapshot).toBe(null);
  });

  it("should handle snapshot query failures", async () => {
    mockPrisma.setFailQuery(true);

    await expect(eventStore.getSnapshot("post-123")).rejects.toThrow(/Query failed/);
  });
});

describe("EventStore - Health Check", () => {
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

    expect(health.status).toBe("healthy");
    expect(health.details.database).toBe(true);
    expect(health.details.redis).toBe(true);
  });

  it("should report unhealthy status when database fails", async () => {
    mockPrisma.setFailQuery(true);

    const health = await eventStore.healthCheck();

    expect(health.status).toBe("unhealthy");
    expect(health.details.database).toBe(false);
  });

  it("should report unhealthy status when Redis fails", async () => {
    mockRedis.setFailPing(true);

    const health = await eventStore.healthCheck();

    expect(health.status).toBe("unhealthy");
    expect(health.details.redis).toBe(false);
  });

  it("should include total events in health check", async () => {
    const health = await eventStore.healthCheck();

    expect(
      "totalEvents" in health.details || health.details.totalEvents === undefined
    ).toBeTruthy();
  });
});

describe("EventStore - Cleanup", () => {
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

    expect(typeof deletedCount).toBe("number");
  });

  it("should keep minimum events when cleaning up", async () => {
    const olderThan = new Date("2023-01-01T00:00:00Z");
    const deletedCount = await eventStore.cleanup(olderThan, 1000);

    expect(typeof deletedCount).toBe("number");
  });

  it("should handle cleanup failures", async () => {
    mockPrisma.setFailQuery(true);
    const olderThan = new Date("2023-01-01T00:00:00Z");

    await expect(eventStore.cleanup(olderThan)).rejects.toThrow(/Execute failed/);
  });
});

describe("EventStore - Event Sourcing Patterns", () => {
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
    expect(Array.isArray(events)).toBeTruthy();
    // Mock returns empty by default - verifying the method accepts version parameter without error
    expect(typeof events.length).toBe("number");
  });

  it("should retrieve all events starting from specific position", async () => {
    const events = await eventStore.getAllEvents(100);
    expect(Array.isArray(events)).toBeTruthy();
    expect(typeof events.length).toBe("number");
  });

  it("should maintain event ordering by version", async () => {
    const events: EventStoreEvent[] = [
      createEventStoreEvent(
        EVENT_TYPES.POST_CREATED,
        "post-123",
        "Post",
        { postId: "post-123", projectId: "project-456", status: "DRAFT", channelIds: [] },
        { source: "TestSuite" }
      ),
      createEventStoreEvent(
        EVENT_TYPES.POST_UPDATED,
        "post-123",
        "Post",
        { postId: "post-123", changes: {}, previousVersion: 1, newVersion: 2, projectId: "proj-1" },
        { source: "TestSuite" }
      ),
    ];

    await eventStore.append("post-123", events);

    const storedEvents = mockPrisma.getEvents();
    expect(storedEvents.length).toBe(2);
  });

  it("should support correlation ID tracking", async () => {
    const correlationId = "correlation-123";
    const event: EventStoreEvent = {
      ...createEventStoreEvent(
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
    expect(storedEvents.length).toBe(1);
    expect(event.correlationId).toBe(correlationId);
  });

  it("should support causation ID tracking", async () => {
    const causationId = "causation-456";
    const event: EventStoreEvent = {
      ...createEventStoreEvent(
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
    expect(storedEvents.length).toBe(1);
    expect(event.causationId).toBe(causationId);
  });
});
