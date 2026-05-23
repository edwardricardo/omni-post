/**
 * @file webhookInboundRoutes.ts
 * @description Inbound provider-webhook endpoints. `GET /webhooks/:provider`
 *   answers each provider's verification handshake; `POST /webhooks/:provider`
 *   reads the raw body, verifies the signature at the edge, enqueues the event
 *   for async processing, and acks 2xx fast. Unauthenticated (signature-verified)
 *   and gated by `supportsInboundWebhooks`. The raw-body parser is registered
 *   inside this plugin so HMAC verification sees the unmodified bytes.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { Provider } from "@infra/prisma";
import { supportsInboundWebhooks } from "@shared/types";
import { TOKENS } from "../infrastructure/container/types.js";
import type { WebhookManager } from "./webhookManager.js";

/** URL slug (lowercase) → Prisma Provider enum, for the providers we receive. */
const PROVIDER_BY_SLUG: Readonly<Record<string, Provider>> = {
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
  threads: "THREADS",
  x: "X",
  youtube: "YOUTUBE",
  tiktok: "TIKTOK",
  telegram: "TELEGRAM",
};

/** The header carrying each provider's signature / secret token. */
const SIGNATURE_HEADER_BY_PROVIDER: Readonly<Partial<Record<Provider, string>>> = {
  INSTAGRAM: "x-hub-signature-256",
  FACEBOOK: "x-hub-signature-256",
  THREADS: "x-hub-signature-256",
  X: "x-twitter-webhooks-signature",
  YOUTUBE: "x-hub-signature",
  TIKTOK: "x-tiktok-signature",
  TELEGRAM: "x-telegram-bot-api-secret-token",
};

/** Resolve the Provider for a `:provider` slug, if it accepts inbound webhooks. */
function resolveProvider(slug: string): Provider | null {
  const provider = PROVIDER_BY_SLUG[slug.toLowerCase()];
  if (!provider || !supportsInboundWebhooks(provider)) {
    return null;
  }
  return provider;
}

/**
 * Fastify plugin registering inbound provider-webhook routes under /api/webhooks.
 */
const webhookInboundRoutes: FastifyPluginAsync = async (app) => {
  // Raw body so signature HMAC sees the exact bytes (JSON middleware re-serializes).
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req: unknown, body: Buffer, done: (err: null, result: Buffer) => void) => done(null, body)
  );

  const manager = app.container.resolve<WebhookManager>(TOKENS.WebhookManager);

  app.get(
    "/webhooks/:provider",
    { schema: { tags: ["Webhooks"], summary: "Provider webhook verification handshake" } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const provider = resolveProvider((request.params as { provider: string }).provider);
      if (!provider) {
        return reply.code(404).send({ error: "Provider does not support inbound webhooks" });
      }
      const result = await manager.getInboundChallenge(
        provider,
        request.query as Record<string, string>,
        request.headers as Record<string, string>
      );
      if (result.body.startsWith("{")) {
        reply.header("content-type", "application/json");
      }
      return reply.code(result.status).send(result.body);
    }
  );

  app.post(
    "/webhooks/:provider",
    { schema: { tags: ["Webhooks"], summary: "Receive a provider webhook event" } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const provider = resolveProvider((request.params as { provider: string }).provider);
      if (!provider) {
        return reply.code(404).send({ error: "Provider does not support inbound webhooks" });
      }

      const headers = request.headers as Record<string, string>;
      const signatureHeader = SIGNATURE_HEADER_BY_PROVIDER[provider];
      const signature = (signatureHeader && headers[signatureHeader]) || "";
      const rawBody = Buffer.isBuffer(request.body)
        ? request.body.toString("utf8")
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body ?? {});

      const result = await manager.receiveInboundWebhook(provider, signature, rawBody, headers);
      if (result.accepted) {
        return reply.code(result.status).send({ received: true });
      }
      return reply.code(result.status).send({ error: result.reason ?? "Webhook rejected" });
    }
  );
};

export { webhookInboundRoutes };
