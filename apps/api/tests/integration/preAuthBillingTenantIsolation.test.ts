/**
 * @file preAuthBillingTenantIsolation.test.ts
 * @description MERGE-BLOCKING integration proof for the billing webhook boundary
 *   (A5). Drives the live `billingWebhookRoutes` THROUGH HTTP (`app.inject`)
 *   against a REAL database, proving the declared system-context seam:
 *   - the webhook handler body runs under `system:billing-webhook`, so an
 *     enrolled `billingEvent` write inside it succeeds WITHOUT
 *     `TenantContextMissingError` and persists a row;
 *   - the request returns 200.
 *
 *   Signature verification is bypassed with a fake gateway adapter so the test
 *   is deterministic (a real Stripe signature cannot be forged in-repo); the
 *   security property under test is the context seam, not the crypto. The
 *   billing service double performs a REAL guarded `billingEvent.create`, which
 *   only succeeds because the route bound a system context — without the seam it
 *   would throw and the route would answer 400.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { getTenantContext, getSystemContext } from "../../src/security/tenantContext.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { billingWebhookRoutes } from "../../src/billing/billingWebhookRoutes.js";

const gatewayEventId = `preauth-billing-${Date.now()}-${randomUUID()}`;

interface Captured {
  reasonAtBillingWrite?: string;
}

describe("Billing webhook — system-context seam (MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let guarded: PrismaClient;
  let app: FastifyInstance;
  const captured: Captured = {};

  before(async () => {
    base = createTestPrismaClient();
    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    // Fake adapter: skips real signature crypto, returns a mapped payment event.
    const fakeRegistry = {
      getAdapter: () => ({
        parseWebhookEvent: async () => ({
          id: gatewayEventId,
          type: "payment_intent.succeeded",
          data: { customer: "cus_test" },
        }),
        mapEventType: () => "payment.succeeded" as const,
      }),
    };

    // Service double whose idempotency check performs a REAL guarded billingEvent
    // write — the enrolled model the seam must make reachable. It captures the
    // system reason active at write time to assert the seam is the one binding it.
    const fakeService = {
      checkBillingEventIdempotency: async (
        eventId: string,
        _provider: string,
        eventType: string,
        _domainEvent: unknown,
        data: Record<string, unknown>
      ) => {
        captured.reasonAtBillingWrite = getSystemContext()?.reason;
        const row = await guarded.billingEvent.create({
          data: {
            gatewayProvider: "STRIPE",
            gatewayEventId: eventId,
            eventType,
            rawEventType: eventType,
            payload: data as Record<string, string>,
          },
        });
        return { skip: false, recordId: row.id };
      },
      markBillingEventProcessed: async () => true,
      handlePaymentSucceeded: async () => ({ ok: true as const, value: undefined }),
      markBillingEventError: async () => undefined,
    };

    const container = new Container();
    container.registerInstance(
      TOKENS.GatewayAdapterRegistry,
      fakeRegistry as unknown as Parameters<typeof container.registerInstance>[1]
    );
    container.registerInstance(
      TOKENS.GatewayBillingService,
      fakeService as unknown as Parameters<typeof container.registerInstance>[1]
    );

    app = Fastify();
    app.decorate("container", container);
    await app.register(billingWebhookRoutes);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await base.billingEvent.deleteMany({ where: { gatewayEventId } }).catch(() => undefined);
    await base.$disconnect();
  });

  it("processes a signed webhook under system context and persists a billingEvent row", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": "test-signature" },
      payload: JSON.stringify({ probe: true }),
    });

    assert.strictEqual(res.statusCode, 200, "webhook must be accepted under the seam");
    assert.strictEqual(
      captured.reasonAtBillingWrite,
      "system:billing-webhook",
      "the enrolled billingEvent write must run under the declared system context"
    );

    const row = await base.billingEvent.findUnique({ where: { gatewayEventId } });
    assert.ok(row, "the billingEvent row must persist — the guarded write ran under the seam");
  });
});
