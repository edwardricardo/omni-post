/**
 * @file EventService.ts
 * @description High-level event service orchestrating Event Store, Publisher, and Handlers
 *              with publishing, persistence, replay, and health monitoring capabilities.
 * @layer infrastructure
 */

import { PrismaClient, Prisma } from "@infra/prisma";
import { Redis } from "ioredis";
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
} from "@shared/types/events.js";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { PostgreSQLEventStore } from "./EventStore.js";
import { RedisEventPublisher } from "./EventPublisher.js";
import { BaseService } from "../services/BaseService.js";
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
   * @method initialize
   * @description Registers the default handlers and marks the service ready. It appends and
   *              publishes no event: every API boot calls it, and a boot must leave a freshly
   *              migrated database without a row of the application.
   * @returns Result<void> that is ok once the service is ready, or the error that stopped it
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
      }
    );
  }

  /**
   * @method appendEventInTx
   * @description Appends an event to the durable EventStore inside an externally-managed
   *   Prisma transaction. Used by callers (e.g. SagaManager) that need the event log to commit
   *   atomically with their own state mutation. The pub/sub broadcast does NOT happen here: call
   *   `broadcastEvent` after the outer transaction commits (best-effort fan-out).
   * @param tx - The Prisma transaction client the append runs in
   * @param event - The event to append to the stream `<aggregateType>:<aggregateId>`
   * @returns Resolves once the event is appended; rejects when the service is not initialized
   */
  async appendEventInTx(tx: Prisma.TransactionClient, event: EventStoreEvent): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Event Service not initialized");
    }
    await this.eventStore.appendInTx(tx, `${event.aggregateType}:${event.aggregateId}`, [event]);
  }

  /**
   * @method broadcastEvent
   * @description Broadcasts an event to in-process Redis pub/sub subscribers without touching the
   *   EventStore. Pair with `appendEventInTx` after the outer transaction commits to preserve the
   *   durable-first / broadcast-after semantic.
   * @param event - The event to publish to subscribers
   * @returns Result<void> that is ok once published, or the error message when the service is not
   *   initialized or the publish fails
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
   * @method publishEvent
   * @description Publishes an event: appends it to its aggregate stream in the EventStore first,
   *   then publishes it to subscribers.
   * @param event - The event to store and publish
   * @returns Result<void> that is ok once both steps finish, or the error message when the service
   *   is not initialized or either step fails
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
   * @method publishEvents
   * @description Publishes several events in a batch: groups them by aggregate stream, appends each
   *   group to the EventStore, then publishes all of them to subscribers in one batch. An empty list
   *   is a no-op.
   * @param events - The events to store and publish
   * @returns Result<void> that is ok once the batch is stored and published, or the error message
   *   when the service is not initialized or a step fails
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
   * @method registerHandler
   * @description Registers an event handler for an event type, tracking it in the service and
   *   subscribing it on the publisher.
   * @param eventType - The event type the handler listens to
   * @param handler - The handler to invoke for events of that type
   * @returns Nothing
   */
  registerHandler<T extends EventStoreEvent>(eventType: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    this.handlers.get(eventType)!.add(handler);
    this.publisher.subscribe(eventType, handler);
  }

  /**
   * @method unregisterHandler
   * @description Unregisters an event handler: removes it from the service's tracking (dropping the
   *   event type once it has no handler left) and unsubscribes it from the publisher.
   * @param eventType - The event type the handler was registered for
   * @param handler - The handler to remove
   * @returns Nothing
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
   * @method getAggregateEvents
   * @description Reads the events of one aggregate from its stream in the EventStore.
   * @param aggregateType - The aggregate type that, with the id, names the stream
   * @param aggregateId - The aggregate id
   * @param fromVersion - Optional version to start reading from
   * @returns Result with the aggregate's events, or the error message when the read fails
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
   * @method replayAggregateEvents
   * @description Replays the stored events of one aggregate to subscribers, tagging each replayed
   *   event's metadata with the source `EventService:Replay`. Refuses when replay is disabled.
   * @param aggregateType - The aggregate type that, with the id, names the stream
   * @param aggregateId - The aggregate id
   * @param fromVersion - Optional version to start replaying from
   * @returns Result<void> that is ok once every event is republished, or the error message when
   *   replay is disabled or the read or a publish fails
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
   * @method getEventsByType
   * @description Reads the stored events of one type, useful for analytics and monitoring.
   * @param eventType - The event type to read
   * @param fromTimestamp - Optional instant to start reading from
   * @returns Result with the matching events, or the error message when the read fails
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
   * @method healthCheck
   * @description Reports the service's health: healthy only when it is initialized and both the
   *   EventStore and the publisher report healthy.
   * @returns Result with the status and its details (initialization flag, EventStore and publisher
   *   details, handler count), or the error message when a probe fails
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
   * @method getStatistics
   * @description Reports the service's statistics: the number of registered handlers, their event
   *   types and, when metrics are enabled, the publisher's metrics.
   * @returns Result with the statistics, or the error message when collecting them fails
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
   * @method shutdown
   * @description Shuts the service down gracefully: stops the publisher, clears the tracked
   *   handlers and marks the service as not initialized.
   * @returns Result<void> that is ok once the service is stopped, or the error message when the
   *   publisher fails to stop
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
 * @description Creates a post lifecycle event on the `Post` aggregate, with `postId` and
 *   `projectId` placed ahead of the caller's data in the payload.
 * @param eventType - The post event type
 * @param postId - The post id, used as the aggregate id and in the payload
 * @param projectId - The project the post belongs to
 * @param data - Extra payload fields merged after `postId` and `projectId`
 * @param metadata - The event metadata: the source and, optionally, the acting user
 * @returns The event ready to store or publish
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
 * @description Creates a channel event on the `Channel` aggregate, with `channelId` and
 *   `projectId` placed ahead of the caller's data in the payload.
 * @param eventType - The channel event type
 * @param channelId - The channel id, used as the aggregate id and in the payload
 * @param projectId - The project the channel belongs to
 * @param data - Extra payload fields merged after `channelId` and `projectId`
 * @param metadata - The event metadata: the source and, optionally, the acting user
 * @returns The event ready to store or publish
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
 * @description Creates a user action event on the `User` aggregate, stamped with the current time.
 *   The metadata source is `API`, and the session id is added to the metadata only when given.
 * @param userId - The acting user, used as the aggregate id, in the payload and in the metadata
 * @param action - The action the user performed
 * @param resourceType - The type of resource the action targeted
 * @param resourceId - The id of the resource the action targeted
 * @param details - Optional extra details about the action
 * @param sessionId - Optional session the action happened in
 * @returns The event ready to store or publish
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
 * @method createAnalyticsEvent
 * @description Creates an analytics-collected event whose period is the 24 hours that end at the
 *   collection instant.
 * @param postId - The post the metrics belong to
 * @param channelId - The channel the metrics were collected from
 * @param provider - The provider that reported the metrics
 * @param metrics - The collected metric values
 * @returns The event, with `collectedAt` and `period.end` at one instant and `period.start` exactly
 *   24 hours before it
 */
export function createAnalyticsEvent(
  postId: string,
  channelId: string,
  provider: string,
  metrics: Record<string, unknown>
): EventStoreEvent {
  // One read of the clock: separate reads for the window's ends let a millisecond boundary fall
  // between them, and the window then measured 24 hours plus or minus one millisecond.
  const collectedAtMs = Date.now();
  return createEventStoreEvent(
    EVENT_TYPES.ANALYTICS_COLLECTED,
    postId,
    "Post",
    {
      postId,
      channelId,
      provider,
      metrics,
      collectedAt: new Date(collectedAtMs),
      period: {
        start: new Date(collectedAtMs - 24 * 60 * 60 * 1000), // Last 24 hours
        end: new Date(collectedAtMs),
      },
    },
    {
      source: "AnalyticsCollector",
    }
  );
}
