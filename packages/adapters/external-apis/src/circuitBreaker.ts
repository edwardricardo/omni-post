/**
 * @file circuitBreaker.ts
 * @description External API circuit breaker wrapping opossum with fallback strategies, dead
 *              letter queue integration, and Prometheus metric emission.
 * @layer infrastructure
 */
import CircuitBreaker from "opossum";
import client from "prom-client";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:external-apis:circuit-breaker");
import {
  FallbackManager,
  createFallbackManager,
  type FallbackConfig,
  type FallbackContext,
  CommonFallbackStrategies,
} from "@adapters/fallback-strategies";
import {
  DeadLetterQueueManager as _DeadLetterQueueManager,
  createDeadLetterQueue,
  getDeadLetterQueue,
} from "@adapters/dead-letter-queue";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";

/**
 * @interface CircuitBreakerStatus
 * @description Public status snapshot of a single circuit breaker. Returned
 *              by `getStatus(service, operation)` and as the value type of
 *              `getAllStatuses()`. Used by adapter and provider modules to
 *              expose breaker health to observability dashboards.
 */
export interface CircuitBreakerStatus {
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failures: number;
  successes: number;
  /** Epoch ms — only present while the breaker is OPEN. */
  nextAttempt?: number;
}

export interface ExternalApiOptions {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  monitoringPeriod: number;
  halfOpenRetries: number;
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitterEnabled: boolean;
  cacheTtl?: number;
  fallbackConfig?: FallbackConfig;
  fallbackEnabled?: boolean;
  deadLetterEnabled?: boolean;
  deadLetterPriority?: "critical" | "high" | "normal" | "low";
}

export const DEFAULT_EXTERNAL_API_OPTIONS: ExternalApiOptions = {
  timeout: 10000, // 10 seconds
  errorThresholdPercentage: 50,
  resetTimeout: 30000, // 30 seconds
  monitoringPeriod: 10000, // 10 seconds
  halfOpenRetries: 3,
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
  jitterEnabled: true,
  cacheTtl: 300000, // 5 minutes
  // Fail-fast by default (R1-B): non-idempotent writes MUST propagate errors,
  // never resolve with a synthetic cached/static value. Genuinely-degradable
  // reads opt in explicitly via ANALYTICS_CB_OPTIONS or METADATA_CB_OPTIONS.
  fallbackEnabled: false,
  deadLetterEnabled: true,
  deadLetterPriority: "normal",
};

/**
 * Opt-in preset for analytics / insights / trending reads.
 * On provider failure, returns the most-recent Redis-cached response (30-min TTL).
 * Rejects if the cache is empty (R3-B: no invented defaults).
 * Call-site: `circuitBreaker.call(svc, op, fn, args, ANALYTICS_CB_OPTIONS)`.
 */
export const ANALYTICS_CB_OPTIONS = {
  fallbackEnabled: true,
  fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
  cacheTtl: 1_800_000, // 30 minutes
} as const;

/**
 * Opt-in preset for pure metadata / list reads.
 * On provider failure, returns the most-recent Redis-cached response (1-hr TTL).
 * Rejects if the cache is empty.
 * Call-site: `circuitBreaker.call(svc, op, fn, args, METADATA_CB_OPTIONS)`.
 */
export const METADATA_CB_OPTIONS = {
  fallbackEnabled: true,
  fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
  cacheTtl: 3_600_000, // 1 hour
} as const;

export interface ApiCallMetrics {
  // Circuit breaker metrics
  circuitBreakerRequests: client.Counter<string>;
  circuitBreakerFailures: client.Counter<string>;
  circuitBreakerSuccesses: client.Counter<string>;
  circuitBreakerTimeouts: client.Counter<string>;
  circuitBreakerFallbacks: client.Counter<string>;
  circuitBreakerStateChanges: client.Counter<string>;

  // Request metrics
  apiRequestDuration: client.Histogram<string>;
  apiRequestsInFlight: client.Gauge<string>;
  apiRetryAttempts: client.Counter<string>;

  // Cache metrics
  cacheHits: client.Counter<string>;
  cacheMisses: client.Counter<string>;
  cacheErrors: client.Counter<string>;
}

export class ExternalApiCircuitBreaker {
  private breakers = new Map<string, CircuitBreaker<unknown[], unknown>>();
  private cache = new Map<string, { data: unknown; expires: number }>();
  private metrics: ApiCallMetrics;
  private registry: client.Registry;
  private fallbackManager: FallbackManager;

  constructor(registry: client.Registry, redisUrl?: string) {
    this.registry = registry;
    this.metrics = this.createMetrics();
    this.fallbackManager = createFallbackManager(redisUrl || process.env.REDIS_URL);

    // Initialize dead letter queue if Redis URL is available
    if (redisUrl || process.env.REDIS_URL) {
      try {
        createDeadLetterQueue({
          redisUrl: redisUrl || process.env.REDIS_URL!,
          queueName: QUEUE_NAMES.FAILED_OPERATIONS_DLQ,
          maxRetentionDays: 30,
          processingConcurrency: 2,
        });
      } catch (error) {
        logger.warn({ err: error }, "Failed to initialize dead letter queue");
      }
    }
  }

  private createMetrics(): ApiCallMetrics {
    return {
      circuitBreakerRequests: new client.Counter({
        name: "circuit_breaker_requests_total",
        help: "Total circuit breaker requests",
        labelNames: ["service", "operation", "state"],
        registers: [this.registry],
      }),

      circuitBreakerFailures: new client.Counter({
        name: "circuit_breaker_failures_total",
        help: "Total circuit breaker failures",
        labelNames: ["service", "operation", "reason"],
        registers: [this.registry],
      }),

      circuitBreakerSuccesses: new client.Counter({
        name: "circuit_breaker_successes_total",
        help: "Total circuit breaker successes",
        labelNames: ["service", "operation"],
        registers: [this.registry],
      }),

      circuitBreakerTimeouts: new client.Counter({
        name: "circuit_breaker_timeouts_total",
        help: "Total circuit breaker timeouts",
        labelNames: ["service", "operation"],
        registers: [this.registry],
      }),

      circuitBreakerFallbacks: new client.Counter({
        name: "circuit_breaker_fallbacks_total",
        help: "Total circuit breaker fallbacks executed",
        labelNames: ["service", "operation"],
        registers: [this.registry],
      }),

      circuitBreakerStateChanges: new client.Counter({
        name: "circuit_breaker_state_changes_total",
        help: "Total circuit breaker state changes",
        labelNames: ["service", "operation", "from_state", "to_state"],
        registers: [this.registry],
      }),

      apiRequestDuration: new client.Histogram({
        name: "external_api_request_duration_seconds",
        help: "External API request duration",
        labelNames: ["service", "operation", "status"],
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
        registers: [this.registry],
      }),

      apiRequestsInFlight: new client.Gauge({
        name: "external_api_requests_in_flight",
        help: "External API requests currently in flight",
        labelNames: ["service", "operation"],
        registers: [this.registry],
      }),

      apiRetryAttempts: new client.Counter({
        name: "external_api_retry_attempts_total",
        help: "Total external API retry attempts",
        labelNames: ["service", "operation", "attempt"],
        registers: [this.registry],
      }),

      cacheHits: new client.Counter({
        name: "external_api_cache_hits_total",
        help: "Total cache hits for external API calls",
        labelNames: ["service", "operation"],
        registers: [this.registry],
      }),

      cacheMisses: new client.Counter({
        name: "external_api_cache_misses_total",
        help: "Total cache misses for external API calls",
        labelNames: ["service", "operation"],
        registers: [this.registry],
      }),

      cacheErrors: new client.Counter({
        name: "external_api_cache_errors_total",
        help: "Total cache errors for external API calls",
        labelNames: ["service", "operation"],
        registers: [this.registry],
      }),
    };
  }

  private getOrCreateBreaker<T extends unknown[], R>(
    service: string,
    operation: string,
    apiCall: (...args: T) => Promise<R>,
    options: Partial<ExternalApiOptions> = {}
  ): CircuitBreaker<T, R> {
    const key = `${service}:${operation}`;

    if (this.breakers.has(key)) {
      return this.breakers.get(key) as CircuitBreaker<T, R>;
    }

    const opts = { ...DEFAULT_EXTERNAL_API_OPTIONS, ...options };

    const breaker = new CircuitBreaker<T, R>(apiCall, {
      timeout: opts.timeout,
      errorThresholdPercentage: opts.errorThresholdPercentage,
      resetTimeout: opts.resetTimeout,
      rollingCountTimeout: opts.monitoringPeriod,
      rollingCountBuckets: opts.halfOpenRetries,
      name: key,
    });

    // Add event listeners for monitoring
    breaker.on("open", () => {
      logger.warn({ service, operation }, "Circuit breaker OPENED");
      this.metrics.circuitBreakerStateChanges.inc({
        service,
        operation,
        from_state: "closed",
        to_state: "open",
      });
    });

    breaker.on("halfOpen", () => {
      logger.info({ service, operation }, "Circuit breaker HALF-OPEN");
      this.metrics.circuitBreakerStateChanges.inc({
        service,
        operation,
        from_state: "open",
        to_state: "half-open",
      });
    });

    breaker.on("close", () => {
      logger.info({ service, operation }, "Circuit breaker CLOSED");
      this.metrics.circuitBreakerStateChanges.inc({
        service,
        operation,
        from_state: "half-open",
        to_state: "closed",
      });
    });

    breaker.on("success", () => {
      this.metrics.circuitBreakerSuccesses.inc({ service, operation });
    });

    breaker.on("failure", () => {
      this.metrics.circuitBreakerFailures.inc({ service, operation, reason: "api_error" });
    });

    breaker.on("timeout", () => {
      this.metrics.circuitBreakerTimeouts.inc({ service, operation });
      this.metrics.circuitBreakerFailures.inc({ service, operation, reason: "timeout" });
    });

    breaker.on("reject", () => {
      this.metrics.circuitBreakerFailures.inc({ service, operation, reason: "circuit_open" });
    });

    breaker.on("fallback", () => {
      this.metrics.circuitBreakerFallbacks.inc({ service, operation });
    });

    this.breakers.set(key, breaker);
    return breaker;
  }

  private generateCacheKey(service: string, operation: string, args: unknown[]): string {
    const argsHash = JSON.stringify(args);
    return `${service}:${operation}:${Buffer.from(argsHash).toString("base64")}`;
  }

  private async getFromCache(
    cacheKey: string,
    service: string,
    operation: string
  ): Promise<unknown | null> {
    try {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        this.metrics.cacheHits.inc({ service, operation });
        return cached.data;
      }

      if (cached) {
        this.cache.delete(cacheKey); // Remove expired entry
      }

      this.metrics.cacheMisses.inc({ service, operation });
      return null;
    } catch (error) {
      this.metrics.cacheErrors.inc({ service, operation });
      logger.warn({ err: error, cacheKey }, "Cache get error");
      return null;
    }
  }

  private async setCache(
    cacheKey: string,
    data: unknown,
    ttl: number,
    service: string,
    operation: string
  ): Promise<void> {
    try {
      this.cache.set(cacheKey, {
        data,
        expires: Date.now() + ttl,
      });
    } catch (error) {
      this.metrics.cacheErrors.inc({ service, operation });
      logger.warn({ err: error, cacheKey }, "Cache set error");
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private calculateRetryDelay(
    attempt: number,
    baseDelay: number,
    maxDelay: number,
    multiplier: number,
    jitter: boolean
  ): number {
    const exponentialDelay = Math.min(baseDelay * Math.pow(multiplier, attempt), maxDelay);

    if (!jitter) {
      return exponentialDelay;
    }

    // Add jitter (±25% of the delay)
    const jitterAmount = exponentialDelay * 0.25;
    const randomJitter = (Math.random() - 0.5) * 2 * jitterAmount;
    return Math.max(0, exponentialDelay + randomJitter);
  }

  async call<T extends unknown[], R>(
    service: string,
    operation: string,
    apiCall: (...args: T) => Promise<R>,
    args: T,
    options: Partial<ExternalApiOptions> & {
      cacheEnabled?: boolean;
      fallback?: (...args: T) => Promise<R>;
    } = {}
  ): Promise<R> {
    const opts = { ...DEFAULT_EXTERNAL_API_OPTIONS, ...options };
    const startTime = Date.now();

    // Check cache first if enabled
    let cacheKey: string | null = null;
    if (options.cacheEnabled && opts.cacheTtl) {
      cacheKey = this.generateCacheKey(service, operation, args);
      const cached = await this.getFromCache(cacheKey, service, operation);
      if (cached) {
        return cached as R;
      }
    }

    // Track in-flight requests
    this.metrics.apiRequestsInFlight.inc({ service, operation });
    this.metrics.circuitBreakerRequests.inc({ service, operation, state: "attempt" });

    try {
      // Get or create circuit breaker
      const breaker = this.getOrCreateBreaker(service, operation, apiCall, opts);

      // Add fallback if provided
      if (options.fallback) {
        breaker.fallback(options.fallback);
      }

      let lastError: Error = new Error("Unknown error");
      let attempt = 0;

      while (attempt <= opts.maxRetries) {
        try {
          // Record retry attempts (skip for first attempt)
          if (attempt > 0) {
            this.metrics.apiRetryAttempts.inc({ service, operation, attempt: attempt.toString() });

            // Calculate delay with exponential backoff and jitter
            const delay = this.calculateRetryDelay(
              attempt - 1,
              opts.baseDelay,
              opts.maxDelay,
              opts.backoffMultiplier,
              opts.jitterEnabled
            );

            logger.info(
              {
                service,
                operation,
                attempt: attempt + 1,
                maxAttempts: opts.maxRetries + 1,
                delayMs: Math.round(delay),
              },
              "Retrying external API call"
            );
            await this.sleep(delay);
          }

          // Make the API call through circuit breaker
          const result = await breaker.fire(...args);

          // Cache successful result if caching is enabled
          if (cacheKey && opts.cacheTtl) {
            await this.setCache(cacheKey, result, opts.cacheTtl, service, operation);
          }

          // Cache successful response for fallback use
          if (opts.fallbackEnabled) {
            await this.fallbackManager.cacheSuccessfulResponse(
              service,
              operation,
              result,
              opts.cacheTtl || 300000 // 5 minutes default
            );
          }

          // Record success metrics
          const duration = (Date.now() - startTime) / 1000;
          this.metrics.apiRequestDuration.observe(
            { service, operation, status: "success" },
            duration
          );

          return result;
        } catch (error) {
          lastError = error as Error;
          attempt++;

          // Check if this is a retryable error
          const isRetryable = this.isRetryableError(error);
          const isCircuitOpen =
            error instanceof Error && error.message?.includes("Circuit breaker is OPEN");

          if (!isRetryable || isCircuitOpen || attempt > opts.maxRetries) {
            break;
          }

          logger.warn(
            { err: error, service, operation, attempt, maxAttempts: opts.maxRetries + 1 },
            "Retryable error on external API call"
          );
        }
      }

      // All retries exhausted, try fallback strategies before failing
      const duration = (Date.now() - startTime) / 1000;

      // Try fallback strategies if enabled
      if (opts.fallbackEnabled && opts.fallbackConfig) {
        logger.warn({ service, operation }, "Attempting fallback strategy after retry exhaustion");

        try {
          const fallbackContext: FallbackContext = {
            service,
            operation,
            originalError: lastError,
            attempt: attempt,
          };

          const fallbackResult = await this.fallbackManager.executeFallback<R>(
            opts.fallbackConfig,
            fallbackContext
          );

          if (fallbackResult.ok) {
            // Record fallback success
            this.metrics.circuitBreakerFallbacks.inc({ service, operation });
            this.metrics.apiRequestDuration.observe(
              { service, operation, status: "fallback" },
              duration
            );

            logger.info({ service, operation }, "Fallback succeeded");
            return fallbackResult.value;
          }
        } catch (fallbackError) {
          logger.warn({ err: fallbackError, service, operation }, "Fallback failed");
        }
      }

      // Try dead letter queue if enabled before final failure
      if (opts.deadLetterEnabled) {
        try {
          const deadLetterQueue = getDeadLetterQueue();
          if (deadLetterQueue) {
            logger.warn({ service, operation }, "Adding to dead letter queue");

            const result = await deadLetterQueue.addFailedOperation(
              service,
              operation,
              args,
              lastError,
              {
                retryCount: attempt,
                firstAttempt: new Date(startTime),
                fallbackAttempted: !!opts.fallbackEnabled,
                ...(opts.fallbackEnabled && lastError ? { fallbackError: lastError } : {}),
                metadata: {
                  priority: opts.deadLetterPriority || "normal",
                  source: "circuit-breaker",
                },
              }
            );

            if (result.ok) {
              logger.info(
                { service, operation, jobId: result.value },
                "Operation queued for later retry"
              );
            } else {
              logger.error(
                { service, operation },
                "Failed to queue operation for dead letter processing"
              );
            }
          }
        } catch (deadLetterError) {
          logger.error({ err: deadLetterError, service, operation }, "Dead letter queue error");
          // Don't fail the original operation because of dead letter queue issues
        }
      }

      // Record failure metrics
      this.metrics.apiRequestDuration.observe({ service, operation, status: "failure" }, duration);

      throw lastError;
    } finally {
      this.metrics.apiRequestsInFlight.dec({ service, operation });
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (!error) return false;

    const errorObj = error as Record<string, unknown>;
    const errorMessage = (errorObj.message as string) || "";
    const errorCode = (errorObj.code as number) || (errorObj.status as number) || 0;

    // Network errors
    if (
      errorMessage.includes("ENOTFOUND") ||
      errorMessage.includes("ECONNRESET") ||
      errorMessage.includes("ETIMEDOUT") ||
      errorMessage.includes("ECONNREFUSED")
    ) {
      return true;
    }

    // HTTP status codes that are retryable
    if (typeof errorCode === "number") {
      // 5xx server errors (except 501 Not Implemented)
      if (errorCode >= 500 && errorCode <= 599 && errorCode !== 501) {
        return true;
      }

      // 429 Too Many Requests
      if (errorCode === 429) {
        return true;
      }

      // 408 Request Timeout
      if (errorCode === 408) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get circuit breaker status for a specific service/operation
   */
  getStatus(service: string, operation: string): CircuitBreakerStatus | null {
    const key = `${service}:${operation}`;
    const breaker = this.breakers.get(key);

    if (!breaker) {
      return null;
    }

    return {
      state: breaker.opened ? "OPEN" : breaker.halfOpen ? "HALF_OPEN" : "CLOSED",
      failures: breaker.stats.failures,
      successes: breaker.stats.successes,
      ...(breaker.opened && {
        nextAttempt:
          Date.now() +
          ("options" in breaker &&
          breaker.options &&
          typeof breaker.options === "object" &&
          "resetTimeout" in breaker.options
            ? Number(breaker.options.resetTimeout)
            : 30000),
      }),
    };
  }

  /**
   * Get all circuit breaker statuses
   */
  getAllStatuses(): Record<string, CircuitBreakerStatus | null> {
    const statuses: Record<string, CircuitBreakerStatus | null> = {};

    for (const [key, _breaker] of this.breakers) {
      const [service, operation] = key.split(":");
      if (service && operation) {
        statuses[key] = this.getStatus(service, operation);
      }
    }

    return statuses;
  }

  /**
   * Manually open a circuit breaker
   */
  forceOpen(service: string, operation: string): boolean {
    const key = `${service}:${operation}`;
    const breaker = this.breakers.get(key);

    if (breaker) {
      breaker.open();
      return true;
    }

    return false;
  }

  /**
   * Manually close a circuit breaker
   */
  forceClose(service: string, operation: string): boolean {
    const key = `${service}:${operation}`;
    const breaker = this.breakers.get(key);

    if (breaker) {
      breaker.close();
      return true;
    }

    return false;
  }

  /**
   * Clear cache for a specific service/operation or all cache
   */
  clearCache(service?: string, operation?: string): void {
    if (service && operation) {
      const prefix = `${service}:${operation}:`;
      for (const [key] of this.cache) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: Array<{ key: string; expires: number }> } {
    const entries = Array.from(this.cache.entries()).map(([key, value]) => ({
      key,
      expires: value.expires,
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }
}
