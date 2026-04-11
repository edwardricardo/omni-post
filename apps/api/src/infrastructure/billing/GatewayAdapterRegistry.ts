/**
 * @file GatewayAdapterRegistry.ts
 * @description Registry that holds both Stripe and Paddle payment adapters.
 *   Enables dual-gateway operations required for gateway switching.
 *   Adapters are lazily instantiated on first access and cached.
 * @layer infrastructure
 */

import type { IPaymentAdapter, GatewayProviderType } from "@ports/core";
import { StripePaymentAdapter, type StripeConfig } from "./StripePaymentAdapter.js";
import { PaddlePaymentAdapter, type PaddleConfig } from "./PaddlePaymentAdapter.js";

export interface IGatewayAdapterRegistry {
  getAdapter(provider: GatewayProviderType): IPaymentAdapter;
}

interface GatewayRegistryConfig {
  stripe: StripeConfig;
  paddle: PaddleConfig;
}

export class GatewayAdapterRegistry implements IGatewayAdapterRegistry {
  private stripeAdapter: StripePaymentAdapter | null = null;
  private paddleAdapter: PaddlePaymentAdapter | null = null;
  private readonly config: GatewayRegistryConfig;

  constructor(config: GatewayRegistryConfig) {
    this.config = config;
  }

  getAdapter(provider: GatewayProviderType): IPaymentAdapter {
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
 */
export function createGatewayRegistry(): GatewayAdapterRegistry {
  return new GatewayAdapterRegistry({
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY ?? "",
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
      prices: buildPriceMap("STRIPE"),
    },
    paddle: {
      apiKey: process.env.PADDLE_API_KEY ?? "",
      webhookSecret: process.env.PADDLE_WEBHOOK_SECRET ?? "",
      sandbox: process.env.PADDLE_SANDBOX === "true",
      prices: buildPriceMap("PADDLE"),
    },
  });
}
