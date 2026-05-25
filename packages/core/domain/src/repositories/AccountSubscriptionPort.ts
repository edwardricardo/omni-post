/**
 * @file AccountSubscriptionPort.ts
 * @description Port for creating AccountSubscription records during registration.
 * @layer domain
 */

export interface CreateAccountSubscriptionParams {
  accountId: string;
  status: string;
  pricePerMonth: number;
  maxProjects: number;
  trialEndsAt: Date;
  billingCycle: string;
}

export interface AccountSubscriptionPort {
  createForNewAccount(params: CreateAccountSubscriptionParams): Promise<void>;

  /**
   * Cancel every subscription belonging to an account by setting its status to
   * CANCELED. Idempotent — a no-op when the account has no subscription.
   */
  cancelByAccountId(accountId: string): Promise<void>;
}
