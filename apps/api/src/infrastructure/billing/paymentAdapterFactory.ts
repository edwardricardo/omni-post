/**
 * @file paymentAdapterFactory.ts
 * @description Factory that selects payment adapter based on PAYMENT_PROVIDER env var.
 *              Defaults to Stripe. Switching providers is a config change, not a code change.
 * @layer infrastructure
 */

import type { IPaymentAdapter, BillingPlan, BillingCycle } from "@ports/core";
import { StripePaymentAdapter } from "./StripePaymentAdapter.js";
import { PaddlePaymentAdapter } from "./PaddlePaymentAdapter.js";

function buildPriceMap(prefix: string): Record<BillingPlan, Record<BillingCycle, string>> {
  return {
    BASIC: {
      monthly: process.env[`${prefix}_PRICE_BASIC_MONTHLY`] ?? "",
      yearly: process.env[`${prefix}_PRICE_BASIC_YEARLY`] ?? "",
    },
    PRO: {
      monthly: process.env[`${prefix}_PRICE_PRO_MONTHLY`] ?? "",
      yearly: process.env[`${prefix}_PRICE_PRO_YEARLY`] ?? "",
    },
    ENTERPRISE: {
      monthly: process.env[`${prefix}_PRICE_ENTERPRISE_MONTHLY`] ?? "",
      yearly: process.env[`${prefix}_PRICE_ENTERPRISE_YEARLY`] ?? "",
    },
  };
}

export function createPaymentAdapter(): IPaymentAdapter {
  const provider = process.env.PAYMENT_PROVIDER ?? "stripe";

  if (provider === "paddle") {
    return new PaddlePaymentAdapter({
      apiKey: process.env.PADDLE_API_KEY ?? "",
      webhookSecret: process.env.PADDLE_WEBHOOK_SECRET ?? "",
      sandbox: process.env.PADDLE_SANDBOX === "true",
      prices: buildPriceMap("PADDLE"),
    });
  }

  return new StripePaymentAdapter({
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    prices: buildPriceMap("STRIPE"),
  });
}
