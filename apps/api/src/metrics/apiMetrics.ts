import * as client from "prom-client";
import { v4 as uuidv4 } from "uuid";

interface ApiMetricsCollector {
  // HTTP request metrics
  httpRequests: client.Counter<string>;
  httpDuration: client.Histogram<string>;
  httpRequestsInFlight: client.Gauge<string>;

  // API endpoint metrics
  endpointRequests: client.Counter<string>;
  endpointDuration: client.Histogram<string>;
  endpointErrors: client.Counter<string>;

  // Database operation metrics
  dbOperations: client.Counter<string>;
  dbDuration: client.Histogram<string>;
  dbConnections: client.Gauge<string>;
  dbErrors: client.Counter<string>;

  // Queue operation metrics
  queueOperations: client.Counter<string>;
  queueDuration: client.Histogram<string>;
  queueDepth: client.Gauge<string>;
  queueErrors: client.Counter<string>;

  // Storage operation metrics
  storageOperations: client.Counter<string>;
  storageDuration: client.Histogram<string>;
  storageErrors: client.Counter<string>;

  // Business logic metrics
  postsCreated: client.Counter<string>;
  postsPublished: client.Counter<string>;
  mediaUploads: client.Counter<string>;
  threadsCreated: client.Counter<string>;
  tweetsCreated: client.Counter<string>;

  // Rate limiting metrics
  rateLimitHits: client.Counter<string>;
  rateLimitBlocks: client.Counter<string>;
  rateLimitBypass: client.Counter<string>;
  rateLimitRequests: client.Counter<string>;
  rateLimitBlocked: client.Counter<string>;
  rateLimitErrors: client.Counter<string>;

  // Security validation metrics
  inputValidationDuration: client.Histogram<string>;
  inputValidationErrors: client.Counter<string>;
  securityThreats: client.Counter<string>;

  // Health and system metrics
  apiHealth: client.Gauge<string>;
  activeConnections: client.Gauge<string>;
  memoryUsage: client.Gauge<string>;
  responseSize: client.Histogram<string>;

  // Error classification
  errorsByType: client.Counter<string>;
  errorsByEndpoint: client.Counter<string>;
  validationErrors: client.Counter<string>;

  // Performance metrics
  renderDuration: client.Histogram<string>;
  previewRequests: client.Counter<string>;
  cacheHitRate: client.Gauge<string>;

  // Request correlation tracking
  correlationTracker: client.Gauge<string>;

  // Provider API metrics (P2-6)
  providerApiCalls: client.Counter<string>;
  providerApiDuration: client.Histogram<string>;
  providerApiErrors: client.Counter<string>;
  providerHealthStatus: client.Gauge<string>;

  // Cache metrics (P2-6)
  cacheOperations: client.Counter<string>;
  cacheDuration: client.Histogram<string>;
  cacheSize: client.Gauge<string>;
  cacheEvictions: client.Counter<string>;
}

export class ApiMetrics {
  private registry: client.Registry;
  public metrics: ApiMetricsCollector;
  private correlationIds = new Map<string, string>();

  constructor(registry: client.Registry) {
    this.registry = registry;

    // Clear existing metrics to avoid "already registered" errors
    try {
      registry.clear();
    } catch {
      // Ignore errors if registry is already clear
    }

    this.metrics = {
      // HTTP request metrics
      httpRequests: new client.Counter({
        name: "api_http_requests_total",
        help: "Total HTTP requests received",
        labelNames: ["method", "status_code", "route"],
        registers: [registry],
      }),

      httpDuration: new client.Histogram({
        name: "api_http_request_duration_seconds",
        help: "HTTP request duration in seconds",
        labelNames: ["method", "route", "status_class"],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [registry],
      }),

      httpRequestsInFlight: new client.Gauge({
        name: "api_http_requests_in_flight",
        help: "Current HTTP requests being processed",
        registers: [registry],
      }),

      // API endpoint metrics
      endpointRequests: new client.Counter({
        name: "api_endpoint_requests_total",
        help: "Requests by specific API endpoint",
        labelNames: ["endpoint", "method", "status"],
        registers: [registry],
      }),

      endpointDuration: new client.Histogram({
        name: "api_endpoint_duration_seconds",
        help: "Endpoint processing duration",
        labelNames: ["endpoint", "method"],
        buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
        registers: [registry],
      }),

      endpointErrors: new client.Counter({
        name: "api_endpoint_errors_total",
        help: "Errors by endpoint",
        labelNames: ["endpoint", "error_type", "status_code"],
        registers: [registry],
      }),

      // Database operation metrics
      dbOperations: new client.Counter({
        name: "api_db_operations_total",
        help: "Database operations performed",
        labelNames: ["operation", "table", "result"],
        registers: [registry],
      }),

      dbDuration: new client.Histogram({
        name: "api_db_operation_duration_seconds",
        help: "Database operation duration",
        labelNames: ["operation", "table"],
        buckets: [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
        registers: [registry],
      }),

      dbConnections: new client.Gauge({
        name: "api_db_connections_active",
        help: "Active database connections",
        labelNames: ["pool"],
        registers: [registry],
      }),

      dbErrors: new client.Counter({
        name: "api_db_errors_total",
        help: "Database errors by type",
        labelNames: ["error_type", "operation"],
        registers: [registry],
      }),

      // Queue operation metrics
      queueOperations: new client.Counter({
        name: "api_queue_operations_total",
        help: "Queue operations performed",
        labelNames: ["operation", "queue_name", "result"],
        registers: [registry],
      }),

      queueDuration: new client.Histogram({
        name: "api_queue_operation_duration_seconds",
        help: "Queue operation duration",
        labelNames: ["operation", "queue_name"],
        buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
        registers: [registry],
      }),

      queueDepth: new client.Gauge({
        name: "api_queue_depth",
        help: "Current queue depth by queue",
        labelNames: ["queue_name"],
        registers: [registry],
      }),

      queueErrors: new client.Counter({
        name: "api_queue_errors_total",
        help: "Queue operation errors",
        labelNames: ["error_type", "queue_name"],
        registers: [registry],
      }),

      // Storage operation metrics
      storageOperations: new client.Counter({
        name: "api_storage_operations_total",
        help: "Storage operations performed",
        labelNames: ["operation", "provider", "result"],
        registers: [registry],
      }),

      storageDuration: new client.Histogram({
        name: "api_storage_duration_seconds",
        help: "Storage operation duration",
        labelNames: ["operation", "provider"],
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
        registers: [registry],
      }),

      storageErrors: new client.Counter({
        name: "api_storage_errors_total",
        help: "Storage operation errors",
        labelNames: ["error_type", "operation", "provider"],
        registers: [registry],
      }),

      // Business logic metrics
      postsCreated: new client.Counter({
        name: "api_posts_created_total",
        help: "Posts created via API",
        labelNames: ["project_id", "locale"],
        registers: [registry],
      }),

      postsPublished: new client.Counter({
        name: "api_posts_published_total",
        help: "Posts enqueued for publication",
        labelNames: ["channel_id", "scheduled"],
        registers: [registry],
      }),

      mediaUploads: new client.Counter({
        name: "api_media_uploads_total",
        help: "Media files uploaded",
        labelNames: ["media_type", "status"],
        registers: [registry],
      }),

      threadsCreated: new client.Counter({
        name: "api_threads_created_total",
        help: "Threads created via API",
        labelNames: ["strategy", "post_id"],
        registers: [registry],
      }),

      tweetsCreated: new client.Counter({
        name: "api_tweets_created_total",
        help: "Tweets created in threads",
        labelNames: ["thread_id"],
        registers: [registry],
      }),

      // Rate limiting metrics
      rateLimitHits: new client.Counter({
        name: "api_rate_limit_hits_total",
        help: "Rate limit evaluations",
        labelNames: ["client_ip", "allowed"],
        registers: [registry],
      }),

      rateLimitBlocks: new client.Counter({
        name: "api_rate_limit_blocks_total",
        help: "Requests blocked by rate limiting",
        labelNames: ["client_ip", "endpoint"],
        registers: [registry],
      }),

      rateLimitBypass: new client.Counter({
        name: "api_rate_limit_bypass_total",
        help: "Rate limit bypasses",
        labelNames: ["reason"],
        registers: [registry],
      }),

      rateLimitRequests: new client.Counter({
        name: "api_rate_limit_requests_total",
        help: "Total rate limit evaluations",
        labelNames: ["status", "path"],
        registers: [registry],
      }),

      rateLimitBlocked: new client.Counter({
        name: "api_rate_limit_blocked_total",
        help: "Requests blocked by advanced rate limiting",
        labelNames: ["type", "path"],
        registers: [registry],
      }),

      rateLimitErrors: new client.Counter({
        name: "api_rate_limit_errors_total",
        help: "Rate limiting system errors",
        labelNames: ["error_type"],
        registers: [registry],
      }),

      // Security validation metrics
      inputValidationDuration: new client.Histogram({
        name: "api_input_validation_duration_seconds",
        help: "Time spent on input validation",
        labelNames: ["validation_type"],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1],
        registers: [registry],
      }),

      inputValidationErrors: new client.Counter({
        name: "api_input_validation_errors_total",
        help: "Input validation errors",
        labelNames: ["error_type", "endpoint"],
        registers: [registry],
      }),

      securityThreats: new client.Counter({
        name: "api_security_threats_total",
        help: "Security threats detected",
        labelNames: ["threat_type", "endpoint"],
        registers: [registry],
      }),

      // Health and system metrics
      apiHealth: new client.Gauge({
        name: "api_health_status",
        help: "API health status (1=healthy, 0=unhealthy)",
        registers: [registry],
      }),

      activeConnections: new client.Gauge({
        name: "api_active_connections",
        help: "Currently active connections",
        registers: [registry],
      }),

      memoryUsage: new client.Gauge({
        name: "api_memory_usage_bytes",
        help: "API memory usage in bytes",
        labelNames: ["type"],
        registers: [registry],
      }),

      responseSize: new client.Histogram({
        name: "api_response_size_bytes",
        help: "HTTP response size in bytes",
        labelNames: ["endpoint", "status_class"],
        buckets: [100, 1000, 10000, 100000, 1000000],
        registers: [registry],
      }),

      // Error classification
      errorsByType: new client.Counter({
        name: "api_errors_by_type_total",
        help: "Errors classified by type and source",
        labelNames: ["component", "error_type", "recoverable"],
        registers: [registry],
      }),

      errorsByEndpoint: new client.Counter({
        name: "api_errors_by_endpoint_total",
        help: "Errors by endpoint and status code",
        labelNames: ["endpoint", "status_code", "error_category"],
        registers: [registry],
      }),

      validationErrors: new client.Counter({
        name: "api_validation_errors_total",
        help: "Input validation errors",
        labelNames: ["endpoint", "field", "validation_type"],
        registers: [registry],
      }),

      // Performance metrics
      renderDuration: new client.Histogram({
        name: "api_render_duration_seconds",
        help: "Content rendering duration",
        labelNames: ["provider", "content_type"],
        buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
        registers: [registry],
      }),

      previewRequests: new client.Counter({
        name: "api_preview_requests_total",
        help: "Preview requests by provider and type",
        labelNames: ["provider", "content_type"],
        registers: [registry],
      }),

      cacheHitRate: new client.Gauge({
        name: "api_cache_hit_rate",
        help: "Cache hit rate percentage",
        labelNames: ["cache_type"],
        registers: [registry],
      }),

      // Request correlation tracking
      correlationTracker: new client.Gauge({
        name: "api_correlation_requests_active",
        help: "Number of requests being tracked with correlation IDs",
        registers: [registry],
      }),

      // Provider API metrics (P2-6)
      providerApiCalls: new client.Counter({
        name: "provider_api_calls_total",
        help: "Total API calls to social media providers",
        labelNames: ["provider", "operation", "status"],
        registers: [registry],
      }),

      providerApiDuration: new client.Histogram({
        name: "provider_api_duration_seconds",
        help: "Provider API call duration",
        labelNames: ["provider", "operation"],
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
        registers: [registry],
      }),

      providerApiErrors: new client.Counter({
        name: "provider_api_errors_total",
        help: "Provider API errors by type",
        labelNames: ["provider", "error_type", "operation"],
        registers: [registry],
      }),

      providerHealthStatus: new client.Gauge({
        name: "provider_health_status",
        help: "Provider health status (1=healthy, 0=unhealthy)",
        labelNames: ["provider"],
        registers: [registry],
      }),

      // Cache metrics (P2-6)
      cacheOperations: new client.Counter({
        name: "cache_operations_total",
        help: "Total cache operations",
        labelNames: ["operation", "cache_type", "result"],
        registers: [registry],
      }),

      cacheDuration: new client.Histogram({
        name: "cache_operation_duration_seconds",
        help: "Cache operation duration",
        labelNames: ["operation", "cache_type"],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
        registers: [registry],
      }),

      cacheSize: new client.Gauge({
        name: "cache_size_bytes",
        help: "Current cache size in bytes",
        labelNames: ["cache_type"],
        registers: [registry],
      }),

      cacheEvictions: new client.Counter({
        name: "cache_evictions_total",
        help: "Total cache evictions",
        labelNames: ["cache_type", "reason"],
        registers: [registry],
      }),
    };

    // Set initial healthy state
    this.metrics.apiHealth.set(1);
  }

  // Correlation ID management for request tracking
  generateCorrelationId(requestId: string): string {
    const correlationId = uuidv4();
    this.correlationIds.set(requestId, correlationId);
    this.metrics.correlationTracker.inc();
    return correlationId;
  }

  getCorrelationId(requestId: string): string | undefined {
    return this.correlationIds.get(requestId);
  }

  removeCorrelationId(requestId: string): void {
    if (this.correlationIds.delete(requestId)) {
      this.metrics.correlationTracker.dec();
    }
  }

  // Helper methods for common metric operations
  recordRequest(method: string, route: string): (statusCode: number) => void {
    this.metrics.httpRequestsInFlight.inc();
    const timer = this.metrics.httpDuration.startTimer({ method, route, status_class: "pending" });

    return (statusCode: number) => {
      this.metrics.httpRequestsInFlight.dec();
      const statusClass = Math.floor(statusCode / 100) + "xx";
      timer({ status_class: statusClass });
      this.metrics.httpRequests.inc({ method, status_code: statusCode.toString(), route });
    };
  }

  recordEndpointRequest(endpoint: string, method: string): (status: string) => void {
    const timer = this.metrics.endpointDuration.startTimer({ endpoint, method });

    return (status: string) => {
      timer();
      this.metrics.endpointRequests.inc({ endpoint, method, status });
    };
  }

  recordDbOperation(operation: string, table: string): (result: "success" | "error") => void {
    const timer = this.metrics.dbDuration.startTimer({ operation, table });

    return (result: "success" | "error") => {
      timer();
      this.metrics.dbOperations.inc({ operation, table, result });
    };
  }

  recordQueueOperation(
    operation: string,
    queueName: string
  ): (result: "success" | "error") => void {
    const timer = this.metrics.queueDuration.startTimer({ operation, queue_name: queueName });

    return (result: "success" | "error") => {
      timer();
      this.metrics.queueOperations.inc({ operation, queue_name: queueName, result });
    };
  }

  recordStorageOperation(
    operation: string,
    provider: string
  ): (result: "success" | "error") => void {
    const timer = this.metrics.storageDuration.startTimer({ operation, provider });

    return (result: "success" | "error") => {
      timer();
      this.metrics.storageOperations.inc({ operation, provider, result });
    };
  }

  recordError(component: string, errorType: string, isRecoverable: boolean): void {
    this.metrics.errorsByType.inc({
      component,
      error_type: errorType,
      recoverable: isRecoverable ? "true" : "false",
    });
  }

  recordValidationError(endpoint: string, field: string, validationType: string): void {
    this.metrics.validationErrors.inc({ endpoint, field, validation_type: validationType });
  }

  recordRateLimit(clientIp: string, allowed: boolean, endpoint?: string): void {
    this.metrics.rateLimitHits.inc({ client_ip: clientIp, allowed: allowed ? "true" : "false" });

    if (!allowed && endpoint) {
      this.metrics.rateLimitBlocks.inc({ client_ip: clientIp, endpoint });
    }
  }

  // Health status management
  setHealthy(): void {
    this.metrics.apiHealth.set(1);
  }

  setUnhealthy(): void {
    this.metrics.apiHealth.set(0);
  }

  // System metrics updates
  updateMemoryUsage(): void {
    const memUsage = process.memoryUsage();
    this.metrics.memoryUsage.set({ type: "rss" }, memUsage.rss);
    this.metrics.memoryUsage.set({ type: "heapUsed" }, memUsage.heapUsed);
    this.metrics.memoryUsage.set({ type: "heapTotal" }, memUsage.heapTotal);
    this.metrics.memoryUsage.set({ type: "external" }, memUsage.external);
  }

  // Queue depth monitoring
  updateQueueDepth(queueName: string, depth: number): void {
    this.metrics.queueDepth.set({ queue_name: queueName }, depth);
  }

  // Database connections monitoring
  updateDbConnections(pool: string, count: number): void {
    this.metrics.dbConnections.set({ pool }, count);
  }

  // Active connections monitoring
  updateActiveConnections(count: number): void {
    this.metrics.activeConnections.set(count);
  }

  // Get registry for HTTP endpoint
  getRegistry(): client.Registry {
    return this.registry;
  }

  // Provider API metrics helpers (P2-6)
  recordProviderApiCall(
    provider: string,
    operation: string
  ): (status: "success" | "error") => void {
    const timer = this.metrics.providerApiDuration.startTimer({ provider, operation });

    return (status: "success" | "error") => {
      timer();
      this.metrics.providerApiCalls.inc({ provider, operation, status });
    };
  }

  recordProviderError(provider: string, errorType: string, operation: string): void {
    this.metrics.providerApiErrors.inc({ provider, error_type: errorType, operation });
  }

  updateProviderHealth(provider: string, isHealthy: boolean): void {
    this.metrics.providerHealthStatus.set({ provider }, isHealthy ? 1 : 0);
  }

  // Cache metrics helpers (P2-6)
  recordCacheOperation(
    operation: "get" | "set" | "delete" | "clear",
    cacheType: "memory" | "redis" | "distributed"
  ): (result: "hit" | "miss" | "success" | "error") => void {
    const timer = this.metrics.cacheDuration.startTimer({ operation, cache_type: cacheType });

    return (result: "hit" | "miss" | "success" | "error") => {
      timer();
      this.metrics.cacheOperations.inc({ operation, cache_type: cacheType, result });
    };
  }

  updateCacheSize(cacheType: string, sizeInBytes: number): void {
    this.metrics.cacheSize.set({ cache_type: cacheType }, sizeInBytes);
  }

  recordCacheEviction(cacheType: string, reason: "size" | "ttl" | "manual"): void {
    this.metrics.cacheEvictions.inc({ cache_type: cacheType, reason });
  }
}
