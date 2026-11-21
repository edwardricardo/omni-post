/**
 * @file problem.ts
 * @description The API's one error body, an RFC 9457 problem, as the types the server that sends
 *   it and every front that reads it share, so no side keeps its own copy of the shape. `title` and
 *   `detail` are the registry's English for developers; a screen words the failure by `code`.
 * @layer domain
 */
import type { ErrorParams } from "./definition.js";

/** The parts of a request a route's schema validates, as the HTTP framework names them. */
export const PROBLEM_ISSUE_PART = {
  BODY: "body",
  QUERYSTRING: "querystring",
  PARAMS: "params",
  HEADERS: "headers",
} as const;
export type ProblemIssuePart = (typeof PROBLEM_ISSUE_PART)[keyof typeof PROBLEM_ISSUE_PART];

/** One reason a route's schema refused the request. */
export interface ProblemIssue {
  readonly part: ProblemIssuePart;
  /** An RFC 6901 pointer into that part; "" is the part itself. */
  readonly pointer: string;
  /** The validator's issue code; "unknown" when it names none. */
  readonly code: string;
  /** The validator's English text. */
  readonly detail: string;
}

/** The body of every failure the API answers, served as `application/problem+json`. */
export interface Problem {
  /** "https://omnipost.app/problems/" followed by the code. */
  readonly type: string;
  /** The code in words. */
  readonly title: string;
  readonly status: number;
  /** The registry's message, worded with this occurrence's parameters. */
  readonly detail: string;
  readonly code: string;
  readonly correlationId: string;
  /** ISO 8601, UTC. */
  readonly timestamp: string;
  /** Absent when the code's definition declares no parameter. */
  readonly params?: ErrorParams;
  /** Present only with `VALIDATION_FAILED`. */
  readonly issues?: readonly ProblemIssue[];
}
