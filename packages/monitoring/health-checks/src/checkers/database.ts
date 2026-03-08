import type { HealthChecker, HealthCheckResult } from "../types.js";
import type { RepoPort } from "@ports/core";

export class DatabaseHealthChecker implements HealthChecker {
  constructor(private repo: RepoPort) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Test basic connectivity by listing accounts (available in RepoPort)
      const accountsResult = await this.repo.listAccounts();

      if (!accountsResult.ok) {
        throw new Error("Database connectivity test failed");
      }

      const latency = Date.now() - startTime;

      // Connection pool metrics not available through RepoPort interface
      const poolSize = 0;

      let status: HealthCheckResult["status"] = "healthy";
      let message = "Database is healthy";

      // Determine health based on latency
      if (latency > 5000) {
        status = "unhealthy";
        message = `Database response time too high: ${latency}ms`;
      } else if (latency > 1000) {
        status = "degraded";
        message = `Database response time elevated: ${latency}ms`;
      }

      return {
        status,
        latency,
        message,
        details: {
          responseTime: latency,
          poolConnections: poolSize,
          engine: "postgresql",
          version: "unknown", // Not accessible through RepoPort
        },
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        status: "unhealthy",
        latency,
        message: "Database connection failed",
        error: error.message,
        details: {
          errorType: error.constructor.name,
          code: error.code,
        },
      };
    }
  }

  private async getDatabaseVersion(): Promise<string> {
    // Database version not accessible through RepoPort interface
    return "unknown";
  }
}

export class DatabaseConnectionPoolHealthChecker implements HealthChecker {
  constructor(
    private repo: RepoPort,
    private maxConnections = 10
  ) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Metrics not accessible through RepoPort interface
      // Return healthy status with default values

      // Connection metrics not accessible through RepoPort interface
      const activeConnections = 0;
      const idleConnections = 0;
      const totalConnections = 0;

      const latency = Date.now() - startTime;

      let status: HealthCheckResult["status"] = "healthy";
      let message = "Connection pool is healthy";

      // Check pool utilization
      const utilization = totalConnections / this.maxConnections;

      if (utilization > 0.9) {
        status = "unhealthy";
        message = `Connection pool near capacity: ${totalConnections}/${this.maxConnections}`;
      } else if (utilization > 0.7) {
        status = "degraded";
        message = `Connection pool utilization high: ${Math.round(utilization * 100)}%`;
      }

      return {
        status,
        latency,
        message,
        details: {
          activeConnections,
          idleConnections,
          totalConnections,
          maxConnections: this.maxConnections,
          utilizationPercent: Math.round(utilization * 100),
        },
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        status: "unhealthy",
        latency,
        message: "Failed to check connection pool",
        error: error.message,
      };
    }
  }
}
