/**
 * @file SocialMessageStatus.ts
 * @description Value object representing the status of a social inbox message
 *   with valid state transitions (state machine).
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidValueError, InvalidStateTransitionError } from "../errors/index.js";

export const SOCIAL_MESSAGE_STATUSES = {
  UNREAD: "UNREAD",
  READ: "READ",
  REPLIED: "REPLIED",
  ARCHIVED: "ARCHIVED",
} as const;

export type SocialMessageStatusValue =
  (typeof SOCIAL_MESSAGE_STATUSES)[keyof typeof SOCIAL_MESSAGE_STATUSES];

/**
 * Valid state transitions:
 * - UNREAD → READ, ARCHIVED
 * - READ → REPLIED, ARCHIVED
 * - REPLIED → ARCHIVED
 * - ARCHIVED (terminal)
 */
const VALID_TRANSITIONS: Record<SocialMessageStatusValue, SocialMessageStatusValue[]> = {
  [SOCIAL_MESSAGE_STATUSES.UNREAD]: [
    SOCIAL_MESSAGE_STATUSES.READ,
    SOCIAL_MESSAGE_STATUSES.ARCHIVED,
  ],
  [SOCIAL_MESSAGE_STATUSES.READ]: [
    SOCIAL_MESSAGE_STATUSES.REPLIED,
    SOCIAL_MESSAGE_STATUSES.ARCHIVED,
  ],
  [SOCIAL_MESSAGE_STATUSES.REPLIED]: [SOCIAL_MESSAGE_STATUSES.ARCHIVED],
  [SOCIAL_MESSAGE_STATUSES.ARCHIVED]: [], // Terminal
};

const VALID_VALUES = Object.values(SOCIAL_MESSAGE_STATUSES) as readonly string[];

/**
 * @class SocialMessageStatus
 * @description Immutable value object representing a social message's status
 *   with enforced state machine transitions.
 */
export class SocialMessageStatus {
  private readonly _value: SocialMessageStatusValue;

  private constructor(value: SocialMessageStatusValue) {
    this._value = value;
  }

  /**
   * @method value
   * @description Returns the raw string value of this status.
   */
  get value(): SocialMessageStatusValue {
    return this._value;
  }

  /**
   * @method fromString
   * @description Creates a SocialMessageStatus from a string, validating against allowed values.
   * @param value - The status string to parse
   * @returns Result containing SocialMessageStatus on success, InvalidValueError on failure
   */
  static fromString(value: string): Result<SocialMessageStatus, InvalidValueError> {
    const upper = value.toUpperCase();
    if (!VALID_VALUES.includes(upper)) {
      return err(
        new InvalidValueError(
          "SocialMessageStatus",
          value,
          `Invalid status: "${value}". Valid: ${VALID_VALUES.join(", ")}`
        )
      );
    }
    return ok(new SocialMessageStatus(upper as SocialMessageStatusValue));
  }

  /** Factory: UNREAD (initial state) */
  static unread(): SocialMessageStatus {
    return new SocialMessageStatus(SOCIAL_MESSAGE_STATUSES.UNREAD);
  }

  /** Factory: READ */
  static read(): SocialMessageStatus {
    return new SocialMessageStatus(SOCIAL_MESSAGE_STATUSES.READ);
  }

  /** Factory: REPLIED */
  static replied(): SocialMessageStatus {
    return new SocialMessageStatus(SOCIAL_MESSAGE_STATUSES.REPLIED);
  }

  /** Factory: ARCHIVED */
  static archived(): SocialMessageStatus {
    return new SocialMessageStatus(SOCIAL_MESSAGE_STATUSES.ARCHIVED);
  }

  /**
   * @method canTransitionTo
   * @description Check if transition to target status is valid.
   * @param target - The target status value
   * @returns true if transition is allowed
   */
  canTransitionTo(target: SocialMessageStatusValue): boolean {
    return VALID_TRANSITIONS[this._value].includes(target);
  }

  /**
   * @method transitionTo
   * @description Transition to a new status (returns new immutable instance).
   * @param target - The target status value
   * @returns Result containing new SocialMessageStatus on success, error on invalid transition
   */
  transitionTo(
    target: SocialMessageStatusValue
  ): Result<SocialMessageStatus, InvalidStateTransitionError> {
    if (!this.canTransitionTo(target)) {
      return err(new InvalidStateTransitionError(this._value, target, "SocialMessageStatus"));
    }
    return ok(new SocialMessageStatus(target));
  }

  isUnread(): boolean {
    return this._value === SOCIAL_MESSAGE_STATUSES.UNREAD;
  }

  isRead(): boolean {
    return this._value === SOCIAL_MESSAGE_STATUSES.READ;
  }

  isReplied(): boolean {
    return this._value === SOCIAL_MESSAGE_STATUSES.REPLIED;
  }

  isArchived(): boolean {
    return this._value === SOCIAL_MESSAGE_STATUSES.ARCHIVED;
  }

  /**
   * @method isTerminal
   * @description Check if status is terminal (no further transitions possible).
   */
  isTerminal(): boolean {
    return VALID_TRANSITIONS[this._value].length === 0;
  }

  /**
   * @method validNextStatuses
   * @description Get list of valid next statuses.
   */
  validNextStatuses(): SocialMessageStatusValue[] {
    return [...VALID_TRANSITIONS[this._value]];
  }

  /**
   * @method equals
   * @description Value-based equality check.
   * @param other - The SocialMessageStatus to compare
   * @returns true if both statuses have the same value
   */
  equals(other: SocialMessageStatus): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  toJSON(): string {
    return this._value;
  }
}
