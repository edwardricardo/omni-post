/**
 * @file preAuthIntegrationTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant integration proof for the integration
 *   API-key auth boundary (Zapier/Make). Drives the real two-hook seam
 *   (`integrationAuthResolve` onRequest + `integrationAuthBind` preHandler)
 *   THROUGH HTTP (`app.inject`) against a REAL database with two tenants (A, B),
 *   proving the pre-auth seam:
 *   - a valid key for A authenticates (200) and the downstream handler reads
 *     `integrationSubscription` (an enrolled model) WITHOUT `TenantContextMissingError`;
 *   - that read is scoped to A's account — A physically cannot see B's rows;
 *   - an unknown key is refused (401) at the boundary, fail-closed.
 *
 *   The guarded client is built exactly like production (base + tenant guard) and
 *   wired into the DI the resolve hook consults. The resolve hook looks the key up
 *   under a system context (the account is unknown pre-match); the bind hook then
 *   binds the tenant context synchronously so the store propagates to the handler.
 *   The handler succeeding on the guarded read is the end-to-end proof the sync
 *   bind reached the route handler — this test exercises that ordering end to end.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { getTenantContext, getSystemContext } from "../../src/security/tenantContext.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { PrismaIntegrationApiKeyRepository } from "../../src/infrastructure/repositories/PrismaIntegrationApiKeyRepository.js";
import {
  integrationAuthResolve,
  integrationAuthBind,
} from "../../src/auth/integrationAuthMiddleware.js";
import { hashPassword } from "../../src/auth/passwordHashing.js";

const TAG = `preauth-int-${Date.now()}`;

interface Seeded {
  accountId: string;
  token: string;
  subscriptionCount: number;
}

describe("Integration API-key auth — two-tenant isolation (MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let guarded: PrismaClient;
  let app: FastifyInstance;

  let tenantA: Seeded;
  let tenantB: Seeded;

  async function seedTenant(name: string, subCount: number): Promise<Seeded> {
    const account = await base.account.create({
      data: {
        name: `${TAG}-${name}`,
        email: `${TAG}-${name}-${randomUUID()}@test.local`,
        slug: `${TAG}-${name}-${randomUUID()}`,
      },
    });
    // A distinct, valid Zapier token per tenant; the visible 12-char prefix is
    // what the middleware narrows the lookup by.
    const token = `zap_${name.toLowerCase()}${randomUUID().replace(/-/g, "")}`;
    const keyHash = await hashPassword(token);
    await base.integrationApiKey.create({
      data: {
        accountId: account.id,
        platform: "ZAPIER",
        keyHash,
        keyPrefix: token.substring(0, 12),
      },
    });
    for (let i = 0; i < subCount; i += 1) {
      await base.integrationSubscription.create({
        data: {
          accountId: account.id,
          platform: "ZAPIER",
          event: `${TAG}-${name}-event-${i}`,
          targetUrl: `https://hooks.example/${name}/${i}`,
        },
      });
    }
    return { accountId: account.id, token, subscriptionCount: subCount };
  }

  before(async () => {
    base = createTestPrismaClient();

    tenantA = await seedTenant("A", 2);
    tenantB = await seedTenant("B", 1);

    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    const container = new Container();
    container.registerInstance(
      TOKENS.IntegrationApiKeyRepository,
      new PrismaIntegrationApiKeyRepository(guarded)
    );

    app = Fastify();
    app.decorate("container", container);
    // Minimal protected route standing in for the Zapier/Make surface: it reads
    // an enrolled model on the guarded client, so it can only succeed if the
    // middleware bound a tenant context first.
    app.get(
      "/test/integration/subscriptions",
      { onRequest: [integrationAuthResolve], preHandler: [integrationAuthBind] },
      async (_request: FastifyRequest, reply: FastifyReply) => {
        const subs = await guarded.integrationSubscription.findMany({
          where: { active: true },
          select: { id: true, accountId: true },
        });
        return reply.send({ subscriptions: subs });
      }
    );
    await app.ready();
  });

  after(async () => {
    await app?.close();
    const accountIds = [tenantA.accountId, tenantB.accountId];
    await base.integrationSubscription
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.integrationApiKey
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
    await base.$disconnect();
  });

  it("A's valid key authenticates and reads only A's subscriptions (no context-miss)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/test/integration/subscriptions",
      headers: { authorization: `Bearer ${tenantA.token}` },
    });

    assert.strictEqual(res.statusCode, 200, "valid A key must authenticate");
    const body = res.json() as { subscriptions: Array<{ id: string; accountId: string }> };
    assert.strictEqual(
      body.subscriptions.length,
      tenantA.subscriptionCount,
      "A must see exactly its own subscriptions"
    );
    assert.ok(
      body.subscriptions.every((s) => s.accountId === tenantA.accountId),
      "every returned subscription must belong to A — B's rows must be invisible"
    );
  });

  it("B's valid key sees only B's subscriptions — the seam scopes per account", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/test/integration/subscriptions",
      headers: { authorization: `Bearer ${tenantB.token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json() as { subscriptions: Array<{ id: string; accountId: string }> };
    assert.strictEqual(body.subscriptions.length, tenantB.subscriptionCount);
    assert.ok(body.subscriptions.every((s) => s.accountId === tenantB.accountId));
  });

  it("an unknown key is refused at the boundary with 401 (fail-closed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/test/integration/subscriptions",
      headers: { authorization: `Bearer zap_unknownkey_${randomUUID().replace(/-/g, "")}` },
    });

    assert.strictEqual(res.statusCode, 401, "an unmatched key must never reach the handler");
  });
});
