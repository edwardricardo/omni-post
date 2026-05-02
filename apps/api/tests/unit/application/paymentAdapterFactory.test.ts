/**
 * @file paymentAdapterFactory.test.ts
 * @description Unit tests for payment adapter factory and event mapping.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createPaymentAdapter } from "../../../src/infrastructure/billing/paymentAdapterFactory.js";
import { StripePaymentAdapter } from "../../../src/infrastructure/billing/StripePaymentAdapter.js";
import { PaddlePaymentAdapter } from "../../../src/infrastructure/billing/PaddlePaymentAdapter.js";

describe("createPaymentAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns StripePaymentAdapter when provider=stripe", () => {
    const adapter = createPaymentAdapter({
      provider: "stripe",
      stripeSecretKey: "sk_test_placeholder_key_for_testing",
      stripeWebhookSecret: "whsec_test",
    });
    assert.strictEqual(adapter.provider, "stripe");
    expect(adapter).toBeInstanceOf(StripePaymentAdapter);
  });

  it("returns PaddlePaymentAdapter when provider=paddle", () => {
    const adapter = createPaymentAdapter({
      provider: "paddle",
      paddleApiKey: "test_paddle_key",
      paddleWebhookSecret: "test_secret",
    });
    assert.strictEqual(adapter.provider, "paddle");
    expect(adapter).toBeInstanceOf(PaddlePaymentAdapter);
  });

  it("throws when provider=none — explicit selection required", () => {
    expect(() => createPaymentAdapter({ provider: "none" })).toThrow(
      /Set PAYMENT_PROVIDER to "stripe" or "paddle"/
    );
  });

  it("throws when stripe is partially configured", () => {
    expect(() =>
      createPaymentAdapter({ provider: "stripe", stripeSecretKey: "sk_test_only" })
    ).toThrow(/STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET/);
  });

  it("throws when paddle is partially configured", () => {
    expect(() => createPaymentAdapter({ provider: "paddle", paddleApiKey: "key_only" })).toThrow(
      /PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET/
    );
  });
});

describe("StripePaymentAdapter.mapEventType", () => {
  it("maps Stripe events to domain events", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_xxx";
    const adapter = new StripePaymentAdapter({
      secretKey: "sk_test_xxx",
      webhookSecret: "whsec_xxx",
      prices: {
        BASIC: { monthly: "price_1", yearly: "price_2" },
        PRO: { monthly: "price_3", yearly: "price_4" },
        ENTERPRISE: { monthly: "price_5", yearly: "price_6" },
      },
    });

    assert.strictEqual(
      adapter.mapEventType("customer.subscription.created"),
      "subscription.activated"
    );
    assert.strictEqual(adapter.mapEventType("invoice.payment_succeeded"), "payment.succeeded");
    assert.strictEqual(adapter.mapEventType("invoice.payment_failed"), "payment.failed");
    assert.strictEqual(
      adapter.mapEventType("customer.subscription.deleted"),
      "subscription.canceled"
    );
    assert.strictEqual(
      adapter.mapEventType("customer.subscription.trial_will_end"),
      "trial.ending_soon"
    );
    assert.strictEqual(adapter.mapEventType("unknown.event"), null);
  });
});

describe("PaddlePaymentAdapter.mapEventType", () => {
  it("maps Paddle events to domain events", () => {
    const adapter = new PaddlePaymentAdapter({
      apiKey: "test_key",
      webhookSecret: "test_secret",
      sandbox: true,
      prices: {
        BASIC: { monthly: "pri_1", yearly: "pri_2" },
        PRO: { monthly: "pri_3", yearly: "pri_4" },
        ENTERPRISE: { monthly: "pri_5", yearly: "pri_6" },
      },
    });

    assert.strictEqual(adapter.mapEventType("subscription.activated"), "subscription.activated");
    assert.strictEqual(adapter.mapEventType("transaction.completed"), "payment.succeeded");
    assert.strictEqual(adapter.mapEventType("transaction.payment_failed"), "payment.failed");
    assert.strictEqual(adapter.mapEventType("subscription.canceled"), "subscription.canceled");
    assert.strictEqual(adapter.mapEventType("subscription.trial_ending"), "trial.ending_soon");
    assert.strictEqual(adapter.mapEventType("unknown.event"), null);
  });
});
