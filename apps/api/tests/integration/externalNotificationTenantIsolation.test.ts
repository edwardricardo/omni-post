/**
 * @file externalNotificationTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant integration test for the
 *   `ExternalNotificationConfig` tenant-guard enrollment (Slice 1 of the
 *   project-scoped tenant-guard rollout). Exercises the four live routes
 *   THROUGH HTTP (`app.inject`) against a REAL database with two tenants (A, B),
 *   proving the three cross-tenant IDOR paths are closed and that NO decrypted
 *   Slack/Teams webhook secret ever crosses the tenant boundary.
 *
 *   ## Why this test is the sole enforcement for List + Test-fire
 *
 *   `ListExternalNotificationsQuery` and `TestExternalNotificationUseCase` run
 *   OUTSIDE any UnitOfWork, so `PrismaUnitOfWork` never binds the
 *   `app.account_id` GUC and RLS (layer 2) is INERT for exactly the two routes
 *   that DECRYPT the webhook secret. Those two reads are guarded by LAYER 1
 *   (the Prisma `$extends` guard) ALONE at runtime — so THIS integration test,
 *   not RLS, is what catches a guard-list regression on the decrypting reads.
 *   Delete and Create run inside a UoW and keep the RLS backstop.
 *
 *   The guarded client is built exactly like production: a base client extended
 *   with `tenantGuardExtension`, wired into the same DI setup the app uses.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { getTenantContext, getSystemContext } from "../../src/security/tenantContext.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { EncryptionService } from "../../src/security/EncryptionService.js";
import { FetchHttpClient } from "../../src/infrastructure/adapters/FetchHttpClient.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { PrismaProjectRepository } from "../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { setupExternalNotificationUseCases } from "../../src/infrastructure/container/setupExternalNotificationUseCases.js";
import { externalNotificationRoutes } from "../../src/external-notifications/externalNotificationRoutes.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const TAG = `extnotif-iso-${Date.now()}`;

interface Seeded {
  accountId: string;
  projectId: string;
  configId: string;
}

const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `extnotif-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

describe("External Notification — two-tenant isolation (Slice 1, MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let app: FastifyInstance;
  let sink: Server;
  let encryption: EncryptionService;
  const sinkHits = new Map<string, number>();

  let tenantA: Seeded;
  let tenantB: Seeded;
  let sinkAUrl = "";
  let sinkBUrl = "";

  /** Seed one ExternalNotificationConfig row directly (bypasses HTTPS-only
   *  create validation) with an encrypted webhook URL, via the raw client. */
  async function seedConfig(
    accountId: string,
    projectId: string,
    webhookUrl: string
  ): Promise<string> {
    const id = randomUUID();
    const enc = encryption.encrypt(webhookUrl, {
      fieldName: "ExternalNotificationConfig.webhookUrl",
      recordId: id,
    });
    await base.externalNotificationConfig.create({
      data: {
        id,
        accountId,
        projectId,
        channel: "slack",
        webhookUrlCiphertext: enc.encryptedValue,
        webhookUrlIv: enc.iv,
        webhookUrlAuthTag: enc.authTag,
        webhookUrlKeyVersion: enc.keyVersion,
        label: "seeded",
        events: ["post.published"],
        isActive: true,
      },
    });
    return id;
  }

  async function seedTenant(name: string, sinkUrl: string): Promise<Seeded> {
    const account = await base.account.create({
      data: {
        name: `${TAG}-${name}`,
        email: `${TAG}-${name}-${randomUUID()}@test.local`,
        slug: `${TAG}-${name}-${randomUUID()}`,
      },
    });
    const project = await base.project.create({
      data: { accountId: account.id, name: `${TAG}-${name}-project` },
    });
    const configId = await seedConfig(account.id, project.id, sinkUrl);
    return { accountId: account.id, projectId: project.id, configId };
  }

  before(async () => {
    encryption = new EncryptionService();
    base = createTestPrismaClient();

    // Local HTTP sink standing in for the tenants' webhooks. Counts requests
    // per path so we can prove B's webhook is NEVER hit during A's attacks.
    sink = createServer((req, res) => {
      const path = req.url ?? "/";
      sinkHits.set(path, (sinkHits.get(path) ?? 0) + 1);
      res.statusCode = 200;
      res.end("ok");
    });
    await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", () => resolve()));
    const port = (sink.address() as AddressInfo).port;
    sinkAUrl = `http://127.0.0.1:${port}/a`;
    sinkBUrl = `http://127.0.0.1:${port}/b`;

    tenantA = await seedTenant("A", sinkAUrl);
    tenantB = await seedTenant("B", sinkBUrl);

    // Guarded client — EXACTLY as production wires it (base + tenant guard).
    const guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    const container = new Container();
    container.registerInstance(TOKENS.PrismaClient, guarded);
    container.registerInstance(TOKENS.EncryptionService, encryption);
    container.registerInstance(TOKENS.HttpClientPort, new FetchHttpClient());
    container.registerInstance(TOKENS.ProjectRepository, new PrismaProjectRepository(guarded));
    // UnitOfWork is transient per canon (new instance per resolve).
    container.register(TOKENS.UnitOfWork, () => new PrismaUnitOfWork(guarded), false);
    setupExternalNotificationUseCases(container);

    app = Fastify();
    app.decorate("container", container);
    await app.register(externalNotificationRoutes);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await new Promise<void>((resolve) => sink.close(() => resolve()));
    // Cleanup — cascade deletes configs via account/project FK, but delete
    // explicitly to be robust to ordering.
    await base.externalNotificationConfig
      .deleteMany({ where: { accountId: { in: [tenantA.accountId, tenantB.accountId] } } })
      .catch(() => undefined);
    await base.project
      .deleteMany({ where: { accountId: { in: [tenantA.accountId, tenantB.accountId] } } })
      .catch(() => undefined);
    await base.account
      .deleteMany({ where: { id: { in: [tenantA.accountId, tenantB.accountId] } } })
      .catch(() => undefined);
    await base.$disconnect();
  });

  describe("cross-tenant IDOR paths are closed (A attacks B)", () => {
    it("A listing B's project returns 200 with an empty set and no B webhook secret", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/external-notifications?projectId=${tenantB.projectId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json() as { ok: boolean; data: unknown[] };
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data.length, 0, "A must see ZERO of B's configs");
      assert.ok(
        !res.payload.includes("/b"),
        "B's decrypted webhook URL must never appear in the payload"
      );
    });

    it("A deleting B's config resolves to 404 and B's row persists", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/external-notifications/${tenantB.configId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      const stillThere = await base.externalNotificationConfig.findUnique({
        where: { id: tenantB.configId },
      });
      assert.ok(stillThere, "B's config must still exist after A's foreign delete");
    });

    it("A test-firing B's config resolves to 404 and B's webhook sink gets ZERO hits", async () => {
      const before = sinkHits.get("/b") ?? 0;
      const res = await app.inject({
        method: "POST",
        url: `/external-notifications/${tenantB.configId}/test`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      assert.ok(!res.payload.includes("/b"), "no B secret may be materialized in the response");
      const afterHits = sinkHits.get("/b") ?? 0;
      assert.strictEqual(afterHits, before, "B's webhook sink must receive ZERO outbound requests");
    });

    it("A creating against B's project resolves to 404 (never 500/403) and persists no row", async () => {
      const beforeCount = await base.externalNotificationConfig.count({
        where: { projectId: tenantB.projectId },
      });
      const res = await app.inject({
        method: "POST",
        url: "/external-notifications",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: {
          projectId: tenantB.projectId,
          channel: "slack",
          webhookUrl: "https://hooks.slack.com/services/attacker",
          label: "pwn",
          events: ["post.published"],
        },
      });
      assert.strictEqual(res.statusCode, 404, "foreign-project create MUST be 404, never 500/403");
      const afterCount = await base.externalNotificationConfig.count({
        where: { projectId: tenantB.projectId },
      });
      assert.strictEqual(afterCount, beforeCount, "no row may be persisted under B's project");
    });
  });

  describe("own-tenant regression — every route still works for the owner", () => {
    it("A can create a config under its OWN project and the row carries A's accountId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/external-notifications",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: {
          projectId: tenantA.projectId,
          channel: "slack",
          webhookUrl: "https://hooks.slack.com/services/owned",
          label: "owned",
          events: ["post.published"],
        },
      });
      assert.strictEqual(res.statusCode, 201);
      const body = res.json() as { ok: boolean; data: { id: string } };
      assert.strictEqual(body.ok, true);
      const persisted = await base.externalNotificationConfig.findUnique({
        where: { id: body.data.id },
      });
      assert.ok(persisted);
      assert.strictEqual(
        persisted?.accountId,
        tenantA.accountId,
        "persisted row must satisfy accountId === Project.accountId"
      );
      // Cleanup this ad-hoc row so counts stay deterministic.
      await base.externalNotificationConfig.delete({ where: { id: body.data.id } });
    });

    it("A can list its OWN project's configs", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/external-notifications?projectId=${tenantA.projectId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json() as { ok: boolean; data: Array<{ id: string; projectId: string }> };
      assert.ok(body.data.length >= 1, "A must see its own configs");
      assert.ok(body.data.every((c) => c.projectId === tenantA.projectId));
    });

    it("A can fire the test webhook for its OWN config and the sink receives the request", async () => {
      const before = sinkHits.get("/a") ?? 0;
      const res = await app.inject({
        method: "POST",
        url: `/external-notifications/${tenantA.configId}/test`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const afterHits = sinkHits.get("/a") ?? 0;
      assert.strictEqual(
        afterHits,
        before + 1,
        "A's own webhook sink must receive the test request"
      );
    });

    it("A can delete its OWN config", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/external-notifications/${tenantA.configId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const gone = await base.externalNotificationConfig.findUnique({
        where: { id: tenantA.configId },
      });
      assert.strictEqual(gone, null, "A's own config must be deleted");
    });
  });

  describe("data-layer invariants", () => {
    it("every persisted row satisfies accountId === Project.accountId", async () => {
      const rows = await base.externalNotificationConfig.findMany({
        where: { accountId: { in: [tenantA.accountId, tenantB.accountId] } },
        include: { project: { select: { accountId: true } } },
      });
      for (const row of rows) {
        assert.strictEqual(
          row.accountId,
          row.project.accountId,
          `row ${row.id} must be parent-consistent`
        );
      }
    });

    it("no row has a NULL accountId (backfill integrity / NOT NULL invariant)", async () => {
      const result = await base.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM "ExternalNotificationConfig" WHERE "accountId" IS NULL`
      );
      assert.strictEqual(Number(result[0]?.count ?? 0), 0);
    });
  });
});
