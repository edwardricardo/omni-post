/**
 * @file errorHandler.ts
 * @description How Fastify answers with the API's one error body: the global error handler for
 *   what is raised, the not-found handler for a path no route matches, the server's
 *   `frameworkErrors` option for a request the framework refuses before it routes it, its
 *   `clientErrorHandler` option for a connection whose parser fails, with the hooks that tell it
 *   which request the connection is answering, the hooks that refuse a request reaching a server
 *   that is closing and one whose expectation the server does not meet, all through `sendProblem`
 *   or its socket twins, and the body's schema as the OpenAPI document publishes it. Beside them,
 *   the Prisma and Zod converters to an `AppError`, which only their suites call.
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
  logRequestNotTaken,
  logTunnelRequestNotTaken,
  sendProblem,
  sendProblemAfterAnswerInFlight,
  sendProblemOnSocket,
  sendProblemOnTunnelRequest,
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
 * The connections whose parser failed and that are answered, or whose answer waits for the answer
 * in flight on them, each with the correlation id of its refusal. The connection closes after that
 * refusal: no later failure of it is answered again, and no request read from it afterwards is
 * taken, whether the failed message read whole after its request timeout was answered or a
 * request pipelined after it; each such request writes one line that names the refusal.
 */
const answeredConnections = new WeakMap<Socket, string>();

/**
 * Ends the server's side of an answered connection once the client has ended its own, as Node ends
 * a connection whose client ends its side between messages, since the server allows no half-open
 * connection (`socketOnEnd` in `lib/_http_server.js`). When the client's end cuts a message, and
 * when the request timeout fires, Node leaves closing the socket to the `clientError` listener; a
 * connection whose answer waits for the answer in flight would otherwise stay open for as long as
 * that answer takes, after its client has gone.
 */
function endWhenTheClientHasEnded(socket: Socket): void {
  if (socket.readableEnded) socket.end();
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
 *   A request read on a connection already answered for a failure of its parser, the failed message
 *   read whole after its request timeout was answered or a request pipelined after it, is not
 *   taken: it is not answered, its reply is hijacked, so nothing is written after the connection's
 *   own refusal, and it writes one line that names that refusal.
 * @param error - The framework's refusal.
 * @param request - The request Fastify built for the refusal.
 * @param reply - The reply the problem is sent on.
 */
export function answerFrameworkRefusal(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const refusal = answeredConnections.get(request.socket);
  if (refusal !== undefined) {
    logRequestNotTaken(request, refusal, request.server.log);
    reply.hijack();
    return;
  }
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
 * The part of the message each code of Node's HTTP parser finds wrong, for the codes llhttp raises
 * in one part only. The codes are llhttp's `llhttp_errno` names as Node 26.13.1 vendors them
 * (`deps/llhttp/include/llhttp.h`), which Node hands to `clientError` as `error.code`
 * (`src/node_http_parser.cc`), and Node's own `HPE_CHUNK_EXTENSIONS_OVERFLOW`. Each code's reasons
 * in `deps/llhttp/src/llhttp.c` name one part: `HPE_UNEXPECTED_SPACE` is a first header line that
 * starts with a space ("Unexpected space after start line"), so it names the headers. Not here:
 * the codes that have their own answer (`HPE_HEADER_OVERFLOW`, `HPE_UNEXPECTED_CONTENT_LENGTH`,
 * `HPE_INVALID_EOF_STATE`), the codes llhttp raises in more than one part
 * (`MULTI_PART_PARSER_CODES`), and the codes no request
 * makes Node raise: `HPE_INVALID_STATUS` and the response line's reasons (a response parser's),
 * `HPE_INTERNAL`, the `HPE_CB_*` callback errors and `HPE_PAUSED` (Node's callbacks raise none of
 * them), `HPE_PAUSED_UPGRADE`, which Node's binding turns into success before any error is built,
 * `HPE_USER`, which it renames to the code its reason starts with (`HPE_HEADER_OVERFLOW`,
 * `HPE_CHUNK_EXTENSIONS_OVERFLOW`, `HPE_JS_EXCEPTION` or `HPE_REENTRANT_EXECUTE`), and those last
 * two, which Node raises for its own faults, not the client's.
 */
const MESSAGE_PART_OF_PARSER_CODE: ReadonlyMap<string, MessagePart> = new Map<string, MessagePart>([
  ["HPE_INVALID_METHOD", MESSAGE_PART.REQUEST_LINE],
  ["HPE_INVALID_URL", MESSAGE_PART.REQUEST_LINE],
  ["HPE_INVALID_VERSION", MESSAGE_PART.REQUEST_LINE],
  ["HPE_INVALID_CONSTANT", MESSAGE_PART.REQUEST_LINE],
  ["HPE_PAUSED_H2_UPGRADE", MESSAGE_PART.REQUEST_LINE],
  ["HPE_UNEXPECTED_SPACE", MESSAGE_PART.HEADERS],
  ["HPE_INVALID_HEADER_TOKEN", MESSAGE_PART.HEADERS],
  ["HPE_LF_EXPECTED", MESSAGE_PART.HEADERS],
  ["HPE_INVALID_CONTENT_LENGTH", MESSAGE_PART.HEADERS],
  ["HPE_INVALID_TRANSFER_ENCODING", MESSAGE_PART.HEADERS],
  ["HPE_INVALID_CHUNK_SIZE", MESSAGE_PART.BODY_FRAMING],
  ["HPE_CHUNK_EXTENSIONS_OVERFLOW", MESSAGE_PART.BODY_FRAMING],
  ["HPE_CLOSED_CONNECTION", MESSAGE_PART.AFTER_MESSAGE],
]);

/**
 * The codes llhttp raises in more than one part of a request, for which the position decides:
 * `HPE_STRICT` after the version ("Expected CRLF after version"), after the headers ("Expected LF
 * after headers") and in a chunk's size, data and extensions; and `HPE_CR_EXPECTED` after a header
 * value and in a chunk's size, data and extensions (and after a response line, a response
 * parser's).
 */
const MULTI_PART_PARSER_CODES: ReadonlySet<string> = new Set(["HPE_STRICT", "HPE_CR_EXPECTED"]);

/** llhttp's reasons, as Node sets `error.reason`, that name the request line under such a code. */
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

/**
 * The part of the message a connection's error finds wrong, or none the tables name. Node's code
 * decides whenever it names one part. For a code llhttp raises in more than one part, the position
 * decides: the body's framing while a request's own body is being read; otherwise the request
 * line for its reason after the version, and the headers for any other.
 */
function messagePartOf(error: ConnectionError, readingBody: boolean): MessagePart | undefined {
  if (!MULTI_PART_PARSER_CODES.has(error.code)) return MESSAGE_PART_OF_PARSER_CODE.get(error.code);
  if (readingBody) return MESSAGE_PART.BODY_FRAMING;
  const reason = reasonOf(error);
  return reason !== undefined && REQUEST_LINE_REASONS.has(reason)
    ? MESSAGE_PART.REQUEST_LINE
    : MESSAGE_PART.HEADERS;
}

/**
 * @description A connection's failure as the failure the line and the answer name, Node's error its
 *   cause. The request timeout, headers over Node's limit, a Content-Length sent more than once and
 *   a message the client cut by ending its side keep their own codes. That last is
 *   `HPE_INVALID_EOF_STATE`, which `llhttp_finish` (`deps/llhttp/src/api.c`) returns only when the
 *   data ends in the middle of a message, between its first byte and its end, and which Node raises
 *   only when the client ends its side (`socketOnEnd`): wherever the cut falls, in the request line,
 *   the headers or the body, the cause is the same. A request that declares both Transfer-Encoding and Content-Length is a
 *   smuggling attempt, named on its own when the parser reports the conflict. Otherwise the code
 *   names the part of the message that is wrong, by Node's parser code, and by the position for a
 *   code llhttp raises in more than one part. A code the tables do not name, a parser's or a
 *   socket's, is handed on as Node's error with the status 400 every parser error answers, so it
 *   answers as an unnamed refusal of the client's request under Node's own code, never as a
 *   parser's code.
 * @param error - The connection's error, as Node emits it with `clientError`.
 * @param readingBody - Whether the parser was reading the body of a request the server is
 *   answering when it failed.
 * @returns The failure to answer.
 */
export function connectionFailure(
  error: ConnectionError,
  readingBody: boolean
): RegisteredError | (ConnectionError & { readonly statusCode: number }) {
  if (error.code === "ERR_HTTP_REQUEST_TIMEOUT") {
    return RegisteredError.of(HTTP_ERRORS.REQUEST_TIMEOUT, { cause: error });
  }
  if (error.code === "HPE_HEADER_OVERFLOW") {
    return RegisteredError.of(HTTP_ERRORS.REQUEST_HEADERS_TOO_LARGE, { cause: error });
  }
  if (error.code === "HPE_UNEXPECTED_CONTENT_LENGTH") {
    return RegisteredError.of(HTTP_ERRORS.CONTENT_LENGTH_REPEATED, { cause: error });
  }
  if (error.code === "HPE_INVALID_EOF_STATE") {
    return RegisteredError.of(HTTP_ERRORS.REQUEST_INCOMPLETE, { cause: error });
  }
  const reason = reasonOf(error);
  if (reason !== undefined && LENGTH_CONFLICT_REASONS.has(reason)) {
    return RegisteredError.of(HTTP_ERRORS.TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH, {
      cause: error,
    });
  }
  switch (messagePartOf(error, readingBody)) {
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

/** The requests each connection is answering, by its socket, in the order they arrived. */
export type RequestsInFlight = WeakMap<Socket, RequestInFlight[]>;

/**
 * @function trackRequestsInFlight
 * @description Keeps, for each connection, the requests the server is answering on it, in the
 *   order they arrived, which is the order their answers are written in: the first `onRequest` hook
 *   appends each, with its client's address while the connection can still give it, and a request
 *   leaves the list once its answer is sent (its `onResponse` hook) and its own message has been
 *   read whole, which for a request answered before its body arrived is when that message closes:
 *   until then, a failure of its body is its own. The list holds no more than the requests Node
 *   itself keeps unanswered on the connection, and is kept by the socket weakly, so it cannot
 *   outlive its connection; a message that closes before it is whole takes its connection with it
 *   (Node destroys the socket of an aborted message). The relation is read from the framework's
 *   documented request and hooks and the message's documented `complete` and `close`; the requests
 *   a connection holds are kept by Node in fields it does not document. A request read on a
 *   connection already answered for a failure of its parser is not taken: the hook writes its one
 *   line and hijacks its reply, so no route and no later hook runs for it and nothing is sent.
 * @param server - The server, before any route is registered on it.
 * @param requestsInFlight - Where the requests are kept.
 */
export function trackRequestsInFlight(
  server: FastifyInstance,
  requestsInFlight: RequestsInFlight
): void {
  server.addHook("onRequest", (request, reply, done) => {
    const refusal = answeredConnections.get(request.socket);
    if (refusal !== undefined) {
      // The failed message read whole after its request timeout was answered, or a request
      // pipelined after it: a hijacked reply runs no later hook and no route, and sends nothing
      // after the connection's refusal.
      logRequestNotTaken(request, refusal, server.log);
      reply.hijack();
      done();
      return;
    }
    const inFlight = requestsInFlight.get(request.socket);
    if (inFlight === undefined) requestsInFlight.set(request.socket, [{ request, reply }]);
    else inFlight.push({ request, reply });
    keepClientAddress(request);
    done();
  });
  server.addHook("onResponse", (request, _reply, done) => {
    const forget = (): void => {
      const inFlight = requestsInFlight.get(request.socket) ?? [];
      const index = inFlight.findIndex((entry) => entry.request === request);
      if (index !== -1) inFlight.splice(index, 1);
    };
    if (request.raw.complete) forget();
    else request.raw.once("close", forget);
    done();
  });
}

/**
 * @function createClientErrorHandler
 * @description Builds the server's `clientErrorHandler` option: a connection whose parser fails is
 *   answered on the server's logger, the instance Fastify binds the option to, with the failure
 *   `connectionFailure` names. Node hands it the connection's error and its socket and no request;
 *   the requests the connection is answering are read from what `trackRequestsInFlight` keeps, in
 *   the order they arrived. With none, `sendProblemOnSocket` answers at once. When the latest is
 *   still being read, the failure is that request's own: `sendProblemOnSocket` answers it, at once
 *   or, when an earlier request is still unanswered, once that request's answer has ended. When the
 *   latest is complete, the failure is the next message's, its own event:
 *   `sendProblemAfterAnswerInFlight` answers it once the answer in flight has ended. So an answer
 *   is never written ahead of the answer of a request that arrived before it. A connection is
 *   answered once, under the correlation id the handler keeps as its refusal. Node calls the handler again for a connection it answered in three ways:
 *   for each later chunk, since llhttp returns its error again once failed; for the request
 *   timeout of the failed message, which stays among the messages Node times out; and for the end
 *   of data, when the client ends its side in the middle of a message the parser has not failed,
 *   as after a request timeout. Each is the same failure's and is not answered again; but in the
 *   last two Node leaves closing the socket to this handler, so once the client has ended its side,
 *   in that call or in the first, the server ends its own, and a refusal waiting for the answer in
 *   flight then finds a connection that can no longer be written. A client that ends its side
 *   after a failure llhttp raised needs nothing more: Node raises no error at the end of data for a
 *   parser already failed, and ends the server's side itself. A connection the client reset
 *   (`ECONNRESET`), or one already destroyed, is left as it is, as the framework's own handler
 *   leaves it: nothing can be written to it, and a request in flight on it logs its own failure
 *   when its body's stream fails. No hook of the application runs for these answers, so they carry
 *   no security header and count against no rate limit and no metric.
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
    if (answeredConnections.has(socket)) {
      endWhenTheClientHasEnded(socket);
      return;
    }
    const inFlight = requestsInFlight.get(socket) ?? [];
    const latest = inFlight.at(-1);
    let refusal: string;
    if (latest === undefined) {
      refusal = sendProblemOnSocket(
        socket,
        connectionFailure(error, false),
        this.log,
        undefined,
        undefined
      );
    } else if (latest.request.raw.complete) {
      refusal = sendProblemAfterAnswerInFlight(
        socket,
        connectionFailure(error, false),
        this.log,
        latest
      );
    } else {
      refusal = sendProblemOnSocket(
        socket,
        connectionFailure(error, true),
        this.log,
        latest,
        inFlight.at(-2)
      );
    }
    answeredConnections.set(socket, refusal);
    // A no-op once an answer written at once has ended the server's side.
    endWhenTheClientHasEnded(socket);
  };
}

/**
 * @function refuseTunnels
 * @description Answers a CONNECT request with `CONNECT_NOT_IMPLEMENTED` at 501 on its socket, then
 *   closes the connection. The server is not a proxy and opens no tunnel. Node hands such a request
 *   to the server's `connect` listener with its socket and the first bytes of the tunnel, and with
 *   no listener closes the connection with no answer; it removes its own listeners from the socket
 *   first, so the socket's errors, its end of data and every byte that follows are this listener's.
 *   The bytes are read and dropped, the head included; an error, which has already destroyed the
 *   socket, is not thrown; and when the client ends its side the server ends its own, as Node does
 *   between messages. The answer is written after the answer of the request still in flight on the
 *   connection, as every answer on a connection is. A CONNECT read on a connection already answered
 *   for a failure of its parser is not taken and writes its one line, as any request there does.
 *   An `Upgrade` request is not this case: Node hands it to the server's handler as an ordinary
 *   request when nothing listens for `upgrade`.
 * @param server - The server, before it listens.
 * @param requestsInFlight - The requests the connections are answering.
 */
export function refuseTunnels(server: FastifyInstance, requestsInFlight: RequestsInFlight): void {
  server.server.on("connect", (request: IncomingMessage, socket: Socket) => {
    socket.on("error", () => undefined);
    socket.on("end", () => socket.end());
    socket.resume();
    const refusal = answeredConnections.get(socket);
    if (refusal !== undefined) {
      logTunnelRequestNotTaken(socket, request, refusal, server.log);
      return;
    }
    sendProblemOnTunnelRequest(
      socket,
      request,
      RegisteredError.of(HTTP_ERRORS.CONNECT_NOT_IMPLEMENTED),
      server.log,
      requestsInFlight.get(socket)?.at(-1)
    );
  });
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
