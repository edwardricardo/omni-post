/**
 * @file sendProblem.ts
 * @description The one writer of the API's error body. It turns a failure into its problem, writes
 *   the failure's one log line, reports an unexpected failure to Sentry, and sends the problem as
 *   `application/problem+json`. A route answers a failure through it, and the global error handler
 *   answers through it what is raised.
 * @layer infrastructure
 */
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import { captureError } from "../../observability/sentryInit.js";
import { PROBLEM_MEDIA_TYPE, toProblem } from "./problem.js";

const LOG_MESSAGE = "Request failed";

/**
 * @description Answers a failure with the API's one error body, at the problem's status, with the
 *   headers the failure needs, and logs it once at the answer's severity.
 * @param request - The request that failed; its correlation id, or its id when no hook set one,
 *   stamps the problem and the log line.
 * @param reply - The reply the problem is sent on.
 * @param error - The failure, a raised value or a `Result`'s error.
 * @param logger - The logger the failure's one line is written to.
 * @returns The reply, sent.
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
  const fields = {
    code: answer.loggedCode,
    wireCode: problem.code,
    status: problem.status,
    source: answer.source,
    correlationId,
    method,
    url,
    err: error,
  };
  if (answer.severity === "error") {
    logger.error(fields, LOG_MESSAGE);
    captureError(error, {
      requestId: request.id,
      correlationId,
      code: answer.loggedCode,
      method,
      url,
      ip: request.ip,
    });
  } else {
    logger.warn(fields, LOG_MESSAGE);
  }
  // A string under a JSON media type is sent as it is: no preSerialization hook and no response
  // schema the route declares for this status reads it, so a route's success shape never refuses
  // the problem.
  return reply
    .code(problem.status)
    .headers(answer.headers)
    .type(PROBLEM_MEDIA_TYPE)
    .send(JSON.stringify(problem));
}
