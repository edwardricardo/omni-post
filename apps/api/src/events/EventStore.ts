/**
 * Phase 2: Week 3-4 - PostgreSQL Event Store Implementation
 *
 * High-performance Event Store using PostgreSQL for persistence and Redis for pub/sub.
 * Implements event sourcing patterns with optimistic concurrency control.
 *
 * Features:
 * - ACID transactions for event appending
 * - Optimistic concurrency control
 * - Event projection capabilities
 * - Performance monitoring
 * - Connection pooling optimization
 */

import { PrismaClient } from "@infra/prisma";
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
  private tableName: string;
  private streamPrefix: string;
  private maxBatchSize: number;

  constructor(config: EventStoreConfig) {
    this.prisma = config.prisma;
    this.redis = config.redis;
    this.tableName = config.tableName || "EventStore";
    this.streamPrefix = config.streamPrefix || "stream:";
    this.maxBatchSize = config.maxBatchSize || 1000;
  }

  /**
   * Append events to a stream with optimistic concurrency control
   */
  async append(streamId: string, events: DomainEvent[], expectedVersion?: number): Promise<void> {
    if (events.length === 0) {
      return;
    }

    if (events.length > this.maxBatchSize) {
      throw new Error(`Cannot append more than ${this.maxBatchSize} events at once`);
    }

    const fullStreamId = `${this.streamPrefix}${streamId}`;

    try {
      await this.prisma.$transaction(async (tx) => {
        // Get current stream version
        const currentVersionResult = await tx.$queryRaw<[{ version: number | null }]>`
          SELECT MAX(version) as version
          FROM ${this.tableName}
          WHERE stream_id = ${fullStreamId}
        `;

        const currentVersion = currentVersionResult[0]?.version || 0;

        // Check optimistic concurrency
        if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
          throw new Error(
            `Concurrency conflict: expected version ${expectedVersion}, but current version is ${currentVersion}`
          );
        }

        // Get next sequence number
        const sequenceResult = await tx.$queryRaw<[{ next_sequence: number }]>`
          SELECT COALESCE(MAX(sequence), 0) + 1 as next_sequence
          FROM ${this.tableName}
        `;

        let nextSequence = sequenceResult[0]?.next_sequence || 1;

        // Prepare events for insertion
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

        // Insert events - use individual inserts or createMany instead
        for (const event of eventsToInsert) {
          await tx.$executeRaw`
            INSERT INTO stored_events (
              id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            )
            VALUES (
              ${event.id}, ${event.stream_id}, ${event.event_type}, ${event.event_data}, ${event.metadata},
              ${event.version}, ${event.sequence}, ${event.timestamp}, ${event.correlation_id}, ${event.causation_id}
            )
          `;
        }
      });

      // Publish events to Redis after successful storage
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
        ? await this.prisma.$queryRaw<StoredEvent[]>`
            SELECT
              id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM stored_events
            WHERE stream_id = ${fullStreamId} AND version >= ${fromVersion}
            ORDER BY version ASC
          `
        : await this.prisma.$queryRaw<StoredEvent[]>`
            SELECT
              id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM stored_events
            WHERE stream_id = ${fullStreamId}
            ORDER BY version ASC
          `;

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
        ? await this.prisma.$queryRaw<StoredEvent[]>`
            SELECT
              id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM stored_events
            WHERE sequence >= ${fromPosition}
            ORDER BY sequence ASC
            LIMIT 1000
          `
        : await this.prisma.$queryRaw<StoredEvent[]>`
            SELECT
              id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM stored_events
            ORDER BY sequence ASC
            LIMIT 1000
          `;

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
        ? await this.prisma.$queryRaw<StoredEvent[]>`
            SELECT
              id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM stored_events
            WHERE event_type = ${eventType} AND timestamp >= ${fromTimestamp}
            ORDER BY timestamp DESC
            LIMIT 1000
          `
        : await this.prisma.$queryRaw<StoredEvent[]>`
            SELECT
              id, stream_id, event_type, event_data, metadata,
              version, sequence, timestamp, correlation_id, causation_id
            FROM stored_events
            WHERE event_type = ${eventType}
            ORDER BY timestamp DESC
            LIMIT 1000
          `;

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
      >`
        SELECT
          COUNT(*) as event_count,
          COALESCE(MAX(version), 0) as current_version,
          MIN(timestamp) as first_event_at,
          MAX(timestamp) as last_event_at
        FROM ${this.tableName}
        WHERE stream_id = ${fullStreamId}
      `;

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

    try {
      await this.prisma.$executeRaw`
        INSERT INTO EventSnapshots (stream_id, version, data, created_at)
        VALUES (${fullStreamId}, ${version}, ${JSON.stringify(data)}, NOW())
        ON CONFLICT (stream_id)
        DO UPDATE SET
          version = ${version},
          data = ${JSON.stringify(data)},
          created_at = NOW()
      `;
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
        [
          {
            version: number;
            data: string;
            created_at: Date;
          },
        ]
      >`
        SELECT version, data, created_at
        FROM EventSnapshots
        WHERE stream_id = ${fullStreamId}
      `;

      const result = snapshot[0];
      if (!result) {
        return null;
      }

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
      // Don't throw - event storage succeeded, publishing is optional
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
    details: {
      database: boolean;
      redis: boolean;
      totalEvents?: number;
      lastEventAt?: Date;
    };
  }> {
    const details: any = {
      database: false,
      redis: false,
    };

    try {
      // Check database connection
      await this.prisma.$queryRaw`SELECT 1`;
      details.database = true;

      // Get basic stats
      const stats = await this.prisma.$queryRaw<
        [
          {
            total_events: number;
            last_event_at?: Date;
          },
        ]
      >`
        SELECT
          COUNT(*) as total_events,
          MAX(timestamp) as last_event_at
        FROM ${this.tableName}
      `;

      if (stats[0]) {
        details.totalEvents = Number(stats[0].total_events);
        details.lastEventAt = stats[0].last_event_at;
      }
    } catch (error) {
      logger.error({ err: error }, "Database health check failed");
    }

    try {
      // Check Redis connection
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
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM ${this.tableName}
        WHERE timestamp < ${olderThan}
        AND sequence NOT IN (
          SELECT sequence
          FROM ${this.tableName}
          ORDER BY sequence DESC
          LIMIT ${keepMinimumEvents}
        )
      `;

      return Number(deleted);
    } catch (error) {
      logger.error({ err: error }, "Failed to cleanup old events");
      throw error;
    }
  }
}
