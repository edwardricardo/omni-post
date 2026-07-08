/**
 * @file circuitBreaker.ts
 * @description External API circuit breaker wrapping opossum with fallback strategies, dead
 *              letter queue integration, and Prometheus metric emission.
 * @layer infrastructure
 */
import { createHash } from "node:crypto";
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

/**
 * Maximum number of L1 cache entries retained by the in-process circuit-breaker
 * cache before least-recently-used eviction kicks in. Internal memory-safety
 * bound, not an ops knob: entries are small/medium JSON payloads under a
 * self-expiring TTL, so this caps the worst-case burst of distinct
 * (operation, tenant) keys. Deliberately a `const` rather than an env var —
 * promote to configuration via an ADR only if real multi-thousand-tenant scale
 * demands tuning.
 */
export const CACHE_MAX_ENTRIES = 5000;

/**
 * Maximum number of per-(operation, tenant) opossum breaker instances retained
 * before least-recently-used eviction. Lower than {@link CACHE_MAX_ENTRIES}
 * because a breaker (event emitter + rolling-stats window) is heavier than a
 * cache entry. An actively-failing tenant is continuously touched and stays
 * resident via LRU recency; only idle tenants are evicted, and a re-created
 * breaker starts CLOSED. Same rationale as above for keeping it a `const`.
 */
export const BREAKERS_MAX_ENTRIES = 2000;

/**
 * @interface CircuitBreakerLimits
 * @description Optional overrides for the in-process growth bounds. Both fields
 *              default to the module `CACHE_MAX_ENTRIES` / `BREAKERS_MAX_ENTRIES`
 *              consts; overriding them exists so the LRU behaviour can be
 *              exercised deterministically in tests without allocating thousands
 *              of instances. These are memory-safety bounds, not ops knobs.
 */
export interface CircuitBreakerLimits {
  maxCacheEntries?: number;
  maxBreakerEntries?: number;
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

/**
 * @function isPresentDiscriminant
 * @description Boundary guard (S-2 hardening): a tenant/credential discriminant
 *   counts as PRESENT only when it is a non-empty, non-whitespace string. An
 *   `undefined`, `""`, or `"   "` value is treated as ABSENT everywhere the
 *   discriminant is keyed (L1 cache decision, breaker STATE key, L2 fallback
 *   read/write), so a degenerate blank value can never collapse the key back to a
 *   shared `service:operation:` and reopen the cross-tenant sharing the fail-safe
 *   default closes.
 * @param discriminant - The candidate discriminant.
 * @returns `true` when the discriminant is a usable non-blank string.
 */
export function isPresentDiscriminant(discriminant: string | undefined): discriminant is string {
  return typeof discriminant === "string" && discriminant.trim().length > 0;
}

/**
 * @typedef BreakerApiCall
 * @description A caller's wrapped API call. Under the generic-dispatcher design
 *   (D8) every breaker instance shares ONE action; the caller's own function is
 *   passed per-invocation to `breaker.fire(fn, ...args)` and run by that shared
 *   action. It is typed with `unknown[]` args / `Promise<unknown>` return because
 *   a single stored breaker serves callers of every shape; the concrete generics
 *   are recovered at the `call()` boundary.
 */
type BreakerApiCall = (...args: unknown[]) => Promise<unknown>;

/**
 * @typedef BreakerDispatchArgs
 * @description The argument tuple the generic dispatcher — and therefore
 *   `breaker.fire` — receives: the caller's own function first, then that call's
 *   arguments. Making the caller's function a `fire` ARGUMENT instead of the
 *   breaker's bound action is what closes the bound-closure cross-tenant
 *   disclosure vector: a process-shared breaker no longer runs the FIRST caller's
 *   closure for every later caller.
 */
type BreakerDispatchArgs = [apiCall: BreakerApiCall, ...callArgs: unknown[]];

/**
 * @typedef StoredBreaker
 * @description A breaker as held in the `breakers` Map. Every instance wraps the
 *   same generic dispatcher, so its argument tuple is always
 *   {@link BreakerDispatchArgs} and its return type is erased to `unknown`
 *   (recovered by the `call()` caller through a single boundary cast).
 */
type StoredBreaker = CircuitBreaker<BreakerDispatchArgs, unknown>;

export class ExternalApiCircuitBreaker {
  private breakers = new Map<string, StoredBreaker>();
  private cache = new Map<string, { data: unknown; expires: number }>();
  private metrics: ApiCallMetrics;
  private registry: client.Registry;
  private fallbackManager: FallbackManager;
  private readonly maxCacheEntries: number;
  private readonly maxBreakerEntries: number;

  constructor(registry: client.Registry, redisUrl?: string, limits: CircuitBreakerLimits = {}) {
    this.registry = registry;
    this.metrics = this.createMetrics();
    this.fallbackManager = createFallbackManager(redisUrl || process.env.REDIS_URL);
    this.maxCacheEntries = limits.maxCacheEntries ?? CACHE_MAX_ENTRIES;
    this.maxBreakerEntries = limits.maxBreakerEntries ?? BREAKERS_MAX_ENTRIES;

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

  /**
   * @method breakerKey
   * @description Builds the `breakers` Map key. A tenant/credential discriminant,
   *   when present, partitions circuit STATE so one tenant's failures never open
   *   another tenant's circuit for the same operation. Discriminant-less calls
   *   keep the legacy `service:operation` key (shared STATE) — used by the
   *   process-wide, non-tenant-scoped write operations.
   * @param service - Provider/service name.
   * @param operation - Operation name.
   * @param discriminant - Opaque per-tenant scope; omit for shared STATE.
   * @returns The partitioned or legacy breaker key.
   */
  private breakerKey(service: string, operation: string, discriminant?: string): string {
    return discriminant !== undefined
      ? `${service}:${operation}:${discriminant}`
      : `${service}:${operation}`;
  }

  /**
   * @method dispatch
   * @description The single generic action shared by EVERY breaker instance
   *   (D8, Fix B). Opossum invokes a breaker's action with the arguments passed
   *   to `breaker.fire(...)`; here those arguments are the caller's own function
   *   followed by that call's arguments, so the dispatcher simply runs the
   *   caller's closure. Because the action is caller-independent, a
   *   process-shared breaker (same `service:operation[:discriminant]` key) always
   *   executes the CURRENT caller's closure — never the first caller's — which
   *   structurally closes the cross-tenant bound-closure disclosure vector for
   *   every call, discriminant-carrying or not.
   * @param apiCall - The caller's wrapped API call, supplied per `fire`.
   * @param callArgs - The arguments to invoke `apiCall` with.
   * @returns The caller's own promise.
   */
  private static readonly dispatch = (
    apiCall: BreakerApiCall,
    ...callArgs: unknown[]
  ): Promise<unknown> => apiCall(...callArgs);

  private getOrCreateBreaker(
    service: string,
    operation: string,
    options: Partial<ExternalApiOptions> = {},
    discriminant?: string
  ): StoredBreaker {
    const key = this.breakerKey(service, operation, discriminant);

    const existing = this.breakers.get(key);
    if (existing) {
      // Refresh LRU recency so an actively-used (e.g. continuously failing)
      // tenant's breaker is never evicted ahead of idle tenants.
      this.breakers.delete(key);
      this.breakers.set(key, existing);
      return existing;
    }

    const opts = { ...DEFAULT_EXTERNAL_API_OPTIONS, ...options };

    // Wrap the GENERIC dispatcher (D8), never a caller's closure: this breaker
    // runs whatever function each `call()` passes to `fire`, so a shared key
    // never binds — and re-runs — the first caller's closure for another tenant.
    const breaker = new CircuitBreaker<BreakerDispatchArgs, unknown>(
      ExternalApiCircuitBreaker.dispatch,
      {
        timeout: opts.timeout,
        errorThresholdPercentage: opts.errorThresholdPercentage,
        resetTimeout: opts.resetTimeout,
        rollingCountTimeout: opts.monitoringPeriod,
        rollingCountBuckets: opts.halfOpenRetries,
        name: key,
      }
    );

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
    this.evictBreakersIfNeeded();
    return breaker;
  }

  /**
   * @method evictBreakersIfNeeded
   * @description Bounds the `breakers` Map with insertion-ordered LRU eviction.
   *   Timer-free by design (Fitness #11 forbids raw `setInterval` in packages):
   *   the least-recently-used breaker is the first key of the insertion-ordered
   *   Map. Evicted breakers are `shutdown()` so their opossum rolling-stats
   *   timers are cleared and no handle leaks.
   */
  private evictBreakersIfNeeded(): void {
    while (this.breakers.size > this.maxBreakerEntries) {
      const oldestKey = this.breakers.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const evicted = this.breakers.get(oldestKey);
      this.breakers.delete(oldestKey);
      evicted?.shutdown();
    }
  }

  /**
   * @method generateCacheKey
   * @description Builds the L1 cache key from a caller-supplied opaque
   *   discriminant. Keeping the `service:operation:` prefix preserves
   *   `clearCache` prefix-purge and `getCacheStats` enumeration. The raw
   *   credential is never the key input — the discriminant is a hash folded by
   *   `hashCallScope` at the call site.
   * @param service - Provider/service name.
   * @param operation - Operation name.
   * @param discriminant - Opaque per-tenant/credential scope.
   * @returns The tenant-scoped cache key.
   */
  private generateCacheKey(service: string, operation: string, discriminant: string): string {
    return `${service}:${operation}:${discriminant}`;
  }

  /**
   * @method evictCacheIfNeeded
   * @description Bounds the L1 `cache` Map with insertion-ordered LRU eviction.
   *   Timer-free; the least-recently-used entry is the first key of the
   *   insertion-ordered Map (recency is refreshed on both read-hit and write).
   */
  private evictCacheIfNeeded(): void {
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.cache.delete(oldestKey);
    }
  }

  private async getFromCache(
    cacheKey: string,
    service: string,
    operation: string
  ): Promise<unknown | null> {
    try {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        // Refresh LRU recency on read so a hot entry outlives idle ones.
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, cached);
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
      // Delete-then-set moves the entry to the most-recent position so LRU
      // eviction targets genuinely idle keys.
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, {
        data,
        expires: Date.now() + ttl,
      });
      this.evictCacheIfNeeded();
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
      /**
       * Opaque per-tenant/credential scope (typically `hashCallScope(creds)`).
       * PRESENT ⇒ folded into the cache AND breaker keys, so a cached payload
       * and circuit STATE are tenant-scoped. ABSENT ⇒ L1 caching is SKIPPED
       * (fail-safe default): the read is a miss and nothing shared is stored.
       *
       * Since D8 (the generic dispatcher), the discriminant no longer gates
       * cross-tenant DISCLOSURE — the breaker always runs the caller's OWN
       * closure regardless of key, so a missing discriminant degrades only to
       * shared cache-skip + shared circuit STATE (an availability/noisy-neighbor
       * concern), never to running another tenant's closure. The discriminant is
       * retained purely to SCOPE the L1 cache key, the L2 fallback key, and the
       * per-tenant STATE partition.
       */
      cacheKeyDiscriminant?: string;
      fallback?: (...args: T) => Promise<R>;
    } = {}
  ): Promise<R> {
    const opts = { ...DEFAULT_EXTERNAL_API_OPTIONS, ...options };
    const startTime = Date.now();

    // Normalise the discriminant ONCE at the boundary (S-2): an empty or
    // whitespace-only value is treated as absent so a blank string can never key
    // a shared cache/STATE partition. Every downstream use (L1 decision, breaker
    // STATE key, L2 write, L2 read) reads this normalised value, never the raw
    // option, so the fail-safe behaviour is uniform across all three surfaces.
    const discriminant = isPresentDiscriminant(options.cacheKeyDiscriminant)
      ? options.cacheKeyDiscriminant
      : undefined;

    // Check cache first if enabled AND a discriminant is present. Fail-safe
    // default (D1b): a `cacheEnabled` call with no (or a blank) discriminant MUST
    // NOT read or write a shared L1 entry — it is treated as a miss and fetched
    // fresh, so no tenant's payload can be served to another under a constant key.
    let cacheKey: string | null = null;
    if (options.cacheEnabled && opts.cacheTtl && discriminant !== undefined) {
      cacheKey = this.generateCacheKey(service, operation, discriminant);
      const cached = await this.getFromCache(cacheKey, service, operation);
      if (cached) {
        return cached as R;
      }
    }

    // Track in-flight requests
    this.metrics.apiRequestsInFlight.inc({ service, operation });
    this.metrics.circuitBreakerRequests.inc({ service, operation, state: "attempt" });

    try {
      // Get or create circuit breaker (STATE partitioned by the same normalised
      // discriminant — including write ops, which stay cacheEnabled:false but get
      // per-tenant STATE, W-1/D2b). The breaker wraps the generic dispatcher (D8),
      // so THIS call's own closure is what runs below, regardless of which caller
      // created the breaker.
      const breaker = this.getOrCreateBreaker(service, operation, opts, discriminant);

      // Add fallback if provided. The dispatcher prepends the caller's function
      // as fire's first argument, so strip it here and forward only the caller's
      // own args (plus the failure reason opossum appends) to the caller's
      // fallback, preserving the pre-D8 fallback contract.
      if (options.fallback) {
        const callerFallback = options.fallback;
        breaker.fallback(
          (_apiCall: BreakerApiCall, ...rest: unknown[]): Promise<R> =>
            callerFallback(...(rest as T))
        );
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

          // Make the API call through the circuit breaker. Pass THIS call's own
          // closure as fire's first argument so the generic dispatcher (D8) runs
          // it — the breaker never binds another tenant's closure. The
          // caller-shaped generics collapse to the dispatcher's erased tuple, so
          // the function and return type are recovered by a single boundary cast.
          const result = (await breaker.fire(apiCall as unknown as BreakerApiCall, ...args)) as R;

          // Cache successful result if caching is enabled
          if (cacheKey && opts.cacheTtl) {
            await this.setCache(cacheKey, result, opts.cacheTtl, service, operation);
          }

          // Cache successful response for fallback use. Thread the SAME opaque
          // discriminant used for the L1 cache and STATE keys so the L2 fallback
          // store is tenant-scoped too. Fail-safe: with no discriminant the
          // FallbackManager stores nothing (no shared cross-tenant entry).
          if (opts.fallbackEnabled) {
            await this.fallbackManager.cacheSuccessfulResponse(
              service,
              operation,
              result,
              opts.cacheTtl || 300000, // 5 minutes default
              discriminant
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
            // Scope the L2 fallback read by the same normalised discriminant as
            // the write, so a discriminant-carrying call reads only its own
            // tenant's entry and a blank/absent discriminant is a fail-safe miss
            // (never a shared-key read).
            ...(discriminant !== undefined && {
              discriminant,
            }),
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
   * @method breakerStatus
   * @description Builds a public status snapshot from an opossum breaker. Shared
   *   by `getStatus` and `getAllStatuses` so a STATE-partitioned breaker (keyed
   *   `service:operation:<discriminant>`) reports correctly under its own key
   *   instead of resolving to null via a legacy two-segment lookup.
   * @param breaker - The opossum breaker to snapshot.
   * @returns The public status.
   */
  private breakerStatus(breaker: StoredBreaker): CircuitBreakerStatus {
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
   * @method matchingBreakers
   * @description Returns every breaker whose key addresses `service:operation` —
   *   the exact legacy (shared-STATE) key AND every per-tenant partition
   *   `service:operation:<discriminant>`. The trailing colon on the partition
   *   prefix prevents a sibling op (`get-post`) from matching a longer name
   *   (`get-post-comments`). This is the W-2 partition-aware address resolution
   *   shared by `getStatus`, `forceOpen`, and `forceClose` so an admin control
   *   addressed by the generic operation reaches the partitioned breakers instead
   *   of silently no-op'ing.
   * @param service - Provider/service name.
   * @param operation - Operation name.
   * @returns The breakers addressed by that service/operation, across all partitions.
   */
  private matchingBreakers(service: string, operation: string): StoredBreaker[] {
    const exact = `${service}:${operation}`;
    const partitionPrefix = `${exact}:`;
    const matches: StoredBreaker[] = [];
    for (const [key, breaker] of this.breakers) {
      if (key === exact || key.startsWith(partitionPrefix)) {
        matches.push(breaker);
      }
    }
    return matches;
  }

  /**
   * Get circuit breaker status for a specific service/operation, aggregated
   * across ALL partitions (W-2). Returns the worst-of state (OPEN ≻ HALF_OPEN ≻
   * CLOSED) with failure/success counters summed across the exact
   * `service:operation` breaker and every `service:operation:<discriminant>`
   * partition, so an operator polling the generic operation sees "is ANY tenant's
   * circuit for this op open?" instead of null. `null` only when no partition
   * exists yet. Per-partition detail remains available via `getAllStatuses`.
   */
  getStatus(service: string, operation: string): CircuitBreakerStatus | null {
    const matches = this.matchingBreakers(service, operation);
    if (matches.length === 0) {
      return null;
    }

    const rank = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 } as const;
    let worst: CircuitBreakerStatus | null = null;
    let failures = 0;
    let successes = 0;
    for (const breaker of matches) {
      const snapshot = this.breakerStatus(breaker);
      failures += snapshot.failures;
      successes += snapshot.successes;
      if (worst === null || rank[snapshot.state] > rank[worst.state]) {
        worst = snapshot;
      }
    }

    if (worst === null) {
      return null;
    }

    return {
      state: worst.state,
      failures,
      successes,
      ...(worst.nextAttempt !== undefined && { nextAttempt: worst.nextAttempt }),
    };
  }

  /**
   * Get all circuit breaker statuses (each under its actual, possibly
   * tenant-partitioned, key).
   */
  getAllStatuses(): Record<string, CircuitBreakerStatus | null> {
    const statuses: Record<string, CircuitBreakerStatus | null> = {};

    for (const [key, breaker] of this.breakers) {
      statuses[key] = this.breakerStatus(breaker);
    }

    return statuses;
  }

  /**
   * Manually open a circuit breaker across ALL partitions addressed by
   * `service:operation` (W-2): the exact legacy key and every per-tenant
   * `service:operation:<discriminant>` partition. Returns `true` when at least
   * one breaker matched (so a control addressed by the generic operation is not
   * a silent no-op against partitioned breakers).
   */
  forceOpen(service: string, operation: string): boolean {
    const matches = this.matchingBreakers(service, operation);
    for (const breaker of matches) {
      breaker.open();
    }
    return matches.length > 0;
  }

  /**
   * Manually close a circuit breaker across ALL partitions addressed by
   * `service:operation` (W-2). Mirrors {@link forceOpen}: applies to the exact
   * key and every per-tenant partition; returns `true` when at least one matched.
   */
  forceClose(service: string, operation: string): boolean {
    const matches = this.matchingBreakers(service, operation);
    for (const breaker of matches) {
      breaker.close();
    }
    return matches.length > 0;
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

/**
 * @function hashCallScope
 * @description Folds a caller's credential and any public request parameters into
 *   a short, opaque, deterministic discriminant for the circuit-breaker cache and
 *   STATE keys. The raw credential is NEVER used directly as a key — it is hashed
 *   through SHA-256 so enumerable keys (`getCacheStats`) can never expose a
 *   secret. Call sites compute this from `this.credentials` (plus any public
 *   resource id) and pass it as `cacheKeyDiscriminant`.
 * @param credential - The caller's credential (opaque; hashed, never stored raw).
 * @param publicParams - Additional public, non-secret parameters (e.g. a public
 *   resource id) that must also scope the key so distinct resources never collide.
 * @returns A 16-character hex discriminant, stable for identical inputs.
 */
export function hashCallScope(credential: unknown, ...publicParams: unknown[]): string {
  const material = JSON.stringify([credential, ...publicParams]);
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}
