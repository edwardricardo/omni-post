/**
 * @file EventStore.ts
 * @description PostgreSQL Event Store with Redis pub/sub for real-time subscriptions.
 *   Implements event sourcing with optimistic concurrency control.
 *   Uses Prisma.sql for adapter-pg compatibility (no template literal interpolation).
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
  tableName?: string;
  streamPrefix?: string;
  maxBatchSize?: number;
}

interface StoredEvent {
  id: string;
  streamId: string;
  eventType: string;
  eventData: string;
  metadata: string;
  version: number;
  sequence: number;
  timestamp: Date;
  correlationId?: string;
  causationId?: string;
}

export class PostgreSQLEventStore implements IEventStore {
  private prisma: PrismaClient;
  private redis: Redis;
  private tableRef: Prisma.Sql;
  private streamPrefix: string;
  private maxBatchSize: number;

  constructor(config: EventStoreConfig) {
    this.prisma = config.prisma;
    this.redis = config.redis;
    this.tableRef = Prisma.raw(config.tableName || "stored_events");
    this.streamPrefix = config.streamPrefix || "stream:";
    this.maxBatchSize = config.maxBatchSize || 1000;
  }

  /**
   * Append events to a stream with optimistic concurrency control
   */
  async append(streamId: string, events: DomainEvent[], expectedVersion?: number): Promise<void> {
    if (events.length === 0) return;

    if (events.length > this.maxBatchSize) {
      throw new Error(`Cannot append more than ${this.maxBatchSize} events at once`);
    }

    const fullStreamId = `${this.streamPrefix}${streamId}`;

    try {
      await this.prisma.$transaction(async (tx) => {
        const currentVersionResult = await tx.$queryRaw<[{ version: number | null }]>(
          Prisma.sql`SELECT MAX(version) as version FROM ${this.tableRef} WHERE stream_id = ${fullStreamId}`
        );

        const currentVersion = currentVersionResult[0]?.version || 0;

        if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
          throw new Error(
            `Concurrency conflict: expected version ${expectedVersion}, but current version is ${currentVersion}`
          );
        }

        const sequenceResult = await tx.$queryRaw<[{ next_sequence: number }]>(
          Prisma.sql`SELECT COALESCE(MAX(sequence), 0) + 1 as next_sequence FROM ${this.tableRef}`
        );

        let nextSequence = sequenceResult[0]?.next_sequence || 1;

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

        // Batch insert all events in a single query
        const valuesTuples = eventsToInsert.map(
          (evt) =>
            Prisma.sql`(${evt.id}, ${evt.stream_id}, ${evt.event_type}, ${evt.event_data}, ${evt.metadata}, ${evt.version}, ${evt.sequence}, ${evt.timestamp}, ${evt.correlation_id}, ${evt.causation_id})`
        );
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO ${this.tableRef} (
            id, stream_id, event_type, event_data, metadata,
            version, sequence, timestamp, correlation_id, causation_id
          ) VALUES ${Prisma.join(valuesTuples)}`
        );
      });

      await this.publishEvents(events);
    } catch (error) {
      logger.error({ err: error, streamId }, "Failed to append events to stream");
      throw error;
    }
  }

  /**
   * Get events from a specific stream
   */
  async getEvents(streamId: string, fromVersion?: number): Promise<EventEnvelope[]> {
    const fullStreamId = `${this.streamPrefix}${streamId}`;

    try {
      const storedEvents = fromVersion
        ? await this.prisma.$queryRaw<StoredEvent[]>(
            Prisma.sql`SELECT id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM ${this.tableRef}
            WHERE stream_id = ${fullStreamId} AND version >= ${fromVersion}
            ORDER BY version ASC`
          )
        : await this.prisma.$queryRaw<StoredEvent[]>(
            Prisma.sql`SELECT id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM ${this.tableRef}
            WHERE stream_id = ${fullStreamId}
            ORDER BY version ASC`
          );

      return storedEvents.map(this.mapToEventEnvelope.bind(this));
    } catch (error) {
      logger.error({ err: error, streamId }, "Failed to get events from stream");
      throw error;
    }
  }

  /**
   * Get all events across all streams (useful for projections)
   */
  async getAllEvents(fromPosition?: number): Promise<EventEnvelope[]> {
    try {
      const storedEvents = fromPosition
        ? await this.prisma.$queryRaw<StoredEvent[]>(
            Prisma.sql`SELECT id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM ${this.tableRef}
            WHERE sequence >= ${fromPosition}
            ORDER BY sequence ASC
            LIMIT 1000`
          )
        : await this.prisma.$queryRaw<StoredEvent[]>(
            Prisma.sql`SELECT id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM ${this.tableRef}
            ORDER BY sequence ASC
            LIMIT 1000`
          );

      return storedEvents.map(this.mapToEventEnvelope.bind(this));
    } catch (error) {
      logger.error({ err: error }, "Failed to get all events");
      throw error;
    }
  }

  /**
   * Get events by type (useful for analytics and monitoring)
   */
  async getEventsByType(eventType: string, fromTimestamp?: Date): Promise<EventEnvelope[]> {
    try {
      const storedEvents = fromTimestamp
        ? await this.prisma.$queryRaw<StoredEvent[]>(
            Prisma.sql`SELECT id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM ${this.tableRef}
            WHERE event_type = ${eventType} AND timestamp >= ${fromTimestamp}
            ORDER BY timestamp DESC
            LIMIT 1000`
          )
        : await this.prisma.$queryRaw<StoredEvent[]>(
            Prisma.sql`SELECT id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM ${this.tableRef}
            WHERE event_type = ${eventType}
            ORDER BY timestamp DESC
            LIMIT 1000`
          );

      return storedEvents.map(this.mapToEventEnvelope.bind(this));
    } catch (error) {
      logger.error({ err: error, eventType }, "Failed to get events by type");
      throw error;
    }
  }

  /**
   * Get stream statistics
   */
  async getStreamStats(streamId: string): Promise<{
    eventCount: number;
    currentVersion: number;
    firstEventAt?: Date;
    lastEventAt?: Date;
  }> {
    const fullStreamId = `${this.streamPrefix}${streamId}`;

    try {
      const stats = await this.prisma.$queryRaw<
        [
          {
            event_count: number;
            current_version: number;
            first_event_at?: Date;
            last_event_at?: Date;
          },
        ]
      >(
        Prisma.sql`SELECT
          COUNT(*) as event_count,
          COALESCE(MAX(version), 0) as current_version,
          MIN(timestamp) as first_event_at,
          MAX(timestamp) as last_event_at
        FROM ${this.tableRef}
        WHERE stream_id = ${fullStreamId}`
      );

      const result = stats[0];
      return {
        eventCount: Number(result?.event_count || 0),
        currentVersion: Number(result?.current_version || 0),
        ...(result?.first_event_at && { firstEventAt: result.first_event_at }),
        ...(result?.last_event_at && { lastEventAt: result.last_event_at }),
      };
    } catch (error) {
      logger.error({ err: error, streamId }, "Failed to get stream stats");
      throw error;
    }
  }

  /**
   * Create event stream snapshots for performance
   */
  async createSnapshot(streamId: string, version: number, data: unknown): Promise<void> {
    const fullStreamId = `${this.streamPrefix}${streamId}`;
    const jsonData = JSON.stringify(data);

    try {
      await this.prisma.$executeRaw(
        Prisma.sql`INSERT INTO "EventSnapshots" (stream_id, version, data, created_at)
        VALUES (${fullStreamId}, ${version}, ${jsonData}, NOW())
        ON CONFLICT (stream_id)
        DO UPDATE SET version = ${version}, data = ${jsonData}, created_at = NOW()`
      );
    } catch (error) {
      logger.error({ err: error, streamId }, "Failed to create snapshot for stream");
      throw error;
    }
  }

  /**
   * Get the latest snapshot for a stream
   */
  async getSnapshot(streamId: string): Promise<{
    version: number;
    data: unknown;
    createdAt: Date;
  } | null> {
    const fullStreamId = `${this.streamPrefix}${streamId}`;

    try {
      const snapshot = await this.prisma.$queryRaw<
        [{ version: number; data: string; created_at: Date }]
      >(
        Prisma.sql`SELECT version, data, created_at
        FROM "EventSnapshots"
        WHERE stream_id = ${fullStreamId}`
      );

      const result = snapshot[0];
      if (!result) return null;

      return {
        version: result.version,
        data: JSON.parse(result.data),
        createdAt: result.created_at,
      };
    } catch (error) {
      logger.error({ err: error, streamId }, "Failed to get snapshot for stream");
      throw error;
    }
  }

  /**
   * Publish events to Redis for real-time subscriptions
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
   * Map stored event to event envelope
   */
  private mapToEventEnvelope(storedEvent: StoredEvent): EventEnvelope {
    const event = deserializeEvent(storedEvent.eventData);

    return {
      event: {
        ...event,
        ...(storedEvent.correlationId && { correlationId: storedEvent.correlationId }),
        ...(storedEvent.causationId && { causationId: storedEvent.causationId }),
      },
      occurredAt: storedEvent.timestamp,
      sequence: storedEvent.sequence,
      streamId: storedEvent.streamId.replace(this.streamPrefix, ""),
      streamVersion: storedEvent.version,
    };
  }

  /**
   * Health check for the event store
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
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
      details.database = true;

      const stats = await this.prisma.$queryRaw<[{ total_events: number; last_event_at?: Date }]>(
        Prisma.sql`SELECT COUNT(*) as total_events, MAX(timestamp) as last_event_at FROM ${this.tableRef}`
      );

      if (stats[0]) {
        details.totalEvents = Number(stats[0].total_events);
        if (stats[0].last_event_at) {
          details.lastEventAt = stats[0].last_event_at;
        }
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
   * Clean up old events (for maintenance)
   */
  async cleanup(olderThan: Date, keepMinimumEvents: number = 1000): Promise<number> {
    try {
      const deleted = await this.prisma.$executeRaw(
        Prisma.sql`DELETE FROM ${this.tableRef}
        WHERE timestamp < ${olderThan}
        AND sequence NOT IN (
          SELECT sequence FROM ${this.tableRef}
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
