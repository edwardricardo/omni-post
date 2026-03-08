// Correlation tracking and context propagation for distributed operations
import { trace, context, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import { randomBytes } from "crypto";
import pino from "pino";

const logger = pino({ name: "correlation-tracking" });

export interface CorrelationContext {
  correlationId: string;
  traceId: string;
  spanId: string;
  tenantId?: string;
  projectId?: string;
  userId?: string;
  operation: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface UserJourneyContext {
  journeyId: string;
  sessionId: string;
  userId: string;
  startTime: Date;
  currentStep: string;
  previousSteps: string[];
  metadata: Record<string, any>;
}

/**
 * Correlation tracking manager for maintaining context across distributed operations
 */
export class CorrelationTracker {
  private static instance: CorrelationTracker;
  private correlationMap = new Map<string, CorrelationContext>();
  private userJourneyMap = new Map<string, UserJourneyContext>();
  private logger: pino.Logger;

  private constructor() {
    this.logger = pino({ name: "correlation-tracker" });

    // Cleanup old correlations every 5 minutes
    setInterval(
      () => {
        this.cleanup();
      },
      5 * 60 * 1000
    );
  }

  static getInstance(): CorrelationTracker {
    if (!CorrelationTracker.instance) {
      CorrelationTracker.instance = new CorrelationTracker();
    }
    return CorrelationTracker.instance;
  }

  /**
   * Generate a new correlation ID
   */
  generateCorrelationId(prefix = "social-cms"): string {
    return `${prefix}-${Date.now()}-${randomBytes(8).toString("hex")}`;
  }

  /**
   * Create correlation context from current span
   */
  createCorrelationContext(
    operation: string,
    tenantId?: string,
    projectId?: string,
    userId?: string,
    metadata?: Record<string, any>
  ): CorrelationContext {
    const currentSpan = trace.getActiveSpan();
    const spanContext = currentSpan?.spanContext();

    const correlationId = this.generateCorrelationId();
    const traceId = spanContext?.traceId || "unknown";
    const spanId = spanContext?.spanId || "unknown";

    const context: CorrelationContext = {
      correlationId,
      traceId,
      spanId,
      operation,
      timestamp: new Date(),
      ...(tenantId && { tenantId }),
      ...(projectId && { projectId }),
      ...(userId && { userId }),
      ...(metadata && { metadata }),
    };

    this.correlationMap.set(correlationId, context);

    // Add correlation context to current span
    if (currentSpan) {
      currentSpan.setAttributes({
        "correlation.id": correlationId,
        "correlation.operation": operation,
        ...(tenantId && { "tenant.id": tenantId }),
        ...(projectId && { "project.id": projectId }),
        ...(userId && { "user.id": userId }),
      });
    }

    this.logger.debug(
      {
        correlationId,
        traceId,
        operation,
        tenantId,
        projectId,
        userId,
      },
      "Correlation context created"
    );

    return context;
  }

  /**
   * Get correlation context by ID
   */
  getCorrelationContext(correlationId: string): CorrelationContext | undefined {
    return this.correlationMap.get(correlationId);
  }

  /**
   * Update correlation context with new information
   */
  updateCorrelationContext(correlationId: string, updates: Partial<CorrelationContext>): void {
    const existing = this.correlationMap.get(correlationId);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.correlationMap.set(correlationId, updated);

      this.logger.debug(
        {
          correlationId,
          updates,
        },
        "Correlation context updated"
      );
    }
  }

  /**
   * Remove correlation context
   */
  removeCorrelationContext(correlationId: string): void {
    this.correlationMap.delete(correlationId);
    this.logger.debug({ correlationId }, "Correlation context removed");
  }

  /**
   * Start tracking a user journey
   */
  startUserJourney(
    userId: string,
    sessionId: string,
    initialStep: string,
    metadata: Record<string, any> = {}
  ): string {
    const journeyId = this.generateCorrelationId("journey");

    const journey: UserJourneyContext = {
      journeyId,
      sessionId,
      userId,
      startTime: new Date(),
      currentStep: initialStep,
      previousSteps: [],
      metadata,
    };

    this.userJourneyMap.set(journeyId, journey);

    this.logger.info(
      {
        journeyId,
        userId,
        sessionId,
        initialStep,
      },
      "User journey started"
    );

    return journeyId;
  }

  /**
   * Update user journey with new step
   */
  updateUserJourney(journeyId: string, newStep: string, metadata: Record<string, any> = {}): void {
    const journey = this.userJourneyMap.get(journeyId);
    if (journey) {
      journey.previousSteps.push(journey.currentStep);
      journey.currentStep = newStep;
      journey.metadata = { ...journey.metadata, ...metadata };

      this.userJourneyMap.set(journeyId, journey);

      // Add journey context to current span
      const currentSpan = trace.getActiveSpan();
      if (currentSpan) {
        currentSpan.setAttributes({
          "user_journey.id": journeyId,
          "user_journey.step": newStep,
          "user_journey.step_count": journey.previousSteps.length + 1,
        });
      }

      this.logger.debug(
        {
          journeyId,
          userId: journey.userId,
          newStep,
          stepCount: journey.previousSteps.length + 1,
        },
        "User journey step updated"
      );
    }
  }

  /**
   * Get user journey context
   */
  getUserJourney(journeyId: string): UserJourneyContext | undefined {
    return this.userJourneyMap.get(journeyId);
  }

  /**
   * End user journey
   */
  endUserJourney(journeyId: string, finalStep?: string): void {
    const journey = this.userJourneyMap.get(journeyId);
    if (journey) {
      if (finalStep) {
        journey.previousSteps.push(journey.currentStep);
        journey.currentStep = finalStep;
      }

      const duration = Date.now() - journey.startTime.getTime();

      this.logger.info(
        {
          journeyId,
          userId: journey.userId,
          duration,
          totalSteps: journey.previousSteps.length + 1,
          finalStep: journey.currentStep,
          steps: [...journey.previousSteps, journey.currentStep],
        },
        "User journey completed"
      );

      this.userJourneyMap.delete(journeyId);
    }
  }

  /**
   * Get all correlations for debugging
   */
  getAllCorrelations(): CorrelationContext[] {
    return Array.from(this.correlationMap.values());
  }

  /**
   * Get all user journeys for analytics
   */
  getAllUserJourneys(): UserJourneyContext[] {
    return Array.from(this.userJourneyMap.values());
  }

  /**
   * Clean up old correlations and journeys
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    // Clean up old correlations
    let correlationsCleaned = 0;
    for (const [id, context] of this.correlationMap.entries()) {
      if (now - context.timestamp.getTime() > maxAge) {
        this.correlationMap.delete(id);
        correlationsCleaned++;
      }
    }

    // Clean up old journeys
    let journeysCleaned = 0;
    for (const [id, journey] of this.userJourneyMap.entries()) {
      if (now - journey.startTime.getTime() > maxAge) {
        this.userJourneyMap.delete(id);
        journeysCleaned++;
      }
    }

    if (correlationsCleaned > 0 || journeysCleaned > 0) {
      this.logger.debug(
        {
          correlationsCleaned,
          journeysCleaned,
          remaining: {
            correlations: this.correlationMap.size,
            journeys: this.userJourneyMap.size,
          },
        },
        "Cleaned up old tracking data"
      );
    }
  }
}

/**
 * Context propagation utilities for distributed operations
 */
export class ContextPropagation {
  /**
   * Inject current context into headers for HTTP requests
   */
  static injectIntoHeaders(headers: Record<string, string> = {}): Record<string, string> {
    const activeContext = context.active();
    const injectedHeaders = { ...headers };

    propagation.inject(activeContext, injectedHeaders);

    return injectedHeaders;
  }

  /**
   * Extract context from incoming HTTP headers
   */
  static extractFromHeaders(headers: Record<string, string | string[]>): any {
    // Convert headers to string format for propagation
    const stringHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        const firstValue = value[0];
        if (firstValue !== undefined) {
          stringHeaders[key] = firstValue;
        }
      } else if (value !== undefined) {
        stringHeaders[key] = value;
      }
    }

    return propagation.extract(ROOT_CONTEXT, stringHeaders);
  }

  /**
   * Create a new child context with additional attributes
   */
  static createChildContext(
    parentContext: any,
    operation: string,
    attributes: Record<string, any> = {}
  ): any {
    const tracer = trace.getTracer("context-propagation", "1.0.0");

    return tracer.startActiveSpan(operation, { attributes }, parentContext, (_span: any) => {
      return context.active();
    });
  }

  /**
   * Run function with propagated context
   */
  static async withPropagatedContext<T>(ctx: any, fn: () => Promise<T>): Promise<T> {
    return context.with(ctx, fn);
  }
}

/**
 * Middleware function for Express/Fastify to inject correlation tracking
 */
export function createCorrelationMiddleware() {
  const tracker = CorrelationTracker.getInstance();

  return async (request: any, reply: any, next: any) => {
    try {
      // Extract context from headers if present
      const extractedContext = ContextPropagation.extractFromHeaders(request.headers);

      // Get tenant and user information from headers or auth
      const tenantId = request.headers["x-tenant-id"] as string;
      const projectId = request.headers["x-project-id"] as string;
      const userId = request.user?.id || (request.headers["x-user-id"] as string);

      // Create correlation context
      const correlationContext = tracker.createCorrelationContext(
        `${request.method} ${request.url}`,
        tenantId,
        projectId,
        userId,
        {
          userAgent: request.headers["user-agent"],
          ip: request.ip,
          method: request.method,
          url: request.url,
        }
      );

      // Add correlation ID to request for downstream use
      request.correlationId = correlationContext.correlationId;
      request.correlationContext = correlationContext;

      // Add correlation ID to response headers
      reply.header("x-correlation-id", correlationContext.correlationId);
      reply.header("x-trace-id", correlationContext.traceId);

      // Continue with request processing in the extracted context
      if (extractedContext) {
        return context.with(extractedContext, () => next());
      } else {
        return next();
      }
    } catch (error) {
      logger.error({ error }, "Error in correlation middleware");
      return next();
    }
  };
}

// Export singleton instance
export const correlationTracker = CorrelationTracker.getInstance();

/**
 * Utility functions for common correlation operations
 */
export class CorrelationUtils {
  /**
   * Get current correlation ID from active span
   */
  static getCurrentCorrelationId(): string | undefined {
    const currentSpan = trace.getActiveSpan();
    if (!currentSpan) return undefined;

    // Span attributes are stored internally, we need to track correlation ID separately
    // or use span context's trace ID as correlation identifier
    const spanContext = currentSpan.spanContext();
    return spanContext?.traceId;
  }

  /**
   * Add correlation context to log messages
   */
  static enhanceLogContext(baseContext: any): any {
    const correlationId = CorrelationUtils.getCurrentCorrelationId();
    const currentSpan = trace.getActiveSpan();
    const spanContext = currentSpan?.spanContext();

    return {
      ...baseContext,
      ...(correlationId && { correlationId }),
      ...(spanContext && {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
      }),
    };
  }

  /**
   * Create structured log entry with correlation data
   */
  static createStructuredLog(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data: any = {}
  ): void {
    const enhancedData = CorrelationUtils.enhanceLogContext(data);
    logger[level](enhancedData, message);
  }
}
