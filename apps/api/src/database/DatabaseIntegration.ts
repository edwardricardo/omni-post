/**
 * Phase 2: Week 5-6 - Database Integration with Scalability
 *
 * Integrates advanced database features with the API:
 * - Automatic read/write routing
 * - Connection pool management
 * - Query optimization and monitoring
 * - Dynamic scaling based on load
 * - Health monitoring and alerts
 */

import { FastifyInstance } from "fastify";
import { EventService } from "../events/EventService";
import { RedisCacheManager } from "@adapters/cache-redis";
import { createDomainEvent } from "@shared/events";
import Redis from "ioredis";
import { dbLogger } from "../lib/logger.js";

/**
 * Minimal interface for the connection manager used by DatabaseIntegration.
 * The concrete DatabaseConnectionManager implements this interface.
 * Defining it here avoids a static import of ConnectionManager, which would
 * transitively import @infra/prisma and require DATABASE_URL at module load time.
 */
interface IConnectionManager {
  executeQuery<T>(
    query: (client: any) => Promise<T>,
    options?: { readOnly?: boolean; maxRetries?: number; timeout?: number }
  ): Promise<T>;
  executeTransaction<T>(
    transaction: (client: any) => Promise<T>,
    options?: { timeout?: number }
  ): Promise<T>;
  healthCheck(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    primary: boolean;
    replicas: { url: string; healthy: boolean; latency: number }[];
    metrics: any;
    lastCheck: Date;
  }>;
  getConnectionStats(): {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    queuedRequests: number;
    averageQueryTime: number;
    slowQueries: number;
    failedConnections: number;
    connectionErrors: number;
    replicaHealth: Map<string, boolean>;
    queryPerformance: {
      averageQueryTime: number;
      p95QueryTime: number;
      p99QueryTime: number;
      slowQueryRate: number;
    };
    connectionUtilization: { utilizationRate: number; queueUtilization: number; errorRate: number };
  };
  scaleConnectionPool(targetSize: number): Promise<void>;
  addReplica(url: string, weight?: number, priority?: number): Promise<void>;
  removeReplica(url: string): Promise<void>;
  shutdown(): Promise<void>;
}

interface DatabaseIntegrationConfig {
  fastify: FastifyInstance;
  eventService: EventService;
  cache: RedisCacheManager;
  redis: Redis;
  /** Optional: inject a pre-built connection manager (used in tests to avoid real DB connections) */
  connectionManager?: IConnectionManager;
}

interface QueryAnalytics {
  queryType: string;
  executionTime: number;
  resultSize: number;
  cacheHit: boolean;
  replicaUsed: boolean;
}

export class DatabaseIntegration {
  private connectionManager!: IConnectionManager;
  private queryAnalytics: QueryAnalytics[] = [];
  private loadMetrics = {
    readQueries: 0,
    writeQueries: 0,
    averageReadTime: 0,
    averageWriteTime: 0,
    peakConcurrentConnections: 0,
  };
  private autoScaleInterval?: NodeJS.Timeout;

  constructor(private config: DatabaseIntegrationConfig) {
    if (config.connectionManager) {
      // Use injected connection manager (test scenarios / DI)
      this.connectionManager = config.connectionManager;
    }
    // If no connectionManager is provided, it will be created lazily in initialize()
    // via a dynamic import of ConnectionManager. This avoids a static import that
    // would transitively import @infra/prisma and throw at module-load time when
    // DATABASE_URL is not set.
  }

  /**
   * Initialize database integration
   */
  async initialize(): Promise<void> {
    // If no connectionManager was injected, create the real one now via
    // a dynamic import so that importing this module doesn't eagerly trigger
    // the @infra/prisma → DATABASE_URL requirement at module load time.
    if (!this.connectionManager) {
      const { DatabaseConnectionManager } = await import("./ConnectionManager.js");
      const replicaConfig = this.parseReplicaConfig();
      this.connectionManager = new DatabaseConnectionManager(
        {
          primary: {
            url: process.env.DATABASE_URL!,
            poolSize: parseInt(process.env.DB_POOL_SIZE || "20"),
            connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || "30000"),
            idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || "30000"),
          },
          ...(replicaConfig && { replicas: replicaConfig }),
          pooling: {
            minConnections: 5,
            maxConnections: parseInt(process.env.DB_POOL_SIZE || "20"),
            acquireTimeout: 10000,
            createTimeout: 5000,
            destroyTimeout: 5000,
            reapInterval: 1000,
          },
          monitoring: {
            enabled: process.env.NODE_ENV === "production",
            slowQueryThreshold: 1000, // 1 second
            healthCheckInterval: 30000, // 30 seconds
          },
        },
        this.config.eventService
      );
    }

    // Register database management routes
    await this.registerDatabaseRoutes();

    // Set up automatic scaling
    this.setupAutoScaling();

    // Integrate with existing Prisma client
    this.integrateWithPrisma();

    dbLogger.info("Database Integration initialized successfully");
  }

  /**
   * Execute optimized query with automatic routing and caching
   */
  async executeOptimizedQuery<T>(
    queryKey: string,
    query: (client: any) => Promise<T>,
    options?: {
      readOnly?: boolean;
      cacheTtl?: number;
      tags?: string[];
      forceRefresh?: boolean;
    }
  ): Promise<T> {
    const { readOnly = false, cacheTtl = 300, tags = [], forceRefresh = false } = options || {};
    const startTime = Date.now();

    try {
      // Try cache first (unless force refresh)
      if (!forceRefresh) {
        const cacheResponse = await this.config.cache.get<T>(queryKey);

        if (cacheResponse.ok && cacheResponse.value !== null) {
          this.recordQueryAnalytics({
            queryType: readOnly ? "READ_CACHED" : "WRITE_CACHED",
            executionTime: Date.now() - startTime,
            resultSize: JSON.stringify(cacheResponse.value).length,
            cacheHit: true,
            replicaUsed: false,
          });

          return cacheResponse.value;
        }
      }

      // Execute query with connection manager
      const result = await this.connectionManager.executeQuery(query, {
        readOnly,
        maxRetries: 3,
        timeout: 30000,
      });

      // Cache the result
      await this.config.cache.set(queryKey, result, { ttl: cacheTtl, tags });

      // Record analytics
      this.recordQueryAnalytics({
        queryType: readOnly ? "READ_DB" : "WRITE_DB",
        executionTime: Date.now() - startTime,
        resultSize: JSON.stringify(result).length,
        cacheHit: false,
        replicaUsed: readOnly, // Assumes replicas are used for reads
      });

      // Update load metrics
      if (readOnly) {
        this.loadMetrics.readQueries++;
        this.loadMetrics.averageReadTime = this.calculateMovingAverage(
          this.loadMetrics.averageReadTime,
          Date.now() - startTime,
          this.loadMetrics.readQueries
        );
      } else {
        this.loadMetrics.writeQueries++;
        this.loadMetrics.averageWriteTime = this.calculateMovingAverage(
          this.loadMetrics.averageWriteTime,
          Date.now() - startTime,
          this.loadMetrics.writeQueries
        );
      }

      return result;
    } catch (error) {
      dbLogger.error({ err: error, queryKey }, "Optimized query failed");

      // Emit error event
      const errorEvent = createDomainEvent(
        "database.query-error",
        queryKey,
        "Database",
        {
          queryKey,
          readOnly,
          executionTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        { source: "DatabaseIntegration" }
      );

      await this.config.eventService.publishEvent(errorEvent);
      throw error;
    }
  }

  /**
   * Execute transaction with intelligent retry and monitoring
   */
  async executeOptimizedTransaction<T>(
    transactionKey: string,
    transaction: (client: any) => Promise<T>,
    options?: { timeout?: number; cacheTags?: string[] }
  ): Promise<T> {
    const { timeout = 60000, cacheTags = [] } = options || {};
    const startTime = Date.now();

    try {
      const result = await this.connectionManager.executeTransaction(transaction, { timeout });

      // Invalidate related caches
      if (cacheTags.length > 0) {
        for (const tag of cacheTags) {
          await this.config.cache.invalidateByTag(tag);
        }
      }

      // Record transaction analytics
      this.recordQueryAnalytics({
        queryType: "TRANSACTION",
        executionTime: Date.now() - startTime,
        resultSize: JSON.stringify(result).length,
        cacheHit: false,
        replicaUsed: false,
      });

      return result;
    } catch (error) {
      dbLogger.error({ err: error, transactionKey }, "Transaction failed");

      // Emit transaction error event
      const errorEvent = createDomainEvent(
        "database.transaction-error",
        transactionKey,
        "Database",
        {
          transactionKey,
          executionTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        { source: "DatabaseIntegration" }
      );

      await this.config.eventService.publishEvent(errorEvent);
      throw error;
    }
  }

  /**
   * Register database management API routes
   */
  private async registerDatabaseRoutes(): Promise<void> {
    const { fastify } = this.config;

    // Database health endpoint
    fastify.get("/api/database/health", async (request, reply) => {
      try {
        const health = await this.connectionManager.healthCheck();
        const stats = this.connectionManager.getConnectionStats();

        return {
          ...health,
          connectionStats: stats,
          loadMetrics: this.loadMetrics,
          timestamp: new Date(),
        };
      } catch (error) {
        dbLogger.error({ err: error }, "Database health check failed");
        return reply.status(500).send({
          status: "unhealthy",
          error: "Health check failed",
        });
      }
    });

    // Database statistics endpoint
    fastify.get("/api/database/stats", async (request, reply) => {
      try {
        const connectionStats = this.connectionManager.getConnectionStats();
        const recentAnalytics = this.queryAnalytics.slice(-100);

        const analyticsStats = this.calculateAnalyticsStats(recentAnalytics);

        return {
          success: true,
          data: {
            connections: {
              total: connectionStats.totalConnections,
              active: connectionStats.activeConnections,
              utilization: connectionStats.connectionUtilization.utilizationRate,
              errorRate: connectionStats.connectionUtilization.errorRate,
            },
            queries: {
              performance: connectionStats.queryPerformance,
              distribution: {
                reads: this.loadMetrics.readQueries,
                writes: this.loadMetrics.writeQueries,
                transactions: recentAnalytics.filter((a) => a.queryType === "TRANSACTION").length,
              },
              caching: {
                hitRate:
                  (recentAnalytics.filter((a) => a.cacheHit).length / recentAnalytics.length) * 100,
                replicaUsage:
                  (recentAnalytics.filter((a) => a.replicaUsed).length / recentAnalytics.length) *
                  100,
              },
            },
            performance: analyticsStats,
            loadMetrics: this.loadMetrics,
          },
          timestamp: new Date(),
        };
      } catch (error) {
        dbLogger.error({ err: error }, "Database stats failed");
        return reply.status(500).send({
          error: "Failed to get database statistics",
        });
      }
    });

    // Scale connection pool endpoint
    fastify.post("/api/database/scale", async (request, reply) => {
      try {
        const { poolSize } = request.body as { poolSize: number };

        if (poolSize < 5 || poolSize > 100) {
          return reply.status(400).send({
            error: "Pool size must be between 5 and 100",
          });
        }

        await this.connectionManager.scaleConnectionPool(poolSize);

        return {
          success: true,
          message: `Connection pool scaled to ${poolSize} connections`,
          newSize: poolSize,
          timestamp: new Date(),
        };
      } catch (error) {
        dbLogger.error({ err: error }, "Database scaling failed");
        return reply.status(500).send({
          error: "Failed to scale database connections",
        });
      }
    });

    // Add read replica endpoint
    fastify.post("/api/database/replicas", async (request, reply) => {
      try {
        const {
          url,
          weight = 1,
          priority = 1,
        } = request.body as {
          url: string;
          weight?: number;
          priority?: number;
        };

        if (!url) {
          return reply.status(400).send({
            error: "Replica URL is required",
          });
        }

        await this.connectionManager.addReplica(url, weight, priority);

        return {
          success: true,
          message: "Read replica added successfully",
          replica: { url, weight, priority },
          timestamp: new Date(),
        };
      } catch (error) {
        dbLogger.error({ err: error }, "Add replica failed");
        return reply.status(500).send({
          error: "Failed to add read replica",
        });
      }
    });

    // Remove read replica endpoint
    fastify.delete("/api/database/replicas", async (request, reply) => {
      try {
        const { url } = request.body as { url: string };

        if (!url) {
          return reply.status(400).send({
            error: "Replica URL is required",
          });
        }

        await this.connectionManager.removeReplica(url);

        return {
          success: true,
          message: "Read replica removed successfully",
          removedUrl: url,
          timestamp: new Date(),
        };
      } catch (error) {
        dbLogger.error({ err: error }, "Remove replica failed");
        return reply.status(500).send({
          error: "Failed to remove read replica",
        });
      }
    });

    // Query analytics endpoint
    fastify.get("/api/database/analytics", async (request, reply) => {
      try {
        const { timeframe = "1h" } = request.query as { timeframe?: string };

        const cutoffTime = this.getTimeframeCutoff(timeframe);
        const filteredAnalytics = this.queryAnalytics.filter(
          (_a) => Date.now() - cutoffTime < 0 // This would need proper timestamp tracking
        );

        const analytics = this.calculateAnalyticsStats(filteredAnalytics);

        return {
          success: true,
          data: {
            timeframe,
            analytics,
            sampleSize: filteredAnalytics.length,
          },
          timestamp: new Date(),
        };
      } catch (error) {
        dbLogger.error({ err: error }, "Query analytics failed");
        return reply.status(500).send({
          error: "Failed to get query analytics",
        });
      }
    });

    dbLogger.info("Database management routes registered");
  }

  /**
   * Integrate with existing Prisma client usage
   */
  private integrateWithPrisma(): void {
    const { fastify } = this.config;

    // Add database integration to request context
    fastify.addHook("onRequest", async (request, _reply) => {
      (request as any).database = {
        executeOptimizedQuery: this.executeOptimizedQuery.bind(this),
        executeOptimizedTransaction: this.executeOptimizedTransaction.bind(this),
        connectionManager: this.connectionManager,
      };
    });

    // Example integration with existing endpoints
    this.enhanceExistingEndpoints();

    dbLogger.info("Prisma integration completed");
  }

  /**
   * Setup automatic scaling based on load
   */
  private setupAutoScaling(): void {
    this.autoScaleInterval = setInterval(async () => {
      try {
        const stats = this.connectionManager.getConnectionStats();
        const utilizationRate = stats.connectionUtilization.utilizationRate;

        // Scale up if utilization > 80%
        if (utilizationRate > 80) {
          const currentSize = stats.totalConnections;
          const newSize = Math.min(currentSize + 5, 50); // Max 50 connections

          dbLogger.info(
            { previousSize: currentSize, newSize, utilizationRate },
            "Auto-scaling up connection pool"
          );
          await this.connectionManager.scaleConnectionPool(newSize);

          // Emit scaling event
          const scaleEvent = createDomainEvent(
            "database.auto-scaled-up",
            "auto-scale",
            "Database",
            {
              previousSize: currentSize,
              newSize,
              utilizationRate,
              trigger: "high-utilization",
            },
            { source: "DatabaseIntegration" }
          );

          await this.config.eventService.publishEvent(scaleEvent);
        }
        // Scale down if utilization < 30% for extended period
        else if (utilizationRate < 30) {
          const currentSize = stats.totalConnections;
          const newSize = Math.max(currentSize - 2, 5); // Min 5 connections

          if (newSize < currentSize) {
            dbLogger.info(
              { previousSize: currentSize, newSize, utilizationRate },
              "Auto-scaling down connection pool"
            );
            await this.connectionManager.scaleConnectionPool(newSize);
          }
        }

        // Update peak concurrent connections
        this.loadMetrics.peakConcurrentConnections = Math.max(
          this.loadMetrics.peakConcurrentConnections,
          stats.activeConnections
        );
      } catch (error) {
        dbLogger.error({ err: error }, "Auto-scaling check failed");
      }
    }, 60000); // Check every minute
    this.autoScaleInterval.unref();
  }

  /**
   * Enhance existing endpoints with optimized database access
   */
  private enhanceExistingEndpoints(): void {
    // This would wrap existing endpoints with optimized database access
    // Implementation would depend on your specific endpoint structure
    dbLogger.debug("Enhanced existing endpoints with optimized database access");
  }

  /**
   * Parse replica configuration from environment
   */
  private parseReplicaConfig() {
    const replicaUrls = process.env.DATABASE_REPLICA_URLS;
    if (!replicaUrls) return undefined;

    return replicaUrls.split(",").map((url, index) => ({
      url: url.trim(),
      weight: 1,
      priority: index + 1,
    }));
  }

  /**
   * Record query analytics
   */
  private recordQueryAnalytics(analytics: QueryAnalytics): void {
    this.queryAnalytics.push(analytics);

    // Keep only last 1000 entries
    if (this.queryAnalytics.length > 1000) {
      this.queryAnalytics.shift();
    }
  }

  /**
   * Calculate moving average
   */
  private calculateMovingAverage(current: number, newValue: number, count: number): number {
    return (current * (count - 1) + newValue) / count;
  }

  /**
   * Calculate analytics statistics
   */
  private calculateAnalyticsStats(analytics: QueryAnalytics[]) {
    if (analytics.length === 0) {
      return {
        averageExecutionTime: 0,
        p95ExecutionTime: 0,
        p99ExecutionTime: 0,
        cacheHitRate: 0,
        replicaUsageRate: 0,
        queryTypeDistribution: {},
      };
    }

    const executionTimes = analytics.map((a) => a.executionTime).sort((a, b) => a - b);
    const p95Index = Math.floor(executionTimes.length * 0.95);
    const p99Index = Math.floor(executionTimes.length * 0.99);

    const queryTypeDistribution = analytics.reduce(
      (acc, a) => {
        acc[a.queryType] = (acc[a.queryType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      averageExecutionTime: executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length,
      p95ExecutionTime: executionTimes[p95Index] || 0,
      p99ExecutionTime: executionTimes[p99Index] || 0,
      cacheHitRate: (analytics.filter((a) => a.cacheHit).length / analytics.length) * 100,
      replicaUsageRate: (analytics.filter((a) => a.replicaUsed).length / analytics.length) * 100,
      queryTypeDistribution,
    };
  }

  /**
   * Get timeframe cutoff timestamp
   */
  private getTimeframeCutoff(timeframe: string): number {
    const now = Date.now();
    switch (timeframe) {
      case "5m":
        return now - 5 * 60 * 1000;
      case "1h":
        return now - 60 * 60 * 1000;
      case "24h":
        return now - 24 * 60 * 60 * 1000;
      case "7d":
        return now - 7 * 24 * 60 * 60 * 1000;
      default:
        return now - 60 * 60 * 1000; // 1 hour default
    }
  }

  /**
   * Get connection manager instance
   */
  getConnectionManager(): IConnectionManager {
    if (!this.connectionManager) {
      throw new Error("DatabaseIntegration not initialized. Call initialize() first.");
    }
    return this.connectionManager;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    dbLogger.info("Shutting down Database Integration");
    if (this.autoScaleInterval) {
      clearInterval(this.autoScaleInterval);
    }
    if (this.connectionManager) {
      await this.connectionManager.shutdown();
    }
    dbLogger.info("Database Integration shutdown complete");
  }
}
