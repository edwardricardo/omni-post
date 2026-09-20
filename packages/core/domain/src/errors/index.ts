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
  INVALID_STATE_TRANSITION_CODE,
  EntityNotFoundError,
  InvariantViolationError,
  VersionConflictError,
  VERSION_CONFLICT_CODE,
  type DomainErrorType,
} from "./DomainError.js";

export {
  ContentLockedError,
  CONTENT_LOCKED_CODE,
  type ContentLockedErrorProps,
} from "./ContentLockedError.js";

export { NotificationDeliveryError } from "./NotificationDeliveryError.js";
