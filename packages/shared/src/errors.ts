/**
 * Standardized Error Codes
 * Used to return consistent, safe error codes to clients without leaking internal details
 */
export enum ErrorCode {
  // Authentication & Authorization
  AUTH_INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS",
  AUTH_USER_NOT_FOUND = "AUTH_USER_NOT_FOUND",
  AUTH_TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED",
  AUTH_TOKEN_INVALID = "AUTH_TOKEN_INVALID",
  AUTH_INSUFFICIENT_PERMISSIONS = "AUTH_INSUFFICIENT_PERMISSIONS",
  AUTH_MFA_REQUIRED = "AUTH_MFA_REQUIRED",
  AUTH_MFA_INVALID = "AUTH_MFA_INVALID",

  // Validation
  VALIDATION_ERROR = "VALIDATION_ERROR",
  VALIDATION_MISSING_FIELD = "VALIDATION_MISSING_FIELD",
  VALIDATION_INVALID_FORMAT = "VALIDATION_INVALID_FORMAT",

  // Resources
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  RESOURCE_ALREADY_EXISTS = "RESOURCE_ALREADY_EXISTS",
  RESOURCE_CONFLICT = "RESOURCE_CONFLICT",

  // Rate Limiting
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  // Database
  DATABASE_ERROR = "DATABASE_ERROR",
  DATABASE_CONNECTION_FAILED = "DATABASE_CONNECTION_FAILED",

  // External Services
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
  PROVIDER_ERROR = "PROVIDER_ERROR",

  // Configuration
  CONFIGURATION_ERROR = "CONFIGURATION_ERROR",

  // Generic
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
  BAD_REQUEST = "BAD_REQUEST",
  FORBIDDEN = "FORBIDDEN",
}

/**
 * Application Error Class
 * Provides structured error handling without exposing sensitive information.
 * Shared across the entire monorepo (apps, packages, providers).
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: Date;

  constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    isOperational = true,
    details?: Record<string, unknown>
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    // Use conditional spreading to comply with exactOptionalPropertyTypes
    if (details !== undefined) {
      this.details = details;
    }
    this.timestamp = new Date();

    Error.captureStackTrace(this);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        timestamp: this.timestamp.toISOString(),
        // Only include details in development
        ...(process.env.NODE_ENV === "development" && this.details && { details: this.details }),
      },
    };
  }

  /**
   * Factory Methods for Common Errors
   * These provide a convenient API for creating standard errors
   */

  static badRequest(message = "Bad request", details?: Record<string, unknown>): AppError {
    return new AppError(ErrorCode.BAD_REQUEST, 400, message, true, details);
  }

  static unauthorized(message = "Unauthorized", details?: Record<string, unknown>): AppError {
    return new AppError(ErrorCode.AUTH_INVALID_CREDENTIALS, 401, message, true, details);
  }

  static forbidden(message = "Forbidden", details?: Record<string, unknown>): AppError {
    return new AppError(ErrorCode.FORBIDDEN, 403, message, true, details);
  }

  static notFound(resource = "Resource", details?: Record<string, unknown>): AppError {
    return new AppError(ErrorCode.RESOURCE_NOT_FOUND, 404, `${resource} not found`, true, details);
  }

  static conflict(message = "Resource conflict", details?: Record<string, unknown>): AppError {
    return new AppError(ErrorCode.RESOURCE_CONFLICT, 409, message, true, details);
  }

  static internal(message = "Internal server error", details?: Record<string, unknown>): AppError {
    return new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, message, false, details);
  }

  static validationFailed(
    message = "Validation failed",
    details?: Record<string, unknown>
  ): AppError {
    return new AppError(ErrorCode.VALIDATION_ERROR, 400, message, true, details);
  }

  static tooManyRequests(message = "Too many requests", retryAfter?: number): AppError {
    return new AppError(
      ErrorCode.RATE_LIMIT_EXCEEDED,
      429,
      message,
      true,
      retryAfter !== undefined ? { retryAfter } : undefined
    );
  }

  static database(
    message = "Database operation failed",
    details?: Record<string, unknown>
  ): AppError {
    return new AppError(ErrorCode.DATABASE_ERROR, 500, message, true, details);
  }

  static externalService(
    service: string,
    message?: string,
    details?: Record<string, unknown>
  ): AppError {
    return new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      502,
      message || `External service '${service}' unavailable`,
      true,
      details
    );
  }

  static configuration(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(ErrorCode.CONFIGURATION_ERROR, 500, message, true, details);
  }
}

/**
 * Check if an error is an operational error (expected) vs programming error (bug)
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Extract safe error message from unknown error
 * Never exposes stack traces, database details, or internal paths to clients
 */
export function getSafeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof Error) {
    // Check for Prisma errors
    if (error.constructor.name.startsWith("Prisma")) {
      return "Database operation failed";
    }

    // Check for validation errors
    if (error.name === "ValidationError" || error.name === "ZodError") {
      return "Validation failed";
    }

    // Handle Fastify native errors — safe to expose their messages as they are
    // user-facing by design (e.g., "Body cannot be empty when content-type is
    // set to 'application/json'")
    if (
      error.name === "FastifyError" &&
      "statusCode" in error &&
      typeof (error as Record<string, unknown>).statusCode === "number"
    ) {
      const statusCode = (error as Record<string, unknown>).statusCode as number;
      if (statusCode >= 400 && statusCode < 500) {
        return error.message;
      }
    }

    // Generic error - don't expose details
    return "An unexpected error occurred";
  }

  return "An unexpected error occurred";
}

/**
 * Extract error code from unknown error
 */
export function getErrorCode(error: unknown): ErrorCode {
  if (error instanceof AppError) {
    return error.code;
  }

  if (error instanceof Error) {
    // Map known error types
    if (error.constructor.name.startsWith("Prisma")) {
      return ErrorCode.DATABASE_ERROR;
    }

    if (error.name === "ValidationError" || error.name === "ZodError") {
      return ErrorCode.VALIDATION_ERROR;
    }

    // Handle Fastify native errors (e.g., content-type parser, schema validation)
    if (
      error.name === "FastifyError" &&
      "statusCode" in error &&
      typeof (error as Record<string, unknown>).statusCode === "number"
    ) {
      const statusCode = (error as Record<string, unknown>).statusCode as number;
      if (statusCode >= 400 && statusCode < 500) {
        return ErrorCode.VALIDATION_ERROR;
      }
    }
  }

  return ErrorCode.INTERNAL_SERVER_ERROR;
}

/**
 * Get HTTP status code from unknown error
 */
export function getStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }

  // Handle Fastify native errors (e.g., content-type parser errors)
  // FastifyError objects carry their own statusCode property
  if (
    error instanceof Error &&
    "statusCode" in error &&
    typeof (error as Record<string, unknown>).statusCode === "number"
  ) {
    return (error as Record<string, unknown>).statusCode as number;
  }

  // Default to 500 for unknown errors
  return 500;
}
