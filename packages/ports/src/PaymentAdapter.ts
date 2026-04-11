/**
 * @file PaymentAdapter.ts
 * @description Technology-free payment adapter interface.
 *              Supports Stripe, Paddle, or any future payment provider.
 * @layer ports
 */

export type BillingPlan = "BASIC" | "PRO" | "ENTERPRISE";
export type BillingCycle = "monthly" | "yearly";

export interface CreateCustomerResult {
  externalCustomerId: string;
}

export interface CreateSubscriptionResult {
  externalSubscriptionId: string;
  status: "active" | "trialing" | "past_due" | "canceled";
  currentPeriodEnd: Date;
}

export interface BillingPortalResult {
  url: string;
}

export type BillingDomainEvent =
  | "subscription.activated"
  | "subscription.updated"
  | "subscription.canceled"
  | "payment.succeeded"
  | "payment.failed"
  | "trial.ending_soon";

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export type GatewayProviderType = "stripe" | "paddle";

export interface SubscriptionDetails {
  currentPeriodEnd: Date;
  status: string;
  cancelAtPeriodEnd: boolean;
}

export interface IPaymentAdapter {
  readonly provider: GatewayProviderType;

  createCustomer(params: {
    email: string;
    name: string;
    metadata: { accountId: string };
  }): Promise<CreateCustomerResult>;

  createSubscription(params: {
    externalCustomerId: string;
    plan: BillingPlan;
    cycle: BillingCycle;
    trialDays?: number;
  }): Promise<CreateSubscriptionResult>;

  updateSubscription(params: {
    externalSubscriptionId: string;
    newPlan: BillingPlan;
    newCycle: BillingCycle;
  }): Promise<CreateSubscriptionResult>;

  cancelSubscription(params: {
    externalSubscriptionId: string;
    immediately?: boolean;
  }): Promise<void>;

  cancelAtPeriodEnd(params: { externalSubscriptionId: string }): Promise<void>;

  reactivateSubscription(params: { externalSubscriptionId: string }): Promise<void>;

  getSubscriptionDetails(params: { externalSubscriptionId: string }): Promise<SubscriptionDetails>;

  createCheckoutSession(params: {
    externalCustomerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string }>;

  createBillingPortalSession(params: {
    externalCustomerId: string;
    returnUrl: string;
  }): Promise<BillingPortalResult>;

  parseWebhookEvent(params: { payload: Buffer | string; signature: string }): Promise<WebhookEvent>;

  mapEventType(providerEventType: string): BillingDomainEvent | null;
}
