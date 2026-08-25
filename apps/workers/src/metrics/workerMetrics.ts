/**
 * @file workerMetrics.ts
 * @description Prometheus metrics collector for publish workers — counters, histograms, and gauges
 *              covering publishing, threading, job processing, and system health.
 * @layer infrastructure
 */
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

  // Tenant-scope provenance for publish jobs
  publishJobAccountIdSource: client.Counter<string>;

  // Job processing metrics
  jobsActive: client.Gauge<string>;
  jobsCompleted: client.Counter<string>;
  jobsFailed: client.Counter<string>;
  jobsSkipped: client.Counter<string>;
  jobProcessingDuration: client.Histogram<string>;

  // System metrics
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

      // Where each publish job's tenant scope came from. `payload` is the
      // steady state; `fallback` counts jobs that had to resolve the channel's
      // owner because they were enqueued before the payload carried the field.
      // The deploy-compat fallback can only be removed once this counter shows
      // no `fallback` increments — without it, "remove when no pre-deploy jobs
      // remain" is unverifiable and the fallback lives forever.
      publishJobAccountIdSource: new client.Counter({
        name: "worker_publish_job_account_id_source_total",
        help: "Publish jobs by the origin of their tenant scope (payload vs deploy-compat owner fallback)",
        labelNames: ["source"],
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
  }

  /**
   * @method generateCorrelationId
   * @description Mint a correlation UUID for a dedupe key and track it as in-flight.
   * @param dedupeKey - Job-level dedupe key used as the lookup index.
   * @returns The generated correlation UUID.
   */
  generateCorrelationId(dedupeKey: string): string {
    const correlationId = uuidv4();
    this.correlationIds.set(dedupeKey, correlationId);
    this.metrics.correlationTracker.inc();
    return correlationId;
  }

  /**
   * @method getCorrelationId
   * @description Look up the correlation UUID previously minted for a dedupe key.
   * @param dedupeKey - Job-level dedupe key.
   * @returns The correlation UUID, or undefined when none is registered.
   */
  getCorrelationId(dedupeKey: string): string | undefined {
    return this.correlationIds.get(dedupeKey);
  }

  /**
   * @method removeCorrelationId
   * @description Drop the correlation entry for a dedupe key and decrement the
   *              in-flight gauge.
   * @param dedupeKey - Job-level dedupe key.
   */
  removeCorrelationId(dedupeKey: string): void {
    if (this.correlationIds.delete(dedupeKey)) {
      this.metrics.correlationTracker.dec();
    }
  }

  /**
   * @method recordJobStart
   * @description Increment the active-jobs gauge and start a duration timer.
   * @returns A finalizer that decrements the gauge and stops the timer.
   */
  recordJobStart(): () => void {
    this.metrics.jobsActive.inc();
    const timer = this.metrics.jobProcessingDuration.startTimer();

    return () => {
      this.metrics.jobsActive.dec();
      timer();
    };
  }

  /**
   * @method recordThreadStart
   * @description Increment the in-progress thread gauge and start a thread
   *              duration timer scoped to a provider.
   * @param provider - Provider label for the thread metric.
   * @returns A finalizer that decrements the gauge and stops the timer.
   */
  recordThreadStart(provider: string): () => void {
    this.metrics.threadsInProgress.inc({ provider });
    const timer = this.metrics.threadDuration.startTimer();

    return () => {
      this.metrics.threadsInProgress.dec({ provider });
      timer();
    };
  }

  /**
   * @method recordError
   * @description Increment the errors-by-type counter with component, type, and
   *              recoverability labels.
   * @param component - Component reporting the error (e.g. "publisher", "renderer").
   * @param errorType - Short error classification label.
   * @param isRecoverable - True when the worker can retry the operation.
   */
  recordError(component: string, errorType: string, isRecoverable: boolean): void {
    this.metrics.errorsByType.inc({
      component,
      error_type: errorType,
      recoverable: isRecoverable ? "true" : "false",
    });
  }

  /**
   * @method recordRetry
   * @description Increment the retry-attempts counter for a component + reason.
   * @param component - Component performing the retry.
   * @param reason - Short reason label.
   */
  recordRetry(component: string, reason: string): void {
    this.metrics.retryAttempts.inc({ component, retry_reason: reason });
  }

  /**
   * @method recordCircuitBreakerTrip
   * @description Increment the circuit-breaker trip counter for a component.
   * @param component - Component owning the breaker.
   * @param breakerName - Identifier of the tripped breaker.
   */
  recordCircuitBreakerTrip(component: string, breakerName: string): void {
    this.metrics.circuitBreakerTrips.inc({ component, breaker_name: breakerName });
  }

  /**
   * @method getTweetCountRange
   * @description Bucket a tweet count into a histogram-friendly range label.
   * @param count - Number of tweets in the thread.
   * @returns A range label such as "1-2", "3-5", "6-10", "11-20", or "20+".
   */
  getTweetCountRange(count: number): string {
    if (count <= 2) return "1-2";
    if (count <= 5) return "3-5";
    if (count <= 10) return "6-10";
    if (count <= 20) return "11-20";
    return "20+";
  }

  /**
   * @method recordPostPublished
   * @description Increment the SLO counter for posts successfully published.
   */
  recordPostPublished(): void {
    this.metrics.postsPublishedTotal.inc();
  }

  /**
   * @method recordPostPublishFailed
   * @description Increment the SLO counter for failed publish attempts.
   */
  recordPostPublishFailed(): void {
    this.metrics.postsPublishFailedTotal.inc();
  }

  /**
   * @method recordProviderPublishSuccess
   * @description Increment the per-provider success counter.
   * @param provider - Provider label.
   */
  recordProviderPublishSuccess(provider: string): void {
    this.metrics.providerPublishSuccessTotal.inc({ provider });
  }

  /**
   * @method recordProviderPublishFailure
   * @description Increment the per-provider failure counter.
   * @param provider - Provider label.
   */
  recordProviderPublishFailure(provider: string): void {
    this.metrics.providerPublishFailureTotal.inc({ provider });
  }

  /**
   * @method getRegistry
   * @description Expose the prom-client registry for the metrics HTTP endpoint.
   * @returns The underlying prom-client Registry.
   */
  getRegistry(): client.Registry {
    return this.registry;
  }
}
