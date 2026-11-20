/**
 * @file sendProblem.ts
 * @description The one writer of the API's error body and of a failure's one log line. It turns a
 *   failure into its problem, writes the line, reports a failure logged at error severity to
 *   Sentry, and sends the problem as `application/problem+json`: on the request's reply for every
 *   failure a request reaches, and straight to the socket, as a whole HTTP response, for a
 *   connection whose parser failed, where Node hands over no reply. A route answers a failure
 *   through it, the global error handler answers through it what is raised, and the server's
 *   `frameworkErrors` and `clientErrorHandler` options and its hooks for a closing server and an
 *   unsupported expectation answer through it what never reaches a route. A refusal below 500 that
 *   no registered code names, such as a plugin's 401 or 406, answers `REQUEST_REFUSED` at its own
 *   status and logs at error severity under the code it carries, or under `REQUEST_REFUSED` when
 *   it carries none, so the framework's own message does not reach the client and the gap in the
 *   registry is seen; one at 500 or above answers `INTERNAL_ERROR` the same way.
 * @layer infrastructure
 */
import { STATUS_CODES, type IncomingMessage } from "node:http";
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
const NOT_TAKEN_LOG_MESSAGE = "Request not taken: its connection was already refused";
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
 * failed on a message no request was read from, with no request in flight or after a complete one,
 * has none: its `method` and `url` are null, since no request reached the server's handler, and the
 * id generated for the answer is both its request id and its correlation id.
 */
interface FailedRequest {
  readonly requestId: string;
  readonly correlationId: string;
  readonly method: string | null;
  readonly url: string | null;
  /** The client's address and where it comes from, as `resolveClientAddress` derives them. */
  readonly address: ClientAddress;
  /**
   * The correlation id of the request whose answer the failure's answer waited for, the one just
   * ahead of it on its connection; absent when its answer waited for none.
   */
  readonly inFlightCorrelationId?: string;
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

/** A request's correlation id: the one a hook stamped, or its id when none did. */
function correlationIdOf(request: FastifyRequest): string {
  return request.correlationId ?? request.id;
}

/** A request as its failure's line and report name it. */
function failedRequestOf(request: FastifyRequest): FailedRequest {
  return {
    requestId: request.id,
    correlationId: correlationIdOf(request),
    method: request.method,
    url: request.url,
    address: clientAddresses.get(request) ?? resolveClientAddress(request),
  };
}

/** A connection whose failed message no request was read from, as its failure's line names it. */
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
 * A request Node hands over with its connection instead of to the server's handler, a CONNECT, as
 * its line names it: an id generated for it, the method and the target Node parsed, and the
 * connection's peer, since no forwarding header of a request the framework never reads is read.
 */
function tunnelRequestOf(socket: Socket, request: IncomingMessage): FailedRequest {
  return { ...connectionOf(socket), method: request.method ?? null, url: request.url ?? null };
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
  const { requestId, correlationId, method, url, inFlightCorrelationId } = failed;
  // The address never travels without its source: `ip` alone reads alike for a client a trusted
  // proxy reported and for the proxy itself.
  const { ip, source: ipSource } = failed.address;
  const precededBy = inFlightCorrelationId === undefined ? {} : { inFlightCorrelationId };
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
    ...precededBy,
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
      ...precededBy,
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
 * Writes the one line of a request read on a connection already refused, which is not taken: it is
 * no failure of its own and gets no answer, so the line is at info, beside the framework's own
 * line for the request, and names the refusal that closes its connection.
 */
function writeNotTaken(
  read: FailedRequest,
  refusalCorrelationId: string,
  logger: FastifyBaseLogger
): void {
  const { correlationId, method, url } = read;
  const { ip, source: ipSource } = read.address;
  logger.info(
    { correlationId, method, url, ip, ipSource, refusalCorrelationId },
    NOT_TAKEN_LOG_MESSAGE
  );
}

/**
 * @description Writes the one line of a request the framework read on a connection already refused
 *   for a failure of its parser, which is not taken: its own correlation id, method, url and
 *   address, and the correlation id of the refusal that closes its connection.
 * @param request - The request read after the refusal.
 * @param refusalCorrelationId - The correlation id of the connection's refusal.
 * @param logger - The logger the line is written to.
 */
export function logRequestNotTaken(
  request: FastifyRequest,
  refusalCorrelationId: string,
  logger: FastifyBaseLogger
): void {
  writeNotTaken(failedRequestOf(request), refusalCorrelationId, logger);
}

/**
 * @description Writes the one line of a CONNECT request read on a connection already refused for a
 *   failure of its parser, which is not taken, as `logRequestNotTaken` does for a request the
 *   framework reads; its id is generated and its address is the connection's peer.
 * @param socket - The connection Node handed over with the request.
 * @param request - The CONNECT request.
 * @param refusalCorrelationId - The correlation id of the connection's refusal.
 * @param logger - The logger the line is written to.
 */
export function logTunnelRequestNotTaken(
  socket: Socket,
  request: IncomingMessage,
  refusalCorrelationId: string,
  logger: FastifyBaseLogger
): void {
  writeNotTaken(tunnelRequestOf(socket, request), refusalCorrelationId, logger);
}

/**
 * Answers a failure on the socket, as one whole response while the socket can still be written and
 * none when it cannot, the line saying which, and closes the connection once the answer is sent.
 */
function answerOnSocket(
  socket: Socket,
  error: unknown,
  failed: FailedRequest,
  logger: FastifyBaseLogger
): void {
  const writable = socket.writable;
  const { problem, headers } = answerFailure(
    error,
    failed,
    logger,
    writable ? LOG_MESSAGE : UNWRITABLE_LOG_MESSAGE
  );
  if (writable) socket.write(httpResponseOf(problem, headers));
  socket.destroySoon();
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
 * Answers the failure of a request's own message on the socket, unless its own answer has already
 * started: a second status line inside a response would corrupt it, so no byte is written, the line
 * says the failure came after the answer, and the connection is destroyed at once, as Node's own
 * handler does.
 */
function answerRequestOnSocket(
  socket: Socket,
  error: unknown,
  failed: FailedRequest,
  logger: FastifyBaseLogger,
  reply: FastifyReply
): void {
  if (reply.raw.headersSent) {
    answerFailure(error, failed, logger, LATE_LOG_MESSAGE);
    socket.destroy();
    return;
  }
  answerOnSocket(socket, error, failed, logger);
}

/**
 * @description Answers the failure of a connection whose parser failed, where no reply exists, as
 *   Node's documentation of `clientError` asks: on the socket itself, as a whole HTTP response,
 *   only while the socket can still be written, and with the connection closed. With no request
 *   in flight, the answer is stamped with an id generated for it, null for the method and the url,
 *   and the peer's address, the one address the connection has. With a request in flight whose own
 *   message failed, the failure is that request's: it is answered once, under its own correlation
 *   id, method, url and address, and `sendProblem` answers nothing more for it, so its body stream's
 *   failure once the connection closes logs nothing again; the connection is closed, so its route's
 *   answer, if it still comes, reaches no client. On a connection an answer is never written ahead
 *   of the answer of a request that arrived before it: when a request arrived before the failing
 *   one and is still unanswered, the failure's answer waits for that request's answer to end (its
 *   response's `close`), and its line names that request by `inFlightCorrelationId`; responses on a
 *   connection end in the order their requests arrived, so the request just ahead is the last to
 *   end. When the failing request's own answer has already started by the time its failure is
 *   written, no byte is written: the line says the failure came after the answer and the
 *   connection is destroyed at once, as Node's own handler does. A message that follows a complete
 *   request is answered by `sendProblemAfterAnswerInFlight` instead.
 * @param socket - The connection whose parser failed.
 * @param error - The failure, a registered error whose cause is the connection's error.
 * @param logger - The logger the failure's one line is written to.
 * @param inFlight - The request whose own message failed, when there is one.
 * @param ahead - The request that arrived just before it and is still unanswered, when there is
 *   one.
 * @returns The correlation id the failure is answered under.
 */
export function sendProblemOnSocket(
  socket: Socket,
  error: unknown,
  logger: FastifyBaseLogger,
  inFlight: RequestInFlight | undefined,
  ahead: RequestInFlight | undefined
): string {
  if (inFlight === undefined) {
    const failed = connectionOf(socket);
    answerOnSocket(socket, error, failed, logger);
    return failed.correlationId;
  }
  answeredOnTheirConnection.add(inFlight.request);
  const failed: FailedRequest = {
    ...failedRequestOf(inFlight.request),
    ...(ahead !== undefined && { inFlightCorrelationId: correlationIdOf(ahead.request) }),
  };
  const answer = (): void => answerRequestOnSocket(socket, error, failed, logger, inFlight.reply);
  if (ahead === undefined) answer();
  else answerAfter(ahead, answer);
  return failed.correlationId;
}

/**
 * @description Answers the failure of a message that follows a complete request still in flight on
 *   its connection, as its own event: the request in flight is not failed by what follows it, so it
 *   is answered by its route and logs nothing for it, and the failure gets an id generated for it,
 *   null for the method and the url, the peer's address, and on its line the correlation id of the
 *   request in flight. Responses on a reused connection are matched to requests by their order
 *   alone, as Node's documentation of `http.Agent` says, so the failure's answer waits for the
 *   answer in flight to end (its response's `close` event, "the response is completed, or its
 *   underlying connection was terminated prematurely") and is written after its last byte, never
 *   between or over it, then the connection is closed. When the connection can no longer be
 *   written by then (the answer in flight closed it, the client went away, or the server ended its
 *   side once the client had ended its own, as `createClientErrorHandler` does), nothing is
 *   written, the line says so, and the connection is closed. The id and the address are taken when
 *   the failure arrives, while the connection can still give its peer's address. While the client
 *   stays connected, nothing but that answer's end bounds the wait, and no timer is added: a
 *   request in flight whose route never answers holds its connection as long whether or not a
 *   message follows it, since the server sets no handler or idle timeout and Node's request
 *   timeout bounds only a message still being received.
 * @param socket - The connection whose parser failed on the following message.
 * @param error - The failure, a registered error whose cause is the connection's error.
 * @param logger - The logger the failure's one line is written to.
 * @param inFlight - The complete request whose answer is still in flight on the connection, the
 *   latest to arrive, whose answer ends after every earlier one.
 * @returns The correlation id the failure is answered under.
 */
export function sendProblemAfterAnswerInFlight(
  socket: Socket,
  error: unknown,
  logger: FastifyBaseLogger,
  inFlight: RequestInFlight
): string {
  const failed: FailedRequest = {
    ...connectionOf(socket),
    inFlightCorrelationId: correlationIdOf(inFlight.request),
  };
  answerAfter(inFlight, () => answerOnSocket(socket, error, failed, logger));
  return failed.correlationId;
}

/**
 * Runs an answer once the answer of the request in flight ahead of it ends. The request leaves
 * `trackRequestsInFlight`'s list in its `onResponse` hook, which the response's `finish` runs before
 * Node emits its `close` on the next tick: a request still in the list has a `close` to come.
 */
function answerAfter(ahead: RequestInFlight, answer: () => void): void {
  ahead.reply.raw.once("close", answer);
}

/**
 * @description Answers a CONNECT request, which Node hands over with its connection instead of to
 *   the server's handler, through the API's one error body on the socket, then closes the
 *   connection: an id generated for it, the method and the target Node parsed, and the peer's
 *   address. Behind a request still in flight on the connection, the answer waits for that
 *   request's answer to end, as every answer on a connection does, and its line names that request
 *   by `inFlightCorrelationId`.
 * @param socket - The connection Node handed over with the request.
 * @param request - The CONNECT request.
 * @param error - The failure, a registered error.
 * @param logger - The logger the failure's one line is written to.
 * @param ahead - The request still in flight on the connection, when there is one.
 */
export function sendProblemOnTunnelRequest(
  socket: Socket,
  request: IncomingMessage,
  error: unknown,
  logger: FastifyBaseLogger,
  ahead: RequestInFlight | undefined
): void {
  const read = tunnelRequestOf(socket, request);
  if (ahead === undefined) {
    answerOnSocket(socket, error, read, logger);
    return;
  }
  const failed: FailedRequest = { ...read, inFlightCorrelationId: correlationIdOf(ahead.request) };
  answerAfter(ahead, () => answerOnSocket(socket, error, failed, logger));
}
