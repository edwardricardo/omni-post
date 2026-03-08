/**
 * Phase 3.1: Backend Service Consolidation - Base Service Class
 *
 * Provides consistent error handling, logging, and validation patterns
 * across all backend services to eliminate duplication.
 *
 * Features:
 * - Standardized error handling with Result<T, E> pattern
 * - Contextual logging with structured data
 * - Input validation helpers
 * - Performance timing
 * - Consistent error responses
 */

import { Result, ok, err } from "@shared/types";
import { logger } from "../lib/logger.js";

export interface ServiceContext {
  serviceName: string;
  operation: string;
  userId?: string;
  accountId?: string;
  metadata?: Record<string, unknown>;
}

export interface ServiceError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  context: ServiceContext;
}

/**
 * Base class for all backend services
 * Provides consistent error handling, logging, and validation
 */
export abstract class BaseService {
  protected serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  /**
   * Execute an operation with standardized error handling
   *
   * @example
   * return this.executeWithErrorHandling(
   *   { operation: 'createUser', userId: '123' },
   *   async () => {
   *     const user = await prisma.user.create({ data });
   *     return user;
   *   }
   * );
   */
  protected async executeWithErrorHandling<T>(
    context: Omit<ServiceContext, "serviceName">,
    operation: () => Promise<T>
  ): Promise<Result<T, string>> {
    const fullContext: ServiceContext = {
      serviceName: this.serviceName,
      ...context,
    };

    const startTime = Date.now();

    try {
      const result = await operation();
      const duration = Date.now() - startTime;

      this.logOperation(fullContext, "success", duration);

      return ok(result);
    } catch (error) {
      const duration = Date.now() - startTime;

      const serviceError = this.createServiceError(error, fullContext);
      this.logError(fullContext, serviceError, duration);

      return err(serviceError.message);
    }
  }

  /**
   * Execute an operation with error handling and return raw result (throws on error)
   * Use this when you want to handle errors in the calling code
   */
  protected async execute<T>(
    context: Omit<ServiceContext, "serviceName">,
    operation: () => Promise<T>
  ): Promise<T> {
    const fullContext: ServiceContext = {
      serviceName: this.serviceName,
      ...context,
    };

    const startTime = Date.now();

    try {
      const result = await operation();
      const duration = Date.now() - startTime;

      this.logOperation(fullContext, "success", duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const serviceError = this.createServiceError(error, fullContext);

      this.logError(fullContext, serviceError, duration);

      throw error;
    }
  }

  /**
   * Validate that all required values are present and non-null
   * Throws error if any value is null/undefined
   *
   * @example
   * this.validateRequired(
   *   { userId, accountId },
   *   'Missing required fields'
   * );
   */
  protected validateRequired(
    values: Record<string, unknown>,
    errorMessage = "Missing required fields"
  ): void {
    const missingFields: string[] = [];

    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === undefined || value === "") {
        missingFields.push(key);
      }
    }

    if (missingFields.length > 0) {
      throw new Error(`${errorMessage}: ${missingFields.join(", ")}`);
    }
  }

  /**
   * Validate that at least one of the provided values is present
   */
  protected validateAtLeastOne(
    values: Record<string, unknown>,
    errorMessage = "At least one field is required"
  ): void {
    const hasValue = Object.values(values).some((value) => value !== null && value !== undefined);

    if (!hasValue) {
      throw new Error(`${errorMessage}: ${Object.keys(values).join(", ")}`);
    }
  }

  /**
   * Create a standardized service error
   */
  protected createServiceError(error: unknown, context: ServiceContext): ServiceError {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = this.extractErrorCode(error);

    const details = this.extractErrorDetails(error);
    return {
      code: errorCode,
      message: errorMessage,
      ...(details !== undefined && { details }),
      timestamp: new Date(),
      context,
    };
  }

  /**
   * Extract error code from various error types
   */
  protected extractErrorCode(error: unknown): string {
    if (error instanceof Error) {
      // Prisma errors
      if ("code" in error && typeof error.code === "string") {
        return error.code;
      }
      // Custom errors with code property
      if ("name" in error) {
        return error.name;
      }
    }
    return "UNKNOWN_ERROR";
  }

  /**
   * Extract additional error details for logging
   */
  protected extractErrorDetails(error: unknown): Record<string, unknown> | undefined {
    if (error instanceof Error) {
      const details: Record<string, unknown> = {
        name: error.name,
        stack: error.stack,
      };

      // Include additional properties from error object
      for (const [key, value] of Object.entries(error)) {
        if (key !== "message" && key !== "name" && key !== "stack") {
          details[key] = value;
        }
      }

      return details;
    }
    return undefined;
  }

  /**
   * Log successful operation
   */
  protected logOperation(context: ServiceContext, status: string, durationMs: number): void {
    logger.info(
      {
        service: context.serviceName,
        operation: context.operation,
        status,
        durationMs,
        userId: context.userId,
        accountId: context.accountId,
        metadata: context.metadata,
      },
      "Service operation completed"
    );
  }

  /**
   * Log error with context
   */
  protected logError(context: ServiceContext, error: ServiceError, durationMs: number): void {
    logger.error(
      {
        service: context.serviceName,
        operation: context.operation,
        errorCode: error.code,
        errorMessage: error.message,
        errorDetails: error.details,
        durationMs,
        userId: context.userId,
        accountId: context.accountId,
        metadata: context.metadata,
      },
      "Service operation failed"
    );
  }

  /**
   * Log warning
   */
  protected logWarning(context: Omit<ServiceContext, "serviceName">, message: string): void {
    logger.warn(
      {
        service: this.serviceName,
        operation: context.operation,
        userId: context.userId,
        accountId: context.accountId,
        metadata: context.metadata,
      },
      message
    );
  }
}
