/**
 * @file ReviewDecision.ts
 * @description Value object representing a reviewer's decision on an approval request.
 *   Encapsulates the three possible outcomes: approved, rejected, or changes requested.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

/**
 * Valid review decision values
 */
export const REVIEW_DECISIONS = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
} as const;

export type ReviewDecisionValue = (typeof REVIEW_DECISIONS)[keyof typeof REVIEW_DECISIONS];

/**
 * @class ReviewDecision
 * @description Immutable value object representing a reviewer's verdict on content.
 *   Provides semantic helpers for determining whether the decision is an approval or rejection.
 */
export class ReviewDecision {
  private readonly _value: ReviewDecisionValue;

  private constructor(value: ReviewDecisionValue) {
    this._value = value;
  }

  /**
   * @method value
   * @description Returns the raw string value of this decision.
   */
  get value(): ReviewDecisionValue {
    return this._value;
  }

  /**
   * @method create
   * @description Creates a ReviewDecision from a string, validating against allowed values.
   * @param value - The decision string to parse
   * @returns Result containing ReviewDecision on success, InvalidValueError on failure
   */
  static create(value: string): Result<ReviewDecision, InvalidValueError> {
    const upper = value.toUpperCase();
    if (!Object.values(REVIEW_DECISIONS).includes(upper as ReviewDecisionValue)) {
      return err(
        new InvalidValueError(
          "ReviewDecision",
          value,
          `Invalid review decision: "${value}". Valid values: ${Object.values(REVIEW_DECISIONS).join(", ")}`
        )
      );
    }
    return ok(new ReviewDecision(upper as ReviewDecisionValue));
  }

  /**
   * @description Factory for APPROVED decision
   */
  static approved(): ReviewDecision {
    return new ReviewDecision(REVIEW_DECISIONS.APPROVED);
  }

  /**
   * @description Factory for REJECTED decision
   */
  static rejected(): ReviewDecision {
    return new ReviewDecision(REVIEW_DECISIONS.REJECTED);
  }

  /**
   * @description Factory for CHANGES_REQUESTED decision
   */
  static changesRequested(): ReviewDecision {
    return new ReviewDecision(REVIEW_DECISIONS.CHANGES_REQUESTED);
  }

  /**
   * @method isApproval
   * @description Returns true if this decision represents an approval.
   */
  isApproval(): boolean {
    return this._value === REVIEW_DECISIONS.APPROVED;
  }

  /**
   * @method isRejection
   * @description Returns true if this decision represents a rejection
   *   (either explicit rejection or changes requested).
   */
  isRejection(): boolean {
    return (
      this._value === REVIEW_DECISIONS.REJECTED ||
      this._value === REVIEW_DECISIONS.CHANGES_REQUESTED
    );
  }

  /**
   * @method equals
   * @description Value-based equality check.
   * @param other - The ReviewDecision to compare
   * @returns true if both decisions have the same value
   */
  equals(other: ReviewDecision): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  toJSON(): string {
    return this._value;
  }
}
