/**
 * Domain Layer - PublishStatus Value Object
 *
 * Part of Sprint 3: DDD Architecture Implementation
 * Represents the publishing status of a post with valid state transitions.
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError, InvalidStateTransitionError } from "../errors/index.js";

/**
 * Valid publish status values
 */
export const PUBLISH_STATUS = {
  DRAFT: "DRAFT",
  PENDING_REVIEW: "PENDING_REVIEW",
  SCHEDULED: "SCHEDULED",
  PUBLISHING: "PUBLISHING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type PublishStatusValue = (typeof PUBLISH_STATUS)[keyof typeof PUBLISH_STATUS];

/**
 * Valid state transitions for publish status
 */
const VALID_TRANSITIONS: Record<PublishStatusValue, PublishStatusValue[]> = {
  [PUBLISH_STATUS.DRAFT]: [
    PUBLISH_STATUS.PENDING_REVIEW,
    PUBLISH_STATUS.SCHEDULED,
    PUBLISH_STATUS.PUBLISHING,
    PUBLISH_STATUS.CANCELLED,
  ],
  [PUBLISH_STATUS.PENDING_REVIEW]: [
    PUBLISH_STATUS.SCHEDULED, // Approved path
    PUBLISH_STATUS.DRAFT, // Rejected path
  ],
  [PUBLISH_STATUS.SCHEDULED]: [
    PUBLISH_STATUS.PUBLISHING,
    PUBLISH_STATUS.CANCELLED,
    PUBLISH_STATUS.DRAFT,
  ],
  [PUBLISH_STATUS.PUBLISHING]: [PUBLISH_STATUS.PUBLISHED, PUBLISH_STATUS.FAILED],
  [PUBLISH_STATUS.PUBLISHED]: [], // Terminal state
  [PUBLISH_STATUS.FAILED]: [
    PUBLISH_STATUS.DRAFT,
    PUBLISH_STATUS.SCHEDULED,
    PUBLISH_STATUS.PUBLISHING,
  ], // Can retry
  [PUBLISH_STATUS.CANCELLED]: [PUBLISH_STATUS.DRAFT], // Can be restored to draft
};

/**
 * PublishStatus - Immutable value object representing post publishing state
 *
 * @example
 * const status = PublishStatus.draft();
 * const scheduled = status.transitionTo('SCHEDULED');
 */
export class PublishStatus {
  private readonly _value: PublishStatusValue;

  private constructor(value: PublishStatusValue) {
    this._value = value;
  }

  /**
   * Get the raw status value
   */
  get value(): PublishStatusValue {
    return this._value;
  }

  /**
   * Create a PublishStatus from a string value
   */
  static fromString(value: string): Result<PublishStatus, InvalidValueError> {
    const upperValue = value.toUpperCase();
    if (!Object.values(PUBLISH_STATUS).includes(upperValue as PublishStatusValue)) {
      return err(
        new InvalidValueError(
          "PublishStatus",
          value,
          `Invalid status: "${value}". Valid values: ${Object.values(PUBLISH_STATUS).join(", ")}`
        )
      );
    }
    return ok(new PublishStatus(upperValue as PublishStatusValue));
  }

  /**
   * Factory methods for each status
   */
  static draft(): PublishStatus {
    return new PublishStatus(PUBLISH_STATUS.DRAFT);
  }

  static scheduled(): PublishStatus {
    return new PublishStatus(PUBLISH_STATUS.SCHEDULED);
  }

  static publishing(): PublishStatus {
    return new PublishStatus(PUBLISH_STATUS.PUBLISHING);
  }

  static published(): PublishStatus {
    return new PublishStatus(PUBLISH_STATUS.PUBLISHED);
  }

  static failed(): PublishStatus {
    return new PublishStatus(PUBLISH_STATUS.FAILED);
  }

  static pendingReview(): PublishStatus {
    return new PublishStatus(PUBLISH_STATUS.PENDING_REVIEW);
  }

  static cancelled(): PublishStatus {
    return new PublishStatus(PUBLISH_STATUS.CANCELLED);
  }

  /**
   * Check if transition to target status is valid
   */
  canTransitionTo(target: PublishStatusValue): boolean {
    return VALID_TRANSITIONS[this._value].includes(target);
  }

  /**
   * Transition to a new status (returns new immutable instance)
   */
  transitionTo(target: PublishStatusValue): Result<PublishStatus, InvalidStateTransitionError> {
    if (!this.canTransitionTo(target)) {
      return err(new InvalidStateTransitionError(this._value, target, "PublishStatus"));
    }
    return ok(new PublishStatus(target));
  }

  /**
   * Status predicates
   */
  isDraft(): boolean {
    return this._value === PUBLISH_STATUS.DRAFT;
  }

  isScheduled(): boolean {
    return this._value === PUBLISH_STATUS.SCHEDULED;
  }

  isPublishing(): boolean {
    return this._value === PUBLISH_STATUS.PUBLISHING;
  }

  isPublished(): boolean {
    return this._value === PUBLISH_STATUS.PUBLISHED;
  }

  isFailed(): boolean {
    return this._value === PUBLISH_STATUS.FAILED;
  }

  isPendingReview(): boolean {
    return this._value === PUBLISH_STATUS.PENDING_REVIEW;
  }

  isCancelled(): boolean {
    return this._value === PUBLISH_STATUS.CANCELLED;
  }

  /**
   * Check if status is terminal (no further transitions possible)
   */
  isTerminal(): boolean {
    return VALID_TRANSITIONS[this._value].length === 0;
  }

  /**
   * Check if content can still be edited
   */
  isEditable(): boolean {
    return this._value === PUBLISH_STATUS.DRAFT || this._value === PUBLISH_STATUS.FAILED;
  }

  /**
   * Get list of valid next statuses
   */
  validNextStatuses(): PublishStatusValue[] {
    return [...VALID_TRANSITIONS[this._value]];
  }

  /**
   * Equality check
   */
  equals(other: PublishStatus): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  toJSON(): string {
    return this._value;
  }
}
