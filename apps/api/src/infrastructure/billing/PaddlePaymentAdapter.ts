/**
 * @file PaddlePaymentAdapter.ts
 * @description Paddle (Merchant of Record) implementation of IPaymentAdapter.
 *              Paddle handles VAT/tax globally — they charge the customer and pay you net.
 * @layer infrastructure
 */

import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import type {
  IPaymentAdapter,
  BillingPlan,
  BillingCycle,
  CreateCustomerResult,
  CreateSubscriptionResult,
  BillingPortalResult,
  WebhookEvent,
  BillingDomainEvent,
} from "@ports/core";

export interface PaddleConfig {
  apiKey: string;
  webhookSecret: string;
  sandbox: boolean;
  prices: Record<BillingPlan, Record<BillingCycle, string>>;
}

export class PaddlePaymentAdapter implements IPaymentAdapter {
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

  async cancelSubscription(params: {
    externalSubscriptionId: string;
    immediately?: boolean;
  }): Promise<void> {
    await this.paddle.subscriptions.cancel(params.externalSubscriptionId, {
      effectiveFrom: params.immediately ? "immediately" : "next_billing_period",
    });
  }

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
      type: raw.eventType as string,
      data: raw.data as Record<string, unknown>,
    };
  }

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
