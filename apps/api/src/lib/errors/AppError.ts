/**
 * @file AppError.ts
 * @description Re-exports core error types from @shared/types and defines API-specific
 *              error subclasses (AuthenticationError, AuthorizationError, etc.).
 * @layer infrastructure
 */
export {
  ErrorCode,
  AppError,
  isOperationalError,
  getSafeErrorMessage,
  getErrorCode,
  getStatusCode,
} from "@shared/types";

import { AppError, ErrorCode } from "@shared/types";

/**
 * Predefined Error Classes for common scenarios
 */

export class AuthenticationError extends AppError {
  constructor(message = "Authentication failed", details?: Record<string, unknown>) {
    super(ErrorCode.AUTH_INVALID_CREDENTIALS, 401, message, true, details);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Insufficient permissions", details?: Record<string, unknown>) {
    super(ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, 403, message, true, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: Record<string, unknown>) {
    super(ErrorCode.VALIDATION_ERROR, 400, message, true, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource", details?: Record<string, unknown>) {
    super(ErrorCode.RESOURCE_NOT_FOUND, 404, `${resource} not found`, true, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict", details?: Record<string, unknown>) {
    super(ErrorCode.RESOURCE_CONFLICT, 409, message, true, details);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number, details?: Record<string, unknown>) {
    super(ErrorCode.RATE_LIMIT_EXCEEDED, 429, "Too many requests. Please try again later.", true, {
      retryAfter,
      ...details,
    });
  }
}

export class DatabaseError extends AppError {
  constructor(message = "Database operation failed", details?: Record<string, unknown>) {
    super(ErrorCode.DATABASE_ERROR, 500, message, true, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, details?: Record<string, unknown>) {
    super(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      502,
      `External service '${service}' unavailable`,
      true,
      details
    );
  }
}
