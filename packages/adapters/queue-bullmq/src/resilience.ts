import CircuitBreaker from "opossum";
import type { Result as _Result } from "@shared/types";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:queue-bullmq:resilience");

export interface CircuitBreakerOptions {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  monitoringPeriod: number;
  halfOpenRetries: number;
}

export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  monitoringPeriod: 10000,
  halfOpenRetries: 3,
};

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 100,
  maxDelay: 5000,
  backoffMultiplier: 2,
};

export function createCircuitBreaker<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  options: Partial<CircuitBreakerOptions> = {}
): CircuitBreaker<T, R> {
  const opts = { ...DEFAULT_CIRCUIT_BREAKER_OPTIONS, ...options };

  const breaker = new CircuitBreaker<T, R>(fn, {
    timeout: opts.timeout,
    errorThresholdPercentage: opts.errorThresholdPercentage,
    resetTimeout: opts.resetTimeout,
    rollingCountTimeout: opts.monitoringPeriod,
    rollingCountBuckets: opts.halfOpenRetries,
  });

  breaker.on("open", () => {
    logger.warn("Circuit breaker opened - blocking requests");
  });

  breaker.on("halfOpen", () => {
    logger.info("Circuit breaker half-open - testing requests");
  });

  breaker.on("close", () => {
    logger.info("Circuit breaker closed - normal operation");
  });

  return breaker;
}

export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === opts.maxRetries) {
        break;
      }

      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelay
      );

      const jitteredDelay = delay + Math.random() * delay * 0.1;

      logger.warn(
        {
          attempt: attempt + 1,
          maxAttempts: opts.maxRetries + 1,
          retryInMs: Math.round(jitteredDelay),
          err: lastError,
        },
        "Operation failed, retrying"
      );

      await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
    }
  }

  throw lastError!;
}

export interface ResilienceMetrics {
  circuitBreakerState: "CLOSED" | "OPEN" | "HALF_OPEN";
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rejectedRequests: number;
  averageResponseTime: number;
  lastFailure?: {
    timestamp: Date;
    error: string;
  };
}

export class MetricsCollector {
  private metrics: ResilienceMetrics = {
    circuitBreakerState: "CLOSED",
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rejectedRequests: 0,
    averageResponseTime: 0,
  };

  private responseTimes: number[] = [];

  setupCircuitBreakerMetrics(breaker: CircuitBreaker<any, any>): void {
    breaker.on("success", (result, latencyTime) => {
      this.metrics.totalRequests++;
      this.metrics.successfulRequests++;
      this.recordResponseTime(latencyTime);
    });

    breaker.on("failure", (error, latencyTime) => {
      this.metrics.totalRequests++;
      this.metrics.failedRequests++;
      this.metrics.lastFailure = {
        timestamp: new Date(),
        error: error.message || "Unknown error",
      };
      this.recordResponseTime(latencyTime);
    });

    breaker.on("reject", () => {
      this.metrics.totalRequests++;
      this.metrics.rejectedRequests++;
    });

    breaker.on("open", () => {
      this.metrics.circuitBreakerState = "OPEN";
    });

    breaker.on("halfOpen", () => {
      this.metrics.circuitBreakerState = "HALF_OPEN";
    });

    breaker.on("close", () => {
      this.metrics.circuitBreakerState = "CLOSED";
    });
  }

  private recordResponseTime(latencyTime: number): void {
    this.responseTimes.push(latencyTime);

    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }

    this.metrics.averageResponseTime =
      this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;
  }

  getMetrics(): ResilienceMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      circuitBreakerState: "CLOSED",
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      averageResponseTime: 0,
    };
    this.responseTimes = [];
  }
}
