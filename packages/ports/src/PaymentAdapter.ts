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
  type: string;
  data: Record<string, unknown>;
}

export interface IPaymentAdapter {
  readonly provider: "stripe" | "paddle";

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

  createBillingPortalSession(params: {
    externalCustomerId: string;
    returnUrl: string;
  }): Promise<BillingPortalResult>;

  parseWebhookEvent(params: { payload: Buffer | string; signature: string }): Promise<WebhookEvent>;

  mapEventType(providerEventType: string): BillingDomainEvent | null;
}
