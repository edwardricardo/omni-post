/**
 * @file StripePaymentAdapter.ts
 * @description Stripe implementation of IPaymentAdapter.
 * @layer infrastructure
 */

import Stripe from "stripe";
import type {
  IPaymentAdapter,
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

export class StripePaymentAdapter implements IPaymentAdapter {
  readonly provider = "stripe" as const;
  private readonly stripe: Stripe;
  private readonly priceMap: Record<BillingPlan, Record<BillingCycle, string>>;
  private readonly webhookSecret: string;

  constructor(config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey);
    this.priceMap = config.prices;
    this.webhookSecret = config.webhookSecret;
  }

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

  async cancelAtPeriodEnd(params: { externalSubscriptionId: string }): Promise<void> {
    await this.stripe.subscriptions.update(params.externalSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  async reactivateSubscription(params: { externalSubscriptionId: string }): Promise<void> {
    await this.stripe.subscriptions.update(params.externalSubscriptionId, {
      cancel_at_period_end: false,
    });
  }

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
