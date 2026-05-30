/**
 * @file GatewayAdapterRegistryPort.ts
 * @description Port over the dual-gateway adapter registry that
 *   `GatewayBillingService` uses to call into the concrete payment SDKs
 *   (Stripe + Paddle). Lets the service stay in @core/application by not
 *   depending on the infra-side `GatewayAdapterRegistry` class.
 *
 *   The concrete implementation (`GatewayAdapterRegistry`) lives in
 *   `apps/api/src/infrastructure/billing/` and lazily instantiates the
 *   `PaymentAdapter` instances from environment-derived config.
 * @layer domain
 */

import type { PaymentAdapter, GatewayProviderType } from "@ports/core";

export interface GatewayAdapterRegistryPort {
  /**
   * Resolve the `PaymentAdapter` for a given gateway. Throws when the
   * provider is not configured — the caller MUST have validated provider
   * support upstream (e.g. account billing config).
   */
  getAdapter(provider: GatewayProviderType): PaymentAdapter;
}
