/**
 * @file billingWebhookRoutes.ts
 * @description Webhook receiver for Stripe and Paddle billing events.
 *   These routes require raw body access for signature verification and
 *   must be registered BEFORE any JWT auth middleware in index.ts.
 *   Uses scoped addContentTypeParser so only webhook routes receive raw Buffer.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyBaseLogger } from "fastify";
import { prisma } from "@infra/prisma";
import { TOKENS } from "../infrastructure/container/types.js";
import type { IGatewayAdapterRegistry } from "../infrastructure/billing/GatewayAdapterRegistry.js";
import type { GatewayBillingService } from "./GatewayBillingService.js";
import type { GatewayProviderType, BillingDomainEvent } from "@ports/core";

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractCustomerId(data: Record<string, unknown>, provider: GatewayProviderType): string {
  if (provider === "stripe") {
    return (data.customer as string) ?? "";
  }
  return ((data.customer_id ?? data.customerId) as string) ?? "";
}

function extractSubscriptionId(
  data: Record<string, unknown>,
  provider: GatewayProviderType
): string {
  if (provider === "stripe") {
    return (data.id as string) ?? "";
  }
  return ((data.subscription_id ?? data.id) as string) ?? "";
}

async function resolveAccountId(
  gatewayCustomerId: string,
  provider: GatewayProviderType
): Promise<string | null> {
  if (!gatewayCustomerId) return null;
  const providerEnum = provider === "stripe" ? "STRIPE" : "PADDLE";
  const account = await prisma.account.findFirst({
    where: { gatewayCustomerId, gatewayProvider: providerEnum },
    select: { id: true },
  });
  return account?.id ?? null;
}

async function routeBillingEvent(
  provider: GatewayProviderType,
  eventId: string,
  eventType: string,
  domainEvent: BillingDomainEvent | null,
  data: Record<string, unknown>,
  service: GatewayBillingService,
  log: FastifyBaseLogger
): Promise<void> {
  if (!domainEvent) {
    log.debug({ provider, eventType }, "Billing webhook event type not mapped — ignoring");
    return;
  }

  // --- Idempotency check ---
  const gatewayEventId = eventId || `${provider}-${eventType}-${Date.now()}`;
  const providerEnum = provider === "stripe" ? ("STRIPE" as const) : ("PADDLE" as const);

  const existing = await prisma.billingEvent.findUnique({
    where: { gatewayEventId },
    select: { id: true, processed: true },
  });

  if (existing?.processed) {
    log.info({ gatewayEventId, provider }, "Duplicate billing webhook event — skipping");
    return;
  }

  const billingEventRecord = await prisma.billingEvent.upsert({
    where: { gatewayEventId },
    create: {
      gatewayEventId,
      gatewayProvider: providerEnum,
      eventType: domainEvent,
      rawEventType: eventType,
      payload: data as object,
      processed: false,
    },
    update: {},
  });
  // --- End idempotency check ---

  const customerId = extractCustomerId(data, provider);
  let processingError: string | undefined;

  switch (domainEvent) {
    case "subscription.canceled": {
      const accountId = await resolveAccountId(customerId, provider);
      if (!accountId) {
        log.warn(
          { provider, customerId },
          "No account found for gateway customer — cannot process cancellation"
        );
        return;
      }
      const result = await service.handleSubscriptionCanceled(accountId);
      if (!result.ok) {
        processingError = result.error;
        log.error(
          { provider, accountId, error: result.error },
          "Error processing subscription.canceled"
        );
      }
      break;
    }

    case "subscription.activated": {
      const subscriptionId = extractSubscriptionId(data, provider);
      const accountId = await resolveAccountId(customerId, provider);
      if (!accountId) {
        log.warn(
          { provider, customerId },
          "No account found for gateway customer — cannot process activation"
        );
        return;
      }
      const result = await service.handleCheckoutCompleted(accountId, customerId, subscriptionId);
      if (!result.ok) {
        processingError = result.error;
        log.error(
          { provider, accountId, error: result.error },
          "Error processing subscription.activated"
        );
      }
      break;
    }

    default:
      log.debug(
        { provider, domainEvent, eventType },
        "Billing event not handled by gateway switch service"
      );
  }

  // Mark as processed (or record error)
  if (processingError) {
    await prisma.billingEvent.update({
      where: { id: billingEventRecord.id },
      data: { error: processingError },
    });
  } else {
    await prisma.billingEvent.update({
      where: { id: billingEventRecord.id },
      data: { processed: true, processedAt: new Date() },
    });
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export const billingWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Override JSON parser ONLY within this plugin scope — routes get raw Buffer
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req: unknown, body: Buffer, done: (err: null, result: Buffer) => void) => done(null, body)
  );

  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }

  const registry = container.resolve<IGatewayAdapterRegistry>(TOKENS.GatewayAdapterRegistry);
  const service = container.resolve<GatewayBillingService>(TOKENS.GatewayBillingService);

  // POST /webhooks/stripe
  fastify.post(
    "/webhooks/stripe",
    {
      schema: {
        tags: ["Billing Webhooks"],
        summary: "Stripe webhook receiver",
      },
    },
    async (request, reply) => {
      const signature = request.headers["stripe-signature"] as string | undefined;

      if (!signature) {
        return reply.code(400).send({ error: "Missing stripe-signature header" });
      }

      const adapter = registry.getAdapter("stripe");
      const rawBody = request.body as Buffer;

      try {
        const event = await adapter.parseWebhookEvent({
          payload: rawBody,
          signature,
        });
        const domainEvent = adapter.mapEventType(event.type);

        request.log.info(
          {
            provider: "stripe",
            eventType: event.type,
            domainEvent,
          },
          "Stripe billing webhook received"
        );

        await routeBillingEvent(
          "stripe",
          event.id,
          event.type,
          domainEvent,
          event.data,
          service,
          request.log
        );
      } catch (err) {
        request.log.warn({ err }, "Stripe webhook signature verification failed");
        return reply.code(400).send({ error: "Invalid signature" });
      }

      // Always return 200 — Stripe retries on non-200
      return reply.code(200).send({ received: true });
    }
  );

  // POST /webhooks/paddle
  fastify.post(
    "/webhooks/paddle",
    {
      schema: {
        tags: ["Billing Webhooks"],
        summary: "Paddle webhook receiver",
      },
    },
    async (request, reply) => {
      const signature = request.headers["paddle-signature"] as string | undefined;

      if (!signature) {
        return reply.code(400).send({ error: "Missing paddle-signature header" });
      }

      const adapter = registry.getAdapter("paddle");
      const rawBody = request.body as Buffer;

      try {
        const event = await adapter.parseWebhookEvent({
          payload: rawBody,
          signature,
        });
        const domainEvent = adapter.mapEventType(event.type);

        request.log.info(
          {
            provider: "paddle",
            eventType: event.type,
            domainEvent,
          },
          "Paddle billing webhook received"
        );

        await routeBillingEvent(
          "paddle",
          event.id,
          event.type,
          domainEvent,
          event.data,
          service,
          request.log
        );
      } catch (err) {
        request.log.warn({ err }, "Paddle webhook signature verification failed");
        return reply.code(400).send({ error: "Invalid signature" });
      }

      return reply.code(200).send({ received: true });
    }
  );
};
