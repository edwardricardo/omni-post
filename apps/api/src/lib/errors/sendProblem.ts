/**
 * @file sendProblem.ts
 * @description The one writer of the API's error body and of a failure's one log line. It turns a
 *   failure into its problem, writes the line, reports a failure logged at error severity to
 *   Sentry, and sends the problem as `application/problem+json`: on the request's reply for every
 *   failure a request reaches, and straight to the socket, as a whole HTTP response, for a
 *   connection whose parser failed, where Node hands over no reply. A route answers a failure
 *   through it, the global error handler answers through it what is raised, and the server's
 *   `frameworkErrors` and `clientErrorHandler` options and its hooks for a closing server and an
 *   unsupported expectation answer through it what never reaches a route. A framework refusal whose
 *   cause no `http` code names, such as a plugin's 401 or 406, answers `INTERNAL_ERROR` at its
 *   status and logs at error severity, so the framework's own message does not reach the client.
 * @layer infrastructure
 */
import { STATUS_CODES } from "node:http";
import type { Socket } from "node:net";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import { AppError, type Problem } from "@shared/types";
import { captureError } from "../../observability/sentryInit.js";
import { resolveClientAddress, type ClientAddress } from "../../security/resolveClientIp.js";
import { createCorrelationId } from "./correlationId.js";
import { PROBLEM_MEDIA_TYPE, carriedCode, toProblem } from "./problem.js";

const LOG_MESSAGE = "Request failed";
const LATE_LOG_MESSAGE = "Request failed after its answer was sent";
const UNWRITABLE_LOG_MESSAGE = "Request failed on a connection that can no longer be written";
/** How many causes the line follows: a longer chain, or one that circles, ends there. */
const MAX_CAUSES = 5;

/** What the log line says of an `Error`. */
interface ErrorFields {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
  readonly isOperational?: boolean;
  readonly cause?: ErrorFields | ValueFields;
  /** True when the error has a cause the line no longer follows. */
  readonly causeOmitted?: true;
}

/** What the log line says of a raised value that is not an `Error`: its type, never its content. */
interface ValueFields {
  readonly type: string;
  readonly code?: string;
}

/**
 * The request a failure answers, as its line and its report name it. A connection whose parser
 * failed with no request in flight has none: its `method` and `url` are null, since no request
 * reached the server's handler, and the id generated for the answer is both its request id and its
 * correlation id.
 */
interface FailedRequest {
  readonly requestId: string;
  readonly correlationId: string;
  readonly method: string | null;
  readonly url: string | null;
  /** The client's address and where it comes from, as `resolveClientAddress` derives them. */
  readonly address: ClientAddress;
}

/**
 * The requests a connection's failure was answered for: their own later failure, the body stream's
 * once the connection closes, already has its answer and its line.
 */
const answeredOnTheirConnection = new WeakSet<FastifyRequest>();

/**
 * Each request's client address and its source, as `resolveClientAddress` derived them when the
 * request arrived: Node no longer gives a destroyed connection's peer address, so the line of a
 * request whose client went away before its failure was logged still names it, and where it came
 * from.
 */
const clientAddresses = new WeakMap<FastifyRequest, ClientAddress>();

/**
 * @description Keeps a request's client address while its connection can still give it, for its
 *   failure's line.
 * @param request - The request, as it arrives.
 */
export function keepClientAddress(request: FastifyRequest): void {
  clientAddresses.set(request, resolveClientAddress(request));
}

/** The request a connection's failure belongs to, while the server is still answering it. */
export interface RequestInFlight {
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
}

/**
 * The failure as the log line carries it, built from a list of fields and never the value itself:
 * a value's other fields can hold a secret (an `AppError`'s details, a provider's response, a Prisma
 * error's meta, the bytes a connection received), and pino's error serializer walks every
 * enumerable field and raises on a frozen one. `name`, `message` and `stack` tell what failed and
 * where; `code` is the code the value carries as `carriedCode` reads it, a driver's or a library's
 * as well as a registered one; `isOperational` tells whether an `AppError` was an expected failure.
 * An error's `cause` is carried the same way, as its own projection in the same shape, for up to
 * `MAX_CAUSES` causes, and the last projection followed says so when the chain goes on: a use
 * case's failure names the infrastructure error under it, which is what an operator reads. A value
 * that is not an `Error` is carried as its type and its code.
 */
function failureFields(error: unknown, causesLeft = MAX_CAUSES): ErrorFields | ValueFields {
  const code = carriedCode(error);
  const coded = code === undefined ? {} : { code };
  if (!(error instanceof Error)) return { type: error === null ? "null" : typeof error, ...coded };
  const hasCause = error.cause !== undefined;
  return {
    name: error.name,
    message: error.message,
    ...coded,
    ...(typeof error.stack === "string" && { stack: error.stack }),
    ...(error instanceof AppError && { isOperational: error.isOperational }),
    ...(hasCause && causesLeft > 0 && { cause: failureFields(error.cause, causesLeft - 1) }),
    ...(hasCause && causesLeft === 0 && { causeOmitted: true as const }),
  };
}

/** A request as its failure's line and report name it. */
function failedRequestOf(request: FastifyRequest): FailedRequest {
  return {
    requestId: request.id,
    correlationId: request.correlationId ?? request.id,
    method: request.method,
    url: request.url,
    address: clientAddresses.get(request) ?? resolveClientAddress(request),
  };
}

/** A connection with no request in flight, as its failure's line names it. */
function connectionOf(socket: Socket): FailedRequest {
  const id = createCorrelationId();
  return {
    requestId: id,
    correlationId: id,
    method: null,
    url: null,
    // A request read from this socket with no forwarding header would carry the peer as its `ip`,
    // so the resolver names the peer, a trusted proxy's own address included; it answers
    // "unknown" when the socket has no peer address.
    address: resolveClientAddress({ ip: socket.remoteAddress ?? "", socket }),
  };
}

/**
 * Builds a failure's answer and writes its one line, with the same fields on every path, at the
 * answer's severity; a line at error is reported to Sentry too.
 */
function answerFailure(
  error: unknown,
  failed: FailedRequest,
  logger: FastifyBaseLogger,
  message: string,
  bodyStreamError?: Error | null
) {
  const { requestId, correlationId, method, url } = failed;
  // The address never travels without its source: `ip` alone reads alike for a client a trusted
  // proxy reported and for the proxy itself.
  const { ip, source: ipSource } = failed.address;
  const answer = toProblem(error, {
    correlationId,
    now: new Date(),
    ...(bodyStreamError !== undefined && { bodyStreamError }),
  });
  // The key is not pino's `err`, whose serializer would read the projection as an error again.
  const fields = {
    code: answer.loggedCode,
    wireCode: answer.problem.code,
    status: answer.problem.status,
    source: answer.source,
    correlationId,
    method,
    url,
    ip,
    ipSource,
    error: failureFields(error),
  };
  if (answer.severity === "error") {
    logger.error(fields, message);
    captureError(error, {
      requestId,
      correlationId,
      code: answer.loggedCode,
      method,
      url,
      ip,
      ipSource,
    });
  } else {
    logger.warn(fields, message);
  }
  return answer;
}

/**
 * A problem as one whole HTTP/1.1 response, for a socket nothing else writes to: the connection is
 * closed once it is sent, so the response says so.
 */
function httpResponseOf(problem: Problem, headers: Readonly<Record<string, string>>): string {
  const body = JSON.stringify(problem);
  // HTTP/1.1 takes an empty reason phrase, and Node knows one for every status the registry holds.
  const reason = STATUS_CODES[problem.status] ?? "";
  const head = [
    `HTTP/1.1 ${String(problem.status)} ${reason}`,
    `Content-Type: ${PROBLEM_MEDIA_TYPE}`,
    `Content-Length: ${String(Buffer.byteLength(body))}`,
    "Connection: close",
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
  ];
  return `${head.join("\r\n")}\r\n\r\n${body}`;
}

/**
 * @description Answers a failure with the API's one error body, at the problem's status, with the
 *   headers the failure needs, and logs it once at the answer's severity. A reply whose answer has
 *   ended, or that a handler hijacked, is left as it is, and the line says the failure came after
 *   the answer. That is what the framework's `reply.sent` reads: a `send` still in its `onSend`
 *   hooks is not seen, by this function or by the framework's own second `send`, and the problem
 *   then replaces that answer's status and content type. When the request's connection is already
 *   destroyed nothing can be sent: the line says so and the reply is hijacked, so the framework
 *   sends nothing either. A failure of the request's own body stream answers the code of its cause.
 *   A request whose connection's failure was already answered for it writes no second line and
 *   sends nothing: its reply is hijacked, and the framework, which reads a hijacked reply returned
 *   to it as handled, does not send it either.
 * @param request - The request that failed; its correlation id, or its id when no hook set one,
 *   stamps the problem and the log line, and the line carries its client's address.
 * @param reply - The reply the problem is sent on.
 * @param error - The failure, a raised value or a `Result`'s error.
 * @param logger - The logger the failure's one line is written to.
 * @returns The reply: sent with the problem, or as it was when it had been sent already.
 */
export function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  logger: FastifyBaseLogger
): FastifyReply {
  if (answeredOnTheirConnection.has(request)) return reply.hijack();
  const gone = request.socket.destroyed;
  const message = reply.sent ? LATE_LOG_MESSAGE : gone ? UNWRITABLE_LOG_MESSAGE : LOG_MESSAGE;
  const answer = answerFailure(
    error,
    failedRequestOf(request),
    logger,
    message,
    request.raw.errored
  );
  if (reply.sent) return reply;
  if (gone) return reply.hijack();
  // A string under a JSON media type is sent as it is: no preSerialization hook and no response
  // schema the route declares for this status reads it, so a route's success shape never refuses
  // the problem.
  return reply
    .code(answer.problem.status)
    .headers(answer.headers)
    .type(PROBLEM_MEDIA_TYPE)
    .send(JSON.stringify(answer.problem));
}

/**
 * @description Answers the failure of a connection whose parser failed, where no reply exists, as
 *   Node's documentation of `clientError` asks: on the socket itself, as a whole HTTP response,
 *   only while the socket can still be written, and with the connection closed. With no request
 *   in flight, the answer is stamped with an id generated for it, null for the method and the url,
 *   and the peer's address, the one address the connection has. With a request in flight, the
 *   failure is that request's: it is answered once, under its own correlation id, method, url and
 *   address, and `sendProblem` answers nothing more for it, so its body stream's failure once the
 *   connection closes logs nothing again; the connection is closed, so its route's answer, if it
 *   still comes, reaches no client. When that request's
 *   answer has already started, no byte is written, since a second status line inside a response
 *   would corrupt it: the line says the failure came after the answer and the connection is
 *   destroyed at once, as Node's own handler does.
 * @param socket - The connection whose parser failed.
 * @param error - The failure, a registered error whose cause is the connection's error.
 * @param logger - The logger the failure's one line is written to.
 * @param inFlight - The request the connection is answering, when there is one.
 */
export function sendProblemOnSocket(
  socket: Socket,
  error: unknown,
  logger: FastifyBaseLogger,
  inFlight: RequestInFlight | undefined
): void {
  if (inFlight !== undefined) {
    answeredOnTheirConnection.add(inFlight.request);
    if (inFlight.reply.raw.headersSent) {
      answerFailure(error, failedRequestOf(inFlight.request), logger, LATE_LOG_MESSAGE);
      socket.destroy();
      return;
    }
  }
  const writable = socket.writable;
  const { problem, headers } = answerFailure(
    error,
    inFlight === undefined ? connectionOf(socket) : failedRequestOf(inFlight.request),
    logger,
    writable ? LOG_MESSAGE : UNWRITABLE_LOG_MESSAGE
  );
  if (writable) socket.write(httpResponseOf(problem, headers));
  socket.destroySoon();
}
