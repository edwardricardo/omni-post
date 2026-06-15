/**
 * @file billingWebhookRoutes.ts
 * @description Webhook receiver for Stripe and Paddle billing events.
 *   These routes require raw body access for signature verification and
 *   must be registered BEFORE any JWT auth middleware in index.ts.
 *   Uses scoped addContentTypeParser so only webhook routes receive raw Buffer.
 *   All DB access delegated to GatewayBillingService — zero direct prisma imports.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyBaseLogger } from "fastify";
import { TOKENS } from "../infrastructure/container/types.js";
import type { GatewayBillingService } from "@core/billing/GatewayBillingService.js";
import type {
  GatewayProviderType,
  BillingDomainEvent,
  GatewayAdapterRegistryPort,
} from "@ports/core";

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

  // --- Idempotency check (delegated to service) — happy-path short-circuit
  // when the event was already fully processed in a previous delivery.
  const { skip, recordId } = await service.checkBillingEventIdempotency(
    eventId,
    provider,
    eventType,
    domainEvent,
    data
  );

  if (skip) {
    log.info({ gatewayEventId: eventId, provider }, "Duplicate billing webhook event — skipping");
    return;
  }

  // --- Atomic claim BEFORE running the handler. Closes the TOCTOU window
  // between the idempotency check above and the side-effect handler below.
  // If two concurrent webhook deliveries pass the idempotency check (the
  // record exists with processed=false), only one wins the CAS and runs
  // the handler. The other receives claimed=false and skips silently.
  if (recordId) {
    const claimed = await service.markBillingEventProcessed(recordId);
    if (!claimed) {
      log.info(
        { gatewayEventId: eventId, provider },
        "Billing webhook event claimed by a concurrent delivery — skipping handler"
      );
      return;
    }
  }

  const customerId = extractCustomerId(data, provider);
  let processingError: string | undefined;

  switch (domainEvent) {
    case "subscription.canceled": {
      const accountId = await service.resolveAccountIdByCustomer(customerId, provider);
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
      const accountId = await service.resolveAccountIdByCustomer(customerId, provider);
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

    case "payment.failed": {
      const result = await service.handlePaymentFailed(data, customerId);
      if (!result.ok) {
        processingError = result.error;
        log.error({ provider, customerId, error: result.error }, "Error processing payment.failed");
      }
      break;
    }

    case "payment.succeeded": {
      const result = await service.handlePaymentSucceeded(data, customerId);
      if (!result.ok) {
        processingError = result.error;
        log.error(
          { provider, customerId, error: result.error },
          "Error processing payment.succeeded"
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

  // Persist the handler outcome on the already-claimed record. The claim
  // is irreversible by design (closes double-charge); a crashed handler
  // leaves the event processed=true with `error` set, requiring manual
  // intervention to retry. A lease-based pattern (claimedAt with TTL)
  // would permit auto-retry but needs a schema migration.
  if (recordId && processingError) {
    await service.markBillingEventError(recordId, processingError);
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

  const registry = container.resolve<GatewayAdapterRegistryPort>(TOKENS.GatewayAdapterRegistry);
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
          { provider: "stripe", eventType: event.type, domainEvent },
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
          { provider: "paddle", eventType: event.type, domainEvent },
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
