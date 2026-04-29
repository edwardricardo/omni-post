/**
 * @file customInstrumentation.ts
 * @description Custom OpenTelemetry instrumentation for business logic — wraps publishing,
 *              provider API, and database spans with semantic attributes and counters.
 * @layer infrastructure
 */
import {
  trace,
  SpanKind,
  SpanStatusCode,
  Span,
  Tracer,
  metrics,
  type Attributes,
} from "@opentelemetry/api";
import pino from "pino";

const logger = pino({ name: "custom-instrumentation" });

// Get tracer instance
const getTracer = () => trace.getTracer("social-cms-custom", "1.0.0");

// Get meter for custom metrics
const meter = metrics.getMeter("social-cms-business", "1.0.0");

// Business metrics
const publishingCounter = meter.createCounter("social_publishing_total", {
  description: "Total number of social media posts published",
  unit: "1",
});

const publishingDuration = meter.createHistogram("social_publishing_duration_ms", {
  description: "Duration of social media publishing operations",
  unit: "ms",
});

const engagementCounter = meter.createCounter("social_engagement_total", {
  description: "Total social media engagement events",
  unit: "1",
});

const providerApiCounter = meter.createCounter("social_provider_api_calls_total", {
  description: "Total API calls to social media providers",
  unit: "1",
});

const providerApiDuration = meter.createHistogram("social_provider_api_duration_ms", {
  description: "Duration of social media provider API calls",
  unit: "ms",
});

const queueProcessingDuration = meter.createHistogram("queue_processing_duration_ms", {
  description: "Duration of queue job processing",
  unit: "ms",
});

const userJourneyCounter = meter.createCounter("user_journey_events_total", {
  description: "User journey tracking events",
  unit: "1",
});

/**
 * Instrumentation wrapper for social media publishing operations
 */
export class PublishingInstrumentation {
  private tracer: Tracer;

  constructor() {
    this.tracer = getTracer();
  }

  /**
   * Instrument a publishing operation with comprehensive tracing
   */
  async instrumentPublishing<T>(
    operation: string,
    provider: string,
    channelId: string,
    contentType: "single" | "thread" | "story",
    fn: (span: Span) => Promise<T>,
    metadata?: Attributes
  ): Promise<T> {
    const startTime = Date.now();

    return await this.tracer.startActiveSpan(
      `publishing.${operation}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "social.operation": operation,
          "social.provider": provider,
          "social.channel_id": channelId,
          "social.content_type": contentType,
          "business.domain": "content_publishing",
          ...metadata,
        },
      },
      async (span: Span) => {
        try {
          // Record operation start
          publishingCounter.add(1, {
            provider,
            content_type: contentType,
            operation,
            status: "started",
          });

          const result = await fn(span);

          // Record successful completion
          const duration = Date.now() - startTime;
          publishingDuration.record(duration, {
            provider,
            content_type: contentType,
            operation,
          });

          publishingCounter.add(1, {
            provider,
            content_type: contentType,
            operation,
            status: "completed",
          });

          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            "social.success": true,
            "social.duration_ms": duration,
          });

          logger.info(
            {
              operation,
              provider,
              channelId,
              contentType,
              duration,
              traceId: span.spanContext().traceId,
            },
            "Publishing operation completed successfully"
          );

          return result;
        } catch (error) {
          const duration = Date.now() - startTime;

          publishingCounter.add(1, {
            provider,
            content_type: contentType,
            operation,
            status: "failed",
          });

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });

          span.setAttributes({
            "social.success": false,
            "social.error": error instanceof Error ? error.message : String(error),
            "social.duration_ms": duration,
          });

          logger.error(
            {
              error,
              operation,
              provider,
              channelId,
              contentType,
              duration,
              traceId: span.spanContext().traceId,
            },
            "Publishing operation failed"
          );

          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  /**
   * Instrument provider API calls
   */
  async instrumentProviderAPI<T>(
    provider: string,
    endpoint: string,
    method: string,
    fn: (span: Span) => Promise<T>,
    requestMetadata?: Attributes
  ): Promise<T> {
    const startTime = Date.now();

    return await this.tracer.startActiveSpan(
      `provider.${provider}.${endpoint}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "social.provider": provider,
          "social.api.endpoint": endpoint,
          "social.api.method": method,
          "business.domain": "provider_integration",
          ...requestMetadata,
        },
      },
      async (span: Span) => {
        try {
          providerApiCounter.add(1, {
            provider,
            endpoint,
            method,
            status: "started",
          });

          const result = await fn(span);
          const duration = Date.now() - startTime;

          providerApiDuration.record(duration, {
            provider,
            endpoint,
            method,
          });

          providerApiCounter.add(1, {
            provider,
            endpoint,
            method,
            status: "success",
          });

          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            "social.api.success": true,
            "social.api.duration_ms": duration,
          });

          return result;
        } catch (error) {
          const duration = Date.now() - startTime;

          providerApiCounter.add(1, {
            provider,
            endpoint,
            method,
            status: "error",
          });

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });

          span.setAttributes({
            "social.api.success": false,
            "social.api.error": error instanceof Error ? error.message : String(error),
            "social.api.duration_ms": duration,
          });

          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  /**
   * Instrument queue processing operations
   */
  async instrumentQueueProcessing<T>(
    queueName: string,
    jobType: string,
    jobId: string,
    fn: (span: Span) => Promise<T>,
    jobData?: Attributes
  ): Promise<T> {
    const startTime = Date.now();

    return await this.tracer.startActiveSpan(
      `queue.${queueName}.${jobType}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          "queue.name": queueName,
          "queue.job_type": jobType,
          "queue.job_id": jobId,
          "business.domain": "async_processing",
          ...jobData,
        },
      },
      async (span: Span) => {
        try {
          const result = await fn(span);
          const duration = Date.now() - startTime;

          queueProcessingDuration.record(duration, {
            queue: queueName,
            job_type: jobType,
          });

          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            "queue.success": true,
            "queue.duration_ms": duration,
          });

          return result;
        } catch (error) {
          const duration = Date.now() - startTime;

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });

          span.setAttributes({
            "queue.success": false,
            "queue.error": error instanceof Error ? error.message : String(error),
            "queue.duration_ms": duration,
          });

          throw error;
        } finally {
          span.end();
        }
      }
    );
  }
}

/**
 * Instrumentation for analytics and engagement tracking
 */
export class AnalyticsInstrumentation {
  private tracer: Tracer;

  constructor() {
    this.tracer = getTracer();
  }

  /**
   * Track engagement events with context
   */
  trackEngagement(
    provider: string,
    engagementType: string,
    postId: string,
    metadata: Attributes = {}
  ): void {
    const span = this.tracer.startSpan(`analytics.engagement.${engagementType}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        "social.provider": provider,
        "social.engagement_type": engagementType,
        "social.post_id": postId,
        "business.domain": "engagement_analytics",
        ...metadata,
      },
    });

    try {
      engagementCounter.add(1, {
        provider,
        engagement_type: engagementType,
      });

      span.setStatus({ code: SpanStatusCode.OK });

      logger.debug(
        {
          provider,
          engagementType,
          postId,
          metadata,
          traceId: span.spanContext().traceId,
        },
        "Engagement event tracked"
      );
    } finally {
      span.end();
    }
  }

  /**
   * Track user journey events
   */
  trackUserJourney(
    userId: string,
    action: string,
    context: string,
    metadata: Attributes = {}
  ): void {
    const span = this.tracer.startSpan(`user_journey.${action}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        "user.id": userId,
        "user.action": action,
        "user.context": context,
        "business.domain": "user_analytics",
        ...metadata,
      },
    });

    try {
      userJourneyCounter.add(1, {
        action,
        context,
      });

      span.setStatus({ code: SpanStatusCode.OK });

      logger.debug(
        {
          userId,
          action,
          context,
          metadata,
          traceId: span.spanContext().traceId,
        },
        "User journey event tracked"
      );
    } finally {
      span.end();
    }
  }
}

/**
 * Database operation instrumentation
 */
export class DatabaseInstrumentation {
  private tracer: Tracer;

  constructor() {
    this.tracer = getTracer();
  }

  /**
   * Instrument database operations with query analysis
   */
  async instrumentQuery<T>(
    operation: string,
    table: string,
    fn: (span: Span) => Promise<T>,
    queryMetadata?: Attributes
  ): Promise<T> {
    return await this.tracer.startActiveSpan(
      `db.${operation}.${table}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.operation": operation,
          "db.table": table,
          "db.system": "postgresql",
          "business.domain": "data_access",
          ...queryMetadata,
        },
      },
      async (span: Span) => {
        const startTime = Date.now();

        try {
          const result = await fn(span);
          const duration = Date.now() - startTime;

          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            "db.success": true,
            "db.duration_ms": duration,
          });

          return result;
        } catch (error) {
          const duration = Date.now() - startTime;

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });

          span.setAttributes({
            "db.success": false,
            "db.error": error instanceof Error ? error.message : String(error),
            "db.duration_ms": duration,
          });

          throw error;
        } finally {
          span.end();
        }
      }
    );
  }
}

// Export singleton instances
export const publishingInstrumentation = new PublishingInstrumentation();
export const analyticsInstrumentation = new AnalyticsInstrumentation();
export const databaseInstrumentation = new DatabaseInstrumentation();

/**
 * Utility function to add business context to current span
 */
export function addBusinessContext(attributes: Attributes): void {
  const currentSpan = trace.getActiveSpan();
  if (currentSpan) {
    currentSpan.setAttributes(attributes);
  }
}

/**
 * Utility function to create child spans for complex operations
 */
export async function createChildSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  return await tracer.startActiveSpan(name, { attributes }, fn);
}
