/**
 * @file Account.ts
 * @description Domain entity representing a user account with subscription tier, billing cycle, and tier-based usage limits.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { AccountId } from "../value-objects/EntityId.js";
import { normalizeEmail } from "../value-objects/EmailAddress.js";
import { InvalidValueError, InvariantViolationError } from "../errors/index.js";

/**
 * @deprecated Use AccountSubscription model with provider-based pricing instead.
 */
export const SUBSCRIPTION_TIER = {
  BASIC: "BASIC",
  PRO: "PRO",
  ENTERPRISE: "ENTERPRISE",
} as const;

/** @deprecated Use AccountSubscription.status instead. */
export type SubscriptionTierValue = (typeof SUBSCRIPTION_TIER)[keyof typeof SUBSCRIPTION_TIER];

/**
 * Tier limits configuration
 */
interface TierLimits {
  maxProjects: number;
  maxChannelsPerProject: number;
  maxPostsPerDay: number;
  maxTeamMembers: number;
  maxStorageBytes: bigint;
  maxRecurringPosts: number;
}

/** @deprecated Use AccountSubscription.maxProjects and BundleFeatureFlag instead. */
const TIER_LIMITS: Record<SubscriptionTierValue, TierLimits> = {
  [SUBSCRIPTION_TIER.BASIC]: {
    maxProjects: 1,
    maxChannelsPerProject: 3,
    maxPostsPerDay: 10,
    maxTeamMembers: 5,
    maxStorageBytes: 5_368_709_120n, // 5 GB
    maxRecurringPosts: 5,
  },
  [SUBSCRIPTION_TIER.PRO]: {
    maxProjects: 5,
    maxChannelsPerProject: 10,
    maxPostsPerDay: 100,
    maxTeamMembers: 15,
    maxStorageBytes: 53_687_091_200n, // 50 GB
    maxRecurringPosts: 20,
  },
  [SUBSCRIPTION_TIER.ENTERPRISE]: {
    maxProjects: -1,
    maxChannelsPerProject: -1,
    maxPostsPerDay: -1,
    maxTeamMembers: Infinity,
    maxStorageBytes: BigInt(Number.MAX_SAFE_INTEGER),
    maxRecurringPosts: Infinity,
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
  nextBillingDate?: Date;
  lastBillingDate?: Date;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  slug?: string;
  timezone?: string;
  locale?: string;
  phone?: string;
  maxTeamMembers?: number;
  maxStorageBytes?: bigint;
  maxRecurringPosts?: number;
}

/**
 * Account creation input
 */
export interface CreateAccountInput {
  email: string;
  name: string;
  subscription?: SubscriptionTierValue;
  trialDays?: number;
  timezone?: string;
  locale?: string;
  slug?: string;
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
  private _maxProjects: number;
  private _isOnTrial: boolean;
  private _trialStartDate: Date;
  private _trialEndDate: Date | undefined;
  private _autoRenewal: boolean;
  private _billingCycle: BillingCycleValue;
  private _nextBillingDate: Date | undefined;
  private _lastBillingDate: Date | undefined;
  private _stripeCustomerId: string | undefined;
  private _stripeSubscriptionId: string | undefined;
  private _projectCount: number;
  private _slug: string | undefined;
  private _timezone: string;
  private _locale: string;
  private _phone: string | undefined;
  private _maxTeamMembers: number;
  private _maxStorageBytes: bigint;
  private _maxRecurringPosts: number;

  private constructor(id: AccountId, props: AccountProps) {
    super(id, props.createdAt);
    const tier = props.subscription ?? SUBSCRIPTION_TIER.BASIC;
    this._email = props.email;
    this._name = props.name;
    this._maxProjects = props.maxProjects ?? TIER_LIMITS[tier].maxProjects;
    this._isOnTrial = props.isOnTrial ?? true;
    this._trialStartDate = props.trialStartDate ?? new Date();
    this._trialEndDate = props.trialEndDate;
    this._autoRenewal = props.autoRenewal ?? false;
    this._billingCycle = props.billingCycle ?? BILLING_CYCLE.MONTHLY;
    this._nextBillingDate = props.nextBillingDate;
    this._lastBillingDate = props.lastBillingDate;
    this._stripeCustomerId = props.stripeCustomerId;
    this._stripeSubscriptionId = props.stripeSubscriptionId;
    this._projectCount = 0;
    this._slug = props.slug;
    this._timezone = props.timezone ?? "UTC";
    this._locale = props.locale ?? "en";
    this._phone = props.phone;
    this._maxTeamMembers = props.maxTeamMembers ?? TIER_LIMITS[tier].maxTeamMembers;
    this._maxStorageBytes = props.maxStorageBytes ?? TIER_LIMITS[tier].maxStorageBytes;
    this._maxRecurringPosts = props.maxRecurringPosts ?? TIER_LIMITS[tier].maxRecurringPosts;

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
        email: normalizeEmail(input.email),
        name: input.name.trim(),
        isOnTrial: true,
        trialEndDate,
        ...(input.subscription !== undefined && { subscription: input.subscription }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        ...(input.locale !== undefined && { locale: input.locale }),
        ...(input.slug !== undefined && { slug: input.slug }),
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

  get nextBillingDate(): Date | undefined {
    return this._nextBillingDate ? new Date(this._nextBillingDate.getTime()) : undefined;
  }

  get lastBillingDate(): Date | undefined {
    return this._lastBillingDate ? new Date(this._lastBillingDate.getTime()) : undefined;
  }

  get stripeCustomerId(): string | undefined {
    return this._stripeCustomerId;
  }

  get stripeSubscriptionId(): string | undefined {
    return this._stripeSubscriptionId;
  }

  get slug(): string | undefined {
    return this._slug;
  }

  get timezone(): string {
    return this._timezone;
  }

  get locale(): string {
    return this._locale;
  }

  get phone(): string | undefined {
    return this._phone;
  }

  get maxTeamMembers(): number {
    return this._maxTeamMembers;
  }

  get maxStorageBytes(): bigint {
    return this._maxStorageBytes;
  }

  get maxRecurringPosts(): number {
    return this._maxRecurringPosts;
  }

  get projectCount(): number {
    return this._projectCount;
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

    this._email = normalizeEmail(newEmail);
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
   * Begin a trial period of the given duration. The next billing date is only
   * recorded when auto-renewal is enabled and a date is supplied; otherwise the
   * existing next billing date is left untouched.
   */
  startTrial(params: {
    trialDurationDays: number;
    autoRenewal: boolean;
    billingCycle: BillingCycleValue;
    nextBillingDate?: Date;
  }): void {
    this._isOnTrial = true;
    this._trialStartDate = new Date();
    this._trialEndDate = new Date(Date.now() + params.trialDurationDays * 24 * 60 * 60 * 1000);
    this._autoRenewal = params.autoRenewal;
    this._billingCycle = params.billingCycle;
    if (params.autoRenewal && params.nextBillingDate) {
      this._nextBillingDate = params.nextBillingDate;
    }
    this.markUpdated();
  }

  /**
   * End the current trial, disabling auto-renewal and clearing the scheduled
   * next billing date.
   */
  endTrial(): void {
    this._isOnTrial = false;
    this._trialEndDate = new Date();
    this._autoRenewal = false;
    this._nextBillingDate = undefined;
    this.markUpdated();
  }

  /**
   * Convert an active trial into a paid subscription with auto-renewal enabled
   * and the first billing dates recorded. Distinct from {@link convertToPaid},
   * which records Stripe identifiers.
   */
  convertTrialToPaid(params: {
    billingCycle: BillingCycleValue;
    lastBillingDate: Date;
    nextBillingDate: Date;
  }): void {
    this._isOnTrial = false;
    this._billingCycle = params.billingCycle;
    this._autoRenewal = true;
    this._lastBillingDate = params.lastBillingDate;
    this._nextBillingDate = params.nextBillingDate;
    this.markUpdated();
  }

  /**
   * Record an automatic renewal after a trial expires, advancing the billing
   * dates and clearing the trial flag.
   */
  recordRenewal(params: { lastBillingDate: Date; nextBillingDate: Date }): void {
    this._isOnTrial = false;
    this._lastBillingDate = params.lastBillingDate;
    this._nextBillingDate = params.nextBillingDate;
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

  /**
   * Set the account slug (URL-friendly identifier).
   * Must be lowercase, numbers, and hyphens only, between 3 and 30 characters.
   */
  setSlug(slug: string): Result<void, InvalidValueError> {
    const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
    if (slug.length < 3 || slug.length > 30) {
      return err(new InvalidValueError("slug", slug, "Slug must be between 3 and 30 characters"));
    }
    if (!slugRegex.test(slug)) {
      return err(
        new InvalidValueError(
          "slug",
          slug,
          "Slug must contain only lowercase letters, numbers, and hyphens"
        )
      );
    }

    this._slug = slug;
    this.markUpdated();
    return ok(undefined);
  }

  /**
   * Check if a new team member can be added given the current count.
   */
  canAddTeamMember(currentCount: number): boolean {
    return currentCount < this._maxTeamMembers;
  }

  /**
   * Check if additional storage can be added given the current and additional bytes.
   */
  canAddStorage(currentBytes: bigint, additionalBytes: bigint): boolean {
    return currentBytes + additionalBytes <= this._maxStorageBytes;
  }

  /**
   * Check if a new recurring post can be added given the current count.
   */
  canAddRecurringPost(currentCount: number): boolean {
    return currentCount < this._maxRecurringPosts;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.toString(),
      email: this._email,
      name: this._name,
      maxProjects: this._maxProjects,
      projectCount: this._projectCount,
      isOnTrial: this._isOnTrial,
      trialStartDate: this._trialStartDate.toISOString(),
      ...(this._trialEndDate && { trialEndDate: this._trialEndDate.toISOString() }),
      trialDaysRemaining: this.trialDaysRemaining,
      isActive: this.isActive,
      autoRenewal: this._autoRenewal,
      billingCycle: this._billingCycle,
      ...(this._nextBillingDate && { nextBillingDate: this._nextBillingDate.toISOString() }),
      ...(this._lastBillingDate && { lastBillingDate: this._lastBillingDate.toISOString() }),
      ...(this._slug !== undefined && { slug: this._slug }),
      timezone: this._timezone,
      locale: this._locale,
      ...(this._phone !== undefined && { phone: this._phone }),
      maxTeamMembers: this._maxTeamMembers,
      maxStorageBytes: this._maxStorageBytes.toString(),
      maxRecurringPosts: this._maxRecurringPosts,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
