/**
 * @file GatewayAdapterRegistry.test.ts
 * @description Unit tests for the dual-gateway registry: a gateway whose key and webhook secret
 *              are both unset is absent and refused by `getAdapter`, both set build its adapter,
 *              one set stops the factory, and no adapter is ever built around an empty secret —
 *              both SDKs accept a signature computed with an empty key, so an empty webhook
 *              secret would make every webhook forgeable. The env module is a mutable object.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, unknown>,
}));

vi.mock("../../../../src/config/env.js", () => ({ env: mockEnv }));

const { GatewayAdapterRegistry, createGatewayRegistry } =
  await import("../../../../src/infrastructure/billing/GatewayAdapterRegistry.js");
const { StripePaymentAdapter } =
  await import("../../../../src/infrastructure/billing/StripePaymentAdapter.js");
const { PaddlePaymentAdapter } =
  await import("../../../../src/infrastructure/billing/PaddlePaymentAdapter.js");

const PRICES = {
  BASIC: { monthly: "price_1", yearly: "price_2" },
  PRO: { monthly: "price_3", yearly: "price_4" },
  ENTERPRISE: { monthly: "price_5", yearly: "price_6" },
};
const STRIPE = { secretKey: "sk_test_1", webhookSecret: "whsec_1", prices: PRICES };
const PADDLE = {
  apiKey: "pdl_test_1",
  webhookSecret: "pdl_whsec_1",
  sandbox: true,
  prices: PRICES,
};

const useEnv = (values: Record<string, unknown>): void => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  Object.assign(mockEnv, values);
};

describe("GatewayAdapterRegistry", () => {
  beforeEach(() => {
    useEnv({});
  });

  it("refuses both gateways when no gateway variable is set", () => {
    const registry = createGatewayRegistry();

    expect(() => registry.getAdapter("stripe")).toThrow(
      "set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET"
    );
    expect(() => registry.getAdapter("paddle")).toThrow(
      "set PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET"
    );
  });

  it("refuses a gateway the registry was constructed without", () => {
    const registry = new GatewayAdapterRegistry({ paddle: PADDLE });

    expect(() => registry.getAdapter("stripe")).toThrow(
      "set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET"
    );
    expect(registry.getAdapter("paddle")).toBeInstanceOf(PaddlePaymentAdapter);
  });

  it("builds each adapter from its key and webhook secret", () => {
    useEnv({
      STRIPE_SECRET_KEY: "sk_test_1",
      STRIPE_WEBHOOK_SECRET: "whsec_1",
      PADDLE_API_KEY: "pdl_test_1",
      PADDLE_WEBHOOK_SECRET: "pdl_whsec_1",
    });

    const registry = createGatewayRegistry();

    expect(registry.getAdapter("stripe")).toBeInstanceOf(StripePaymentAdapter);
    expect(registry.getAdapter("paddle")).toBeInstanceOf(PaddlePaymentAdapter);
  });

  it.each([
    ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    ["STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY"],
    ["PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET"],
    ["PADDLE_WEBHOOK_SECRET", "PADDLE_API_KEY"],
  ])("stops the factory when only %s is set, naming %s", (setVar, missingVar) => {
    useEnv({ [setVar]: "value-1" });

    expect(() => createGatewayRegistry()).toThrow(missingVar);
  });

  it("never hands out an adapter built around an empty webhook secret", () => {
    const registry = new GatewayAdapterRegistry({ stripe: { ...STRIPE, webhookSecret: "" } });

    expect(() => registry.getAdapter("stripe")).toThrow("Stripe webhook secret must not be empty");
  });

  it.each([
    ["Stripe secret key", () => new StripePaymentAdapter({ ...STRIPE, secretKey: "" })],
    ["Stripe webhook secret", () => new StripePaymentAdapter({ ...STRIPE, webhookSecret: "" })],
    ["Paddle API key", () => new PaddlePaymentAdapter({ ...PADDLE, apiKey: "" })],
    ["Paddle webhook secret", () => new PaddlePaymentAdapter({ ...PADDLE, webhookSecret: "" })],
  ])("refuses to construct an adapter with an empty %s", (field, construct) => {
    expect(construct).toThrow(`${field} must not be empty`);
  });
});
