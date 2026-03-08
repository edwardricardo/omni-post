import type { ProviderId, ConnectionConfig } from "../providers/providerAdapter.interface.js";
import type { ProviderConnection } from "@infra/prisma";
import { prisma as defaultPrisma } from "@infra/prisma";
import { capabilityManager } from "../providers/providerCapabilityManager.js";
import { authLogger } from "../lib/logger.js";

interface ConnectionHealth {
  healthy: boolean;
  score: number; // 0-100
  lastCheck: Date;
  errors: string[];
  warnings: string[];
  recommendations: string[];
}

interface ConnectionUsage {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  quotaUsed: number;
  quotaLimit: number;
  lastUsed: Date;
}

// Minimal interface for the Prisma operations used by ConnectionManager
export interface ConnectionManagerPrisma {
  providerConnection: {
    findUnique: (args: any) => Promise<ProviderConnection | null>;
    findMany: (args: any) => Promise<ProviderConnection[]>;
    update: (args: any) => Promise<ProviderConnection>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
}

/**
 * Manages provider connections, health monitoring, and credential management
 */
export class ConnectionManager {
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private healthCache = new Map<string, { health: ConnectionHealth; expires: Date }>();
  private db: ConnectionManagerPrisma;

  constructor(db?: ConnectionManagerPrisma) {
    this.db = db || (defaultPrisma as unknown as ConnectionManagerPrisma);
    this.startHealthMonitoring();
  }

  /**
   * Get connection by ID
   */
  async getConnection(connectionId: string): Promise<ProviderConnection | null> {
    return this.db.providerConnection.findUnique({
      where: { id: connectionId },
    });
  }

  /**
   * Get all connections for an account/project
   */
  async getConnections(
    accountId: string,
    projectId?: string,
    providerId?: ProviderId
  ): Promise<ProviderConnection[]> {
    const where: any = { accountId, isActive: true };

    if (projectId) where.projectId = projectId;
    if (providerId) where.providerId = providerId.toUpperCase();

    return this.db.providerConnection.findMany({
      where,
      orderBy: [
        { status: "asc" }, // Connected first
        { lastUsedAt: "desc" },
        { createdAt: "desc" },
      ],
    });
  }

  /**
   * Get connection configuration for provider adapter
   */
  async getConnectionConfig(connectionId: string): Promise<ConnectionConfig | null> {
    const connection = await this.getConnection(connectionId);
    if (!connection || !connection.isActive) {
      return null;
    }

    return {
      ...(connection.accessToken ? { accessToken: connection.accessToken } : {}),
      ...(connection.refreshToken ? { refreshToken: connection.refreshToken } : {}),
      ...(connection.apiKey ? { apiKey: connection.apiKey } : {}),
      ...(connection.apiSecret ? { apiSecret: connection.apiSecret } : {}),
      ...(connection.providerAccountId ? { accountId: connection.providerAccountId } : {}),
      ...(connection.accountName ? { accountName: connection.accountName } : {}),
      ...(connection.profileImage ? { profileImage: connection.profileImage } : {}),
      connectedAt: connection.connectedAt,
      ...(connection.expiresAt ? { expiresAt: connection.expiresAt } : {}),
    };
  }

  /**
   * Update connection credentials (e.g., after token refresh)
   */
  async updateCredentials(
    connectionId: string,
    credentials: Partial<{
      accessToken: string;
      refreshToken: string;
      expiresAt: Date;
    }>
  ): Promise<ProviderConnection> {
    return this.db.providerConnection.update({
      where: { id: connectionId },
      data: {
        ...credentials,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Record successful connection usage
   */
  async recordUsage(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    const currentScore = connection?.healthScore ?? 0;
    await this.db.providerConnection.update({
      where: { id: connectionId },
      data: {
        lastUsedAt: new Date(),
        healthScore: Math.min(100, currentScore + 1),
      },
    });
  }

  /**
   * Record connection error
   */
  async recordError(connectionId: string, error: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    if (!connection) return;

    const newErrorCount = connection.errorCount + 1;
    const newHealthScore = Math.max(0, (connection.healthScore ?? 100) - newErrorCount * 10);

    await this.db.providerConnection.update({
      where: { id: connectionId },
      data: {
        errorCount: newErrorCount,
        lastError: error,
        lastErrorAt: new Date(),
        healthScore: newHealthScore,
        status: newHealthScore < 20 ? "ERROR" : connection.status,
      },
    });
  }

  /**
   * Check connection health
   */
  async checkConnectionHealth(connectionId: string): Promise<ConnectionHealth> {
    // Check cache first
    const cached = this.healthCache.get(connectionId);
    if (cached && cached.expires > new Date()) {
      return cached.health;
    }

    const connection = await this.getConnection(connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }

    const health: ConnectionHealth = {
      healthy: true,
      score: connection.healthScore ?? 100,
      lastCheck: new Date(),
      errors: [],
      warnings: [],
      recommendations: [],
    };

    // Check connection status
    if (connection.status === "ERROR" || connection.status === "EXPIRED") {
      health.healthy = false;
      health.errors.push(`Connection status: ${connection.status}`);
    }

    // Check token expiration
    if (connection.expiresAt && connection.expiresAt < new Date()) {
      health.healthy = false;
      health.errors.push("Access token has expired");
      health.recommendations.push("Refresh the access token or re-authenticate");
    } else if (connection.expiresAt) {
      const hoursUntilExpiry = (connection.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilExpiry < 24) {
        health.warnings.push(`Access token expires in ${Math.round(hoursUntilExpiry)} hours`);
        health.recommendations.push("Consider refreshing the access token soon");
      }
    }

    // Check error count
    if (connection.errorCount > 10) {
      health.warnings.push(`High error count: ${connection.errorCount} recent errors`);
    }

    // Check last usage
    if (connection.lastUsedAt) {
      const daysSinceUse = (Date.now() - connection.lastUsedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUse > 30) {
        health.warnings.push(`Connection not used for ${Math.round(daysSinceUse)} days`);
        health.recommendations.push("Consider disconnecting if no longer needed");
      }
    }

    // Update health score based on checks
    if (health.errors.length > 0) {
      health.score = Math.max(0, health.score - health.errors.length * 25);
      health.healthy = false;
    }
    if (health.warnings.length > 0) {
      health.score = Math.max(0, health.score - health.warnings.length * 10);
    }

    // Cache for 5 minutes
    this.healthCache.set(connectionId, {
      health,
      expires: new Date(Date.now() + 5 * 60 * 1000),
    });

    return health;
  }

  /**
   * Get connection usage statistics
   */
  async getConnectionUsage(connectionId: string): Promise<ConnectionUsage> {
    const connection = await this.getConnection(connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }

    // In a real implementation, this would query usage logs/metrics
    // For now, return data based on connection state
    return {
      totalRequests: 100,
      successfulRequests: 90,
      failedRequests: connection.errorCount,
      averageResponseTime: 200, // ms
      quotaUsed: 50,
      quotaLimit: 100,
      lastUsed: connection.lastUsedAt || connection.createdAt,
    };
  }

  /**
   * Refresh connection capabilities and limits
   */
  async refreshConnectionMetadata(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }

    try {
      // Get provider adapter to fetch current capabilities
      const providers = capabilityManager.getAllProviders();
      const provider = providers.find((p) => p.id === connection.providerId.toLowerCase());

      if (provider) {
        await this.db.providerConnection.update({
          where: { id: connectionId },
          data: {
            capabilities: JSON.parse(JSON.stringify(provider.capabilities)),
            limits: JSON.parse(JSON.stringify(provider.limits)),
            constraints: JSON.parse(JSON.stringify(provider.constraints)),
            lastHealthCheck: new Date(),
          },
        });
      }
    } catch (error: unknown) {
      await this.recordError(
        connectionId,
        `Metadata refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Test connection by making a simple API call
   */
  async testConnection(connectionId: string): Promise<{
    success: boolean;
    responseTime: number;
    error?: string;
  }> {
    const start = Date.now();

    try {
      const connection = await this.getConnection(connectionId);
      if (!connection) {
        throw new Error("Connection not found");
      }

      const config = await this.getConnectionConfig(connectionId);
      if (!config) {
        throw new Error("Connection configuration not available");
      }

      // Get provider adapter and test health
      const providers = capabilityManager.getAllProviders();
      const provider = providers.find((p) => p.id === connection.providerId.toLowerCase());

      if (!provider) {
        throw new Error(`Provider adapter not found for ${connection.providerId}`);
      }

      // Test connection using provider's health check
      const healthResult = await provider.healthCheck(config);
      const responseTime = Date.now() - start;

      if (healthResult.ok && healthResult.value.healthy) {
        await this.recordUsage(connectionId);
        return { success: true, responseTime };
      } else {
        const errorMessage = healthResult.ok ? "Health check failed" : "Health check error";
        await this.recordError(connectionId, errorMessage);
        return { success: false, responseTime, error: errorMessage };
      }
    } catch (error: unknown) {
      const responseTime = Date.now() - start;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await this.recordError(connectionId, errorMessage);
      return { success: false, responseTime, error: errorMessage };
    }
  }

  /**
   * Get connections summary for dashboard
   */
  async getConnectionsSummary(
    accountId: string,
    projectId?: string
  ): Promise<{
    total: number;
    connected: number;
    error: number;
    expired: number;
    byProvider: Record<string, number>;
    healthScore: number;
  }> {
    const connections = await this.getConnections(accountId, projectId);

    const summary = {
      total: connections.length,
      connected: 0,
      error: 0,
      expired: 0,
      byProvider: {} as Record<string, number>,
      healthScore: 0,
    };

    let totalHealth = 0;

    for (const connection of connections) {
      // Count by status
      switch (connection.status) {
        case "CONNECTED":
          summary.connected++;
          break;
        case "ERROR":
          summary.error++;
          break;
        case "EXPIRED":
          summary.expired++;
          break;
      }

      // Count by provider
      const provider = connection.providerId.toLowerCase();
      summary.byProvider[provider] = (summary.byProvider[provider] || 0) + 1;

      // Add to health score
      totalHealth += connection.healthScore ?? 0;
    }

    // Calculate average health score
    summary.healthScore =
      connections.length > 0 ? Math.round(totalHealth / connections.length) : 100;

    return summary;
  }

  /**
   * Start background health monitoring
   */
  private startHealthMonitoring(): void {
    // Run health checks every 30 minutes
    this.healthCheckInterval = setInterval(
      async () => {
        try {
          const connections = await this.db.providerConnection.findMany({
            where: {
              isActive: true,
              status: { in: ["CONNECTED", "ERROR"] },
            },
          });

          // Check health for up to 10 connections per interval
          const connectionsToCheck = connections.slice(0, 10);

          await Promise.allSettled(
            connectionsToCheck.map((conn) => this.checkConnectionHealth(conn.id))
          );
        } catch (error: unknown) {
          authLogger.error({ err: error }, "Health monitoring error");
        }
      },
      30 * 60 * 1000
    );
    this.healthCheckInterval.unref();
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Cleanup expired connections
   */
  async cleanupExpiredConnections(): Promise<number> {
    const result = await this.db.providerConnection.updateMany({
      where: {
        isActive: true,
        expiresAt: {
          lt: new Date(),
        },
        status: { not: "EXPIRED" },
      },
      data: {
        status: "EXPIRED",
        isActive: false,
      },
    });

    return result.count;
  }
}

// Singleton instance
const connectionManager = new ConnectionManager();

// Cleanup expired connections on startup and then every hour
connectionManager.cleanupExpiredConnections().catch(() => {
  // Ignore startup cleanup errors (DB may not be available)
});

const cleanupInterval = setInterval(
  () => {
    connectionManager.cleanupExpiredConnections().catch(() => {});
  },
  60 * 60 * 1000
); // Every hour
cleanupInterval.unref();
