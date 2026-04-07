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
}
