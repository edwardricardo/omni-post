/**
 * @file CampaignStatus.ts
 * @description Value Object representing the lifecycle state of a Campaign.
 *   Enforces valid transitions: DRAFT→ACTIVE→PAUSED→COMPLETED→ARCHIVED.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError, InvalidStateTransitionError } from "../errors/index.js";

/**
 * Valid campaign status values
 */
export const CAMPAIGN_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
} as const;

export type CampaignStatusValue = (typeof CAMPAIGN_STATUS)[keyof typeof CAMPAIGN_STATUS];

/**
 * Valid state transitions for campaign status
 */
const VALID_TRANSITIONS: Record<CampaignStatusValue, CampaignStatusValue[]> = {
  [CAMPAIGN_STATUS.DRAFT]: [CAMPAIGN_STATUS.ACTIVE],
  [CAMPAIGN_STATUS.ACTIVE]: [CAMPAIGN_STATUS.PAUSED, CAMPAIGN_STATUS.COMPLETED],
  [CAMPAIGN_STATUS.PAUSED]: [CAMPAIGN_STATUS.ACTIVE, CAMPAIGN_STATUS.ARCHIVED],
  [CAMPAIGN_STATUS.COMPLETED]: [CAMPAIGN_STATUS.ARCHIVED],
  [CAMPAIGN_STATUS.ARCHIVED]: [],
};

/**
 * @class CampaignStatus
 * @description Immutable value object representing the lifecycle state of a campaign.
 *   Follows the same pattern as PublishStatus with state machine validation.
 */
export class CampaignStatus {
  private readonly _value: CampaignStatusValue;

  private constructor(value: CampaignStatusValue) {
    this._value = value;
  }

  /**
   * @method value
   * @description Get the raw status value.
   */
  get value(): CampaignStatusValue {
    return this._value;
  }

  /**
   * @method fromString
   * @description Create a CampaignStatus from a string value.
   * @param value - The string value to parse
   * @returns Result with CampaignStatus on success, InvalidValueError on failure
   */
  static fromString(value: string): Result<CampaignStatus, InvalidValueError> {
    const upperValue = value.toUpperCase();
    if (!Object.values(CAMPAIGN_STATUS).includes(upperValue as CampaignStatusValue)) {
      return err(
        new InvalidValueError(
          "CampaignStatus",
          value,
          `Invalid status: "${value}". Valid values: ${Object.values(CAMPAIGN_STATUS).join(", ")}`
        )
      );
    }
    return ok(new CampaignStatus(upperValue as CampaignStatusValue));
  }

  // Factory methods

  static draft(): CampaignStatus {
    return new CampaignStatus(CAMPAIGN_STATUS.DRAFT);
  }

  static active(): CampaignStatus {
    return new CampaignStatus(CAMPAIGN_STATUS.ACTIVE);
  }

  static paused(): CampaignStatus {
    return new CampaignStatus(CAMPAIGN_STATUS.PAUSED);
  }

  static completed(): CampaignStatus {
    return new CampaignStatus(CAMPAIGN_STATUS.COMPLETED);
  }

  static archived(): CampaignStatus {
    return new CampaignStatus(CAMPAIGN_STATUS.ARCHIVED);
  }

  /**
   * @method canTransitionTo
   * @description Check if transition to target status is valid.
   */
  canTransitionTo(target: CampaignStatusValue): boolean {
    return VALID_TRANSITIONS[this._value].includes(target);
  }

  /**
   * @method transitionTo
   * @description Transition to a new status (returns new immutable instance).
   */
  transitionTo(target: CampaignStatusValue): Result<CampaignStatus, InvalidStateTransitionError> {
    if (!this.canTransitionTo(target)) {
      return err(new InvalidStateTransitionError(this._value, target, "CampaignStatus"));
    }
    return ok(new CampaignStatus(target));
  }

  // Status predicates

  isDraft(): boolean {
    return this._value === CAMPAIGN_STATUS.DRAFT;
  }

  isActive(): boolean {
    return this._value === CAMPAIGN_STATUS.ACTIVE;
  }

  isPaused(): boolean {
    return this._value === CAMPAIGN_STATUS.PAUSED;
  }

  isCompleted(): boolean {
    return this._value === CAMPAIGN_STATUS.COMPLETED;
  }

  isArchived(): boolean {
    return this._value === CAMPAIGN_STATUS.ARCHIVED;
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
  validNextStatuses(): CampaignStatusValue[] {
    return [...VALID_TRANSITIONS[this._value]];
  }

  equals(other: CampaignStatus): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  toJSON(): string {
    return this._value;
  }
}
