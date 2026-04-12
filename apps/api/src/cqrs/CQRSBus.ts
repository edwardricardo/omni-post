/**
 * @file CQRSBus.ts
 * @description CQRS bus implementation providing command/query dispatching with handler registration, validation, Redis-based query caching, and performance metrics.
 * @layer application
 */

import {
  Command,
  Query,
  CommandHandler,
  QueryHandler,
  CommandResult,
  QueryResult,
  CQRSBus,
  generateCacheKey,
} from "@shared/cqrs";
import { EventService } from "../events/EventService";
import Redis from "ioredis";
import { logger } from "../lib/logger.js";

interface CQRSBusConfig {
  eventService: EventService;
  redis: Redis;
  enableMetrics?: boolean;
  enableQueryCache?: boolean;
  defaultCacheTtl?: number;
}

interface BusMetrics {
  commandsExecuted: number;
  queriesExecuted: number;
  commandErrors: number;
  queryErrors: number;
  cacheHits: number;
  cacheMisses: number;
  avgCommandExecutionTime: number;
  avgQueryExecutionTime: number;
}

export class CQRSBusImpl implements CQRSBus {
  private commandHandlers = new Map<string, CommandHandler>();
  private queryHandlers = new Map<string, QueryHandler>();
  private metrics: BusMetrics = {
    commandsExecuted: 0,
    queriesExecuted: 0,
    commandErrors: 0,
    queryErrors: 0,
    cacheHits: 0,
    cacheMisses: 0,
    avgCommandExecutionTime: 0,
    avgQueryExecutionTime: 0,
  };
  private executionTimes: { commands: number[]; queries: number[] } = {
    commands: [],
    queries: [],
  };

  constructor(private config: CQRSBusConfig) {}

  /**
   * Register a command handler
   */
  registerCommandHandler<TCommand extends Command, TResult = void>(
    handler: CommandHandler<TCommand, TResult>
  ): void {
    if (this.commandHandlers.has(handler.commandType)) {
      throw new Error(`Command handler for ${handler.commandType} is already registered`);
    }

    this.commandHandlers.set(handler.commandType, handler as CommandHandler);
    logger.debug({ commandType: handler.commandType }, "Registered command handler");
  }

  /**
   * Register a query handler
   */
  registerQueryHandler<TQuery extends Query, TResult = unknown>(
    handler: QueryHandler<TQuery, TResult>
  ): void {
    if (this.queryHandlers.has(handler.queryType)) {
      throw new Error(`Query handler for ${handler.queryType} is already registered`);
    }

    this.queryHandlers.set(handler.queryType, handler as QueryHandler);
    logger.debug({ queryType: handler.queryType }, "Registered query handler");
  }

  /**
   * Execute a command
   */
  async executeCommand<TCommand extends Command, TResult = void>(
    command: TCommand
  ): Promise<CommandResult<TResult>> {
    const startTime = Date.now();

    try {
      // Find handler
      const handler = this.commandHandlers.get(command.type);
      if (!handler) {
        return {
          success: false,
          error: `No handler registered for command type: ${command.type}`,
        };
      }

      if (this.config.enableMetrics) {
        logger.debug({ commandType: command.type, commandId: command.id }, "Executing command");
      }

      // Execute handler
      const result = await handler.handle(command);

      // Publish events if command was successful and generated events
      if (result.success && result.events && result.events.length > 0) {
        await this.config.eventService.publishEvents(result.events);
      }

      // Update metrics
      this.updateCommandMetrics(startTime, true);

      return result as CommandResult<TResult>;
    } catch (error) {
      this.updateCommandMetrics(startTime, false);

      logger.error({ err: error, commandType: command.type }, "Command execution failed");

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  /**
   * Execute a query with optional caching
   */
  async executeQuery<TQuery extends Query, TResult = unknown>(
    query: TQuery
  ): Promise<QueryResult<TResult>> {
    const startTime = Date.now();
    let fromCache = false;

    try {
      // Check cache if enabled
      if (this.config.enableQueryCache && query.metadata.cacheKey) {
        const cachedResult = await this.getCachedResult<TResult>(query.metadata.cacheKey);
        if (cachedResult) {
          this.metrics.cacheHits++;
          fromCache = true;

          if (this.config.enableMetrics) {
            logger.debug({ queryType: query.type, queryId: query.id }, "Query cache hit");
          }

          return {
            ...cachedResult,
            metadata: {
              ...cachedResult.metadata,
              fromCache: true,
              executionTime: Date.now() - startTime,
            },
          };
        } else {
          this.metrics.cacheMisses++;
        }
      }

      // Find handler
      const handler = this.queryHandlers.get(query.type);
      if (!handler) {
        return {
          success: false,
          error: `No handler registered for query type: ${query.type}`,
        };
      }

      if (this.config.enableMetrics) {
        logger.debug({ queryType: query.type, queryId: query.id }, "Executing query");
      }

      // Execute handler
      const result = (await handler.handle(query)) as QueryResult<TResult>;

      // Cache result if successful and caching is enabled
      if (result.success && this.config.enableQueryCache && query.metadata.cacheKey) {
        await this.cacheResult(query.metadata.cacheKey, result, query.metadata.cacheTtl);
      }

      // Update metrics
      this.updateQueryMetrics(startTime, true);

      // Add execution metadata
      const metadata: QueryResult<TResult>["metadata"] = {
        fromCache,
        executionTime: Date.now() - startTime,
        ...(result.metadata?.totalCount !== undefined && {
          totalCount: result.metadata.totalCount,
        }),
        ...(result.metadata?.page !== undefined && { page: result.metadata.page }),
        ...(result.metadata?.limit !== undefined && { limit: result.metadata.limit }),
      };

      const resultWithMetadata: QueryResult<TResult> = {
        success: result.success,
        metadata,
      };
      if (result.data !== undefined) {
        resultWithMetadata.data = result.data;
      }
      if (result.error !== undefined) {
        resultWithMetadata.error = result.error;
      }

      return resultWithMetadata;
    } catch (error) {
      this.updateQueryMetrics(startTime, false);

      logger.error({ err: error, queryType: query.type }, "Query execution failed");

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        metadata: {
          fromCache: false,
          executionTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Get bus metrics
   */
  getMetrics(): BusMetrics {
    return { ...this.metrics };
  }

  /**
   * Get registered handlers info
   */
  getHandlersInfo(): {
    commands: string[];
    queries: string[];
  } {
    return {
      commands: Array.from(this.commandHandlers.keys()),
      queries: Array.from(this.queryHandlers.keys()),
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details: {
      commandHandlers: number;
      queryHandlers: number;
      redis: boolean;
      eventService: boolean;
    };
  }> {
    try {
      // Check Redis connection
      const redisStatus = await this.config.redis.ping();
      const isRedisHealthy = redisStatus === "PONG";

      // Check Event Service
      const eventServiceHealthResult = await this.config.eventService.healthCheck();
      const isEventServiceHealthy =
        eventServiceHealthResult.ok && eventServiceHealthResult.value.status === "healthy";

      return {
        status: isRedisHealthy && isEventServiceHealthy ? "healthy" : "unhealthy",
        details: {
          commandHandlers: this.commandHandlers.size,
          queryHandlers: this.queryHandlers.size,
          redis: isRedisHealthy,
          eventService: isEventServiceHealthy,
        },
      };
    } catch (error) {
      logger.error({ err: error }, "CQRS Bus health check failed");
      return {
        status: "unhealthy",
        details: {
          commandHandlers: this.commandHandlers.size,
          queryHandlers: this.queryHandlers.size,
          redis: false,
          eventService: false,
        },
      };
    }
  }

  /**
   * Clear all cached queries (useful for cache invalidation)
   */
  async clearCache(pattern?: string): Promise<number> {
    if (!this.config.enableQueryCache) {
      return 0;
    }

    try {
      const cachePattern = pattern || "cqrs:query:*";
      const keys = await this.config.redis.keys(cachePattern);

      if (keys.length === 0) {
        return 0;
      }

      const deletedCount = await this.config.redis.del(...keys);
      logger.info({ deletedCount }, "Cleared cached queries");

      return deletedCount;
    } catch (error) {
      logger.error({ err: error }, "Failed to clear cache");
      return 0;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down CQRS Bus");

    this.commandHandlers.clear();
    this.queryHandlers.clear();

    logger.info("CQRS Bus shutdown complete");
  }

  // Private methods

  private async getCachedResult<T>(cacheKey: string): Promise<QueryResult<T> | null> {
    try {
      const cached = await this.config.redis.get(`cqrs:query:${cacheKey}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn({ err: error }, "Failed to get cached result");
      return null;
    }
  }

  private async cacheResult<T>(
    cacheKey: string,
    result: QueryResult<T>,
    ttl?: number
  ): Promise<void> {
    try {
      const cacheTtl = ttl || this.config.defaultCacheTtl || 300; // 5 minutes default
      const cacheData = JSON.stringify(result);

      await this.config.redis.setex(`cqrs:query:${cacheKey}`, cacheTtl, cacheData);
    } catch (error) {
      logger.warn({ err: error }, "Failed to cache result");
    }
  }

  private updateCommandMetrics(startTime: number, success: boolean): void {
    if (!this.config.enableMetrics) return;

    const executionTime = Date.now() - startTime;
    this.executionTimes.commands.push(executionTime);

    if (this.executionTimes.commands.length > 100) {
      this.executionTimes.commands.shift();
    }

    this.metrics.commandsExecuted++;
    if (!success) {
      this.metrics.commandErrors++;
    }

    this.metrics.avgCommandExecutionTime =
      this.executionTimes.commands.reduce((a, b) => a + b, 0) / this.executionTimes.commands.length;
  }

  private updateQueryMetrics(startTime: number, success: boolean): void {
    if (!this.config.enableMetrics) return;

    const executionTime = Date.now() - startTime;
    this.executionTimes.queries.push(executionTime);

    if (this.executionTimes.queries.length > 100) {
      this.executionTimes.queries.shift();
    }

    this.metrics.queriesExecuted++;
    if (!success) {
      this.metrics.queryErrors++;
    }

    this.metrics.avgQueryExecutionTime =
      this.executionTimes.queries.reduce((a, b) => a + b, 0) / this.executionTimes.queries.length;
  }
}

// Middleware for automatic cache key generation
export function withCacheKey(query: Query, customKey?: string): Query {
  if (!query.metadata.cacheKey) {
    query.metadata.cacheKey = customKey || generateCacheKey(query);
  }
  return query;
}

// Cache invalidation helper
export async function invalidateQueryCache(redis: Redis, patterns: string[]): Promise<void> {
  for (const pattern of patterns) {
    try {
      const keys = await redis.keys(`cqrs:query:*${pattern}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info({ count: keys.length, pattern }, "Invalidated cached queries");
      }
    } catch (error) {
      logger.warn({ err: error, pattern }, "Failed to invalidate cache for pattern");
    }
  }
}
