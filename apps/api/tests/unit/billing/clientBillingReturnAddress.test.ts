/**
 * @file clientBillingReturnAddress.test.ts
 * @description The addresses the client billing routes hand a payment gateway to send the customer
 *   back to: the client portal's billing page, on the origin `CLIENT_URL` names, for a checkout's
 *   success and cancel and for the billing portal's return. A request's host headers and query
 *   parameters do not move them. The env module and the customer middleware are doubles; the routes
 *   run in Fastify over a container that holds a gateway service double.
 * @layer infrastructure
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBillingService } from "@core/billing/GatewayBillingService.js";
import { Container } from "../../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { makePublicAddressEnv } from "../helpers/publicAddressEnv.js";

const { mockEnv, PRINCIPAL } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  PRINCIPAL: { id: "customer-user-1", accountId: "c0000000-0000-4000-8000-000000000001" },
}));

vi.mock("../../../src/config/env.js", () => ({ env: mockEnv }));

vi.mock("../../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (request: { customerUser?: unknown }) => {
    request.customerUser = { ...PRINCIPAL };
  },
}));

const FOREIGN_ORIGIN = "https://elsewhere.example.test";

/** Request headers that name an origin other than the client portal's. */
const FOREIGN_HEADERS = {
  host: new URL(FOREIGN_ORIGIN).host,
  "x-forwarded-host": new URL(FOREIGN_ORIGIN).host,
  origin: FOREIGN_ORIGIN,
  referer: FOREIGN_ORIGIN,
};

/** Query parameters that name an origin other than the client portal's. */
const FOREIGN_QUERY = new URLSearchParams({
  successUrl: FOREIGN_ORIGIN,
  cancelUrl: FOREIGN_ORIGIN,
  returnUrl: FOREIGN_ORIGIN,
}).toString();

const BILLING_PAGE = `${makePublicAddressEnv().CLIENT_URL}/dashboard/settings/billing`;

/** A gateway service double whose two calls succeed with a gateway's own address. */
function makeGatewayService() {
  return {
    createCheckoutSession: vi.fn(async () => ({
      ok: true as const,
      value: { url: "https://gateway.example.test/checkout" },
    })),
    getBillingPortalUrl: vi.fn(async () => ({
      ok: true as const,
      value: { url: "https://gateway.example.test/portal" },
    })),
  };
}

let app: FastifyInstance | undefined;

/** The client billing routes over a gateway double, with the public addresses in the env. */
async function makeApp() {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  Object.assign(mockEnv, makePublicAddressEnv());
  vi.resetModules();
  const { clientBillingRoutes } = await import("../../../src/billing/clientBillingRoutes.js");
  const gateway = makeGatewayService();
  const container = new Container();
  container.registerInstance(
    TOKENS.GatewayBillingService,
    gateway as unknown as GatewayBillingService
  );
  container.registerInstance(TOKENS.PrismaClient, {});
  app = Fastify({ logger: false });
  app.decorate("container", container);
  await app.register(clientBillingRoutes);
  await app.ready();
  return { app, gateway };
}

describe("the addresses the client billing routes hand a payment gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("are the client portal's billing page for a checkout's success and cancel", async () => {
    const { app, gateway } = await makeApp();

    const response = await app.inject({
      method: "POST",
      url: `/billing/checkout?${FOREIGN_QUERY}`,
      headers: FOREIGN_HEADERS,
      payload: { gatewayProvider: "stripe" },
    });

    expect(response.statusCode).toBe(200);
    expect(gateway.createCheckoutSession.mock.calls).toEqual([
      [
        PRINCIPAL.accountId,
        "stripe",
        `${BILLING_PAGE}?success=true`,
        `${BILLING_PAGE}?canceled=true`,
      ],
    ]);
  });

  it("is the client portal's billing page for the billing portal's return", async () => {
    const { app, gateway } = await makeApp();

    const response = await app.inject({
      method: "GET",
      url: `/billing/portal?${FOREIGN_QUERY}`,
      headers: FOREIGN_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(gateway.getBillingPortalUrl.mock.calls).toEqual([[PRINCIPAL.accountId, BILLING_PAGE]]);
  });
});
