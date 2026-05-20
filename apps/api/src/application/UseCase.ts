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
} as const;

export type UseCaseErrorCode = (typeof USE_CASE_ERRORS)[keyof typeof USE_CASE_ERRORS];
