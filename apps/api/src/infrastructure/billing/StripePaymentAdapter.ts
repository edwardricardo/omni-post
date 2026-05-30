/**
 * @file StripePaymentAdapter.ts
 * @description Stripe implementation of PaymentAdapter.
 * @layer infrastructure
 */

import Stripe from "stripe";
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

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  prices: Record<BillingPlan, Record<BillingCycle, string>>;
}

export class StripePaymentAdapter implements PaymentAdapter {
  readonly provider = "stripe" as const;
  private readonly stripe: Stripe;
  private readonly priceMap: Record<BillingPlan, Record<BillingCycle, string>>;
  private readonly webhookSecret: string;

  constructor(config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey);
    this.priceMap = config.prices;
    this.webhookSecret = config.webhookSecret;
  }

  /**
   * @method createCustomer
   * @description Creates a Stripe customer for an account.
   * @param params - Email, display name, and accountId metadata
   * @returns Object with the externalCustomerId issued by Stripe
   */
  async createCustomer(params: {
    email: string;
    name: string;
    metadata: { accountId: string };
  }): Promise<CreateCustomerResult> {
    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: { accountId: params.metadata.accountId },
    });
    return { externalCustomerId: customer.id };
  }

  /**
   * @method createSubscription
   * @description Creates a Stripe subscription with the resolved price id and optional trial.
   * @param params - Customer id, plan, billing cycle, and optional trial period in days
   * @returns Subscription id, mapped status, and current period end
   */
  async createSubscription(params: {
    externalCustomerId: string;
    plan: BillingPlan;
    cycle: BillingCycle;
    trialDays?: number;
  }): Promise<CreateSubscriptionResult> {
    const priceId = this.priceMap[params.plan][params.cycle];
    const subscription = await this.stripe.subscriptions.create({
      customer: params.externalCustomerId,
      items: [{ price: priceId }],
      ...(params.trialDays !== undefined && { trial_period_days: params.trialDays }),
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
    });
    const sub = subscription as unknown as Record<string, unknown>;
    return {
      externalSubscriptionId: subscription.id,
      status: this.mapStatus(subscription.status),
      currentPeriodEnd: new Date(((sub.current_period_end as number) ?? Date.now() / 1000) * 1000),
    };
  }

  /**
   * @method updateSubscription
   * @description Swaps the subscription's price to the new plan/cycle with prorations.
   * @param params - Subscription id and new plan/cycle
   * @returns Updated subscription summary
   */
  async updateSubscription(params: {
    externalSubscriptionId: string;
    newPlan: BillingPlan;
    newCycle: BillingCycle;
  }): Promise<CreateSubscriptionResult> {
    const priceId = this.priceMap[params.newPlan][params.newCycle];
    const sub = await this.stripe.subscriptions.retrieve(params.externalSubscriptionId);
    const firstItem = sub.items.data[0];
    if (!firstItem) throw new Error("Subscription has no items");

    const updated = await this.stripe.subscriptions.update(params.externalSubscriptionId, {
      items: [{ id: firstItem.id, price: priceId }],
      proration_behavior: "create_prorations",
    });
    const raw = updated as unknown as Record<string, unknown>;
    return {
      externalSubscriptionId: updated.id,
      status: this.mapStatus(updated.status),
      currentPeriodEnd: new Date(((raw.current_period_end as number) ?? Date.now() / 1000) * 1000),
    };
  }

  /**
   * @method cancelSubscription
   * @description Cancels a subscription immediately or schedules cancellation at period end.
   * @param params - Subscription id and the immediately flag
   */
  async cancelSubscription(params: {
    externalSubscriptionId: string;
    immediately?: boolean;
  }): Promise<void> {
    if (params.immediately) {
      await this.stripe.subscriptions.cancel(params.externalSubscriptionId);
    } else {
      await this.stripe.subscriptions.update(params.externalSubscriptionId, {
        cancel_at_period_end: true,
      });
    }
  }

  /**
   * @method cancelAtPeriodEnd
   * @description Flags the subscription to cancel at the end of the current billing period.
   * @param params - Subscription id
   */
  async cancelAtPeriodEnd(params: { externalSubscriptionId: string }): Promise<void> {
    await this.stripe.subscriptions.update(params.externalSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  /**
   * @method reactivateSubscription
   * @description Clears the cancel-at-period-end flag, restoring the subscription.
   * @param params - Subscription id
   */
  async reactivateSubscription(params: { externalSubscriptionId: string }): Promise<void> {
    await this.stripe.subscriptions.update(params.externalSubscriptionId, {
      cancel_at_period_end: false,
    });
  }

  /**
   * @method getSubscriptionDetails
   * @description Fetches the current subscription state from Stripe.
   * @param params - Subscription id
   * @returns Current period end, mapped status, and cancel-at-period-end flag
   */
  async getSubscriptionDetails(params: {
    externalSubscriptionId: string;
  }): Promise<SubscriptionDetails> {
    const sub = await this.stripe.subscriptions.retrieve(params.externalSubscriptionId);
    const raw = sub as unknown as Record<string, unknown>;
    return {
      currentPeriodEnd: new Date(((raw.current_period_end as number) ?? Date.now() / 1000) * 1000),
      status: this.mapStatus(sub.status),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  }

  /**
   * @method createCheckoutSession
   * @description Creates a Stripe-hosted Checkout session for subscription signup.
   * @param params - Customer id, success/cancel URLs, optional metadata
   * @returns Hosted checkout URL
   */
  async createCheckoutSession(params: {
    externalCustomerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      customer: params.externalCustomerId,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      mode: "subscription",
      ...(params.metadata !== undefined && { metadata: params.metadata }),
    });
    if (!session.url) {
      throw new Error("Stripe checkout session did not return a URL");
    }
    return { url: session.url };
  }

  /**
   * @method createBillingPortalSession
   * @description Creates a Stripe Billing Portal session for self-serve subscription management.
   * @param params - Customer id and return URL
   * @returns Hosted portal URL
   */
  async createBillingPortalSession(params: {
    externalCustomerId: string;
    returnUrl: string;
  }): Promise<BillingPortalResult> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: params.externalCustomerId,
      return_url: params.returnUrl,
    });
    return { url: session.url };
  }

  /**
   * @method parseWebhookEvent
   * @description Verifies the signature and parses a Stripe webhook payload.
   * @param params - Raw payload buffer/string and the Stripe-Signature header value
   * @returns Normalised webhook event (id, type, data)
   */
  async parseWebhookEvent(params: {
    payload: Buffer | string;
    signature: string;
  }): Promise<WebhookEvent> {
    const event = this.stripe.webhooks.constructEvent(
      params.payload,
      params.signature,
      this.webhookSecret
    );
    return {
      id: event.id,
      type: event.type,
      data: event.data.object as unknown as Record<string, unknown>,
    };
  }

  /**
   * @method mapEventType
   * @description Translates a Stripe webhook event type to its canonical BillingDomainEvent.
   * @param type - Stripe event type string
   * @returns Domain event, or null when the Stripe event has no domain counterpart
   */
  mapEventType(type: string): BillingDomainEvent | null {
    const map: Record<string, BillingDomainEvent> = {
      "customer.subscription.created": "subscription.activated",
      "customer.subscription.updated": "subscription.updated",
      "customer.subscription.deleted": "subscription.canceled",
      "invoice.payment_succeeded": "payment.succeeded",
      "invoice.payment_failed": "payment.failed",
      "customer.subscription.trial_will_end": "trial.ending_soon",
    };
    return map[type] ?? null;
  }

  private mapStatus(
    s: Stripe.Subscription.Status
  ): "active" | "trialing" | "past_due" | "canceled" {
    const m: Record<string, "active" | "trialing" | "past_due" | "canceled"> = {
      active: "active",
      trialing: "trialing",
      past_due: "past_due",
      canceled: "canceled",
    };
    return m[s] ?? "active";
  }
}
