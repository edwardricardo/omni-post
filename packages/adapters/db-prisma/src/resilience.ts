import CircuitBreaker from "opossum";
import type { Result as _Result } from "@shared/types";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:resilience");

export interface DatabaseResilienceOptions {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  monitoringPeriod: number;
  halfOpenRetries: number;
  queryTimeout: number;
}

export const DEFAULT_DATABASE_RESILIENCE_OPTIONS: DatabaseResilienceOptions = {
  timeout: 8000,
  errorThresholdPercentage: 50,
  resetTimeout: 60000,
  monitoringPeriod: 15000,
  halfOpenRetries: 5,
  queryTimeout: 10000,
};

export interface DatabaseRetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export const DEFAULT_DATABASE_RETRY_OPTIONS: DatabaseRetryOptions = {
  maxRetries: 3,
  baseDelay: 150,
  maxDelay: 8000,
  backoffMultiplier: 2.5,
  retryableErrors: [
    "P1001", // Can't reach database server
    "P1002", // Database server was reached but timed out
    "P1008", // Operations timed out
    "P1017", // Server has closed the connection
    "P2024", // Timed out fetching a new connection from the connection pool
    "ENOTFOUND",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
  ],
};

export function createDatabaseCircuitBreaker<T extends any[], R>(
  operation: (...args: T) => Promise<R>,
  options: Partial<DatabaseResilienceOptions> = {}
): CircuitBreaker<T, R> {
  const opts = { ...DEFAULT_DATABASE_RESILIENCE_OPTIONS, ...options };

  const breaker = new CircuitBreaker<T, R>(operation, {
    timeout: opts.timeout,
    errorThresholdPercentage: opts.errorThresholdPercentage,
    resetTimeout: opts.resetTimeout,
    rollingCountTimeout: opts.monitoringPeriod,
    rollingCountBuckets: opts.halfOpenRetries,
    name: "database-operation",
  });

  breaker.on("open", () => {
    logger.warn("Database circuit breaker opened - blocking database requests");
  });

  breaker.on("halfOpen", () => {
    logger.info("Database circuit breaker half-open - testing database connectivity");
  });

  breaker.on("close", () => {
    logger.info("Database circuit breaker closed - normal database operations");
  });

  breaker.on("fallback", () => {
    logger.warn("Database circuit breaker fallback triggered");
  });

  return breaker;
}

export function isDatabaseErrorRetryable(error: unknown): boolean {
  if (!error) return false;

  const errObj = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const errorCode =
    (errObj && "code" in errObj ? String(errObj.code) : "") ||
    (errObj && "name" in errObj ? String(errObj.name) : "") ||
    "";
  const errorMessage = (errObj && "message" in errObj ? String(errObj.message) : "") || "";

  return DEFAULT_DATABASE_RETRY_OPTIONS.retryableErrors.some(
    (retryableCode) => errorCode.includes(retryableCode) || errorMessage.includes(retryableCode)
  );
}

export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  options: Partial<DatabaseRetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_DATABASE_RETRY_OPTIONS, ...options };
  let lastError: Error;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if this is the last attempt
      if (attempt === opts.maxRetries) {
        break;
      }

      // Only retry if the error is retryable
      if (!isDatabaseErrorRetryable(error)) {
        throw lastError;
      }

      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelay
      );

      // Add jitter (±20% of the delay)
      const jitteredDelay = delay + (Math.random() - 0.5) * delay * 0.4;

      logger.warn(
        {
          attempt: attempt + 1,
          maxAttempts: opts.maxRetries + 1,
          retryInMs: Math.round(jitteredDelay),
          err: lastError,
        },
        "Database operation failed, retrying"
      );

      await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
    }
  }

  throw lastError!;
}

export interface DatabaseHealthMetrics {
  circuitBreakerState: "CLOSED" | "OPEN" | "HALF_OPEN";
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  rejectedOperations: number;
  averageResponseTime: number;
  connectionHealth: {
    isHealthy: boolean;
    lastCheck: Date;
    errors: number;
  };
  performanceMetrics: {
    slowQueries: number;
    queryTimeouts: number;
    connectionPoolSize?: number;
  };
}

export class DatabaseMetricsCollector {
  private metrics: DatabaseHealthMetrics = {
    circuitBreakerState: "CLOSED",
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    rejectedOperations: 0,
    averageResponseTime: 0,
    connectionHealth: {
      isHealthy: true,
      lastCheck: new Date(),
      errors: 0,
    },
    performanceMetrics: {
      slowQueries: 0,
      queryTimeouts: 0,
    },
  };

  private responseTimes: number[] = [];
  private maxResponseTimeHistory = 200;

  setupCircuitBreakerMetrics(breaker: CircuitBreaker<any, any>): void {
    breaker.on("success", (result: any, latencyTime: number) => {
      this.metrics.totalOperations++;
      this.metrics.successfulOperations++;
      this.recordResponseTime(latencyTime);

      // Track slow queries (>2 seconds)
      if (latencyTime > 2000) {
        this.metrics.performanceMetrics.slowQueries++;
      }
    });

    breaker.on("failure", (error: any, latencyTime: number) => {
      this.metrics.totalOperations++;
      this.metrics.failedOperations++;
      this.metrics.connectionHealth.errors++;

      if (latencyTime) {
        this.recordResponseTime(latencyTime);

        // Check for timeout errors
        if (
          error.code === "P1008" ||
          error.code === "P2024" ||
          error.message?.includes("timeout")
        ) {
          this.metrics.performanceMetrics.queryTimeouts++;
        }
      }
    });

    breaker.on("reject", () => {
      this.metrics.totalOperations++;
      this.metrics.rejectedOperations++;
    });

    breaker.on("timeout", () => {
      this.metrics.performanceMetrics.queryTimeouts++;
    });

    breaker.on("open", () => {
      this.metrics.circuitBreakerState = "OPEN";
      this.metrics.connectionHealth.isHealthy = false;
    });

    breaker.on("halfOpen", () => {
      this.metrics.circuitBreakerState = "HALF_OPEN";
    });

    breaker.on("close", () => {
      this.metrics.circuitBreakerState = "CLOSED";
      this.metrics.connectionHealth.isHealthy = true;
      this.metrics.connectionHealth.lastCheck = new Date();
    });
  }

  private recordResponseTime(latencyTime: number): void {
    this.responseTimes.push(latencyTime);

    // Keep only recent response times for memory efficiency
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes = this.responseTimes.slice(-this.maxResponseTimeHistory);
    }

    // Calculate rolling average
    this.metrics.averageResponseTime =
      this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;
  }

  updateConnectionHealth(isHealthy: boolean): void {
    this.metrics.connectionHealth.isHealthy = isHealthy;
    this.metrics.connectionHealth.lastCheck = new Date();

    if (!isHealthy) {
      this.metrics.connectionHealth.errors++;
    }
  }

  getMetrics(): DatabaseHealthMetrics {
    return {
      ...this.metrics,
      connectionHealth: { ...this.metrics.connectionHealth },
      performanceMetrics: { ...this.metrics.performanceMetrics },
    };
  }

  reset(): void {
    this.metrics = {
      circuitBreakerState: "CLOSED",
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      rejectedOperations: 0,
      averageResponseTime: 0,
      connectionHealth: {
        isHealthy: true,
        lastCheck: new Date(),
        errors: 0,
      },
      performanceMetrics: {
        slowQueries: 0,
        queryTimeouts: 0,
      },
    };
    this.responseTimes = [];
  }
}

// Database connection monitoring
export async function checkDatabaseConnection(prisma: any): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error: unknown) {
    logger.error({ err: error }, "Database connection check failed");
    return false;
  }
}

// Connection pooling helper
export function getDatabaseConnectionConfig() {
  return {
    connectionLimit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || "10"),
    poolTimeout: parseInt(process.env.DATABASE_POOL_TIMEOUT || "10000"),
    idleTimeout: parseInt(process.env.DATABASE_IDLE_TIMEOUT || "600000"),
  };
}
