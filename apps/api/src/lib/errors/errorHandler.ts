/**
 * @file errorHandler.ts
 * @description How Fastify answers with the API's one error body: the global error handler for
 *   what is raised, the not-found handler for a path no route matches, the server's
 *   `frameworkErrors` option for a request the framework refuses before it routes it, its
 *   `clientErrorHandler` option for a connection whose request cannot be read, and the hooks that
 *   refuse a request reaching a server that is closing, all through `sendProblem` or its socket
 *   twin, and the body's schema as the OpenAPI document publishes it. Beside them, the Prisma and
 *   Zod converters to an `AppError`, which only their suites call.
 * @layer infrastructure
 */
import type { Socket } from "node:net";
import type { FastifyDynamicSwaggerOptions } from "@fastify/swagger";
import type {
  ConnectionError,
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import { HTTP_ERRORS, RegisteredError } from "@shared/types";
import { AppError, ErrorCode, isOperationalError } from "./AppError.js";
import { problemSchema } from "./problem.js";
import { sendProblem, sendProblemOnSocket } from "./sendProblem.js";
import {
  violatedConstraint,
  type ViolatedConstraint,
} from "@infra/prisma/extensions/constraintViolation.js";

/** A schema object of the API's OpenAPI document, as the swagger plugin's options type it. */
type OpenApiSchemaObject = Exclude<
  NonNullable<
    NonNullable<NonNullable<FastifyDynamicSwaggerOptions["openapi"]>["components"]>["schemas"]
  >[string],
  { $ref: string }
>;

/**
 * The body's schema, published as `components.schemas.Problem`, at the OpenAPI 3.0 target the
 * route schemas are converted to. Zod types a JSON Schema's `type` as a union OpenAPI's types do not
 * take, so the value is typed by the document that holds it.
 */
export const PROBLEM_OPENAPI_SCHEMA = z.toJSONSchema(problemSchema, {
  target: "openapi-3.0",
}) as OpenApiSchemaObject;

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
 * @description Builds the global error handler: whatever a route, a hook or the framework raises is
 *   answered with its problem through `sendProblem`. It is the net for what is raised; a route
 *   answers its own failures through `sendProblem` itself.
 * @param logger - The logger each failure's one line is written to.
 * @returns The Fastify error handler.
 */
export function createErrorHandler(logger: FastifyBaseLogger) {
  return function errorHandler(
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply
  ): FastifyReply {
    return sendProblem(request, reply, error, logger);
  };
}

/**
 * @function createNotFoundHandler
 * @description Builds the not-found handler: a path no route matches, under any prefix, is answered
 *   with ROUTE_NOT_FOUND's problem through `sendProblem`.
 * @param logger - The logger each failure's one line is written to.
 * @returns The Fastify not-found handler.
 */
export function createNotFoundHandler(logger: FastifyBaseLogger) {
  return function notFoundHandler(request: FastifyRequest, reply: FastifyReply): FastifyReply {
    return sendProblem(request, reply, RegisteredError.of(HTTP_ERRORS.ROUTE_NOT_FOUND), logger);
  };
}

/**
 * @function answerFrameworkRefusal
 * @description The server's `frameworkErrors` option: a request the framework refuses before it
 *   routes it is answered through `sendProblem`, on the server's logger, the one the error and
 *   not-found handlers are given. Fastify hands it three refusals: a path whose percent-encoding
 *   does not decode (`FST_ERR_BAD_URL`), a route parameter over the router's limit
 *   (`FST_ERR_MAX_PARAM_LENGTH`) and a failing async route constraint (`FST_ERR_ASYNC_CONSTRAINT`).
 *   Fastify builds their request and reply outside the route lifecycle, so no hook of the
 *   application runs for them: the answer carries no security header, counts against no rate limit
 *   and no metric, and its correlation id is the request id, as for any failure no hook stamped;
 *   Fastify writes its "incoming request" line for them and no "request completed" line. A failing
 *   async constraint arrives without the constraint's own error, which Fastify does not pass on.
 * @param error - The framework's refusal.
 * @param request - The request Fastify built for the refusal.
 * @param reply - The reply the problem is sent on.
 */
export function answerFrameworkRefusal(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  sendProblem(request, reply, error, request.server.log);
}

/** A connection's failure as a registered error, by Node's code, the connection's error its cause. */
function connectionFailure(error: ConnectionError): RegisteredError {
  switch (error.code) {
    case "ERR_HTTP_REQUEST_TIMEOUT":
      return RegisteredError.of(HTTP_ERRORS.REQUEST_TIMEOUT, { cause: error });
    case "HPE_HEADER_OVERFLOW":
      return RegisteredError.of(HTTP_ERRORS.REQUEST_HEADERS_TOO_LARGE, { cause: error });
    default:
      return RegisteredError.of(HTTP_ERRORS.REQUEST_NOT_PARSABLE, { cause: error });
  }
}

/**
 * @function answerClientError
 * @description The server's `clientErrorHandler` option: a connection whose request Node's HTTP
 *   server cannot finish is answered through `sendProblemOnSocket`, on the server's logger, the
 *   instance Fastify binds the option to. Node hands it the connection's error and its socket, and
 *   no request: a client too slow to send its request within the server's `requestTimeout`
 *   (`ERR_HTTP_REQUEST_TIMEOUT`) answers `REQUEST_TIMEOUT` at 408, headers over Node's limit
 *   (`HPE_HEADER_OVERFLOW`) answer `REQUEST_HEADERS_TOO_LARGE` at 431, and any other error of the
 *   connection, a request line or a header the parser refuses among them, answers
 *   `REQUEST_NOT_PARSABLE` at 400, as Node and the framework answer it; the line names Node's
 *   code as its cause's. A connection the client reset (`ECONNRESET`), or one already destroyed,
 *   is left as it is, as the framework's own handler leaves it: nothing can be written to it, and
 *   no request of it was read. No hook of the application runs for these answers, so they carry
 *   no security header and count against no rate limit and no metric.
 * @param error - The connection's error, as Node emits it with `clientError`.
 * @param socket - The connection.
 */
export function answerClientError(
  this: FastifyInstance,
  error: ConnectionError,
  socket: Socket
): void {
  if (error.code === "ECONNRESET" || socket.destroyed) return;
  sendProblemOnSocket(socket, connectionFailure(error), this.log);
}

/**
 * @function refuseRequestsWhileClosing
 * @description Refuses every request that reaches the server once it has begun to close, with
 *   `SERVER_CLOSING` at 503 through `sendProblem`, before any other hook and its route run. The
 *   server is built with `return503OnClosing: false`, since the framework's own refusal writes its
 *   body past every hook; the framework still sets `Connection: close` on such a request, so the
 *   client sends it again on a new connection. The first `preClose` hook marks the server closing:
 *   the framework marks its routes closing in the same step of `close` and runs the `preClose`
 *   hooks after it on the microtask queue only, so no request is read between the two.
 * @param server - The server, before any route is registered on it.
 */
export function refuseRequestsWhileClosing(server: FastifyInstance): void {
  let closing = false;
  server.addHook("preClose", (done) => {
    closing = true;
    done();
  });
  server.addHook("onRequest", (request, reply, done) => {
    if (!closing) {
      done();
      return;
    }
    sendProblem(request, reply, RegisteredError.of(HTTP_ERRORS.SERVER_CLOSING), server.log);
  });
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
