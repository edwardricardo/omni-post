import client from "prom-client";
import { v4 as uuidv4 } from "uuid";

export interface WorkerMetricsCollector {
  // Core publishing metrics
  publishOk: client.Counter<string>;
  publishErr: client.Counter<string>;
  publishDuration: client.Histogram<string>;

  // Threading-specific metrics
  threadCreated: client.Counter<string>;
  threadPublished: client.Counter<string>;
  threadErrors: client.Counter<string>;
  threadsInProgress: client.Gauge<string>;
  threadTweetCount: client.Histogram<string>;
  threadDuration: client.Histogram<string>;

  // Job processing metrics
  jobsActive: client.Gauge<string>;
  jobsCompleted: client.Counter<string>;
  jobsFailed: client.Counter<string>;
  jobsSkipped: client.Counter<string>;
  jobProcessingDuration: client.Histogram<string>;

  // System metrics
  queueDepth: client.Gauge<string>;
  workerHealth: client.Gauge<string>;
  correlationTracker: client.Gauge<string>;

  // Detailed operation metrics
  renderDuration: client.Histogram<string>;
  dbOperationDuration: client.Histogram<string>;
  providerRequestDuration: client.Histogram<string>;

  // Error classification
  errorsByType: client.Counter<string>;
  retryAttempts: client.Counter<string>;
  circuitBreakerTrips: client.Counter<string>;

  // Business SLO metrics (same Prometheus names as apps/api businessMetrics)
  postsPublishedTotal: client.Counter<string>;
  postsPublishFailedTotal: client.Counter<string>;
  providerPublishSuccessTotal: client.Counter<string>;
  providerPublishFailureTotal: client.Counter<string>;
}

export class WorkerMetrics {
  private registry: client.Registry;
  public metrics: WorkerMetricsCollector;
  private correlationIds = new Map<string, string>();

  constructor(registry: client.Registry) {
    this.registry = registry;

    this.metrics = {
      // Core publishing metrics with enhanced labels
      publishOk: new client.Counter({
        name: "worker_publish_success_total",
        help: "Total successful publications by type and provider",
        labelNames: ["provider", "content_type", "channel_id"],
        registers: [registry],
      }),

      publishErr: new client.Counter({
        name: "worker_publish_errors_total",
        help: "Total publication errors by type and error category",
        labelNames: ["provider", "content_type", "error_type", "channel_id"],
        registers: [registry],
      }),

      publishDuration: new client.Histogram({
        name: "worker_publish_duration_seconds",
        help: "Publication duration in seconds by content type",
        labelNames: ["provider", "content_type"],
        buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
        registers: [registry],
      }),

      // Threading-specific metrics
      threadCreated: new client.Counter({
        name: "worker_threads_created_total",
        help: "Total threads created by strategy",
        labelNames: ["strategy", "provider"],
        registers: [registry],
      }),

      threadPublished: new client.Counter({
        name: "worker_threads_published_total",
        help: "Total threads successfully published",
        labelNames: ["strategy", "provider", "tweet_count"],
        registers: [registry],
      }),

      threadErrors: new client.Counter({
        name: "worker_thread_errors_total",
        help: "Thread publication errors by phase",
        labelNames: ["phase", "error_type", "provider"],
        registers: [registry],
      }),

      threadsInProgress: new client.Gauge({
        name: "worker_threads_in_progress",
        help: "Number of threads currently being processed",
        labelNames: ["provider"],
        registers: [registry],
      }),

      threadTweetCount: new client.Histogram({
        name: "worker_thread_tweet_count",
        help: "Distribution of tweet count per thread",
        buckets: [1, 2, 3, 5, 8, 10, 15, 20, 25],
        registers: [registry],
      }),

      threadDuration: new client.Histogram({
        name: "worker_thread_duration_seconds",
        help: "Total duration for thread processing",
        labelNames: ["strategy", "tweet_count_range"],
        buckets: [1, 5, 10, 30, 60, 120, 300],
        registers: [registry],
      }),

      // Job processing metrics
      jobsActive: new client.Gauge({
        name: "worker_jobs_active",
        help: "Number of jobs currently being processed",
        registers: [registry],
      }),

      jobsCompleted: new client.Counter({
        name: "worker_jobs_completed_total",
        help: "Total jobs completed successfully",
        labelNames: ["content_type"],
        registers: [registry],
      }),

      jobsFailed: new client.Counter({
        name: "worker_jobs_failed_total",
        help: "Total jobs that failed",
        labelNames: ["error_category"],
        registers: [registry],
      }),

      jobsSkipped: new client.Counter({
        name: "worker_jobs_skipped_total",
        help: "Total jobs skipped due to idempotency",
        registers: [registry],
      }),

      jobProcessingDuration: new client.Histogram({
        name: "worker_job_processing_duration_seconds",
        help: "Time spent processing each job",
        labelNames: ["content_type"],
        buckets: [0.5, 1, 5, 10, 30, 60, 120],
        registers: [registry],
      }),

      // System metrics
      queueDepth: new client.Gauge({
        name: "worker_queue_depth",
        help: "Number of jobs waiting in queue",
        registers: [registry],
      }),

      workerHealth: new client.Gauge({
        name: "worker_health_status",
        help: "Worker health status (1=healthy, 0=unhealthy)",
        registers: [registry],
      }),

      correlationTracker: new client.Gauge({
        name: "worker_correlation_requests_active",
        help: "Number of requests being tracked with correlation IDs",
        registers: [registry],
      }),

      // Detailed operation metrics
      renderDuration: new client.Histogram({
        name: "worker_render_duration_seconds",
        help: "Time spent rendering posts",
        labelNames: ["provider", "content_type"],
        buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
        registers: [registry],
      }),

      dbOperationDuration: new client.Histogram({
        name: "worker_db_operation_duration_seconds",
        help: "Database operation duration",
        labelNames: ["operation", "result"],
        buckets: [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
        registers: [registry],
      }),

      providerRequestDuration: new client.Histogram({
        name: "worker_provider_request_duration_seconds",
        help: "Provider API request duration",
        labelNames: ["provider", "operation", "status"],
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
        registers: [registry],
      }),

      // Error classification
      errorsByType: new client.Counter({
        name: "worker_errors_by_type_total",
        help: "Errors classified by type and component",
        labelNames: ["component", "error_type", "recoverable"],
        registers: [registry],
      }),

      retryAttempts: new client.Counter({
        name: "worker_retry_attempts_total",
        help: "Retry attempts by component and reason",
        labelNames: ["component", "retry_reason"],
        registers: [registry],
      }),

      circuitBreakerTrips: new client.Counter({
        name: "worker_circuit_breaker_trips_total",
        help: "Circuit breaker activations",
        labelNames: ["component", "breaker_name"],
        registers: [registry],
      }),

      // Business SLO metrics — same Prometheus counter names used by
      // apps/api/src/metrics/businessMetrics.ts so dashboards can aggregate
      // across both processes using a single PromQL query.
      postsPublishedTotal: new client.Counter({
        name: "omnipost_posts_published_total",
        help: "Total number of posts successfully published",
        registers: [registry],
      }),

      postsPublishFailedTotal: new client.Counter({
        name: "omnipost_posts_publish_failed_total",
        help: "Total number of post publish attempts that failed",
        registers: [registry],
      }),

      providerPublishSuccessTotal: new client.Counter({
        name: "omnipost_provider_publish_success_total",
        help: "Total successful publish operations per social media provider",
        labelNames: ["provider"],
        registers: [registry],
      }),

      providerPublishFailureTotal: new client.Counter({
        name: "omnipost_provider_publish_failure_total",
        help: "Total failed publish operations per social media provider",
        labelNames: ["provider"],
        registers: [registry],
      }),
    };

    // Set initial healthy state
    this.metrics.workerHealth.set(1);
  }

  // Correlation ID management for request tracking
  generateCorrelationId(dedupeKey: string): string {
    const correlationId = uuidv4();
    this.correlationIds.set(dedupeKey, correlationId);
    this.metrics.correlationTracker.inc();
    return correlationId;
  }

  getCorrelationId(dedupeKey: string): string | undefined {
    return this.correlationIds.get(dedupeKey);
  }

  removeCorrelationId(dedupeKey: string): void {
    if (this.correlationIds.delete(dedupeKey)) {
      this.metrics.correlationTracker.dec();
    }
  }

  // Helper methods for common metric operations
  recordJobStart(): () => void {
    this.metrics.jobsActive.inc();
    const timer = this.metrics.jobProcessingDuration.startTimer();

    return () => {
      this.metrics.jobsActive.dec();
      timer();
    };
  }

  recordThreadStart(provider: string): () => void {
    this.metrics.threadsInProgress.inc({ provider });
    const timer = this.metrics.threadDuration.startTimer();

    return () => {
      this.metrics.threadsInProgress.dec({ provider });
      timer();
    };
  }

  recordError(component: string, errorType: string, isRecoverable: boolean): void {
    this.metrics.errorsByType.inc({
      component,
      error_type: errorType,
      recoverable: isRecoverable ? "true" : "false",
    });
  }

  recordRetry(component: string, reason: string): void {
    this.metrics.retryAttempts.inc({ component, retry_reason: reason });
  }

  recordCircuitBreakerTrip(component: string, breakerName: string): void {
    this.metrics.circuitBreakerTrips.inc({ component, breaker_name: breakerName });
  }

  // Thread-specific helpers
  getTweetCountRange(count: number): string {
    if (count <= 2) return "1-2";
    if (count <= 5) return "3-5";
    if (count <= 10) return "6-10";
    if (count <= 20) return "11-20";
    return "20+";
  }

  // Business SLO metric helpers
  recordPostPublished(): void {
    this.metrics.postsPublishedTotal.inc();
  }

  recordPostPublishFailed(): void {
    this.metrics.postsPublishFailedTotal.inc();
  }

  recordProviderPublishSuccess(provider: string): void {
    this.metrics.providerPublishSuccessTotal.inc({ provider });
  }

  recordProviderPublishFailure(provider: string): void {
    this.metrics.providerPublishFailureTotal.inc({ provider });
  }

  // Health status management
  setHealthy(): void {
    this.metrics.workerHealth.set(1);
  }

  setUnhealthy(): void {
    this.metrics.workerHealth.set(0);
  }

  // Queue depth monitoring (to be called periodically)
  updateQueueDepth(depth: number): void {
    this.metrics.queueDepth.set(depth);
  }

  // Get registry for HTTP endpoint
  getRegistry(): client.Registry {
    return this.registry;
  }
}
