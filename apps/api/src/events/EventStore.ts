/**
 * @file EventStore.ts
 * @description PostgreSQL Event Store with Redis pub/sub for real-time
 *              subscriptions. Implements event sourcing with optimistic
 *              concurrency control. Uses the typed Prisma Client wherever the
 *              query maps cleanly; falls back to `Prisma.sql` only inside the
 *              append transaction (which needs `MAX(version)` / `MAX(sequence)`
 *              aggregations + a batched `INSERT … VALUES (…)` that the Client
 *              cannot express).
 * @layer infrastructure
 */

import { PrismaClient, Prisma } from "@infra/prisma";
import Redis from "ioredis";
import {
  DomainEvent,
  EventEnvelope,
  EventStore as IEventStore,
  serializeEvent,
  deserializeEvent,
} from "@shared/events";
import { logger } from "../lib/logger.js";

interface EventStoreConfig {
  prisma: PrismaClient;
  redis: Redis;
  streamPrefix?: string;
  maxBatchSize?: number;
}

/**
 * Subset of the Prisma `StoredEvent` row used by `mapToEventEnvelope`. The
 * extra fields the model carries (`metadata`) are ignored here — events
 * deserialise into envelopes without round-tripping the metadata blob.
 */
interface StoredEventRow {
  streamId: string;
  eventData: string;
  version: number;
  sequence: bigint | number;
  timestamp: Date;
  correlationId: string | null;
  causationId: string | null;
}

export class PostgreSQLEventStore implements IEventStore {
  private prisma: PrismaClient;
  private redis: Redis;
  private streamPrefix: string;
  private maxBatchSize: number;

  constructor(config: EventStoreConfig) {
    this.prisma = config.prisma;
    this.redis = config.redis;
    this.streamPrefix = config.streamPrefix || "stream:";
    this.maxBatchSize = config.maxBatchSize || 1000;
  }

  /**
   * Append events to a stream with optimistic concurrency control.
   *
   * Raw SQL stays here: the version + sequence calculations need `MAX()`
   * aggregations *inside* the same transaction as the insert, and the bulk
   * insert uses a single multi-row `INSERT … VALUES (…)` that Prisma Client
   * cannot express atomically.
   */
  async append(streamId: string, events: DomainEvent[], expectedVersion?: number): Promise<void> {
    if (events.length === 0) return;

    if (events.length > this.maxBatchSize) {
      throw new Error(`Cannot append more than ${this.maxBatchSize} events at once`);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.appendInTx(tx, streamId, events, expectedVersion);
      });

      await this.publishEvents(events);
    } catch (error) {
      logger.error({ err: error, streamId }, "Failed to append events to stream");
      throw error;
    }
  }

  /**
   * Append events to a stream using an externally-managed Prisma transaction.
   * Used by callers (e.g. SagaManager) that need to atomically persist their
   * own state + the event log within the same `$transaction`. The pub/sub
   * broadcast does NOT happen here — callers must invoke their own
   * post-commit broadcast (typically via `EventService.broadcastEvent`).
   *
   * Same concurrency-control + sequence-allocation logic as `append` —
   * extracted so both call paths share a single SQL implementation.
   */
  async appendInTx(
    tx: Prisma.TransactionClient,
    streamId: string,
    events: DomainEvent[],
    expectedVersion?: number
  ): Promise<void> {
    if (events.length === 0) return;
    if (events.length > this.maxBatchSize) {
      throw new Error(`Cannot append more than ${this.maxBatchSize} events at once`);
    }

    const fullStreamId = `${this.streamPrefix}${streamId}`;

    const currentVersionResult = await tx.$queryRaw<[{ version: number | null }]>(
      Prisma.sql`SELECT MAX(version) as version FROM "stored_events" WHERE stream_id = ${fullStreamId}`
    );

    const currentVersion = Number(currentVersionResult[0]?.version ?? 0);

    if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
      throw new Error(
        `Concurrency conflict: expected version ${expectedVersion}, but current version is ${currentVersion}`
      );
    }

    const sequenceResult = await tx.$queryRaw<[{ next_sequence: number }]>(
      Prisma.sql`SELECT COALESCE(MAX(sequence), 0) + 1 as next_sequence FROM "stored_events"`
    );

    const nextSequence = Number(sequenceResult[0]?.next_sequence ?? 1);

    const eventsToInsert = events.map((event, index) => ({
      id: event.id,
      stream_id: fullStreamId,
      event_type: event.type,
      event_data: serializeEvent(event),
      metadata: JSON.stringify(event.metadata),
      version: currentVersion + index + 1,
      sequence: nextSequence + index,
      timestamp: event.timestamp,
      correlation_id: event.correlationId || null,
      causation_id: event.causationId || null,
    }));

    const valuesTuples = eventsToInsert.map(
      (evt) =>
        Prisma.sql`(${evt.id}, ${evt.stream_id}, ${evt.event_type}, ${evt.event_data}, ${evt.metadata}, ${evt.version}, ${evt.sequence}, ${evt.timestamp}, ${evt.correlation_id}, ${evt.causation_id})`
    );
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "stored_events" (
        id, stream_id, event_type, event_data, metadata,
        version, sequence, timestamp, correlation_id, causation_id
      ) VALUES ${Prisma.join(valuesTuples)}`
    );
  }

  /**
   * Get events from a specific stream.
   */
  async getEvents(streamId: string, fromVersion?: number): Promise<EventEnvelope[]> {
    const fullStreamId = `${this.streamPrefix}${streamId}`;

    try {
      const storedEvents = await this.prisma.storedEvent.findMany({
        where: {
          streamId: fullStreamId,
          ...(fromVersion !== undefined && { version: { gte: fromVersion } }),
        },
        orderBy: { version: "asc" },
      });

      return storedEvents.map((evt) => this.mapToEventEnvelope(evt));
    } catch (error) {
      logger.error({ err: error, streamId }, "Failed to get events from stream");
      throw error;
    }
  }

  /**
   * Get all events across all streams (useful for projections).
   */
  async getAllEvents(fromPosition?: number): Promise<EventEnvelope[]> {
    try {
      const storedEvents = await this.prisma.storedEvent.findMany({
        ...(fromPosition !== undefined && { where: { sequence: { gte: BigInt(fromPosition) } } }),
        orderBy: { sequence: "asc" },
        take: 1000,
      });

      return storedEvents.map((evt) => this.mapToEventEnvelope(evt));
    } catch (error) {
      logger.error({ err: error }, "Failed to get all events");
      throw error;
    }
  }

  /**
   * Get events by type (useful for analytics and monitoring).
   */
  async getEventsByType(eventType: string, fromTimestamp?: Date): Promise<EventEnvelope[]> {
    try {
      const storedEvents = await this.prisma.storedEvent.findMany({
        where: {
          eventType,
          ...(fromTimestamp && { timestamp: { gte: fromTimestamp } }),
        },
        orderBy: { timestamp: "desc" },
        take: 1000,
      });

      return storedEvents.map((evt) => this.mapToEventEnvelope(evt));
    } catch (error) {
      logger.error({ err: error, eventType }, "Failed to get events by type");
      throw error;
    }
  }

  /**
   * Get stream statistics.
   */
  async getStreamStats(streamId: string): Promise<{
    eventCount: number;
    currentVersion: number;
    firstEventAt?: Date;
    lastEventAt?: Date;
  }> {
    const fullStreamId = `${this.streamPrefix}${streamId}`;

    try {
      const result = await this.prisma.storedEvent.aggregate({
        where: { streamId: fullStreamId },
        _count: { _all: true },
        _max: { version: true, timestamp: true },
        _min: { timestamp: true },
      });

      return {
        eventCount: result._count._all,
        currentVersion: result._max.version ?? 0,
        ...(result._min.timestamp && { firstEventAt: result._min.timestamp }),
        ...(result._max.timestamp && { lastEventAt: result._max.timestamp }),
      };
    } catch (error) {
      logger.error({ err: error, streamId }, "Failed to get stream stats");
      throw error;
    }
  }

  /**
   * Persist (or replace) the latest snapshot for a stream so that aggregate
   * rehydration can skip replaying events older than `version`. Snapshot
   * triggers are domain decisions per aggregate; this method is intentionally
   * unopinionated about *when* to call it.
   */
  async createSnapshot(streamId: string, version: number, data: unknown): Promise<void> {
    const fullStreamId = `${this.streamPrefix}${streamId}`;
    const jsonData = JSON.stringify(data);

    try {
      await this.prisma.eventSnapshot.upsert({
        where: { streamId: fullStreamId },
        create: { streamId: fullStreamId, version, data: jsonData },
        update: { version, data: jsonData, createdAt: new Date() },
      });
    } catch (error) {
      logger.error({ err: error, streamId }, "Failed to create snapshot for stream");
      throw error;
    }
  }

  /**
   * Get the latest snapshot for a stream, if any.
   */
  async getSnapshot(streamId: string): Promise<{
    version: number;
    data: unknown;
    createdAt: Date;
  } | null> {
    const fullStreamId = `${this.streamPrefix}${streamId}`;

    try {
      const snapshot = await this.prisma.eventSnapshot.findUnique({
        where: { streamId: fullStreamId },
      });
      if (!snapshot) return null;

      return {
        version: snapshot.version,
        data: JSON.parse(snapshot.data),
        createdAt: snapshot.createdAt,
      };
    } catch (error) {
      logger.error({ err: error, streamId }, "Failed to get snapshot for stream");
      throw error;
    }
  }

  /**
   * Publish events to Redis for real-time subscriptions.
   */
  private async publishEvents(events: DomainEvent[]): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();

      for (const event of events) {
        const channel = `events:${event.type}`;
        const payload = serializeEvent(event);
        pipeline.publish(channel, payload);
        pipeline.publish("events:all", payload);
      }

      await pipeline.exec();
    } catch (error) {
      logger.error({ err: error }, "Failed to publish events to Redis");
    }
  }

  /**
   * Map a `StoredEvent` row to the canonical `EventEnvelope` shape.
   */
  private mapToEventEnvelope(storedEvent: StoredEventRow): EventEnvelope {
    const event = deserializeEvent(storedEvent.eventData);

    return {
      event: {
        ...event,
        ...(storedEvent.correlationId && { correlationId: storedEvent.correlationId }),
        ...(storedEvent.causationId && { causationId: storedEvent.causationId }),
      },
      occurredAt: storedEvent.timestamp,
      sequence: Number(storedEvent.sequence),
      streamId: storedEvent.streamId.replace(this.streamPrefix, ""),
      streamVersion: storedEvent.version,
    };
  }

  /**
   * Health check for the event store.
   */
  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details: { database: boolean; redis: boolean; totalEvents?: number; lastEventAt?: Date };
  }> {
    const details: { database: boolean; redis: boolean; totalEvents?: number; lastEventAt?: Date } =
      {
        database: false,
        redis: false,
      };

    try {
      const result = await this.prisma.storedEvent.aggregate({
        _count: { _all: true },
        _max: { timestamp: true },
      });
      details.database = true;
      details.totalEvents = result._count._all;
      if (result._max.timestamp) {
        details.lastEventAt = result._max.timestamp;
      }
    } catch (error) {
      logger.error({ err: error }, "Database health check failed");
    }

    try {
      await this.redis.ping();
      details.redis = true;
    } catch (error) {
      logger.error({ err: error }, "Redis health check failed");
    }

    return {
      status: details.database && details.redis ? "healthy" : "unhealthy",
      details,
    };
  }

  /**
   * Clean up old events (for maintenance). Deletes rows older than
   * `olderThan` while keeping the most recent `keepMinimumEvents` rows by
   * sequence to guarantee at least a baseline replay window stays available.
   *
   * Uses raw SQL because the `NOT IN (SELECT … LIMIT n)` subquery is not
   * expressible through Prisma Client.
   */
  async cleanup(olderThan: Date, keepMinimumEvents: number = 1000): Promise<number> {
    try {
      const deleted = await this.prisma.$executeRaw(
        Prisma.sql`DELETE FROM "stored_events"
        WHERE timestamp < ${olderThan}
        AND sequence NOT IN (
          SELECT sequence FROM "stored_events"
          ORDER BY sequence DESC
          LIMIT ${keepMinimumEvents}
        )`
      );

      return Number(deleted);
    } catch (error) {
      logger.error({ err: error }, "Failed to cleanup old events");
      throw error;
    }
  }
}
