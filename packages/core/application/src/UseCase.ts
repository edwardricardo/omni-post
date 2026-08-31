/**
 * @file UseCase.ts
 * @description Defines the base UseCase and CommandUseCase interfaces, UseCaseError class, and USE_CASE_ERRORS constants shared by all application use cases.
 * @layer application
 */

import { type Result } from "@shared/types";

/**
 * Base Use Case interface
 *
 * Use cases encapsulate application-specific business logic.
 * They orchestrate domain objects and external services to fulfill
 * a specific user intention.
 *
 * @typeParam TInput - The input DTO type
 * @typeParam TOutput - The output type (success case)
 * @typeParam TError - The error type (failure case)
 *
 * @example
 * class CreatePostUseCase implements UseCase<CreatePostInput, PostDTO, CreatePostError> {
 *   async execute(input: CreatePostInput): Promise<Result<PostDTO, CreatePostError>> {
 *     // Implementation
 *   }
 * }
 */
export interface UseCase<TInput, TOutput, TError extends Error = Error> {
  /**
   * Execute the use case with the given input
   */
  execute(input: TInput): Promise<Result<TOutput, TError>>;
}

/**
 * Use case without input (query use cases often)
 */
export interface QueryUseCase<TOutput, TError extends Error = Error> {
  execute(): Promise<Result<TOutput, TError>>;
}

/**
 * Use case without output (command use cases that only have side effects)
 */
export interface CommandUseCase<TInput, TError extends Error = Error> {
  execute(input: TInput): Promise<Result<void, TError>>;
}

/**
 * Application error types for use cases
 */
export class UseCaseError extends Error {
  public readonly code: string;
  public readonly originalError: Error | undefined;

  constructor(message: string, code: string, originalError?: Error) {
    super(message, originalError ? { cause: originalError } : undefined);
    this.name = "UseCaseError";
    this.code = code;
    this.originalError = originalError ?? undefined;
  }
}

/**
 * Common use case error codes
 */
export const USE_CASE_ERRORS = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  /**
   * Request was valid but the requested operation isn't wired yet — distinct
   * from `INTERNAL_ERROR` (unknown failure) and `VALIDATION_FAILED` (caller
   * input wrong). Caller should surface this as a "feature not available"
   * UX, not a generic 500.
   */
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  /**
   * A content/policy guardrail rejected the action. Distinct from
   * `VALIDATION_FAILED` (schema/shape) — the input was well-formed but
   * violated a runtime policy. Caller should surface the guardrail name
   * and reason so the user can retry with corrected content.
   */
  GUARDRAIL_REJECTED: "GUARDRAIL_REJECTED",
  /**
   * The operation is well-formed and authorized but its blast radius exceeds a
   * bound the system will attempt atomically (e.g. a hard delete whose cascade
   * would touch more rows than one transaction can safely carry). Not retryable
   * as-is — the caller must reduce the scope first or use a chunked path. The
   * error message names the measured size and the ceiling. Caller should surface
   * it as an actionable "too large" response, not a generic 500.
   */
  OPERATION_TOO_LARGE: "OPERATION_TOO_LARGE",
  /**
   * A persistence failure that may succeed on retry: a transaction timeout, or a
   * write conflict / serialization failure under a Serializable transaction.
   * Distinct from `INTERNAL_ERROR` (unknown, do not blindly retry) and `CONFLICT`
   * (a durable interlock that will keep failing). Caller should surface it as a
   * retryable "temporarily unavailable" response.
   */
  TRANSIENT_FAILURE: "TRANSIENT_FAILURE",
} as const;

export type UseCaseErrorCode = (typeof USE_CASE_ERRORS)[keyof typeof USE_CASE_ERRORS];

/**
 * @function classifyPersistenceFailure
 * @description Maps a caught persistence-layer failure to a use-case error code by its portable
 *              SQLSTATE-style code, WITHOUT importing any ORM type — so the application layer
 *              stays framework-free. The codes are the stable identifiers the data layer surfaces
 *              on a known request failure:
 *                - `P2003` foreign-key interlock (a RESTRICT relationship blocks the delete) →
 *                  `CONFLICT`: durable, never retryable; the caller must remove the blocker first.
 *                - `P2028` transaction timeout, `P2034` write conflict / deadlock (serialization
 *                  failure under a Serializable transaction) → `TRANSIENT_FAILURE`: retryable.
 *              Anything else is an unknown failure → `INTERNAL_ERROR`.
 * @param error - The value caught from a repository/transaction call.
 * @returns The use-case error code that best classifies the failure.
 */
export function classifyPersistenceFailure(error: unknown): UseCaseErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "P2003") {
    return USE_CASE_ERRORS.CONFLICT;
  }
  if (code === "P2028" || code === "P2034") {
    return USE_CASE_ERRORS.TRANSIENT_FAILURE;
  }
  return USE_CASE_ERRORS.INTERNAL_ERROR;
}
