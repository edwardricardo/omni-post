/**
 * @file PaymentAdapter.ts
 * @description Technology-free payment adapter interface.
 *              Supports Stripe, Paddle, or any future payment provider.
 * @layer domain
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

export interface PaymentAdapter {
  /** Identifies which payment gateway this adapter wraps. */
  readonly provider: GatewayProviderType;

  /**
   * Create a customer record on the gateway and return its external id.
   * `metadata.accountId` MUST be stamped so webhooks can route back to the
   * owning account without an extra lookup.
   */
  createCustomer(params: {
    email: string;
    name: string;
    metadata: { accountId: string };
  }): Promise<CreateCustomerResult>;

  /**
   * Create a subscription for an existing gateway customer. Returns the
   * gateway subscription id, its initial status, and the current period end.
   */
  createSubscription(params: {
    externalCustomerId: string;
    plan: BillingPlan;
    cycle: BillingCycle;
    trialDays?: number;
  }): Promise<CreateSubscriptionResult>;

  /**
   * Switch plan/cycle on an existing subscription. Gateway handles proration
   * per its own policy; result reflects the post-change state.
   */
  updateSubscription(params: {
    externalSubscriptionId: string;
    newPlan: BillingPlan;
    newCycle: BillingCycle;
  }): Promise<CreateSubscriptionResult>;

  /**
   * Cancel a subscription. When `immediately` is true the cancellation takes
   * effect at once; otherwise the gateway cancels at the period boundary.
   */
  cancelSubscription(params: {
    externalSubscriptionId: string;
    immediately?: boolean;
  }): Promise<void>;

  /** Schedule cancellation at the end of the current billing period. */
  cancelAtPeriodEnd(params: { externalSubscriptionId: string }): Promise<void>;

  /** Reverse a `cancelAtPeriodEnd` so the subscription continues renewing. */
  reactivateSubscription(params: { externalSubscriptionId: string }): Promise<void>;

  /** Fetch live subscription state from the gateway (status + period end). */
  getSubscriptionDetails(params: { externalSubscriptionId: string }): Promise<SubscriptionDetails>;

  /**
   * Create a hosted checkout session for a new subscription. `metadata` is
   * forwarded to the resulting subscription so webhooks can correlate it.
   */
  createCheckoutSession(params: {
    externalCustomerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string }>;

  /**
   * Mint a one-time URL for the gateway's hosted billing portal so the
   * customer can self-manage payment methods and invoices.
   */
  createBillingPortalSession(params: {
    externalCustomerId: string;
    returnUrl: string;
  }): Promise<BillingPortalResult>;

  /**
   * Verify webhook authenticity (HMAC signature) and parse the event payload.
   * Throws on signature mismatch — callers MUST treat that as a 401.
   */
  parseWebhookEvent(params: { payload: Buffer | string; signature: string }): Promise<WebhookEvent>;

  /**
   * Translate a gateway-specific event type into our canonical
   * `BillingDomainEvent`, or null when the event is not actionable.
   */
  mapEventType(providerEventType: string): BillingDomainEvent | null;
}
