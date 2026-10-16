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
import { captureError } from "../../observability/sentryInit.js";
import {
  violatedConstraint,
  type ViolatedConstraint,
} from "@infra/prisma/extensions/constraintViolation.js";

/**
 * Structural type for Prisma errors with a code and optional meta. Under Prisma 7 the meta holds
 * the driver adapter's payload, which `violatedConstraint` reads; `meta.target` is never set.
 */
interface PrismaErrorLike {
  code: string;
  meta?: unknown;
}

/** Structural type for Zod validation errors */
interface ZodErrorLike {
  issues?: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>;
}

/**
 * @function createErrorHandler
 * @description Builds the centralized Fastify error handler, which logs every error in full and
 *   answers the client with a sanitized body. SECURITY: never exposes stack traces, database
 *   schema, or internal paths in production.
 * @param logger - The logger the full error is written to.
 * @returns The Fastify error handler.
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
      // Unexpected errors - log as error and report to Sentry
      logger.error(logContext, "Unexpected error occurred");
      captureError(error, { requestId, method, url, ip });
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
 * @function asyncHandler
 * @description Wraps an async route handler so a rejection reaches Fastify's error handler.
 * @param handler - The route handler to wrap.
 * @returns A route handler that awaits the wrapped one.
 */
export function asyncHandler<T>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    return await handler(request, reply);
  };
}

/**
 * @param error - A Prisma constraint-violation error.
 * @returns In development only, the constraint the driver adapter names, as `{ index }` or
 *   `{ fields }`; otherwise, or when no constraint can be read, undefined.
 */
function constraintDetails(error: PrismaErrorLike): { constraint: ViolatedConstraint } | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  const constraint = violatedConstraint(error);
  return constraint === null ? undefined : { constraint };
}

/**
 * @function convertPrismaError
 * @description Converts a Prisma error to a safe AppError by its code; in development the detail
 *   names the violated constraint as the driver adapter reports it.
 * @param error - The Prisma error, read by its code and its meta.
 * @returns The AppError the code maps to; an unknown code maps to a generic database error.
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
        constraintDetails(error)
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
        constraintDetails(error)
      );

    case "P2011":
      // Null constraint violation
      return new AppError(
        ErrorCode.VALIDATION_MISSING_FIELD,
        400,
        "Required field is missing",
        true,
        constraintDetails(error)
      );

    default:
      // Generic database error - don't expose Prisma details
      return new AppError(ErrorCode.DATABASE_ERROR, 500, "Database operation failed", true);
  }
}

/**
 * @function convertZodError
 * @description Converts a Zod validation error to a safe AppError; in development the detail
 *   lists each issue's path and message.
 * @param error - The Zod error, read by its issues.
 * @returns A 400 validation AppError.
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
 * @function handleAnyError
 * @description Converts any thrown value to an AppError: an AppError unchanged, a Prisma or Zod
 *   error by its converter, and anything else to a generic internal error.
 * @param error - The thrown value.
 * @param logger - The logger an unexpected error is written to.
 * @returns The AppError the value converts to.
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
 * @function shouldTerminateProcess
 * @description Decides whether the process should stop after an error, which it should only for
 *   a non-operational one.
 * @param error - The error that occurred.
 * @returns True when the error is not operational.
 */
export function shouldTerminateProcess(error: Error): boolean {
  // Only terminate on non-operational errors
  return !isOperationalError(error);
}
