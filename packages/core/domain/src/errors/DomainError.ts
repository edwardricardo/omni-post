/**
 * @file DomainError.ts
 * @description Domain error hierarchy for typed error handling via Result pattern — includes validation, invariant, state transition, and not-found errors.
 * @layer domain
 */

/**
 * Base class for all domain errors
 * Provides consistent error structure for domain layer
 */
export abstract class DomainError extends Error {
  public readonly code: string;
  public readonly timestamp: Date;

  constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.timestamp = new Date();

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

/**
 * Value Object Validation Errors
 */
export class InvalidValueError extends DomainError {
  public readonly field: string;
  public readonly value: unknown;

  constructor(field: string, value: unknown, message: string) {
    super(message, "INVALID_VALUE");
    this.field = field;
    this.value = value;
  }
}

export class InvalidIdError extends DomainError {
  public readonly idType: string;

  constructor(idType: string, value: string) {
    super(`Invalid ${idType}: "${value}"`, "INVALID_ID");
    this.idType = idType;
  }
}

export class EmptyValueError extends DomainError {
  public readonly field: string;

  constructor(field: string) {
    super(`${field} cannot be empty`, "EMPTY_VALUE");
    this.field = field;
  }
}

export class ValueTooLongError extends DomainError {
  public readonly field: string;
  public readonly maxLength: number;
  public readonly actualLength: number;

  constructor(field: string, maxLength: number, actualLength: number) {
    super(
      `${field} exceeds maximum length of ${maxLength} (was ${actualLength})`,
      "VALUE_TOO_LONG"
    );
    this.field = field;
    this.maxLength = maxLength;
    this.actualLength = actualLength;
  }
}

/**
 * Entity State Errors
 */
export class InvalidStateTransitionError extends DomainError {
  public readonly fromState: string;
  public readonly toState: string;

  constructor(fromState: string, toState: string, entityType: string) {
    super(
      `Cannot transition ${entityType} from ${fromState} to ${toState}`,
      "INVALID_STATE_TRANSITION"
    );
    this.fromState = fromState;
    this.toState = toState;
  }
}

export class EntityNotFoundError extends DomainError {
  public readonly entityType: string;
  public readonly entityId: string;

  constructor(entityType: string, entityId: string) {
    super(`${entityType} with id "${entityId}" not found`, "ENTITY_NOT_FOUND");
    this.entityType = entityType;
    this.entityId = entityId;
  }
}

export class InvariantViolationError extends DomainError {
  public readonly invariant: string;

  constructor(invariant: string) {
    super(`Invariant violated: ${invariant}`, "INVARIANT_VIOLATION");
    this.invariant = invariant;
  }
}

/**
 * Optimistic Concurrency Control conflict (Azure saga §15-20). Raised when a
 * write detects that the aggregate version in the database has advanced past
 * the version held by the caller — another process has committed in the
 * meantime, so the current write would silently overwrite (lost update).
 */
export class VersionConflictError extends DomainError {
  public readonly entityType: string;
  public readonly entityId: string;
  public readonly expectedVersion: number;
  public readonly actualVersion: number | null;

  constructor(
    entityType: string,
    entityId: string,
    expectedVersion: number,
    actualVersion: number | null
  ) {
    super(
      `${entityType} "${entityId}" version conflict: expected ${expectedVersion}, found ${actualVersion ?? "missing"}`,
      "VERSION_CONFLICT"
    );
    this.entityType = entityType;
    this.entityId = entityId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/**
 * Domain Error type union for Result<T, DomainError>
 */
export type DomainErrorType =
  | InvalidValueError
  | InvalidIdError
  | EmptyValueError
  | ValueTooLongError
  | InvalidStateTransitionError
  | EntityNotFoundError
  | InvariantViolationError
  | VersionConflictError;
