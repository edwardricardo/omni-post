/**
 * @file webhookSubscriptionRoutes.test.ts
 * @description Unit tests for webhook-subscription CRUD: auth required, body /
 *              param validation, create (201), list (200), and error mapping
 *              (NotFound → 404). WebhookManager is stubbed in the DI container.
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

vi.mock("../../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (
    req: { headers: Record<string, string | undefined>; customerUser?: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ) => {
    if (!req.headers.authorization) {
      reply.code(401).send({ ok: false, error: "Authorization token required" });
      return;
    }
    req.customerUser = {
      id: "u1",
      accountId: "acc-1",
      roleId: "r",
      roleName: "owner",
      permissions: [],
    };
  },
}));

import Fastify, { type FastifyInstance } from "fastify";
import { AppError } from "../../../src/lib/errors/AppError.js";
import { createTestContainer } from "../../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { webhookSubscriptionRoutes } from "../../../src/webhooks/webhookSubscriptionRoutes.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const AUTH = { authorization: "Bearer t" };

async function makeApp(manager: Record<string, unknown>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = createTestContainer();
  container.registerInstance(TOKENS.WebhookManager, manager);
  app.decorate("container", container);
  await app.register(webhookSubscriptionRoutes);
  await app.ready();
  return app;
}

let app: FastifyInstance;

describe("webhookSubscriptionRoutes", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 401 without an authorization header", async () => {
    app = await makeApp({ createSubscription: vi.fn() });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/subscriptions",
      payload: { provider: "INSTAGRAM", eventTypes: ["COMMENT_RECEIVED"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for an invalid provider", async () => {
    app = await makeApp({ createSubscription: vi.fn() });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/subscriptions",
      headers: AUTH,
      payload: { provider: "MYSPACE", eventTypes: ["COMMENT_RECEIVED"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates a subscription (201) scoped to the caller's account", async () => {
    const createSubscription = vi.fn(async () => ({ id: UUID, provider: "INSTAGRAM" }));
    app = await makeApp({ createSubscription });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/subscriptions",
      headers: AUTH,
      payload: { provider: "INSTAGRAM", eventTypes: ["COMMENT_RECEIVED"], secretKey: "app-secret" },
    });
    expect(res.statusCode).toBe(201);
    expect(createSubscription.mock.calls[0]?.[0]).toBe("acc-1");
  });

  it("lists subscriptions (200)", async () => {
    app = await makeApp({ getSubscriptions: vi.fn(async () => []) });
    const res = await app.inject({
      method: "GET",
      url: "/webhooks/subscriptions",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it("maps a NotFound from the manager to 404 on delete", async () => {
    app = await makeApp({
      deleteSubscription: vi.fn(async () => {
        throw AppError.notFound("Webhook subscription");
      }),
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/webhooks/subscriptions/${UUID}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a non-uuid id on update", async () => {
    app = await makeApp({ updateSubscription: vi.fn() });
    const res = await app.inject({
      method: "PATCH",
      url: "/webhooks/subscriptions/not-a-uuid",
      headers: AUTH,
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(400);
  });
});
