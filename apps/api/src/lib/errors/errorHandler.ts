/**
 * @file errorHandler.ts
 * @description Centralized Fastify error handler that sanitizes errors before sending
 *              to clients. Maps Prisma, Zod, and domain errors to appropriate HTTP responses.
 * @layer infrastructure
 */
import type { FastifyBaseLogger, FastifyError, FastifyReply, FastifyRequest } from "fastify";
import {
  AppError,
  ErrorCode,
  getSafeErrorMessage,
  getErrorCode,
  getStatusCode,
  isOperationalError,
} from "./AppError.js";

/** Structural type for Prisma errors with a code and optional meta */
interface PrismaErrorLike {
  code: string;
  meta?: { target?: unknown; field_name?: unknown; constraint?: unknown };
}

/** Structural type for Zod validation errors */
interface ZodErrorLike {
  issues?: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>;
}

/**
 * Centralized Error Handler
 * Ensures all errors are properly sanitized before being sent to clients
 * SECURITY: Never exposes stack traces, database schema, or internal paths in production
 */
export function createErrorHandler(logger: FastifyBaseLogger) {
  return async function errorHandler(
    error: FastifyError | AppError | Error,
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const requestId = request.id;
    const method = request.method;
    const url = request.url;
    const ip = request.ip;

    // Log the full error internally (with stack trace) for debugging
    const logContext = {
      requestId,
      method,
      url,
      ip,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error instanceof AppError && { code: error.code, isOperational: error.isOperational }),
      },
    };

    if (error instanceof AppError && error.isOperational) {
      // Expected operational errors - log as warning
      logger.warn(logContext, "Operational error occurred");
    } else {
      // Unexpected errors - log as error
      logger.error(logContext, "Unexpected error occurred");
    }

    // Prepare safe response for client
    const statusCode = getStatusCode(error);
    const errorCode = getErrorCode(error);
    const safeMessage = getSafeErrorMessage(error);

    // Build response object
    const response: {
      ok: false;
      error: {
        code: string;
        message: string;
        requestId: string;
        timestamp: string;
        details?: Record<string, unknown>;
      };
    } = {
      ok: false,
      error: {
        code: errorCode,
        message: safeMessage,
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    // Only include error details in development mode
    if (process.env.NODE_ENV === "development") {
      if (error instanceof AppError && error.details) {
        response.error.details = error.details;
      }
    }

    // Send response
    return reply.status(statusCode).send(response);
  };
}

/**
 * Async error wrapper for route handlers
 * Catches async errors and passes them to the error handler
 */
export function asyncHandler<T>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    return await handler(request, reply);
  };
}

/**
 * Convert Prisma errors to safe AppErrors
 */
export function convertPrismaError(error: PrismaErrorLike): AppError {
  // Prisma error codes
  switch (error.code) {
    case "P2002":
      // Unique constraint violation
      return new AppError(
        ErrorCode.RESOURCE_CONFLICT,
        409,
        "Resource already exists",
        true,
        process.env.NODE_ENV === "development" ? { field: error.meta?.target } : undefined
      );

    case "P2025":
      // Record not found
      return new AppError(ErrorCode.RESOURCE_NOT_FOUND, 404, "Resource not found", true);

    case "P2003":
      // Foreign key constraint violation
      return new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        "Invalid reference",
        true,
        process.env.NODE_ENV === "development" ? { field: error.meta?.field_name } : undefined
      );

    case "P2011":
      // Null constraint violation
      return new AppError(
        ErrorCode.VALIDATION_MISSING_FIELD,
        400,
        "Required field is missing",
        true,
        process.env.NODE_ENV === "development" ? { field: error.meta?.constraint } : undefined
      );

    default:
      // Generic database error - don't expose Prisma details
      return new AppError(ErrorCode.DATABASE_ERROR, 500, "Database operation failed", true);
  }
}

/**
 * Convert Zod errors to safe AppErrors
 */
export function convertZodError(error: ZodErrorLike): AppError {
  const details =
    process.env.NODE_ENV === "development"
      ? {
          issues: error.issues?.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        }
      : undefined;

  return new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, details);
}

/**
 * Global error handler that processes all error types
 */
export function handleAnyError(error: unknown, logger: FastifyBaseLogger): AppError {
  // Already an AppError
  if (error instanceof AppError) {
    return error;
  }

  // Prisma error
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    if (error.code.startsWith("P")) {
      return convertPrismaError(error as PrismaErrorLike);
    }
  }

  // Zod error
  if (error && typeof error === "object" && "issues" in error) {
    return convertZodError(error as ZodErrorLike);
  }

  // Standard Error
  if (error instanceof Error) {
    // Log the error for debugging
    logger.error({ error: { message: error.message, stack: error.stack } }, "Unhandled error");

    // Return safe generic error
    return new AppError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      500,
      "An unexpected error occurred",
      false
    );
  }

  // Unknown error type
  logger.error({ error }, "Unknown error type");
  return new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "An unexpected error occurred", false);
}

/**
 * Check if application is in a state to continue after an error
 */
export function shouldTerminateProcess(error: Error): boolean {
  // Only terminate on non-operational errors
  return !isOperationalError(error);
}
