/**
 * @file EventService.ts
 * @description High-level event service orchestrating Event Store, Publisher, and Handlers
 *              with publishing, persistence, replay, and health monitoring capabilities.
 * @layer infrastructure
 */

import { PrismaClient, Prisma } from "@infra/prisma";
import Redis from "ioredis";
import {
  EventStoreEvent,
  EventHandler,
  createEventStoreEvent,
  EVENT_TYPES,
  PostCreatedEvent as _PostCreatedEvent,
  PostUpdatedEvent as _PostUpdatedEvent,
  PostScheduledEvent as _PostScheduledEvent,
  PostPublishedEvent as _PostPublishedEvent,
  ChannelConnectedEvent as _ChannelConnectedEvent,
  AnalyticsCollectedEvent as _AnalyticsCollectedEvent,
  UserActionEvent,
} from "@shared/events";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { PostgreSQLEventStore } from "./EventStore";
import { RedisEventPublisher } from "./EventPublisher";
import { BaseService } from "../services/BaseService";
import { Result } from "@shared/types";

interface EventServiceConfig {
  prisma: PrismaClient;
  redis: Redis;
  scheduler: BackgroundTaskScheduler;
  enableReplay?: boolean;
  enableMetrics?: boolean;
}

export class EventService extends BaseService {
  private eventStore: PostgreSQLEventStore;
  private publisher: RedisEventPublisher;
  private handlers = new Map<string, Set<EventHandler>>();
  private isInitialized = false;
  private enableReplay: boolean;
  private enableMetrics: boolean;

  constructor(config: EventServiceConfig) {
    super("EventService");

    this.eventStore = new PostgreSQLEventStore({
      prisma: config.prisma,
      redis: config.redis,
    });

    this.publisher = new RedisEventPublisher({
      redis: config.redis,
      scheduler: config.scheduler,
      ...(config.enableMetrics !== undefined && { enableMetrics: config.enableMetrics }),
    });

    this.enableReplay = config.enableReplay || false;
    this.enableMetrics = config.enableMetrics || true;
  }

  /**
   * Initialize the event service
   */
  async initialize(): Promise<Result<void, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "initialize",
        metadata: { enableReplay: this.enableReplay, enableMetrics: this.enableMetrics },
      },
      async () => {
        if (this.isInitialized) {
          return;
        }

        // Subscribe publisher to handle events from store
        this.setupDefaultHandlers();

        this.isInitialized = true;

        // Emit system health event
        await this.publishEvent(
          createEventStoreEvent(
            EVENT_TYPES.SYSTEM_HEALTH,
            "event-service",
            "EventService",
            {
              component: "EventService",
              status: "healthy",
              timestamp: new Date(),
              metrics: {
                handlersRegistered: this.handlers.size,
              },
            },
            {
              source: "EventService",
            }
          )
        );
      }
    );
  }

  /**
   * Append an event to the durable EventStore inside an externally-managed
   * Prisma transaction. Used by callers (e.g. SagaManager) that need the
   * event log to commit atomically with their own state mutation. The
   * pub/sub broadcast does NOT happen here — call `broadcastEvent` after
   * the outer transaction commits (best-effort fan-out).
   */
  async appendEventInTx(tx: Prisma.TransactionClient, event: EventStoreEvent): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Event Service not initialized");
    }
    await this.eventStore.appendInTx(tx, `${event.aggregateType}:${event.aggregateId}`, [event]);
  }

  /**
   * Broadcast an event to in-process Redis pub/sub subscribers without
   * touching the EventStore. Pair with `appendEventInTx` after the outer
   * transaction commits to preserve the durable-first / broadcast-after
   * semantic.
   */
  async broadcastEvent(event: EventStoreEvent): Promise<Result<void, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "broadcastEvent",
        metadata: {
          eventType: event.type,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
        },
      },
      async () => {
        if (!this.isInitialized) {
          throw new Error("Event Service not initialized");
        }
        await this.publisher.publish(event);
      }
    );
  }

  /**
   * Publish an event (stores and publishes)
   */
  async publishEvent(event: EventStoreEvent): Promise<Result<void, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "publishEvent",
        metadata: {
          eventType: event.type,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
        },
      },
      async () => {
        if (!this.isInitialized) {
          throw new Error("Event Service not initialized");
        }

        // Store the event first
        await this.eventStore.append(`${event.aggregateType}:${event.aggregateId}`, [event]);

        // Then publish it
        await this.publisher.publish(event);
      }
    );
  }

  /**
   * Publish multiple events in a batch
   */
  async publishEvents(events: EventStoreEvent[]): Promise<Result<void, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "publishEvents",
        metadata: { eventCount: events.length },
      },
      async () => {
        if (!this.isInitialized) {
          throw new Error("Event Service not initialized");
        }

        if (events.length === 0) {
          return;
        }

        // Group events by stream
        const eventsByStream = new Map<string, EventStoreEvent[]>();

        for (const event of events) {
          const streamId = `${event.aggregateType}:${event.aggregateId}`;
          if (!eventsByStream.has(streamId)) {
            eventsByStream.set(streamId, []);
          }
          eventsByStream.get(streamId)!.push(event);
        }

        // Store events by stream
        for (const [streamId, streamEvents] of eventsByStream) {
          await this.eventStore.append(streamId, streamEvents);
        }

        // Publish all events
        await this.publisher.publishBatch(events);
      }
    );
  }

  /**
   * Register an event handler
   */
  registerHandler<T extends EventStoreEvent>(eventType: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    this.handlers.get(eventType)!.add(handler);
    this.publisher.subscribe(eventType, handler);
  }

  /**
   * Unregister an event handler
   */
  unregisterHandler<T extends EventStoreEvent>(eventType: string, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(eventType);
      }
    }

    this.publisher.unsubscribe(eventType, handler);
  }

  /**
   * Get events from a specific aggregate
   */
  async getAggregateEvents(
    aggregateType: string,
    aggregateId: string,
    fromVersion?: number
  ): Promise<Result<EventStoreEvent[], string>> {
    return this.executeWithErrorHandling(
      {
        operation: "getAggregateEvents",
        metadata: {
          aggregateType,
          aggregateId,
          ...(fromVersion !== undefined && { fromVersion }),
        },
      },
      async () => {
        const streamId = `${aggregateType}:${aggregateId}`;
        const envelopes = await this.eventStore.getEvents(streamId, fromVersion);
        return envelopes.map((envelope) => envelope.event);
      }
    );
  }

  /**
   * Replay events for a specific aggregate
   */
  async replayAggregateEvents(
    aggregateType: string,
    aggregateId: string,
    fromVersion?: number
  ): Promise<Result<void, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "replayAggregateEvents",
        metadata: {
          aggregateType,
          aggregateId,
          ...(fromVersion !== undefined && { fromVersion }),
        },
      },
      async () => {
        if (!this.enableReplay) {
          throw new Error("Event replay is disabled");
        }

        const eventsResult = await this.getAggregateEvents(aggregateType, aggregateId, fromVersion);
        if (!eventsResult.ok) {
          throw new Error(eventsResult.error);
        }

        const events = eventsResult.value;

        for (const event of events) {
          await this.publisher.publish({
            ...event,
            metadata: {
              ...event.metadata,
              source: "EventService:Replay",
            },
          });
        }
      }
    );
  }

  /**
   * Get events by type (useful for analytics and monitoring)
   */
  async getEventsByType(
    eventType: string,
    fromTimestamp?: Date
  ): Promise<Result<EventStoreEvent[], string>> {
    return this.executeWithErrorHandling(
      {
        operation: "getEventsByType",
        metadata: {
          eventType,
          ...(fromTimestamp && { fromTimestamp: fromTimestamp.toISOString() }),
        },
      },
      async () => {
        const envelopes = await this.eventStore.getEventsByType(eventType, fromTimestamp);
        return envelopes.map((envelope) => envelope.event);
      }
    );
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<
    Result<
      {
        status: "healthy" | "unhealthy";
        details: {
          initialized: boolean;
          eventStore: unknown;
          publisher: unknown;
          handlersCount: number;
        };
      },
      string
    >
  > {
    return this.executeWithErrorHandling(
      {
        operation: "healthCheck",
      },
      async () => {
        const eventStoreHealth = await this.eventStore.healthCheck();
        const publisherHealth = await this.publisher.healthCheck();

        return {
          status:
            this.isInitialized &&
            eventStoreHealth.status === "healthy" &&
            publisherHealth.status === "healthy"
              ? ("healthy" as const)
              : ("unhealthy" as const),
          details: {
            initialized: this.isInitialized,
            eventStore: eventStoreHealth.details,
            publisher: publisherHealth.details,
            handlersCount: this.handlers.size,
          },
        };
      }
    );
  }

  /**
   * Get service statistics
   */
  async getStatistics(): Promise<
    Result<
      {
        handlersRegistered: number;
        eventTypes: string[];
        publisherMetrics?: unknown;
      },
      string
    >
  > {
    return this.executeWithErrorHandling(
      {
        operation: "getStatistics",
      },
      async () => {
        const publisherMetrics = this.enableMetrics ? this.publisher.getMetrics() : undefined;

        return {
          handlersRegistered: this.handlers.size,
          eventTypes: Array.from(this.handlers.keys()),
          ...(publisherMetrics !== undefined && { publisherMetrics }),
        };
      }
    );
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<Result<void, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "shutdown",
      },
      async () => {
        await this.publisher.shutdown();
        this.handlers.clear();
        this.isInitialized = false;
      }
    );
  }

  /**
   * Setup default event handlers for common operations
   */
  private setupDefaultHandlers(): void {
    // Analytics handler - collect metrics from published posts
    this.registerHandler<_PostPublishedEvent>(EVENT_TYPES.POST_PUBLISHED, {
      eventType: EVENT_TYPES.POST_PUBLISHED,
      async handle(_event: _PostPublishedEvent) {
        // Here you could trigger analytics collection
        // await analyticsService.collectInitialMetrics(event.data);
      },
    });

    // User activity logging
    this.registerHandler<UserActionEvent>(EVENT_TYPES.USER_ACTION, {
      eventType: EVENT_TYPES.USER_ACTION,
      async handle(_event: UserActionEvent) {
        // Could integrate with audit logging
        // await auditService.logUserAction(event.data);
      },
    });

    // System health monitoring
    this.registerHandler(EVENT_TYPES.SYSTEM_HEALTH, {
      eventType: EVENT_TYPES.SYSTEM_HEALTH,
      async handle(event) {
        const data = event.data as { status: string; component: string; details: string };
        if (data.status !== "healthy") {
          // Could trigger alerts
          // await alertingService.sendHealthAlert(data);
        }
      },
    });
  }
}

// Helper functions for common event creation patterns

/**
 * Create a post lifecycle event
 */
export function createPostEvent(
  eventType: string,
  postId: string,
  projectId: string,
  data: Record<string, unknown>,
  metadata: { userId?: string; source: string }
): EventStoreEvent {
  return createEventStoreEvent(
    eventType,
    postId,
    "Post",
    {
      postId,
      projectId,
      ...data,
    },
    metadata
  );
}

/**
 * Create a channel event
 */
export function createChannelEvent(
  eventType: string,
  channelId: string,
  projectId: string,
  data: Record<string, unknown>,
  metadata: { userId?: string; source: string }
): EventStoreEvent {
  return createEventStoreEvent(
    eventType,
    channelId,
    "Channel",
    {
      channelId,
      projectId,
      ...data,
    },
    metadata
  );
}

/**
 * Create a user action event
 */
export function createUserActionEvent(
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  details?: Record<string, unknown>,
  sessionId?: string
): EventStoreEvent {
  return createEventStoreEvent(
    EVENT_TYPES.USER_ACTION,
    userId,
    "User",
    {
      userId,
      action,
      resourceType,
      resourceId,
      details,
      timestamp: new Date(),
      sessionId,
    },
    {
      source: "API",
      userId,
      ...(sessionId && { sessionId }),
    }
  );
}

/**
 * Create an analytics event
 */
export function createAnalyticsEvent(
  postId: string,
  channelId: string,
  provider: string,
  metrics: Record<string, unknown>
): EventStoreEvent {
  return createEventStoreEvent(
    EVENT_TYPES.ANALYTICS_COLLECTED,
    postId,
    "Post",
    {
      postId,
      channelId,
      provider,
      metrics,
      collectedAt: new Date(),
      period: {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        end: new Date(),
      },
    },
    {
      source: "AnalyticsCollector",
    }
  );
}
