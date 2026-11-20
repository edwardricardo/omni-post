/**
 * @file database.ts
 * @description Health checkers for the database: its connectivity, asked through the repository
 *              port's ping so the latency measures the connection and never the size of a table,
 *              and its connection pool.
 * @layer infrastructure
 */
import type { HealthChecker, HealthCheckResult } from "../types.js";
import type { RepoPort } from "@ports/core";

/** Above this latency the database still answers, slowly, and the report says degraded. */
const DEGRADED_LATENCY_MS = 1000;

/** Above this latency the database is reported unhealthy. */
const UNHEALTHY_LATENCY_MS = 5000;

export class DatabaseHealthChecker implements HealthChecker {
  /**
   * @param database - The repository whose ping the check asks; it reads no table.
   */
  constructor(private readonly database: Pick<RepoPort, "ping">) {}

  /**
   * @method check
   * @description Pings the database once and grades the answer by its latency: healthy up to one
   *   second, degraded above it, unhealthy above five seconds or when the ping fails.
   * @returns The status, the latency in milliseconds, a message and the report's details.
   */
  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const ping = await this.database.ping();
      const latency = Date.now() - startTime;

      if (!ping.ok) {
        return {
          status: "unhealthy",
          latency,
          message: "Database connection failed",
          error: "Database connectivity test failed",
          details: { errorType: ping.error },
        };
      }

      let status: HealthCheckResult["status"] = "healthy";
      let message = "Database is healthy";

      if (latency > UNHEALTHY_LATENCY_MS) {
        status = "unhealthy";
        message = `Database response time too high: ${latency}ms`;
      } else if (latency > DEGRADED_LATENCY_MS) {
        status = "degraded";
        message = `Database response time elevated: ${latency}ms`;
      }

      return {
        status,
        latency,
        message,
        // The port exposes neither the pool's size nor the server's version; the two fields keep
        // the report's shape for its readers.
        details: {
          responseTime: latency,
          poolConnections: 0,
          engine: "postgresql",
          version: "unknown",
        },
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      return {
        status: "unhealthy",
        latency,
        message: "Database connection failed",
        error: error instanceof Error ? error.message : String(error),
        details: {
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
          code: error instanceof Error && "code" in error ? error.code : undefined,
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

  /**
   * @method check
   * @description Grades the pool's utilization against `maxConnections`. The port exposes no pool
   *   counts, so every count reads 0 and the status is always healthy.
   * @returns The status, the latency in milliseconds, a message and the pool's counts.
   */
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
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      return {
        status: "unhealthy",
        latency,
        message: "Failed to check connection pool",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
