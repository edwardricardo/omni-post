/**
 * @file index.ts
 * @description Barrel export for errors — re-exports all domain error classes and types.
 * @layer domain
 */

export {
  DomainError,
  InvalidValueError,
  InvalidIdError,
  EmptyValueError,
  ValueTooLongError,
  InvalidStateTransitionError,
  EntityNotFoundError,
  InvariantViolationError,
  type DomainErrorType,
} from "./DomainError.js";
