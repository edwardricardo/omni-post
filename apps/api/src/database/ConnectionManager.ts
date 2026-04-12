/**
 * @file ConnectionManager.ts
 * @description Database connection manager with dynamic pool sizing, read/write replica
 *              routing, health monitoring, failover, and performance analytics.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { createTestPrismaClient } from "@infra/prisma";
import { EventService } from "../events/EventService";
import { createDomainEvent } from "@shared/events";
import { dbLogger } from "../lib/logger.js";

interface DatabaseConfig {
  primary: {
    url: string;
    poolSize: number;
    connectionTimeout: number;
    idleTimeout: number;
  };
  replicas?: {
    url: string;
    weight: number;
    priority: number;
  }[];
  pooling: {
    minConnections: number;
    maxConnections: number;
    acquireTimeout: number;
    createTimeout: number;
    destroyTimeout: number;
    reapInterval: number;
  };
  monitoring: {
    enabled: boolean;
    slowQueryThreshold: number;
    healthCheckInterval: number;
  };
}

interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  queuedRequests: number;
  averageQueryTime: number;
  slowQueries: number;
  failedConnections: number;
  connectionErrors: number;
  replicaHealth: Map<string, boolean>;
}

interface ConnectionHealth {
  status: "healthy" | "degraded" | "unhealthy";
  primary: boolean;
  replicas: { url: string; healthy: boolean; latency: number }[];
  metrics: ConnectionMetrics;
  lastCheck: Date;
}

export class DatabaseConnectionManager {
  private primaryClient!: PrismaClient; // Will be initialized in constructor
  private replicaClients: Map<string, PrismaClient> = new Map();
  private connectionPool: Map<string, PrismaClient[]> = new Map();
  private metrics: ConnectionMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    queuedRequests: 0,
    averageQueryTime: 0,
    slowQueries: 0,
    failedConnections: 0,
    connectionErrors: 0,
    replicaHealth: new Map(),
  };
  private queryTimes: number[] = [];
  private healthChecks: Map<string, Date> = new Map();
  private isShuttingDown = false;

  constructor(
    private config: DatabaseConfig,
    private eventService?: EventService
  ) {
    this.initializePrimaryConnection();
    this.initializeReplicaConnections();
    this.startBackgroundTasks();
  }

  /**
   * Get database client for write operations (always primary)
   */
  async getWriteClient(): Promise<PrismaClient> {
    this.metrics.queuedRequests++;

    try {
      const startTime = Date.now();

      // Ensure primary connection is healthy
      await this.ensurePrimaryHealth();

      this.recordQueryTime(startTime);
      this.metrics.queuedRequests--;
      this.metrics.activeConnections++;

      return this.primaryClient;
    } catch (error) {
      this.metrics.queuedRequests--;
      this.metrics.failedConnections++;
      dbLogger.error({ err: error }, "Failed to get write client");
      throw error;
    }
  }

  /**
   * Get database client for read operations (replica if available)
   */
  async getReadClient(): Promise<PrismaClient> {
    this.metrics.queuedRequests++;

    try {
      const startTime = Date.now();

      // Try to get a healthy replica client
      const replicaClient = await this.getHealthyReplica();
      if (replicaClient) {
        this.recordQueryTime(startTime);
        this.metrics.queuedRequests--;
        this.metrics.activeConnections++;
        return replicaClient;
      }

      // Fallback to primary
      await this.ensurePrimaryHealth();
      this.recordQueryTime(startTime);
      this.metrics.queuedRequests--;
      this.metrics.activeConnections++;

      return this.primaryClient;
    } catch (error) {
      this.metrics.queuedRequests--;
      this.metrics.failedConnections++;
      dbLogger.error({ err: error }, "Failed to get read client");
      throw error;
    }
  }

  /**
   * Execute query with automatic retry and failover
   */
  async executeQuery<T>(
    query: (client: PrismaClient) => Promise<T>,
    options?: {
      readOnly?: boolean;
      maxRetries?: number;
      timeout?: number;
    }
  ): Promise<T> {
    const { readOnly = false, maxRetries = 3, timeout = 30000 } = options || {};
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const client = readOnly ? await this.getReadClient() : await this.getWriteClient();

        // Execute with timeout
        const result = await Promise.race([
          query(client),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Query timeout")), timeout)
          ),
        ]);

        const queryTime = Date.now() - startTime;
        this.recordQueryTime(queryTime);

        // Check for slow queries
        if (queryTime > this.config.monitoring.slowQueryThreshold) {
          this.metrics.slowQueries++;

          if (this.eventService) {
            const slowQueryEvent = createDomainEvent(
              "database.slow-query",
              "slow-query",
              "Database",
              {
                queryTime,
                threshold: this.config.monitoring.slowQueryThreshold,
                readOnly,
                attempt,
              },
              { source: "DatabaseConnectionManager" }
            );

            await this.eventService.publishEvent(slowQueryEvent);
          }
        }

        this.metrics.activeConnections--;
        return result;
      } catch (error) {
        lastError = error as Error;
        this.metrics.connectionErrors++;
        this.metrics.activeConnections--;

        dbLogger.error({ err: error, attempt, maxRetries }, "Query attempt failed");

        if (attempt < maxRetries) {
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError || new Error("Query failed after all retry attempts");
  }

  /**
   * Execute transaction (always on primary)
   */
  async executeTransaction<T>(
    transaction: (client: PrismaClient) => Promise<T>,
    options?: { timeout?: number }
  ): Promise<T> {
    const { timeout = 60000 } = options || {};
    const startTime = Date.now();

    try {
      const client = await this.getWriteClient();

      const result = await Promise.race([
        client.$transaction(async (tx) => {
          return await transaction(tx as PrismaClient);
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Transaction timeout")), timeout)
        ),
      ]);

      const transactionTime = Date.now() - startTime;
      this.recordQueryTime(transactionTime);

      if (transactionTime > this.config.monitoring.slowQueryThreshold) {
        this.metrics.slowQueries++;
        dbLogger.warn({ transactionTimeMs: transactionTime }, "Slow transaction detected");
      }

      this.metrics.activeConnections--;
      return result;
    } catch (error) {
      this.metrics.connectionErrors++;
      this.metrics.activeConnections--;
      dbLogger.error({ err: error }, "Transaction failed");
      throw error;
    }
  }

  /**
   * Health check for all database connections
   */
  async healthCheck(): Promise<ConnectionHealth> {
    const health: ConnectionHealth = {
      status: "healthy",
      primary: false,
      replicas: [],
      metrics: { ...this.metrics },
      lastCheck: new Date(),
    };

    try {
      // Check primary connection
      const primaryStartTime = Date.now();
      await this.primaryClient.$queryRaw`SELECT 1`;
      const _primaryLatency = Date.now() - primaryStartTime;

      health.primary = true;
      this.healthChecks.set("primary", new Date());

      // Check replica connections
      for (const [url, client] of this.replicaClients) {
        try {
          const replicaStartTime = Date.now();
          await client.$queryRaw`SELECT 1`;
          const replicaLatency = Date.now() - replicaStartTime;

          health.replicas.push({
            url,
            healthy: true,
            latency: replicaLatency,
          });

          this.metrics.replicaHealth.set(url, true);
          this.healthChecks.set(url, new Date());
        } catch (error) {
          dbLogger.error({ err: error, replicaUrl: url }, "Replica health check failed");

          health.replicas.push({
            url,
            healthy: false,
            latency: -1,
          });

          this.metrics.replicaHealth.set(url, false);
          health.status = "degraded";
        }
      }

      // Determine overall health status
      if (!health.primary) {
        health.status = "unhealthy";
      } else if (health.replicas.some((r) => !r.healthy)) {
        health.status = "degraded";
      }

      return health;
    } catch (error) {
      dbLogger.error({ err: error }, "Primary database health check failed");

      return {
        status: "unhealthy",
        primary: false,
        replicas: [],
        metrics: { ...this.metrics },
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): ConnectionMetrics & {
    queryPerformance: {
      averageQueryTime: number;
      p95QueryTime: number;
      p99QueryTime: number;
      slowQueryRate: number;
    };
    connectionUtilization: {
      utilizationRate: number;
      queueUtilization: number;
      errorRate: number;
    };
  } {
    const sortedQueryTimes = [...this.queryTimes].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedQueryTimes.length * 0.95);
    const p99Index = Math.floor(sortedQueryTimes.length * 0.99);

    const totalQueries =
      this.metrics.slowQueries + (this.queryTimes.length - this.metrics.slowQueries);
    const slowQueryRate = totalQueries > 0 ? (this.metrics.slowQueries / totalQueries) * 100 : 0;

    const utilizationRate =
      this.config.pooling.maxConnections > 0
        ? (this.metrics.activeConnections / this.config.pooling.maxConnections) * 100
        : 0;

    const totalRequests = this.metrics.activeConnections + this.metrics.failedConnections;
    const errorRate =
      totalRequests > 0 ? (this.metrics.failedConnections / totalRequests) * 100 : 0;

    return {
      ...this.metrics,
      queryPerformance: {
        averageQueryTime: this.metrics.averageQueryTime,
        p95QueryTime: sortedQueryTimes[p95Index] || 0,
        p99QueryTime: sortedQueryTimes[p99Index] || 0,
        slowQueryRate,
      },
      connectionUtilization: {
        utilizationRate,
        queueUtilization: (this.metrics.queuedRequests / this.config.pooling.maxConnections) * 100,
        errorRate,
      },
    };
  }

  /**
   * Scale connection pool dynamically
   */
  async scaleConnectionPool(targetSize: number): Promise<void> {
    dbLogger.info({ targetSize }, "Scaling connection pool");

    try {
      // Update configuration
      this.config.pooling.maxConnections = targetSize;

      // Reconnect with new pool size
      await this.reconnectWithNewPoolSize();

      dbLogger.info({ targetSize }, "Connection pool scaled successfully");

      if (this.eventService) {
        const scaleEvent = createDomainEvent(
          "database.pool-scaled",
          "pool-scale",
          "Database",
          {
            previousSize: this.metrics.totalConnections,
            newSize: targetSize,
            timestamp: new Date(),
          },
          { source: "DatabaseConnectionManager" }
        );

        await this.eventService.publishEvent(scaleEvent);
      }
    } catch (error) {
      dbLogger.error({ err: error }, "Failed to scale connection pool");
      throw error;
    }
  }

  /**
   * Add new read replica
   */
  async addReplica(url: string, weight: number = 1, priority: number = 1): Promise<void> {
    dbLogger.info({ replicaUrl: url }, "Adding read replica");

    try {
      const replicaClient = createTestPrismaClient(url);

      // Test connection
      await replicaClient.$queryRaw`SELECT 1`;

      this.replicaClients.set(url, replicaClient);
      this.metrics.replicaHealth.set(url, true);

      // Update configuration
      if (!this.config.replicas) {
        this.config.replicas = [];
      }
      this.config.replicas.push({ url, weight, priority });

      dbLogger.info({ replicaUrl: url }, "Read replica added successfully");

      if (this.eventService) {
        const replicaAddedEvent = createDomainEvent(
          "database.replica-added",
          "replica-add",
          "Database",
          {
            url,
            weight,
            priority,
            timestamp: new Date(),
          },
          { source: "DatabaseConnectionManager" }
        );

        await this.eventService.publishEvent(replicaAddedEvent);
      }
    } catch (error) {
      dbLogger.error({ err: error, replicaUrl: url }, "Failed to add replica");
      throw error;
    }
  }

  /**
   * Remove read replica
   */
  async removeReplica(url: string): Promise<void> {
    dbLogger.info({ replicaUrl: url }, "Removing read replica");

    try {
      const client = this.replicaClients.get(url);
      if (client) {
        await client.$disconnect();
        this.replicaClients.delete(url);
        this.metrics.replicaHealth.delete(url);
        this.healthChecks.delete(url);
      }

      // Update configuration
      if (this.config.replicas) {
        this.config.replicas = this.config.replicas.filter((r) => r.url !== url);
      }

      dbLogger.info({ replicaUrl: url }, "Read replica removed successfully");
    } catch (error) {
      dbLogger.error({ err: error, replicaUrl: url }, "Failed to remove replica");
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    dbLogger.info("Shutting down Database Connection Manager");
    this.isShuttingDown = true;

    try {
      // Disconnect primary
      await this.primaryClient.$disconnect();

      // Disconnect all replicas
      for (const [url, client] of this.replicaClients) {
        try {
          await client.$disconnect();
          dbLogger.debug({ replicaUrl: url }, "Disconnected replica");
        } catch (error) {
          dbLogger.error({ err: error, replicaUrl: url }, "Failed to disconnect replica");
        }
      }

      this.replicaClients.clear();
      this.connectionPool.clear();

      dbLogger.info("Database Connection Manager shutdown complete");
    } catch (error) {
      dbLogger.error({ err: error }, "Database shutdown error");
    }
  }

  // Private methods

  private initializePrimaryConnection(): void {
    this.primaryClient = createTestPrismaClient(this.config.primary.url);

    this.metrics.totalConnections = 1;
    dbLogger.info("Primary database connection initialized");
  }

  private initializeReplicaConnections(): void {
    if (!this.config.replicas) return;

    for (const replica of this.config.replicas) {
      try {
        const replicaClient = createTestPrismaClient(replica.url);

        this.replicaClients.set(replica.url, replicaClient);
        this.metrics.replicaHealth.set(replica.url, true);
        this.metrics.totalConnections++;

        dbLogger.info({ replicaUrl: replica.url }, "Read replica initialized");
      } catch (error) {
        dbLogger.error({ err: error, replicaUrl: replica.url }, "Failed to initialize replica");
        this.metrics.replicaHealth.set(replica.url, false);
      }
    }
  }

  private async ensurePrimaryHealth(): Promise<void> {
    const lastCheck = this.healthChecks.get("primary");
    const checkInterval = this.config.monitoring.healthCheckInterval;

    if (!lastCheck || Date.now() - lastCheck.getTime() > checkInterval) {
      try {
        await this.primaryClient.$queryRaw`SELECT 1`;
        this.healthChecks.set("primary", new Date());
      } catch (error) {
        dbLogger.error({ err: error }, "Primary database health check failed");
        throw new Error("Primary database is unhealthy");
      }
    }
  }

  private async getHealthyReplica(): Promise<PrismaClient | null> {
    if (this.replicaClients.size === 0) return null;

    // Get healthy replicas
    const healthyReplicas = Array.from(this.replicaClients.entries()).filter(
      ([url]) => this.metrics.replicaHealth.get(url) === true
    );

    if (healthyReplicas.length === 0) return null;

    // Simple round-robin selection
    // In production, you'd implement weighted selection based on replica.weight
    const randomIndex = Math.floor(Math.random() * healthyReplicas.length);
    const selected = healthyReplicas[randomIndex];
    return selected ? selected[1] : null;
  }

  private recordQueryTime(queryTime: number): void {
    this.queryTimes.push(queryTime);

    // Keep only last 1000 query times for metrics
    if (this.queryTimes.length > 1000) {
      this.queryTimes.shift();
    }

    // Update average
    this.metrics.averageQueryTime =
      this.queryTimes.reduce((a, b) => a + b, 0) / this.queryTimes.length;
  }

  private async reconnectWithNewPoolSize(): Promise<void> {
    dbLogger.info("Reconnecting with new pool size");

    // Disconnect current connections
    await this.primaryClient.$disconnect();

    for (const [_url, client] of this.replicaClients) {
      await client.$disconnect();
    }

    // Reinitialize with new configuration
    this.initializePrimaryConnection();
    this.initializeReplicaConnections();

    dbLogger.info("Reconnection completed");
  }

  private startBackgroundTasks(): void {
    // Health check monitoring
    if (this.config.monitoring.enabled) {
      setInterval(async () => {
        if (this.isShuttingDown) return;

        try {
          const health = await this.healthCheck();

          if (health.status === "unhealthy" && this.eventService) {
            const unhealthyEvent = createDomainEvent(
              "database.unhealthy",
              "health-check",
              "Database",
              {
                status: health.status,
                primaryHealthy: health.primary,
                replicasHealthy: health.replicas.filter((r) => r.healthy).length,
                totalReplicas: health.replicas.length,
              },
              { source: "DatabaseConnectionManager" }
            );

            await this.eventService.publishEvent(unhealthyEvent);
          }
        } catch (error) {
          dbLogger.error({ err: error }, "Background health check failed");
        }
      }, this.config.monitoring.healthCheckInterval);
    }

    // Metrics cleanup
    setInterval(
      () => {
        if (this.isShuttingDown) return;

        // Keep only recent query times
        if (this.queryTimes.length > 500) {
          this.queryTimes = this.queryTimes.slice(-500);
        }

        // Reset counters periodically
        this.metrics.slowQueries = 0;
        this.metrics.failedConnections = 0;
        this.metrics.connectionErrors = 0;
      },
      60 * 60 * 1000
    ); // Every hour
  }
}
