/**
 * @file paymentAdapterFactory.ts
 * @description Factory that selects payment adapter based on a config.
 *              Switching providers is a config change, not a code change. Required
 *              provider secrets are validated at point of use; partial configuration
 *              fails fast.
 * @layer infrastructure
 */

import type { PaymentAdapter, BillingPlan, BillingCycle } from "@ports/core";
import { env } from "../../config/env.js";
import { StripePaymentAdapter } from "./StripePaymentAdapter.js";
import { PaddlePaymentAdapter } from "./PaddlePaymentAdapter.js";

export interface PaymentAdapterFactoryConfig {
  provider: "stripe" | "paddle" | "none";
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  paddleApiKey?: string;
  paddleWebhookSecret?: string;
  paddleSandbox?: boolean;
}

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

function configFromEnv(): PaymentAdapterFactoryConfig {
  return {
    provider: env.PAYMENT_PROVIDER,
    ...(env.STRIPE_SECRET_KEY !== undefined && { stripeSecretKey: env.STRIPE_SECRET_KEY }),
    ...(env.STRIPE_WEBHOOK_SECRET !== undefined && {
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    }),
    ...(env.PADDLE_API_KEY !== undefined && { paddleApiKey: env.PADDLE_API_KEY }),
    ...(env.PADDLE_WEBHOOK_SECRET !== undefined && {
      paddleWebhookSecret: env.PADDLE_WEBHOOK_SECRET,
    }),
    ...(env.PADDLE_SANDBOX !== undefined && { paddleSandbox: env.PADDLE_SANDBOX }),
  };
}

/**
 * @function createPaymentAdapter
 * @description Builds the configured PaymentAdapter (Stripe, Paddle, or none) from
 *              env-derived config; fails fast on missing required secrets.
 * @param config - Optional factory config (defaults to configFromEnv())
 * @returns Concrete PaymentAdapter implementation
 */
export function createPaymentAdapter(
  config: PaymentAdapterFactoryConfig = configFromEnv()
): PaymentAdapter {
  if (config.provider === "paddle") {
    if (!config.paddleApiKey || !config.paddleWebhookSecret) {
      throw new Error(
        "PAYMENT_PROVIDER=paddle requires PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET. " +
          "Either provide both or set PAYMENT_PROVIDER=none."
      );
    }
    return new PaddlePaymentAdapter({
      apiKey: config.paddleApiKey,
      webhookSecret: config.paddleWebhookSecret,
      sandbox: config.paddleSandbox ?? false,
      prices: buildPriceMap("PADDLE"),
    });
  }

  if (config.provider === "stripe") {
    if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
      throw new Error(
        "PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. " +
          "Either provide both or set PAYMENT_PROVIDER=none."
      );
    }
    return new StripePaymentAdapter({
      secretKey: config.stripeSecretKey,
      webhookSecret: config.stripeWebhookSecret,
      prices: buildPriceMap("STRIPE"),
    });
  }

  throw new Error(
    `PAYMENT_PROVIDER=${config.provider} cannot construct a payment adapter. ` +
      `Set PAYMENT_PROVIDER to "stripe" or "paddle" with the corresponding secrets.`
  );
}
