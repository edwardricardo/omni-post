/**
 * @file webhookInboundRoutes.test.ts
 * @description Unit tests for the inbound provider-webhook routes: per-provider
 *              gating (unsupported → 404 without touching the manager), the GET
 *              verification handshake, and the POST accept (202) / reject (401)
 *              paths. The WebhookManager is stubbed in the DI container.
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createTestContainer } from "../../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { webhookInboundRoutes } from "../../../src/webhooks/webhookInboundRoutes.js";

interface ManagerStub {
  getInboundChallenge?: () => Promise<{ status: number; body: string }>;
  receiveInboundWebhook?: () => Promise<{
    accepted: boolean;
    status: number;
    jobId?: string;
    reason?: string;
  }>;
}

async function makeApp(stub: ManagerStub): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = createTestContainer();
  container.registerInstance(TOKENS.WebhookManager, {
    getInboundChallenge: vi.fn(
      stub.getInboundChallenge ?? (async () => ({ status: 200, body: "ok" }))
    ),
    receiveInboundWebhook: vi.fn(
      stub.receiveInboundWebhook ?? (async () => ({ accepted: true, status: 202, jobId: "j1" }))
    ),
  });
  app.decorate("container", container);
  await app.register(webhookInboundRoutes);
  await app.ready();
  return app;
}

let app: FastifyInstance;

describe("webhookInboundRoutes", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    if (app) await app.close();
  });

  describe("GET /webhooks/:provider (challenge)", () => {
    it("echoes the challenge body for a supported provider", async () => {
      app = await makeApp({
        getInboundChallenge: async () => ({ status: 200, body: "CHALLENGE-123" }),
      });
      const res = await app.inject({
        method: "GET",
        url: "/webhooks/instagram?hub.mode=subscribe&hub.challenge=CHALLENGE-123&hub.verify_token=t",
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("CHALLENGE-123");
    });

    it("returns 404 for a provider without inbound webhooks (snapchat)", async () => {
      app = await makeApp({});
      const res = await app.inject({ method: "GET", url: "/webhooks/snapchat" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for an unknown provider slug", async () => {
      app = await makeApp({});
      const res = await app.inject({ method: "GET", url: "/webhooks/myspace" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /webhooks/:provider", () => {
    it("acks 202 when the manager accepts the event", async () => {
      app = await makeApp({
        receiveInboundWebhook: async () => ({ accepted: true, status: 202, jobId: "job-1" }),
      });
      const res = await app.inject({
        method: "POST",
        url: "/webhooks/facebook",
        headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=abc" },
        payload: JSON.stringify({ entry: [{ id: "1" }] }),
      });
      expect(res.statusCode).toBe(202);
      expect(JSON.parse(res.body)).toEqual({ received: true });
    });

    it("returns the manager's rejection status (401 on bad signature)", async () => {
      app = await makeApp({
        receiveInboundWebhook: async () => ({
          accepted: false,
          status: 401,
          reason: "Signature verification failed",
        }),
      });
      const res = await app.inject({
        method: "POST",
        url: "/webhooks/x",
        headers: { "content-type": "application/json", "x-twitter-webhooks-signature": "bad" },
        payload: JSON.stringify({ tweet_create_events: [] }),
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for a provider without inbound webhooks (pinterest)", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "POST",
        url: "/webhooks/pinterest",
        headers: { "content-type": "application/json" },
        payload: "{}",
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
