/**
 * @file ApprovalStatus.ts
 * @description Value object representing the lifecycle status of an approval request.
 *   Enforces valid state transitions for the content approval workflow.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidValueError, InvalidStateTransitionError } from "../errors/index.js";

/**
 * Valid approval status values
 */
export const APPROVAL_STATUSES = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
} as const;

export type ApprovalStatusValue = (typeof APPROVAL_STATUSES)[keyof typeof APPROVAL_STATUSES];

/**
 * Valid state transitions for approval status
 */
const VALID_TRANSITIONS: Record<ApprovalStatusValue, ApprovalStatusValue[]> = {
  [APPROVAL_STATUSES.PENDING]: [
    APPROVAL_STATUSES.APPROVED,
    APPROVAL_STATUSES.REJECTED,
    APPROVAL_STATUSES.CANCELLED,
  ],
  [APPROVAL_STATUSES.APPROVED]: [], // Terminal state
  [APPROVAL_STATUSES.REJECTED]: [], // Terminal state
  [APPROVAL_STATUSES.CANCELLED]: [], // Terminal state
};

/**
 * @class ApprovalStatus
 * @description Immutable value object representing the current state of an approval request.
 *   Provides transition validation and convenience predicates.
 */
export class ApprovalStatus {
  private readonly _value: ApprovalStatusValue;

  private constructor(value: ApprovalStatusValue) {
    this._value = value;
  }

  /**
   * @method value
   * @description Returns the raw string value of this status.
   */
  get value(): ApprovalStatusValue {
    return this._value;
  }

  /**
   * @method create
   * @description Creates an ApprovalStatus from a string, validating against allowed values.
   * @param value - The status string to parse
   * @returns Result containing ApprovalStatus on success, InvalidValueError on failure
   */
  static create(value: string): Result<ApprovalStatus, InvalidValueError> {
    const upper = value.toUpperCase();
    if (!Object.values(APPROVAL_STATUSES).includes(upper as ApprovalStatusValue)) {
      return err(
        new InvalidValueError(
          "ApprovalStatus",
          value,
          `Invalid approval status: "${value}". Valid values: ${Object.values(APPROVAL_STATUSES).join(", ")}`
        )
      );
    }
    return ok(new ApprovalStatus(upper as ApprovalStatusValue));
  }

  /**
   * @description Factory for PENDING status (initial state)
   */
  static pending(): ApprovalStatus {
    return new ApprovalStatus(APPROVAL_STATUSES.PENDING);
  }

  /**
   * @description Factory for APPROVED status
   */
  static approved(): ApprovalStatus {
    return new ApprovalStatus(APPROVAL_STATUSES.APPROVED);
  }

  /**
   * @description Factory for REJECTED status
   */
  static rejected(): ApprovalStatus {
    return new ApprovalStatus(APPROVAL_STATUSES.REJECTED);
  }

  /**
   * @description Factory for CANCELLED status
   */
  static cancelled(): ApprovalStatus {
    return new ApprovalStatus(APPROVAL_STATUSES.CANCELLED);
  }

  /**
   * @method canTransitionTo
   * @description Checks whether transitioning to the target status is valid.
   * @param target - The target status value
   * @returns true if the transition is allowed
   */
  canTransitionTo(target: ApprovalStatusValue): boolean {
    return VALID_TRANSITIONS[this._value].includes(target);
  }

  /**
   * @method transitionTo
   * @description Transitions to a new status (returns new immutable instance).
   * @param target - The target status value
   * @returns Result containing new ApprovalStatus on success, InvalidStateTransitionError on failure
   */
  transitionTo(target: ApprovalStatusValue): Result<ApprovalStatus, InvalidStateTransitionError> {
    if (!this.canTransitionTo(target)) {
      return err(new InvalidStateTransitionError(this._value, target, "ApprovalStatus"));
    }
    return ok(new ApprovalStatus(target));
  }

  /**
   * @description Returns true if the status is PENDING
   */
  isPending(): boolean {
    return this._value === APPROVAL_STATUSES.PENDING;
  }

  /**
   * @description Returns true if the status is APPROVED
   */
  isApproved(): boolean {
    return this._value === APPROVAL_STATUSES.APPROVED;
  }

  /**
   * @description Returns true if the status is REJECTED
   */
  isRejected(): boolean {
    return this._value === APPROVAL_STATUSES.REJECTED;
  }

  /**
   * @description Returns true if the status is CANCELLED
   */
  isCancelled(): boolean {
    return this._value === APPROVAL_STATUSES.CANCELLED;
  }

  /**
   * @method isTerminal
   * @description Returns true if no further transitions are possible.
   */
  isTerminal(): boolean {
    return VALID_TRANSITIONS[this._value].length === 0;
  }

  /**
   * @method equals
   * @description Value-based equality check.
   * @param other - The ApprovalStatus to compare
   * @returns true if both statuses have the same value
   */
  equals(other: ApprovalStatus): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  toJSON(): string {
    return this._value;
  }
}
