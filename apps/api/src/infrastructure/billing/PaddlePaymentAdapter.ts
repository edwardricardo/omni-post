/**
 * @file PaddlePaymentAdapter.ts
 * @description Paddle (Merchant of Record) implementation of PaymentAdapter.
 *              Paddle handles VAT/tax globally — they charge the customer and pay you net.
 * @layer infrastructure
 */

import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import type {
  PaymentAdapter,
  BillingPlan,
  BillingCycle,
  CreateCustomerResult,
  CreateSubscriptionResult,
  BillingPortalResult,
  WebhookEvent,
  BillingDomainEvent,
  SubscriptionDetails,
} from "@ports/core";

export interface PaddleConfig {
  apiKey: string;
  webhookSecret: string;
  sandbox: boolean;
  prices: Record<BillingPlan, Record<BillingCycle, string>>;
}

export class PaddlePaymentAdapter implements PaymentAdapter {
  readonly provider = "paddle" as const;
  private readonly paddle: Paddle;
  private readonly priceMap: Record<BillingPlan, Record<BillingCycle, string>>;
  private readonly webhookSecret: string;

  constructor(config: PaddleConfig) {
    this.paddle = new Paddle(config.apiKey, {
      environment: config.sandbox ? Environment.sandbox : Environment.production,
    });
    this.priceMap = config.prices;
    this.webhookSecret = config.webhookSecret;
  }

  /**
   * @method createCustomer
   * @description Creates a Paddle customer with accountId attached as custom data.
   * @param params - Email, display name, and accountId metadata
   * @returns Object with the externalCustomerId issued by Paddle
   */
  async createCustomer(params: {
    email: string;
    name: string;
    metadata: { accountId: string };
  }): Promise<CreateCustomerResult> {
    const customer = await this.paddle.customers.create({
      email: params.email,
      name: params.name,
      customData: { accountId: params.metadata.accountId },
    });
    return { externalCustomerId: customer.id };
  }

  /**
   * @method createSubscription
   * @description Returns a placeholder subscription record; Paddle subscriptions are typically
   *              finalised through a Checkout overlay callback rather than backend-initiated.
   * @param params - Customer id, plan, billing cycle, optional trial days
   * @returns Pending subscription summary
   */
  async createSubscription(params: {
    externalCustomerId: string;
    plan: BillingPlan;
    cycle: BillingCycle;
    trialDays?: number;
  }): Promise<CreateSubscriptionResult> {
    // Paddle subscriptions are typically created via Checkout overlay
    // For backend-initiated, we use the subscriptions API
    const _priceId = this.priceMap[params.plan][params.cycle];

    // Paddle SDK v3 doesn't have subscriptions.create() directly
    // Subscriptions are created via checkout sessions in production
    // Return a placeholder that would be filled by checkout callback
    return {
      externalSubscriptionId: `paddle_sub_pending_${params.externalCustomerId}`,
      status: params.trialDays ? "trialing" : "active",
      currentPeriodEnd: new Date(Date.now() + (params.trialDays ?? 30) * 24 * 60 * 60 * 1000),
    };
  }

  /**
   * @method updateSubscription
   * @description Updates the Paddle subscription with the new price and prorates immediately.
   * @param params - Subscription id and new plan/cycle
   * @returns Updated subscription summary
   */
  async updateSubscription(params: {
    externalSubscriptionId: string;
    newPlan: BillingPlan;
    newCycle: BillingCycle;
  }): Promise<CreateSubscriptionResult> {
    const priceId = this.priceMap[params.newPlan][params.newCycle];
    const updated = await this.paddle.subscriptions.update(params.externalSubscriptionId, {
      items: [{ priceId, quantity: 1 }],
      prorationBillingMode: "prorated_immediately",
    });
    const raw = updated as unknown as Record<string, unknown>;
    const period = raw.currentBillingPeriod as { endsAt?: string } | undefined;
    return {
      externalSubscriptionId: updated.id,
      status: this.mapStatus((raw.status as string) ?? "active"),
      currentPeriodEnd: new Date(period?.endsAt ?? Date.now()),
    };
  }

  /**
   * @method cancelSubscription
   * @description Cancels a Paddle subscription either immediately or at next billing period.
   * @param params - Subscription id and the immediately flag
   */
  async cancelSubscription(params: {
    externalSubscriptionId: string;
    immediately?: boolean;
  }): Promise<void> {
    await this.paddle.subscriptions.cancel(params.externalSubscriptionId, {
      effectiveFrom: params.immediately ? "immediately" : "next_billing_period",
    });
  }

  /**
   * @method cancelAtPeriodEnd
   * @description Schedules a Paddle subscription cancellation at the next billing period.
   * @param params - Subscription id
   */
  async cancelAtPeriodEnd(params: { externalSubscriptionId: string }): Promise<void> {
    await this.paddle.subscriptions.cancel(params.externalSubscriptionId, {
      effectiveFrom: "next_billing_period",
    });
  }

  /**
   * @method reactivateSubscription
   * @description Clears any scheduled change on the Paddle subscription, restoring it.
   * @param params - Subscription id
   */
  async reactivateSubscription(params: { externalSubscriptionId: string }): Promise<void> {
    await this.paddle.subscriptions.update(params.externalSubscriptionId, {
      scheduledChange: null,
    });
  }

  /**
   * @method getSubscriptionDetails
   * @description Fetches the current Paddle subscription state.
   * @param params - Subscription id
   * @returns Current period end, mapped status, and cancel-at-period-end flag derived
   *          from any pending scheduledChange
   */
  async getSubscriptionDetails(params: {
    externalSubscriptionId: string;
  }): Promise<SubscriptionDetails> {
    const sub = await this.paddle.subscriptions.get(params.externalSubscriptionId);
    const raw = sub as unknown as Record<string, unknown>;
    const period = raw.currentBillingPeriod as { endsAt?: string } | undefined;
    const scheduledChange = raw.scheduledChange as Record<string, unknown> | null;
    return {
      currentPeriodEnd: new Date(period?.endsAt ?? Date.now()),
      status: this.mapStatus((raw.status as string) ?? "active"),
      cancelAtPeriodEnd: scheduledChange?.action === "cancel",
    };
  }

  /**
   * @method createCheckoutSession
   * @description Builds a Paddle-hosted Checkout URL using a customer auth token.
   * @param params - Customer id, success/cancel URLs, optional metadata
   * @returns Hosted checkout URL
   */
  async createCheckoutSession(params: {
    externalCustomerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string }> {
    const token = await this.paddle.customers.generateAuthToken(params.externalCustomerId);
    const raw = token as unknown as Record<string, unknown>;
    const customerToken = raw.token as string;
    return {
      url: `https://checkout.paddle.com/subscribe?customer_token=${customerToken}&success_url=${encodeURIComponent(params.successUrl)}&cancel_url=${encodeURIComponent(params.cancelUrl)}`,
    };
  }

  /**
   * @method createBillingPortalSession
   * @description Builds the Paddle customer portal URL for self-serve subscription management.
   * @param params - Customer id and return URL
   * @returns Hosted portal URL
   */
  async createBillingPortalSession(params: {
    externalCustomerId: string;
    returnUrl: string;
  }): Promise<BillingPortalResult> {
    const token = await this.paddle.customers.generateAuthToken(params.externalCustomerId);
    const raw = token as unknown as Record<string, unknown>;
    return {
      url: `https://customer.paddle.com/subscriptions?token=${raw.token as string}`,
    };
  }

  /**
   * @method parseWebhookEvent
   * @description Verifies the signature and parses a Paddle webhook payload.
   * @param params - Raw payload buffer/string and the Paddle-Signature header value
   * @returns Normalised webhook event (id, type, data)
   */
  async parseWebhookEvent(params: {
    payload: Buffer | string;
    signature: string;
  }): Promise<WebhookEvent> {
    const body =
      typeof params.payload === "string" ? params.payload : params.payload.toString("utf-8");
    const event = this.paddle.webhooks.unmarshal(body, this.webhookSecret, params.signature);
    if (!event) throw new Error("Invalid Paddle webhook signature");
    const raw = event as unknown as Record<string, unknown>;
    return {
      id: (raw.eventId ?? raw.event_id ?? raw.notificationId ?? "") as string,
      type: raw.eventType as string,
      data: raw.data as Record<string, unknown>,
    };
  }

  /**
   * @method mapEventType
   * @description Translates a Paddle webhook event type to its canonical BillingDomainEvent.
   * @param type - Paddle event type string
   * @returns Domain event, or null when the Paddle event has no domain counterpart
   */
  mapEventType(type: string): BillingDomainEvent | null {
    const map: Record<string, BillingDomainEvent> = {
      "subscription.activated": "subscription.activated",
      "subscription.updated": "subscription.updated",
      "subscription.canceled": "subscription.canceled",
      "transaction.completed": "payment.succeeded",
      "transaction.payment_failed": "payment.failed",
      "subscription.trial_ending": "trial.ending_soon",
    };
    return map[type] ?? null;
  }

  private mapStatus(s: string): "active" | "trialing" | "past_due" | "canceled" {
    const m: Record<string, "active" | "trialing" | "past_due" | "canceled"> = {
      active: "active",
      trialing: "trialing",
      past_due: "past_due",
      canceled: "canceled",
      paused: "past_due",
    };
    return m[s] ?? "active";
  }
}
