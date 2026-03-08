/**
 * Domain Layer - Account Entity
 *
 * Part of Sprint 4: DDD Architecture Implementation
 * Represents a user account with subscription and billing information.
 */

import { type Result, ok, err } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { AccountId } from "../value-objects/EntityId.js";
import {
  InvalidValueError,
  InvariantViolationError,
  InvalidStateTransitionError,
} from "../errors/index.js";

/**
 * Subscription tiers
 */
export const SUBSCRIPTION_TIER = {
  BASIC: "BASIC",
  PRO: "PRO",
  ENTERPRISE: "ENTERPRISE",
} as const;

export type SubscriptionTierValue = (typeof SUBSCRIPTION_TIER)[keyof typeof SUBSCRIPTION_TIER];

/**
 * Tier limits configuration
 */
const TIER_LIMITS: Record<
  SubscriptionTierValue,
  { maxProjects: number; maxChannelsPerProject: number; maxPostsPerDay: number }
> = {
  [SUBSCRIPTION_TIER.BASIC]: { maxProjects: 1, maxChannelsPerProject: 3, maxPostsPerDay: 10 },
  [SUBSCRIPTION_TIER.PRO]: { maxProjects: 5, maxChannelsPerProject: 10, maxPostsPerDay: 100 },
  [SUBSCRIPTION_TIER.ENTERPRISE]: {
    maxProjects: -1,
    maxChannelsPerProject: -1,
    maxPostsPerDay: -1,
  }, // Unlimited
};

/**
 * Billing cycle options
 */
const BILLING_CYCLE = {
  MONTHLY: "monthly",
  YEARLY: "yearly",
} as const;

export type BillingCycleValue = (typeof BILLING_CYCLE)[keyof typeof BILLING_CYCLE];

/**
 * Account construction properties
 */
export interface AccountProps extends EntityProps {
  email: string;
  name: string;
  subscription?: SubscriptionTierValue;
  maxProjects?: number;
  isOnTrial?: boolean;
  trialStartDate?: Date;
  trialEndDate?: Date;
  autoRenewal?: boolean;
  billingCycle?: BillingCycleValue;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

/**
 * Account creation input
 */
export interface CreateAccountInput {
  email: string;
  name: string;
  subscription?: SubscriptionTierValue;
  trialDays?: number;
}

/**
 * Account - Domain entity representing a user account
 *
 * Invariants:
 * - Email must be valid
 * - Name cannot be empty
 * - Trial end date must be after trial start date
 * - Cannot downgrade if project count exceeds new tier limit
 *
 * @example
 * const result = Account.create({
 *   email: 'user@example.com',
 *   name: 'John Doe',
 *   trialDays: 14
 * });
 */
export class Account extends Entity<AccountId> {
  private _email: string;
  private _name: string;
  private _subscription: SubscriptionTierValue;
  private _maxProjects: number;
  private _isOnTrial: boolean;
  private _trialStartDate: Date;
  private _trialEndDate: Date | undefined;
  private _autoRenewal: boolean;
  private _billingCycle: BillingCycleValue;
  private _stripeCustomerId: string | undefined;
  private _stripeSubscriptionId: string | undefined;
  private _projectCount: number;

  private constructor(id: AccountId, props: AccountProps) {
    super(id, props.createdAt);
    this._email = props.email;
    this._name = props.name;
    this._subscription = props.subscription ?? SUBSCRIPTION_TIER.BASIC;
    this._maxProjects = props.maxProjects ?? TIER_LIMITS[this._subscription].maxProjects;
    this._isOnTrial = props.isOnTrial ?? true;
    this._trialStartDate = props.trialStartDate ?? new Date();
    this._trialEndDate = props.trialEndDate;
    this._autoRenewal = props.autoRenewal ?? false;
    this._billingCycle = props.billingCycle ?? BILLING_CYCLE.MONTHLY;
    this._stripeCustomerId = props.stripeCustomerId;
    this._stripeSubscriptionId = props.stripeSubscriptionId;
    this._projectCount = 0;

    if (props.updatedAt) {
      this._updatedAt = props.updatedAt;
    }
  }

  /**
   * Factory method to create a new Account
   */
  static create(input: CreateAccountInput): Result<Account, InvalidValueError> {
    // Validate email
    if (!input.email || !Account.isValidEmail(input.email)) {
      return err(new InvalidValueError("email", input.email, "Invalid email address"));
    }

    // Validate name
    if (!input.name || input.name.trim().length === 0) {
      return err(new InvalidValueError("name", input.name, "Name cannot be empty"));
    }

    // Calculate trial end date
    const trialDays = input.trialDays ?? 14;
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + trialDays);

    return ok(
      new Account(AccountId.generate(), {
        email: input.email.toLowerCase().trim(),
        name: input.name.trim(),
        subscription: input.subscription ?? SUBSCRIPTION_TIER.BASIC,
        isOnTrial: true,
        trialEndDate,
      })
    );
  }

  /**
   * Reconstruct an Account from persistence
   */
  static reconstitute(id: AccountId, props: AccountProps & { projectCount?: number }): Account {
    const account = new Account(id, props);
    account._projectCount = props.projectCount ?? 0;
    return account;
  }

  /**
   * Validate email format
   */
  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Getters

  get entityType(): string {
    return "Account";
  }

  get email(): string {
    return this._email;
  }

  get name(): string {
    return this._name;
  }

  get subscription(): SubscriptionTierValue {
    return this._subscription;
  }

  get maxProjects(): number {
    return this._maxProjects;
  }

  get isOnTrial(): boolean {
    return this._isOnTrial;
  }

  get trialStartDate(): Date {
    return new Date(this._trialStartDate.getTime());
  }

  get trialEndDate(): Date | undefined {
    return this._trialEndDate ? new Date(this._trialEndDate.getTime()) : undefined;
  }

  get autoRenewal(): boolean {
    return this._autoRenewal;
  }

  get billingCycle(): BillingCycleValue {
    return this._billingCycle;
  }

  get stripeCustomerId(): string | undefined {
    return this._stripeCustomerId;
  }

  get stripeSubscriptionId(): string | undefined {
    return this._stripeSubscriptionId;
  }

  get projectCount(): number {
    return this._projectCount;
  }

  /**
   * Get tier limits for this account
   */
  get tierLimits(): { maxProjects: number; maxChannelsPerProject: number; maxPostsPerDay: number } {
    return { ...TIER_LIMITS[this._subscription] };
  }

  // Status predicates

  /**
   * Check if trial has expired
   */
  get isTrialExpired(): boolean {
    if (!this._isOnTrial || !this._trialEndDate) {
      return false;
    }
    return this._trialEndDate.getTime() < Date.now();
  }

  /**
   * Check if account is active (not expired trial or has subscription)
   */
  get isActive(): boolean {
    if (!this._isOnTrial) {
      return true; // Paid subscription
    }
    return !this.isTrialExpired;
  }

  /**
   * Get remaining trial days
   */
  get trialDaysRemaining(): number {
    if (!this._isOnTrial || !this._trialEndDate) {
      return 0;
    }
    const remaining = this._trialEndDate.getTime() - Date.now();
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  }

  /**
   * Check if account can create more projects
   */
  get canCreateProject(): boolean {
    if (this._maxProjects === -1) return true; // Unlimited
    return this._projectCount < this._maxProjects;
  }

  // Domain behavior

  /**
   * Update account name
   */
  updateName(newName: string): Result<void, InvalidValueError> {
    if (!newName || newName.trim().length === 0) {
      return err(new InvalidValueError("name", newName, "Name cannot be empty"));
    }

    this._name = newName.trim();
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * Update email address
   */
  updateEmail(newEmail: string): Result<void, InvalidValueError> {
    if (!newEmail || !Account.isValidEmail(newEmail)) {
      return err(new InvalidValueError("email", newEmail, "Invalid email address"));
    }

    this._email = newEmail.toLowerCase().trim();
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * Upgrade subscription tier
   */
  upgradeTo(tier: SubscriptionTierValue): Result<void, InvariantViolationError> {
    const tierOrder = { BASIC: 0, PRO: 1, ENTERPRISE: 2 };

    if (tierOrder[tier] <= tierOrder[this._subscription]) {
      return err(
        new InvariantViolationError(`Cannot upgrade from ${this._subscription} to ${tier}`)
      );
    }

    this._subscription = tier;
    this._maxProjects = TIER_LIMITS[tier].maxProjects;
    this._isOnTrial = false;
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * Downgrade subscription tier
   */
  downgradeTo(
    tier: SubscriptionTierValue
  ): Result<void, InvariantViolationError | InvalidStateTransitionError> {
    const tierOrder = { BASIC: 0, PRO: 1, ENTERPRISE: 2 };

    if (tierOrder[tier] >= tierOrder[this._subscription]) {
      return err(
        new InvariantViolationError(`Cannot downgrade from ${this._subscription} to ${tier}`)
      );
    }

    // Check if current usage exceeds new tier limits
    const newLimits = TIER_LIMITS[tier];
    if (newLimits.maxProjects !== -1 && this._projectCount > newLimits.maxProjects) {
      return err(
        new InvalidStateTransitionError(
          this._subscription,
          tier,
          `Account has ${this._projectCount} projects but ${tier} allows only ${newLimits.maxProjects}`
        )
      );
    }

    this._subscription = tier;
    this._maxProjects = newLimits.maxProjects;
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * End trial and convert to paid subscription
   */
  convertToPaid(stripeCustomerId: string, stripeSubscriptionId: string): void {
    this._isOnTrial = false;
    this._stripeCustomerId = stripeCustomerId;
    this._stripeSubscriptionId = stripeSubscriptionId;
    this.markUpdated();
  }

  /**
   * Extend trial period
   */
  extendTrial(additionalDays: number): Result<void, InvariantViolationError> {
    if (!this._isOnTrial) {
      return err(new InvariantViolationError("Cannot extend trial for paid account"));
    }

    if (additionalDays <= 0) {
      return err(new InvariantViolationError("Additional days must be positive"));
    }

    const currentEnd = this._trialEndDate ?? new Date();
    const newEnd = new Date(currentEnd.getTime() + additionalDays * 24 * 60 * 60 * 1000);
    this._trialEndDate = newEnd;
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * Toggle auto-renewal
   */
  setAutoRenewal(enabled: boolean): void {
    this._autoRenewal = enabled;
    this.markUpdated();
  }

  /**
   * Change billing cycle
   */
  setBillingCycle(cycle: BillingCycleValue): void {
    this._billingCycle = cycle;
    this.markUpdated();
  }

  /**
   * Increment project count (called when project is created)
   */
  incrementProjectCount(): Result<void, InvariantViolationError> {
    if (!this.canCreateProject) {
      return err(
        new InvariantViolationError(
          `Account has reached maximum projects limit (${this._maxProjects})`
        )
      );
    }
    this._projectCount += 1;
    return ok(undefined);
  }

  /**
   * Decrement project count (called when project is deleted)
   */
  decrementProjectCount(): void {
    if (this._projectCount > 0) {
      this._projectCount -= 1;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.toString(),
      email: this._email,
      name: this._name,
      subscription: this._subscription,
      maxProjects: this._maxProjects,
      projectCount: this._projectCount,
      isOnTrial: this._isOnTrial,
      trialStartDate: this._trialStartDate.toISOString(),
      ...(this._trialEndDate && { trialEndDate: this._trialEndDate.toISOString() }),
      trialDaysRemaining: this.trialDaysRemaining,
      isActive: this.isActive,
      autoRenewal: this._autoRenewal,
      billingCycle: this._billingCycle,
      tierLimits: this.tierLimits,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
