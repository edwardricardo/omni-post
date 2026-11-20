/**
 * @file errorHandler.ts
 * @description How Fastify answers with the API's one error body: the global error handler for
 *   what is raised, the not-found handler for a path no route matches, the server's
 *   `frameworkErrors` option for a request the framework refuses before it routes it, its
 *   `clientErrorHandler` option for a connection whose parser fails, with the hooks that tell it
 *   which request the connection is answering, the hooks that refuse a request reaching a server
 *   that is closing and one whose expectation the server does not meet, all through
 *   `sendProblem` or its socket twin, and the body's schema as the OpenAPI document publishes it. Beside them, the Prisma and
 *   Zod converters to an `AppError`, which only their suites call.
 * @layer infrastructure
 */
import type { IncomingMessage, ServerResponse } from "node:http";
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
import {
  keepClientAddress,
  sendProblem,
  sendProblemOnSocket,
  type RequestInFlight,
} from "./sendProblem.js";
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

/** The part of a message a connection's error finds wrong, which names its code. */
const MESSAGE_PART = {
  REQUEST_LINE: "request-line",
  HEADERS: "headers",
  BODY_FRAMING: "body-framing",
  AFTER_MESSAGE: "after-message",
} as const;
type MessagePart = (typeof MESSAGE_PART)[keyof typeof MESSAGE_PART];

/**
 * The part of the message each code of Node's HTTP parser finds wrong, for a connection with no
 * request in flight. The codes are llhttp's `llhttp_errno` names as Node 26.13.1 vendors them
 * (`deps/llhttp/include/llhttp.h`), which Node hands to `clientError` as `error.code`
 * (`src/node_http_parser.cc`), and Node's own `HPE_CHUNK_EXTENSIONS_OVERFLOW`. llhttp raises
 * `HPE_STRICT` and `HPE_CR_EXPECTED` in the request line, the headers and the body's framing alike,
 * so with no request in flight they name the headers, and `HPE_STRICT`'s reason after the version
 * names the request line; with a request in flight, the position decides (`connectionFailure`).
 * `HPE_INVALID_EOF_STATE`, an end of data in the wrong state, names the body's framing. Not here,
 * since no request makes Node raise them: `HPE_INVALID_STATUS` and the response line's reasons (a
 * response parser's), `HPE_INTERNAL`, the `HPE_CB_*` callback errors and `HPE_PAUSED` (Node's
 * callbacks raise none of them), and `HPE_JS_EXCEPTION` and `HPE_REENTRANT_EXECUTE`, which Node
 * raises for its own faults, not the client's.
 */
const MESSAGE_PART_OF_PARSER_CODE: ReadonlyMap<string, MessagePart> = new Map<string, MessagePart>([
  ["HPE_INVALID_METHOD", MESSAGE_PART.REQUEST_LINE],
  ["HPE_INVALID_URL", MESSAGE_PART.REQUEST_LINE],
  ["HPE_INVALID_VERSION", MESSAGE_PART.REQUEST_LINE],
  ["HPE_INVALID_CONSTANT", MESSAGE_PART.REQUEST_LINE],
  ["HPE_UNEXPECTED_SPACE", MESSAGE_PART.REQUEST_LINE],
  ["HPE_PAUSED_H2_UPGRADE", MESSAGE_PART.REQUEST_LINE],
  ["HPE_INVALID_HEADER_TOKEN", MESSAGE_PART.HEADERS],
  ["HPE_LF_EXPECTED", MESSAGE_PART.HEADERS],
  ["HPE_CR_EXPECTED", MESSAGE_PART.HEADERS],
  ["HPE_STRICT", MESSAGE_PART.HEADERS],
  ["HPE_UNEXPECTED_CONTENT_LENGTH", MESSAGE_PART.HEADERS],
  ["HPE_INVALID_CONTENT_LENGTH", MESSAGE_PART.HEADERS],
  ["HPE_INVALID_TRANSFER_ENCODING", MESSAGE_PART.HEADERS],
  ["HPE_INVALID_CHUNK_SIZE", MESSAGE_PART.BODY_FRAMING],
  ["HPE_CHUNK_EXTENSIONS_OVERFLOW", MESSAGE_PART.BODY_FRAMING],
  ["HPE_INVALID_EOF_STATE", MESSAGE_PART.BODY_FRAMING],
  ["HPE_CLOSED_CONNECTION", MESSAGE_PART.AFTER_MESSAGE],
]);

/** llhttp's reasons, as Node sets `error.reason`, that name the request line under another code. */
const REQUEST_LINE_REASONS: ReadonlySet<string> = new Set(["Expected CRLF after version"]);

/**
 * llhttp's reasons for a request that declares both Transfer-Encoding and Content-Length, the shape
 * of a request-smuggling attempt, which it raises under the code of whichever header it reads
 * second.
 */
const LENGTH_CONFLICT_REASONS: ReadonlySet<string> = new Set([
  "Content-Length can't be present with Transfer-Encoding",
  "Transfer-Encoding can't be present with Content-Length",
]);

/** llhttp's reason for a parser error, which Node sets beside its code. */
function reasonOf(error: ConnectionError): string | undefined {
  return "reason" in error && typeof error.reason === "string" ? error.reason : undefined;
}

/** The part of the message a connection's error finds wrong, or none the table names. */
function messagePartOf(
  error: ConnectionError,
  requestInFlight: IncomingMessage | undefined
): MessagePart | undefined {
  if (requestInFlight !== undefined) {
    return requestInFlight.complete ? MESSAGE_PART.AFTER_MESSAGE : MESSAGE_PART.BODY_FRAMING;
  }
  const reason = reasonOf(error);
  if (reason !== undefined && REQUEST_LINE_REASONS.has(reason)) return MESSAGE_PART.REQUEST_LINE;
  return MESSAGE_PART_OF_PARSER_CODE.get(error.code);
}

/**
 * @description A connection's failure as the failure the line and the answer name, Node's error its
 *   cause. The request timeout and headers over Node's limit keep their own codes. A request that
 *   declares both Transfer-Encoding and Content-Length is a smuggling attempt, named on its own.
 *   Otherwise the code names the part of the message that is wrong: with a request in flight, its
 *   position, the body's framing while its message is incomplete and data after it once complete;
 *   with none, Node's parser code. A code the table does not name, with no request in flight, is
 *   handed on as Node's error with the status 400 every parser error answers, so it answers as an
 *   unnamed refusal of the client's request under Node's own code.
 * @param error - The connection's error, as Node emits it with `clientError`.
 * @param requestInFlight - The message of the request the connection is answering, if any.
 * @returns The failure to answer.
 */
export function connectionFailure(
  error: ConnectionError,
  requestInFlight: IncomingMessage | undefined
): RegisteredError | (ConnectionError & { readonly statusCode: number }) {
  if (error.code === "ERR_HTTP_REQUEST_TIMEOUT") {
    return RegisteredError.of(HTTP_ERRORS.REQUEST_TIMEOUT, { cause: error });
  }
  if (error.code === "HPE_HEADER_OVERFLOW") {
    return RegisteredError.of(HTTP_ERRORS.REQUEST_HEADERS_TOO_LARGE, { cause: error });
  }
  const reason = reasonOf(error);
  if (reason !== undefined && LENGTH_CONFLICT_REASONS.has(reason)) {
    return RegisteredError.of(HTTP_ERRORS.TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH, {
      cause: error,
    });
  }
  switch (messagePartOf(error, requestInFlight)) {
    case MESSAGE_PART.REQUEST_LINE:
      return RegisteredError.of(HTTP_ERRORS.REQUEST_LINE_NOT_PARSABLE, { cause: error });
    case MESSAGE_PART.HEADERS:
      return RegisteredError.of(HTTP_ERRORS.REQUEST_HEADERS_NOT_PARSABLE, { cause: error });
    case MESSAGE_PART.BODY_FRAMING:
      return RegisteredError.of(HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE, { cause: error });
    case MESSAGE_PART.AFTER_MESSAGE:
      return RegisteredError.of(HTTP_ERRORS.DATA_AFTER_REQUEST_UNEXPECTED, { cause: error });
    case undefined:
      return Object.assign(error, { statusCode: 400 });
  }
}

/** The request each connection is answering, by its socket, while the server answers it. */
export type RequestsInFlight = WeakMap<Socket, RequestInFlight>;

/**
 * @function trackRequestsInFlight
 * @description Keeps, for each connection, the request the server is answering on it: the first
 *   `onRequest` hook records it, with its client's address while the connection can still give it,
 *   and its `onResponse` hook forgets it once its answer is sent. The
 *   relation is read from the framework's documented request and hooks only; the request a parser
 *   holds is kept by Node in fields it does not document.
 * @param server - The server, before any route is registered on it.
 * @param requestsInFlight - Where the requests are kept.
 */
export function trackRequestsInFlight(
  server: FastifyInstance,
  requestsInFlight: RequestsInFlight
): void {
  server.addHook("onRequest", (request, reply, done) => {
    requestsInFlight.set(request.socket, { request, reply });
    keepClientAddress(request);
    done();
  });
  server.addHook("onResponse", (request, _reply, done) => {
    if (requestsInFlight.get(request.socket)?.request === request) {
      requestsInFlight.delete(request.socket);
    }
    done();
  });
}

/**
 * @function createClientErrorHandler
 * @description Builds the server's `clientErrorHandler` option: a connection whose parser fails is
 *   answered through `sendProblemOnSocket`, on the server's logger, the instance Fastify binds the
 *   option to, with the failure `connectionFailure` names. Node hands it the connection's error and
 *   its socket and no request; the request the connection is answering, when there is one, is read
 *   from what `trackRequestsInFlight` keeps. A connection the client reset (`ECONNRESET`), or one
 *   already destroyed, is left as it is, as the framework's own handler leaves it: nothing can be
 *   written to it, and a request in flight on it logs its own failure when its body's stream fails.
 *   No hook of the application runs for these answers, so they carry no security header and count
 *   against no rate limit and no metric.
 * @param requestsInFlight - The requests the connections are answering.
 * @returns The handler.
 */
export function createClientErrorHandler(requestsInFlight: RequestsInFlight) {
  return function answerClientError(
    this: FastifyInstance,
    error: ConnectionError,
    socket: Socket
  ): void {
    if (error.code === "ECONNRESET" || socket.destroyed) return;
    const inFlight = requestsInFlight.get(socket);
    sendProblemOnSocket(
      socket,
      connectionFailure(error, inFlight?.request.raw),
      this.log,
      inFlight
    );
  };
}

/**
 * @function answerUnsupportedExpectations
 * @description Answers a request whose `Expect` header asks for something other than
 *   `100-continue` with `EXPECTATION_UNSUPPORTED` at 417 through `sendProblem`. Node emits such a
 *   request as `checkExpectation`, and answers 417 by itself with no body when nothing listens; the
 *   listener hands it to the server as any other request, and the first `onRequest` hook answers
 *   it, before any other hook and its route, under the request's own id, method, url and address.
 *   `Expect: 100-continue` is untouched: Node still answers it `100 Continue` and emits the request.
 * @param server - The server, before any route is registered on it.
 */
export function answerUnsupportedExpectations(server: FastifyInstance): void {
  const unsupported = new WeakSet<IncomingMessage>();
  server.server.on("checkExpectation", (request: IncomingMessage, response: ServerResponse) => {
    unsupported.add(request);
    server.server.emit("request", request, response);
  });
  server.addHook("onRequest", (request, reply, done) => {
    if (!unsupported.has(request.raw)) {
      done();
      return;
    }
    sendProblem(
      request,
      reply,
      RegisteredError.of(HTTP_ERRORS.EXPECTATION_UNSUPPORTED),
      server.log
    );
  });
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
