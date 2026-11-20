/**
 * @file sendProblem.ts
 * @description The one writer of the API's error body and of a failure's one log line. It turns a
 *   failure into its problem, writes the line, reports a failure logged at error severity to
 *   Sentry, and sends the problem as `application/problem+json`: on the request's reply for every
 *   failure a request reaches, and straight to the socket, as a whole HTTP response, for a
 *   connection whose request could not be read, where the framework hands over no reply. A route
 *   answers a failure through it, the global error handler answers through it what is raised, and
 *   the server's `frameworkErrors` and `clientErrorHandler` options and its hook for a server that
 *   is closing answer through it what never reaches a route. A framework refusal whose cause no
 *   `http` code names, such as a plugin's 401 or 406, answers `INTERNAL_ERROR` at its status and
 *   logs at error severity, so the framework's own message does not reach the client.
 * @layer infrastructure
 */
import { STATUS_CODES } from "node:http";
import type { Socket } from "node:net";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import { AppError, isCodedError, type Problem } from "@shared/types";
import { captureError } from "../../observability/sentryInit.js";
import { resolveClientIp } from "../../security/resolveClientIp.js";
import { createCorrelationId } from "./correlationId.js";
import { PROBLEM_MEDIA_TYPE, toProblem } from "./problem.js";

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
}

/** What the log line says of a raised value that is not an `Error`: its type, never its content. */
interface ValueFields {
  readonly type: string;
  readonly code?: string;
}

/**
 * The request a failure answers, as its line and its report name it. A connection whose request
 * could not be read has none: its `method` and `url` are null, since no request line was read, and
 * the id generated for the answer is both its request id and its correlation id.
 */
interface FailedRequest {
  readonly requestId: string;
  readonly correlationId: string;
  readonly method: string | null;
  readonly url: string | null;
  /** The client's address, as `resolveClientIp` derives it. */
  readonly ip: string;
}

/**
 * The failure as the log line carries it, built from a list of fields and never the value itself:
 * a value's other fields can hold a secret (an `AppError`'s details, a provider's response, a Prisma
 * error's meta, the bytes a connection received), and pino's error serializer walks every
 * enumerable field and raises on a frozen one. `name`, `message` and `stack` tell what failed and
 * where; `code` is the code the value carries, a driver's or a library's as well as a registered
 * one; `isOperational` tells whether an `AppError` was an expected failure. An error's `cause` is
 * carried the same way, as its own projection in the same shape, for up to `MAX_CAUSES` causes: a
 * use case's failure names the infrastructure error under it, which is what an operator reads. A
 * value that is not an `Error` is carried as its type and its code.
 */
function failureFields(error: unknown, causesLeft = MAX_CAUSES): ErrorFields | ValueFields {
  const code = isCodedError(error) ? { code: error.code } : {};
  if (!(error instanceof Error)) return { type: error === null ? "null" : typeof error, ...code };
  return {
    name: error.name,
    message: error.message,
    ...code,
    ...(typeof error.stack === "string" && { stack: error.stack }),
    ...(error instanceof AppError && { isOperational: error.isOperational }),
    ...(error.cause !== undefined &&
      causesLeft > 0 && { cause: failureFields(error.cause, causesLeft - 1) }),
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
  message: string
) {
  const { requestId, correlationId, method, url, ip } = failed;
  const answer = toProblem(error, { correlationId, now: new Date() });
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
    error: failureFields(error),
  };
  if (answer.severity === "error") {
    logger.error(fields, message);
    captureError(error, { requestId, correlationId, code: answer.loggedCode, method, url, ip });
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
 *   then replaces that answer's status and content type.
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
  const answer = answerFailure(
    error,
    {
      requestId: request.id,
      correlationId: request.correlationId ?? request.id,
      method: request.method,
      url: request.url,
      ip: resolveClientIp(request),
    },
    logger,
    reply.sent ? LATE_LOG_MESSAGE : LOG_MESSAGE
  );
  if (reply.sent) return reply;
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
 * @description Answers the failure of a connection whose request could not be read, where no reply
 *   exists: the same problem and the same line as `sendProblem`, stamped with an id generated for
 *   the answer, with null for the method and the url no request line gave, and the peer's address,
 *   the one address the connection has. As the framework's documentation of a client-error handler
 *   asks, the answer is written as a whole HTTP response only while the socket can still be
 *   written; when it cannot, the line says so. The connection is then closed once what was written
 *   has gone out.
 * @param socket - The connection whose request could not be read.
 * @param error - The failure, a registered error whose cause is the connection's error.
 * @param logger - The logger the failure's one line is written to.
 */
export function sendProblemOnSocket(
  socket: Socket,
  error: unknown,
  logger: FastifyBaseLogger
): void {
  const id = createCorrelationId();
  const writable = socket.writable;
  const { problem, headers } = answerFailure(
    error,
    {
      requestId: id,
      correlationId: id,
      method: null,
      url: null,
      // A request read from this socket with no forwarding header would carry the peer as its
      // `ip`; the resolver answers "unknown" when the socket has no peer address.
      ip: resolveClientIp({ ip: socket.remoteAddress ?? "", socket }),
    },
    logger,
    writable ? LOG_MESSAGE : UNWRITABLE_LOG_MESSAGE
  );
  if (writable) socket.write(httpResponseOf(problem, headers));
  socket.destroySoon();
}
