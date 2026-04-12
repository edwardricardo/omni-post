/**
 * @file EventPublisher.ts
 * @description Redis-based event publisher implementing pub/sub with real-time broadcasting,
 *              handler registration, dead letter queues, retries, and performance monitoring.
 * @layer infrastructure
 */

import Redis from "ioredis";
import {
  DomainEvent,
  EventHandler,
  EventPublisher as IEventPublisher,
  serializeEvent,
  deserializeEvent,
} from "@shared/events";
import { logger } from "../lib/logger.js";

interface PublisherConfig {
  redis: Redis;
  subscriberRedis?: Redis; // Separate connection for subscriptions
  deadLetterQueue?: string;
  maxRetries?: number;
  retryDelay?: number;
  enableMetrics?: boolean;
}

interface EventMetrics {
  published: number;
  delivered: number;
  failed: number;
  retried: number;
  handlerExecutions: Map<string, number>;
  averageLatency: number;
  lastActivity: Date;
}

interface RetryJob {
  event: DomainEvent;
  handler: EventHandler;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: Date;
  originalError: Error;
}

export class RedisEventPublisher implements IEventPublisher {
  private redis: Redis;
  private subscriberRedis: Redis;
  private handlers = new Map<string, Set<EventHandler>>();
  private deadLetterQueue: string;
  private maxRetries: number;
  private retryDelay: number;
  private enableMetrics: boolean;
  private metrics: EventMetrics;
  private retryJobs = new Map<string, RetryJob>();
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config: PublisherConfig) {
    this.redis = config.redis;
    this.subscriberRedis = config.subscriberRedis || config.redis.duplicate();
    this.deadLetterQueue = config.deadLetterQueue || "events:dead-letter";
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 5000; // 5 seconds
    this.enableMetrics = config.enableMetrics !== false;

    this.metrics = {
      published: 0,
      delivered: 0,
      failed: 0,
      retried: 0,
      handlerExecutions: new Map(),
      averageLatency: 0,
      lastActivity: new Date(),
    };

    this.initializeSubscriptions();
    this.startHealthCheck();
  }

  /**
   * Publish a single event
   */
  async publish(event: DomainEvent): Promise<void> {
    const startTime = Date.now();

    try {
      const serializedEvent = serializeEvent(event);
      const channel = `events:${event.type}`;

      // Publish to specific event type channel
      await this.redis.publish(channel, serializedEvent);

      // Publish to global events channel
      await this.redis.publish("events:all", serializedEvent);

      // Store in stream for replay capability
      await this.redis.xadd(
        `stream:${event.type}`,
        "*",
        "event",
        serializedEvent,
        "timestamp",
        event.timestamp.toISOString(),
        "aggregateId",
        event.aggregateId,
        "correlationId",
        event.correlationId || "",
        "causationId",
        event.causationId || ""
      );

      if (this.enableMetrics) {
        this.metrics.published++;
        this.updateAverageLatency(Date.now() - startTime);
        this.metrics.lastActivity = new Date();
      }

      logger.debug({ eventType: event.type, aggregateId: event.aggregateId }, "Published event");
    } catch (error) {
      logger.error({ err: error, eventType: event.type }, "Failed to publish event");

      if (this.enableMetrics) {
        this.metrics.failed++;
      }

      throw error;
    }
  }

  /**
   * Publish multiple events in a batch
   */
  async publishBatch(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const startTime = Date.now();

    try {
      const pipeline = this.redis.pipeline();

      for (const event of events) {
        const serializedEvent = serializeEvent(event);
        const channel = `events:${event.type}`;

        // Add to pipeline
        pipeline.publish(channel, serializedEvent);
        pipeline.publish("events:all", serializedEvent);

        // Add to stream
        pipeline.xadd(
          `stream:${event.type}`,
          "*",
          "event",
          serializedEvent,
          "timestamp",
          event.timestamp.toISOString(),
          "aggregateId",
          event.aggregateId,
          "correlationId",
          event.correlationId || "",
          "causationId",
          event.causationId || ""
        );
      }

      const results = await pipeline.exec();

      // Check for errors in batch
      if (results) {
        results.forEach((result, index) => {
          if (result[0]) {
            const event = events[index];
            if (event) {
              logger.error(
                { err: result[0], eventType: event.type },
                "Failed to publish event in batch"
              );
            }
          }
        });
      }

      if (this.enableMetrics) {
        this.metrics.published += events.length;
        this.updateAverageLatency(Date.now() - startTime);
        this.metrics.lastActivity = new Date();
      }

      logger.debug({ count: events.length }, "Published event batch");
    } catch (error) {
      logger.error({ err: error, count: events.length }, "Failed to publish event batch");

      if (this.enableMetrics) {
        this.metrics.failed += events.length;
      }

      throw error;
    }
  }

  /**
   * Subscribe to specific event type
   */
  subscribe(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    this.handlers.get(eventType)!.add(handler);

    // Subscribe to Redis channel if this is the first handler for this event type
    if (this.handlers.get(eventType)!.size === 1) {
      this.subscriberRedis.subscribe(`events:${eventType}`, (err) => {
        if (err) {
          logger.error({ err, eventType }, "Failed to subscribe to event type");
        } else {
          logger.debug({ eventType }, "Subscribed to event type");
        }
      });
    }

    logger.debug({ eventType }, "Registered handler for event type");
  }

  /**
   * Unsubscribe from specific event type
   */
  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);

    // Unsubscribe from Redis if no more handlers
    if (handlers.size === 0) {
      this.handlers.delete(eventType);
      this.subscriberRedis.unsubscribe(`events:${eventType}`, (err) => {
        if (err) {
          logger.error({ err, eventType }, "Failed to unsubscribe from event type");
        } else {
          logger.debug({ eventType }, "Unsubscribed from event type");
        }
      });
    }

    logger.debug({ eventType }, "Unregistered handler for event type");
  }

  /**
   * Subscribe to all events (useful for logging, monitoring)
   */
  subscribeToAll(handler: EventHandler): void {
    this.subscribe("*", handler);

    // Subscribe to the global channel if not already subscribed
    this.subscriberRedis.subscribe("events:all", (err) => {
      if (err) {
        logger.error({ err }, "Failed to subscribe to all events");
      } else {
        logger.debug("Subscribed to all events");
      }
    });
  }

  /**
   * Get event metrics
   */
  getMetrics(): EventMetrics {
    return {
      ...this.metrics,
      handlerExecutions: new Map(this.metrics.handlerExecutions),
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      published: 0,
      delivered: 0,
      failed: 0,
      retried: 0,
      handlerExecutions: new Map(),
      averageLatency: 0,
      lastActivity: new Date(),
    };
  }

  /**
   * Get dead letter queue items
   */
  async getDeadLetterItems(limit: number = 100): Promise<
    Array<{
      event: DomainEvent;
      error: string;
      timestamp: Date;
      attempts: number;
    }>
  > {
    try {
      const items = await this.redis.lrange(this.deadLetterQueue, 0, limit - 1);

      return items
        .map((item) => {
          try {
            return JSON.parse(item);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      logger.error({ err: error }, "Failed to get dead letter items");
      return [];
    }
  }

  /**
   * Clear dead letter queue
   */
  async clearDeadLetterQueue(): Promise<number> {
    try {
      return await this.redis.del(this.deadLetterQueue);
    } catch (error) {
      logger.error({ err: error }, "Failed to clear dead letter queue");
      return 0;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details: {
      redis: boolean;
      subscriberRedis: boolean;
      activeSubscriptions: number;
      metrics: EventMetrics;
    };
  }> {
    const details: {
      redis: boolean;
      subscriberRedis: boolean;
      activeSubscriptions: number;
      metrics: EventMetrics;
    } = {
      redis: false,
      subscriberRedis: false,
      activeSubscriptions: this.handlers.size,
      metrics: this.getMetrics(),
    };

    try {
      await this.redis.ping();
      details.redis = true;
    } catch (error) {
      logger.error({ err: error }, "Redis health check failed");
    }

    try {
      await this.subscriberRedis.ping();
      details.subscriberRedis = true;
    } catch (error) {
      logger.error({ err: error }, "Subscriber Redis health check failed");
    }

    return {
      status: details.redis && details.subscriberRedis ? "healthy" : "unhealthy",
      details,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down event publisher");

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    try {
      // Unsubscribe from all channels
      await this.subscriberRedis.unsubscribe();

      // Close Redis connections
      this.redis.disconnect();
      this.subscriberRedis.disconnect();

      logger.info("Event publisher shutdown complete");
    } catch (error) {
      logger.error({ err: error }, "Error during event publisher shutdown");
    }
  }

  /**
   * Initialize Redis subscriptions and message handling
   */
  private initializeSubscriptions(): void {
    this.subscriberRedis.on("message", async (channel: string, message: string) => {
      try {
        const event = deserializeEvent(message);
        const eventType = channel.replace("events:", "");

        // Handle global events channel
        if (channel === "events:all") {
          const globalHandlers = this.handlers.get("*");
          if (globalHandlers) {
            for (const handler of globalHandlers) {
              await this.executeHandler(handler, event);
            }
          }
          return;
        }

        // Handle specific event type
        const handlers = this.handlers.get(eventType);
        if (handlers) {
          for (const handler of handlers) {
            await this.executeHandler(handler, event);
          }
        }

        if (this.enableMetrics) {
          this.metrics.delivered++;
          this.metrics.lastActivity = new Date();
        }
      } catch (error) {
        logger.error({ err: error, channel }, "Failed to handle message from channel");

        if (this.enableMetrics) {
          this.metrics.failed++;
        }
      }
    });

    this.subscriberRedis.on("error", (error) => {
      logger.error({ err: error }, "Subscriber Redis error");
    });

    logger.info("Event publisher initialized");
  }

  /**
   * Execute event handler with retry logic
   */
  private async executeHandler(handler: EventHandler, event: DomainEvent): Promise<void> {
    const _startTime = Date.now();

    try {
      await handler.handle(event);

      if (this.enableMetrics) {
        const handlerName = handler.constructor.name;
        const count = this.metrics.handlerExecutions.get(handlerName) || 0;
        this.metrics.handlerExecutions.set(handlerName, count + 1);
      }
    } catch (error) {
      logger.error({ err: error, eventType: event.type }, "Handler failed for event");

      // Implement retry logic
      const retryKey = `${event.id}-${handler.constructor.name}`;
      const existingRetry = this.retryJobs.get(retryKey);
      const attempt = existingRetry ? existingRetry.attempt + 1 : 1;

      if (attempt <= this.maxRetries) {
        const retryJob: RetryJob = {
          event,
          handler,
          attempt,
          maxAttempts: this.maxRetries,
          nextRetryAt: new Date(Date.now() + this.retryDelay * attempt),
          originalError: error as Error,
        };

        this.retryJobs.set(retryKey, retryJob);

        setTimeout(() => {
          this.executeRetry(retryKey);
        }, this.retryDelay * attempt);

        if (this.enableMetrics) {
          this.metrics.retried++;
        }

        logger.warn(
          { eventType: event.type, attempt, maxRetries: this.maxRetries },
          "Scheduled event retry"
        );
      } else {
        // Send to dead letter queue
        await this.sendToDeadLetterQueue(event, error as Error, this.maxRetries);
        this.retryJobs.delete(retryKey);

        logger.error(
          { eventType: event.type, maxRetries: this.maxRetries },
          "Event sent to dead letter queue after max attempts"
        );
      }

      if (this.enableMetrics) {
        this.metrics.failed++;
      }
    }
  }

  /**
   * Execute retry job
   */
  private async executeRetry(retryKey: string): Promise<void> {
    const retryJob = this.retryJobs.get(retryKey);
    if (!retryJob) {
      return;
    }

    logger.info(
      {
        eventType: retryJob.event.type,
        attempt: retryJob.attempt,
        maxAttempts: retryJob.maxAttempts,
      },
      "Retrying event"
    );
    await this.executeHandler(retryJob.handler, retryJob.event);
  }

  /**
   * Send event to dead letter queue
   */
  private async sendToDeadLetterQueue(
    event: DomainEvent,
    error: Error,
    attempts: number
  ): Promise<void> {
    try {
      const deadLetterItem = {
        event,
        error: error.message,
        timestamp: new Date(),
        attempts,
      };

      await this.redis.lpush(this.deadLetterQueue, JSON.stringify(deadLetterItem));

      // Keep only last 1000 dead letter items
      await this.redis.ltrim(this.deadLetterQueue, 0, 999);
    } catch (dlqError) {
      logger.error({ err: dlqError }, "Failed to send event to dead letter queue");
    }
  }

  /**
   * Update average latency metric
   */
  private updateAverageLatency(latency: number): void {
    if (this.metrics.averageLatency === 0) {
      this.metrics.averageLatency = latency;
    } else {
      // Simple exponential moving average
      this.metrics.averageLatency = this.metrics.averageLatency * 0.9 + latency * 0.1;
    }
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.healthCheck();
        if (health.status === "unhealthy") {
          logger.warn({ details: health.details }, "Event publisher health check failed");
        }
      } catch (error) {
        logger.error({ err: error }, "Health check error");
      }
    }, 30000).unref(); // Every 30 seconds
  }
}
