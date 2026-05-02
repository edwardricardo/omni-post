/**
 * @file GatewayAdapterRegistry.ts
 * @description Registry that holds both Stripe and Paddle payment adapters.
 *   Enables dual-gateway operations required for gateway switching.
 *   Adapters are lazily instantiated on first access and cached.
 * @layer infrastructure
 */

import type { PaymentAdapter, GatewayProviderType } from "@ports/core";
import { env } from "../../config/env.js";
import { StripePaymentAdapter, type StripeConfig } from "./StripePaymentAdapter.js";
import { PaddlePaymentAdapter, type PaddleConfig } from "./PaddlePaymentAdapter.js";

export interface GatewayAdapterRegistryPort {
  getAdapter(provider: GatewayProviderType): PaymentAdapter;
}

interface GatewayRegistryConfig {
  stripe: StripeConfig;
  paddle: PaddleConfig;
}

export class GatewayAdapterRegistry implements GatewayAdapterRegistryPort {
  private stripeAdapter: StripePaymentAdapter | null = null;
  private paddleAdapter: PaddlePaymentAdapter | null = null;
  private readonly config: GatewayRegistryConfig;

  constructor(config: GatewayRegistryConfig) {
    this.config = config;
  }

  getAdapter(provider: GatewayProviderType): PaymentAdapter {
    if (provider === "stripe") {
      if (!this.stripeAdapter) {
        if (!this.config.stripe.secretKey) {
          throw new Error("Stripe adapter requested but STRIPE_SECRET_KEY is not configured");
        }
        this.stripeAdapter = new StripePaymentAdapter(this.config.stripe);
      }
      return this.stripeAdapter;
    }

    if (!this.paddleAdapter) {
      if (!this.config.paddle.apiKey) {
        throw new Error("Paddle adapter requested but PADDLE_API_KEY is not configured");
      }
      this.paddleAdapter = new PaddlePaymentAdapter(this.config.paddle);
    }
    return this.paddleAdapter;
  }
}

function buildPriceMap(
  prefix: string
): Record<"BASIC" | "PRO" | "ENTERPRISE", Record<"monthly" | "yearly", string>> {
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

/**
 * @function createGatewayRegistry
 * @description Factory that creates a registry with configs from environment variables.
 *              Each provider's secretKey/apiKey + webhookSecret pair must be set
 *              together — partial config throws at startup (not at first use).
 */
export function createGatewayRegistry(): GatewayAdapterRegistry {
  const stripeConfigured = Boolean(env.STRIPE_SECRET_KEY) || Boolean(env.STRIPE_WEBHOOK_SECRET);
  if (stripeConfigured && (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)) {
    throw new Error(
      "Stripe is partially configured. Set BOTH STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, or neither."
    );
  }

  const paddleConfigured = Boolean(env.PADDLE_API_KEY) || Boolean(env.PADDLE_WEBHOOK_SECRET);
  if (paddleConfigured && (!env.PADDLE_API_KEY || !env.PADDLE_WEBHOOK_SECRET)) {
    throw new Error(
      "Paddle is partially configured. Set BOTH PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET, or neither."
    );
  }

  return new GatewayAdapterRegistry({
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY ?? "",
      webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "",
      prices: buildPriceMap("STRIPE"),
    },
    paddle: {
      apiKey: env.PADDLE_API_KEY ?? "",
      webhookSecret: env.PADDLE_WEBHOOK_SECRET ?? "",
      sandbox: env.PADDLE_SANDBOX ?? false,
      prices: buildPriceMap("PADDLE"),
    },
  });
}
