/**
 * @file problem.ts
 * @description The API's one error body, an RFC 9457 problem, its schema, and `toProblem`, which
 *   turns any failure into that body. A registered code answers its registry entry, worded by the
 *   registry and never by the error's own message; an internal or configuration code reaches the
 *   wire as `INTERNAL_ERROR` and keeps its own code for the log. The framework's refusals answer
 *   the `http` code of their own cause. A failure nobody registered keeps its status: an
 *   `AppError` its own status and code, and any other carrier of a failure status that status with
 *   `INTERNAL_ERROR`'s text. Every answer at 500 or above, and every answer the registry does not
 *   classify, is logged at error; a refusal of the client's request at warn. Pure: no logger, no
 *   clock, no request.
 * @layer infrastructure
 */
import { z } from "zod";
import {
  AppError,
  COMMON_ERRORS,
  ERROR_CATEGORY,
  ERROR_CODE_MAX_LENGTH,
  ERROR_CODE_PATTERN,
  HTTP_ERRORS,
  PROBLEM_ISSUE_PART,
  formatErrorMessage,
  isCodedError,
  resolveError,
  titleOf,
  type ErrorParams,
  type Problem,
  type ProblemIssue,
  type ProblemIssuePart,
  type RegisteredDefinition,
} from "@shared/types";

export const PROBLEM_MEDIA_TYPE = "application/problem+json; charset=utf-8";

/** The origin of every problem type: a deployment-independent identifier, not a page to fetch. */
const PROBLEM_TYPE_BASE = "https://omnipost.app/problems/";

const paramValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

const problemIssueSchema = z.object({
  part: z.enum([
    PROBLEM_ISSUE_PART.BODY,
    PROBLEM_ISSUE_PART.QUERYSTRING,
    PROBLEM_ISSUE_PART.PARAMS,
    PROBLEM_ISSUE_PART.HEADERS,
  ]),
  pointer: z.string(),
  code: z.string().min(1),
  detail: z.string(),
});

/** The schema the API's contract publishes for the body; `code` is a pattern, not a list. */
export const problemSchema: z.ZodType<Problem> = z.object({
  type: z.string().startsWith(PROBLEM_TYPE_BASE),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().min(1),
  code: z.string().regex(ERROR_CODE_PATTERN).max(ERROR_CODE_MAX_LENGTH),
  correlationId: z.string().min(1),
  timestamp: z.iso.datetime(),
  params: z.record(z.string(), paramValueSchema).exactOptional(),
  issues: z.array(problemIssueSchema).exactOptional(),
});

/** Which step of `toProblem` answered, for the log. */
export const PROBLEM_SOURCE = {
  REGISTERED: "registered",
  VALIDATION: "validation",
  FRAMEWORK: "framework",
  APP_ERROR: "app-error",
  STATUS_CARRIER: "status-carrier",
  UNREGISTERED: "unregistered",
} as const;
type ProblemSource = (typeof PROBLEM_SOURCE)[keyof typeof PROBLEM_SOURCE];

type ProblemSeverity = "warn" | "error";

/** What a problem is stamped with: the request's correlation id and the moment it failed. */
export interface ProblemContext {
  readonly correlationId: string;
  readonly now: Date;
}

/** A failure's answer: what is sent, and what the one log line of it says. */
export interface ProblemAnswer {
  readonly problem: Problem;
  /** The headers the failure needs, derived from its definition, never set where it is raised. */
  readonly headers: Readonly<Record<string, string>>;
  readonly source: ProblemSource;
  /** The code before the wire collapse: the one the value carried, when it carried one. */
  readonly loggedCode: string;
  readonly severity: ProblemSeverity;
}

const INTERNAL_ERROR: RegisteredDefinition = COMMON_ERRORS.INTERNAL_ERROR;
const VALIDATION_FAILED: RegisteredDefinition = COMMON_ERRORS.VALIDATION_FAILED;
const NO_HEADERS: Readonly<Record<string, string>> = Object.freeze({});

/** The categories whose text is the server's own business: the wire says only that it failed. */
const WIRE_HIDDEN_CATEGORIES: ReadonlySet<string> = new Set([
  ERROR_CATEGORY.INTERNAL,
  ERROR_CATEGORY.CONFIGURATION,
]);

/** The lowest status of a failure of the server or of what it depends on. */
const SERVER_FAILURE_STATUS = 500;

/**
 * The framework's refusals of a client's request, each answered by the `http` code of its own
 * cause, by Fastify's code. Every error of the installed Fastify with a 4xx status that a request
 * can raise is here, or named below with the reason it is not:
 * - `FST_ERR_VALIDATION` is answered by the validation step, which reads its issues;
 * - `FST_ERR_NOT_FOUND` is raised only when the router matched not even the not-found handler's
 *   catch-all route, which Fastify reports as a defect of its own: it answers as a status carrier;
 * - `FST_ERR_CTP_INSTANCE_ALREADY_STARTED` and `FST_ERR_INVALID_URL` are raised while content-type
 *   parsers and routes are registered, before any request, and `FST_ERR_ROUTE_MISSING_CONTENT` is
 *   no longer raised.
 * `FST_ERR_CTP_INVALID_MEDIA_TYPE` is raised for a content type that does not parse and for one no
 * parser takes: one cause, a content type the route does not accept. The third error the router
 * hands to `frameworkErrors`, `FST_ERR_ASYNC_CONSTRAINT`, carries 500 and is no refusal of the
 * client's request. A refusal whose cause is not here answers as a carrier of its status, logged at
 * error, so a cause the registry does not name is seen rather than filed under another's code.
 */
const FRAMEWORK_CAUSES: ReadonlyMap<string, RegisteredDefinition> = new Map<
  string,
  RegisteredDefinition
>([
  ["FST_ERR_BAD_URL", HTTP_ERRORS.PATH_NOT_DECODABLE],
  ["FST_ERR_MAX_PARAM_LENGTH", HTTP_ERRORS.ROUTE_PARAMETER_TOO_LONG],
  ["FST_ERR_CTP_BODY_TOO_LARGE", HTTP_ERRORS.PAYLOAD_TOO_LARGE],
  ["FST_ERR_CTP_INVALID_MEDIA_TYPE", HTTP_ERRORS.UNSUPPORTED_MEDIA_TYPE],
  ["FST_ERR_CTP_EMPTY_JSON_BODY", HTTP_ERRORS.JSON_BODY_EMPTY],
  ["FST_ERR_CTP_INVALID_JSON_BODY", HTTP_ERRORS.JSON_BODY_NOT_PARSABLE],
  ["FST_ERR_CTP_INVALID_CONTENT_LENGTH", HTTP_ERRORS.BODY_LENGTH_MISMATCH],
  ["FST_ERR_ROUTE_MISSING_CONTENT_TYPE", HTTP_ERRORS.CONTENT_TYPE_MISSING],
]);

/** The code of an issue whose validator names none. */
const UNKNOWN_ISSUE_CODE = "unknown";

/** What a problem holds beyond the members every problem takes from its code and its context. */
interface ProblemFields {
  readonly code: string;
  readonly status: number;
  readonly detail: string;
  readonly params?: ErrorParams | undefined;
  readonly issues?: readonly ProblemIssue[];
}

/** A value whose fields can be read by name. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/** Whether a value is an integer status inside a range of statuses. */
function isStatusBetween(value: unknown, lowest: number, highest: number): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= lowest && value <= highest
  );
}

/** Whether a value names a part of the request Fastify validates. */
function isRequestPart(value: unknown): value is ProblemIssuePart {
  return Object.values(PROBLEM_ISSUE_PART).some((part) => part === value);
}

/** The code a value carries, which the log keeps whatever code reaches the wire. */
function carriedCode(value: unknown): string | undefined {
  return isCodedError(value) ? value.code : undefined;
}

function problemOf(fields: ProblemFields, context: ProblemContext): Problem {
  return {
    type: `${PROBLEM_TYPE_BASE}${fields.code}`,
    title: titleOf(fields.code),
    status: fields.status,
    detail: fields.detail,
    code: fields.code,
    correlationId: context.correlationId,
    timestamp: context.now.toISOString(),
    ...(fields.params !== undefined && { params: fields.params }),
    ...(fields.issues !== undefined && { issues: fields.issues }),
  };
}

/**
 * A failure at 500 or above is one of the server or of what it depends on, logged and reported as
 * an error; so is a failure its raiser did not expect. Only an expected refusal of the client's
 * request is a warning. Every category's statuses are all below 500 or all at 500 or above, so the
 * status tells the category's side.
 */
function severityOf(status: number, expected: boolean): ProblemSeverity {
  return expected && status < SERVER_FAILURE_STATUS ? "warn" : "error";
}

/**
 * @param expected - Whether the failure is one its raiser expected: a registered code with every
 *   declared parameter, a refusal of the framework or of a schema, or an operational `AppError`.
 *   A value nothing classifies is not.
 */
function answerOf(
  problem: Problem,
  source: ProblemSource,
  loggedCode: string,
  expected: boolean
): ProblemAnswer {
  return {
    problem,
    headers: NO_HEADERS,
    source,
    loggedCode,
    severity: severityOf(problem.status, expected),
  };
}

/** A definition's problem as the registry words it, for a definition that declares no parameter. */
function definitionProblem(definition: RegisteredDefinition, context: ProblemContext): Problem {
  return problemOf(
    { code: definition.code, status: definition.status, detail: formatErrorMessage(definition) },
    context
  );
}

/** `INTERNAL_ERROR`'s problem at a status: the failure is told, its reason is not. */
function internalProblem(status: number, context: ProblemContext): Problem {
  return problemOf(
    { code: INTERNAL_ERROR.code, status, detail: formatErrorMessage(INTERNAL_ERROR) },
    context
  );
}

/** A registered code: its entry, or `INTERNAL_ERROR` on the wire for a server-side category. */
function registeredAnswer(error: unknown, context: ProblemContext): ProblemAnswer | undefined {
  const resolved = resolveError(error);
  if (!resolved.registered) return undefined;
  const { definition, params } = resolved;
  if (WIRE_HIDDEN_CATEGORIES.has(definition.category)) {
    return answerOf(
      internalProblem(INTERNAL_ERROR.status, context),
      PROBLEM_SOURCE.REGISTERED,
      definition.code,
      true
    );
  }
  // A declared parameter the value did not carry leaves its placeholder in the text: a defect of
  // the code that raised it, which `of` makes unreachable for typed code.
  const complete = Object.keys(definition.params).every(
    (name) => params !== undefined && Object.hasOwn(params, name)
  );
  return answerOf(
    problemOf(
      { code: definition.code, status: definition.status, detail: resolved.message, params },
      context
    ),
    PROBLEM_SOURCE.REGISTERED,
    definition.code,
    complete
  );
}

/**
 * One item of Fastify's `validation` list. The Zod type provider writes the issue's path as
 * `instancePath`, "/" for an issue about the whole part, and the issue's code as `keyword`.
 */
function issueOf(part: ProblemIssuePart, item: unknown): ProblemIssue {
  const fields: Readonly<Record<string, unknown>> = isRecord(item) ? item : {};
  const { instancePath, keyword, message } = fields;
  return {
    part,
    pointer: typeof instancePath === "string" && instancePath !== "/" ? instancePath : "",
    code: typeof keyword === "string" && keyword !== "" ? keyword : UNKNOWN_ISSUE_CODE,
    detail: typeof message === "string" ? message : formatErrorMessage(VALIDATION_FAILED),
  };
}

/** A request a route's schema refused: `VALIDATION_FAILED`, with each issue. */
function validationAnswer(error: unknown, context: ProblemContext): ProblemAnswer | undefined {
  if (!isRecord(error)) return undefined;
  const { validation, validationContext: part } = error;
  if (!Array.isArray(validation) || !isRequestPart(part)) return undefined;
  const issues = validation.map((item: unknown) => issueOf(part, item));
  return answerOf(
    problemOf(
      {
        code: VALIDATION_FAILED.code,
        status: VALIDATION_FAILED.status,
        detail: formatErrorMessage(VALIDATION_FAILED),
        issues,
      },
      context
    ),
    PROBLEM_SOURCE.VALIDATION,
    carriedCode(error) ?? VALIDATION_FAILED.code,
    true
  );
}

/** A request the framework itself refused: the `http` code of its cause. */
function frameworkAnswer(error: unknown, context: ProblemContext): ProblemAnswer | undefined {
  const code = carriedCode(error);
  const definition = code === undefined ? undefined : FRAMEWORK_CAUSES.get(code);
  if (code === undefined || definition === undefined) return undefined;
  return answerOf(definitionProblem(definition, context), PROBLEM_SOURCE.FRAMEWORK, code, true);
}

/**
 * An `AppError` whose code nobody registered keeps its own status and code. Its message reaches
 * the client only when it is an expected failure of the client's own request. It is told apart by
 * its class: `ProviderError` carries the same fields, and its message is an upstream's, so it
 * answers as a status carrier.
 */
function appErrorAnswer(error: unknown, context: ProblemContext): ProblemAnswer | undefined {
  if (!(error instanceof AppError) || !isStatusBetween(error.statusCode, 400, 599)) {
    return undefined;
  }
  const shown = error.isOperational && error.statusCode < 500;
  return answerOf(
    problemOf(
      {
        code: error.code,
        status: error.statusCode,
        detail: shown ? error.message : formatErrorMessage(INTERNAL_ERROR),
      },
      context
    ),
    PROBLEM_SOURCE.APP_ERROR,
    error.code,
    error.isOperational
  );
}

/** Any other value that carries a failure status keeps it, and tells nothing else. */
function statusCarrierAnswer(error: unknown, context: ProblemContext): ProblemAnswer | undefined {
  if (!isRecord(error)) return undefined;
  const { statusCode } = error;
  if (!isStatusBetween(statusCode, 400, 599)) return undefined;
  return answerOf(
    internalProblem(statusCode, context),
    PROBLEM_SOURCE.STATUS_CARRIER,
    carriedCode(error) ?? INTERNAL_ERROR.code,
    false
  );
}

/**
 * @description Turns any failure into the API's one error body, by the first step that reads it:
 *   a registered code, a request the route's schema refused, a refusal of the framework, a legacy
 *   `AppError`, a carrier of a failure status, and anything else as `INTERNAL_ERROR`.
 * @param error - Any value, a raised one included.
 * @param context - The correlation id and the moment the problem is stamped with.
 * @returns The problem to send, the headers it needs, and what its log line says.
 */
export function toProblem(error: unknown, context: ProblemContext): ProblemAnswer {
  return (
    registeredAnswer(error, context) ??
    validationAnswer(error, context) ??
    frameworkAnswer(error, context) ??
    appErrorAnswer(error, context) ??
    statusCarrierAnswer(error, context) ??
    answerOf(
      internalProblem(INTERNAL_ERROR.status, context),
      PROBLEM_SOURCE.UNREGISTERED,
      carriedCode(error) ?? INTERNAL_ERROR.code,
      false
    )
  );
}
