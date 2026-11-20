/**
 * @file UseCase.ts
 * @description Defines the base UseCase and CommandUseCase interfaces, UseCaseError class, and USE_CASE_ERRORS constants shared by all application use cases.
 * @layer application
 */

import {
  COMMON_ERRORS,
  resolveOccurrence,
  type CodedError,
  type ErrorParams,
  type OfArgs,
  type RegisteredDefinition,
  type RegisteredOccurrence,
  type Result,
} from "@shared/types";

/**
 * Base Use Case interface
 *
 * Use cases encapsulate application-specific business logic.
 * They orchestrate domain objects and external services to fulfill
 * a specific user intention.
 *
 * @template TInput - The input DTO type
 * @template TOutput - The output type (success case)
 * @template TError - The error type (failure case)
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
 * The registry's fields of an error `UseCaseError.of` built. Its private field makes the type
 * nominal and the class is not exported, so no other module can hand the constructor these fields.
 */
class RegistryFields {
  readonly #occurrence: RegisteredOccurrence;

  constructor(occurrence: RegisteredOccurrence) {
    this.#occurrence = occurrence;
  }

  get occurrence(): RegisteredOccurrence {
    return this.#occurrence;
  }
}

/**
 * Application error types for use cases. `UseCaseError.of` builds one from a registered
 * definition; the constructor takes a message of its own and leaves `definition` and `params`
 * undefined.
 */
export class UseCaseError extends Error implements CodedError {
  public readonly code: string;
  public readonly originalError: Error | undefined;
  public readonly definition: RegisteredDefinition | undefined;
  public readonly params: ErrorParams | undefined;

  constructor(message: string, code: string, originalError?: Error, registered?: RegistryFields) {
    super(message, originalError ? { cause: originalError } : undefined);
    this.name = "UseCaseError";
    this.code = code;
    this.originalError = originalError ?? undefined;
    this.definition = registered?.occurrence.definition;
    this.params = registered?.occurrence.params;
  }

  /**
   * @method of
   * @description Builds the error of a registered definition, worded by the registry's entry for
   *   its code; a code the registry does not hold answers `INTERNAL_ERROR`. It returns the error
   *   and raises nothing.
   * @param definition - A member of a registry table, `<TABLE>.<CODE>`.
   * @param args - The definition's declared parameters first when it declares any, then the
   *   options, whose `cause` becomes `originalError`.
   * @returns The use case's error.
   */
  static of<D extends RegisteredDefinition>(definition: D, ...args: OfArgs<D>): UseCaseError {
    const occurrence = resolveOccurrence(definition, ...args);
    return new UseCaseError(
      occurrence.message,
      occurrence.definition.code,
      occurrence.cause,
      new RegistryFields(occurrence)
    );
  }
}

/**
 * Common use case error codes: the short names of the `common` domain's codes, read from the
 * registry.
 */
export const USE_CASE_ERRORS = {
  NOT_FOUND: COMMON_ERRORS.NOT_FOUND.code,
  VALIDATION_FAILED: COMMON_ERRORS.VALIDATION_FAILED.code,
  UNAUTHORIZED: COMMON_ERRORS.UNAUTHORIZED.code,
  FORBIDDEN: COMMON_ERRORS.FORBIDDEN.code,
  CONFLICT: COMMON_ERRORS.CONFLICT.code,
  INTERNAL_ERROR: COMMON_ERRORS.INTERNAL_ERROR.code,
  /**
   * Request was valid but the requested operation isn't wired yet — distinct
   * from `INTERNAL_ERROR` (unknown failure) and `VALIDATION_FAILED` (caller
   * input wrong). Caller should surface this as a "feature not available"
   * UX, not a generic 500.
   */
  NOT_IMPLEMENTED: COMMON_ERRORS.NOT_IMPLEMENTED.code,
  /**
   * A content/policy guardrail rejected the action. Distinct from
   * `VALIDATION_FAILED` (schema/shape) — the input was well-formed but
   * violated a runtime policy. Caller should surface the guardrail name
   * and reason so the user can retry with corrected content.
   */
  GUARDRAIL_REJECTED: COMMON_ERRORS.GUARDRAIL_REJECTED.code,
  /**
   * The operation is well-formed and authorized but its blast radius exceeds a
   * bound the system will attempt atomically (e.g. a hard delete whose cascade
   * would touch more rows than one transaction can safely carry). Not retryable
   * as-is — the caller must reduce the scope first or use a chunked path. The
   * error message names the measured size and the ceiling. Caller should surface
   * it as an actionable "too large" response, not a generic 500.
   */
  OPERATION_TOO_LARGE: COMMON_ERRORS.OPERATION_TOO_LARGE.code,
  /**
   * A persistence failure that may succeed on retry: a transaction timeout, or a
   * write conflict / serialization failure under a Serializable transaction.
   * Distinct from `INTERNAL_ERROR` (unknown, do not blindly retry) and `CONFLICT`
   * (a durable interlock that will keep failing). Caller should surface it as a
   * retryable "temporarily unavailable" response.
   */
  TRANSIENT_FAILURE: COMMON_ERRORS.TRANSIENT_FAILURE.code,
} as const;

export type UseCaseErrorCode = (typeof USE_CASE_ERRORS)[keyof typeof USE_CASE_ERRORS];

/**
 * @function classifyPersistenceFailure
 * @description Maps a caught persistence-layer failure to a use-case error code by the `code`
 *              string the data layer puts on the error.
 *
 *              Be honest about what this buys. `P2003` / `P2028` / `P2034` are PRISMA's own
 *              error codes — proprietary, not SQLSTATE. SQLSTATE is the five-character ANSI
 *              standard (`23503` for a foreign-key violation, `40001` for a serialization
 *              failure), and nothing here reads one. So this function avoids a compile-time
 *              import of an ORM type while remaining coupled to that same ORM BY VALUE: swap
 *              Prisma out and these literals silently classify everything as
 *              `INTERNAL_ERROR`, with no type error to catch it. The comment this replaces
 *              called them "portable SQLSTATE-style", which reads as a guarantee of the
 *              portability the design does not actually have.
 *
 *              The trade is still the right one — the application layer must not import a
 *              driver — but the cost belongs written down, because the day the driver changes
 *              is the day someone needs to know these four strings exist. The codes:
 *                - `P2003` foreign-key interlock (a RESTRICT relationship blocks the delete) →
 *                  `CONFLICT`: durable, never retryable; the caller must remove the blocker first.
 *                - `P2002` unique-constraint violation → `CONFLICT`. This is the restore
 *                  residual race: a LIVE twin created AFTER the subject was soft-deleted holds
 *                  the identity the subject is trying to reclaim, and clearing `deletedAt`
 *                  collides with it on the partial unique. Checking for the twin first cannot
 *                  close the window — the twin can be born between the check and the update —
 *                  so the partial unique is the authoritative arbiter and its violation is the
 *                  answer, not an internal fault. Classified as a conflict so the caller learns
 *                  a competing row exists and can act (rename it, keep it), instead of reading
 *                  a 500 that blames the system for a race the database resolved correctly.
 *                - `P2028` transaction timeout, `P2034` write conflict / deadlock (serialization
 *                  failure under a Serializable transaction) → `TRANSIENT_FAILURE`: retryable.
 *              Anything else is an unknown failure → `INTERNAL_ERROR`.
 * @param error - The value caught from a repository/transaction call.
 * @returns The use-case error code that best classifies the failure.
 */
export function classifyPersistenceFailure(error: unknown): UseCaseErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "P2003" || code === "P2002") {
    return USE_CASE_ERRORS.CONFLICT;
  }
  if (code === "P2028" || code === "P2034") {
    return USE_CASE_ERRORS.TRANSIENT_FAILURE;
  }
  return USE_CASE_ERRORS.INTERNAL_ERROR;
}

/**
 * @function isRetryableWriteConflict
 * @description Narrower than `TRANSIENT_FAILURE`: true only for `P2034`, the serialization
 *              failure / write conflict a Serializable transaction raises when a concurrent
 *              writer made its snapshot unsafe. That is the one failure class where re-running
 *              the SAME work can succeed unchanged, so it is the only one an automatic retry
 *              may act on.
 *
 *              Deliberately NOT retryable, though both share the `TRANSIENT_FAILURE` code:
 *                - `P2028` transaction timeout. The work did not fit the budget; running it
 *                  again spends the budget again and times out again, while holding locks for
 *                  another full budget. The caller is told to retry, but a HUMAN decides —
 *                  usually after shrinking the operation.
 *              And never `P2003`: a foreign-key interlock is durable by construction.
 *
 *              Coupled to Prisma's code strings by value, exactly like
 *              {@link classifyPersistenceFailure} — see the honesty note there.
 * @param error - The value caught from a repository/transaction call.
 * @returns True when the failure is a write conflict that an identical retry may win.
 */
export function isRetryableWriteConflict(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2034";
}
