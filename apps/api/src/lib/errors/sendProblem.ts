/**
 * @file sendProblem.ts
 * @description The one writer of the API's error body. It turns a failure into its problem, writes
 *   the failure's one log line, reports an unexpected failure to Sentry, and sends the problem as
 *   `application/problem+json`. A route answers a failure through it, and the global error handler
 *   answers through it what is raised. A framework refusal whose status no `http` code holds, such
 *   as a plugin's 401 or 406, answers `INTERNAL_ERROR` at that status and logs at error severity,
 *   so the framework's own message does not reach the client. Two framework refusals never reach
 *   this function, because the app sets no `frameworkErrors`: `FST_ERR_BAD_URL` and
 *   `FST_ERR_MAX_PARAM_LENGTH` answer the framework's own body.
 * @layer infrastructure
 */
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@shared/types";
import { captureError } from "../../observability/sentryInit.js";
import { PROBLEM_MEDIA_TYPE, toProblem } from "./problem.js";

const LOG_MESSAGE = "Request failed";
const LATE_LOG_MESSAGE = "Request failed after its answer was sent";
/** How many causes the line follows: a longer chain, or one that circles, ends there. */
const MAX_CAUSES = 5;

/** What the log line says of an `Error`. */
interface ErrorFields {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly isOperational?: boolean;
  readonly cause?: ErrorFields | ValueFields;
}

/** What the log line says of a raised value that is not an `Error`: its type, never its content. */
interface ValueFields {
  readonly type: string;
}

/**
 * The failure as the log line carries it, built from a list of fields and never the value itself:
 * a value's other fields can hold a secret (an `AppError`'s details, a provider's response, a Prisma
 * error's meta), and pino's error serializer walks every enumerable field and raises on a frozen one.
 * `name`, `message` and `stack` tell what failed and where; `isOperational` tells whether an
 * `AppError` was an expected failure. The code the value carries is the line's own `code`. An
 * error's `cause` is carried the same way, as its own projection, for up to `MAX_CAUSES` causes: a
 * use case's failure names the infrastructure error under it, which is what an operator reads.
 */
function failureFields(error: unknown, causesLeft = MAX_CAUSES): ErrorFields | ValueFields {
  if (!(error instanceof Error)) return { type: error === null ? "null" : typeof error };
  return {
    name: error.name,
    message: error.message,
    ...(typeof error.stack === "string" && { stack: error.stack }),
    ...(error instanceof AppError && { isOperational: error.isOperational }),
    ...(error.cause !== undefined &&
      causesLeft > 0 && { cause: failureFields(error.cause, causesLeft - 1) }),
  };
}

/**
 * @description Answers a failure with the API's one error body, at the problem's status, with the
 *   headers the failure needs, and logs it once at the answer's severity. A reply whose answer has
 *   ended, or that a handler hijacked, is left as it is, and the line says the failure came after
 *   the answer. That is what the framework's `reply.sent` reads: a `send` still in its `onSend`
 *   hooks is not seen, by this function or by the framework's own second `send`, and the problem
 *   then replaces that answer's status and content type.
 * @param request - The request that failed; its correlation id, or its id when no hook set one,
 *   stamps the problem and the log line.
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
  const correlationId = request.correlationId ?? request.id;
  const answer = toProblem(error, { correlationId, now: new Date() });
  const { problem } = answer;
  const { method, url } = request;
  // The key is not pino's `err`, whose serializer would read the projection as an error again.
  const fields = {
    code: answer.loggedCode,
    wireCode: problem.code,
    status: problem.status,
    source: answer.source,
    correlationId,
    method,
    url,
    error: failureFields(error),
  };
  const message = reply.sent ? LATE_LOG_MESSAGE : LOG_MESSAGE;
  if (answer.severity === "error") {
    logger.error(fields, message);
    captureError(error, {
      requestId: request.id,
      correlationId,
      code: answer.loggedCode,
      method,
      url,
      ip: request.ip,
    });
  } else {
    logger.warn(fields, message);
  }
  if (reply.sent) return reply;
  // A string under a JSON media type is sent as it is: no preSerialization hook and no response
  // schema the route declares for this status reads it, so a route's success shape never refuses
  // the problem.
  return reply
    .code(problem.status)
    .headers(answer.headers)
    .type(PROBLEM_MEDIA_TYPE)
    .send(JSON.stringify(problem));
}
