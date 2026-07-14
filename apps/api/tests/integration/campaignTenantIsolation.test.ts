/**
 * @file campaignTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant integration test for the `Campaign`
 *   tenant-guard enrollment. Exercises the live campaign routes THROUGH HTTP
 *   (`app.inject`) against a REAL database with two tenants (A, B), proving the
 *   cross-tenant IDOR paths are closed. The critical case is the JOIN-TABLE
 *   IDOR: `campaignPost` carries no accountId column, so guard enrollment alone
 *   does NOT close the untag route — the app-level parent `findById` in
 *   `UntagPostFromCampaignUseCase` does. This test proves A's foreign untag
 *   resolves to 404 AND B's `campaignPost` join row survives.
 *
 *   The guarded client is built exactly like production: a base client extended
 *   with `tenantGuardExtension`, wired into the same DI the routes use.
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
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { PrismaProjectRepository } from "../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { PrismaCampaignRepository } from "../../src/infrastructure/repositories/PrismaCampaignRepository.js";
import { PrismaCampaignQueryRepository } from "../../src/infrastructure/repositories/PrismaCampaignQueryRepository.js";
import {
  CreateCampaignUseCase,
  UpdateCampaignUseCase,
  ArchiveCampaignUseCase,
  TagPostWithCampaignUseCase,
  UntagPostFromCampaignUseCase,
  GetCampaignAnalyticsUseCase,
  ListCampaignsQuery,
  GetCampaignQuery,
} from "@core/campaigns/index.js";
import type { AnalyticsReadRepositoryPort } from "@core/domain/repositories/AnalyticsReadRepository.js";
import { campaignRoutes } from "../../src/campaigns/campaignRoutes.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const TAG = `campaign-iso-${Date.now()}`;

interface Seeded {
  accountId: string;
  projectId: string;
  campaignId: string;
  postId: string;
}

const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `campaign-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

describe("Campaign — two-tenant isolation (MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let app: FastifyInstance;

  let tenantA: Seeded;
  let tenantB: Seeded;

  async function seedTenant(name: string): Promise<Seeded> {
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
    const campaign = await base.campaign.create({
      data: { accountId: account.id, projectId: project.id, name: `${TAG}-${name}-campaign` },
    });
    const post = await base.post.create({ data: { projectId: project.id } });
    // Tag the post with the campaign — this is the join row A must NOT be able
    // to delete.
    await base.campaignPost.create({ data: { campaignId: campaign.id, postId: post.id } });
    return {
      accountId: account.id,
      projectId: project.id,
      campaignId: campaign.id,
      postId: post.id,
    };
  }

  before(async () => {
    base = createTestPrismaClient();

    tenantA = await seedTenant("A");
    tenantB = await seedTenant("B");

    // Guarded client — EXACTLY as production wires it (base + tenant guard).
    const guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    const campaignRepo = new PrismaCampaignRepository(guarded);
    const campaignQueryRepo = new PrismaCampaignQueryRepository(guarded);
    const projectRepo = new PrismaProjectRepository(guarded);
    // Typed analytics-read double implementing the full port surface (no `as
    // never`). The owner analytics path exercises `getLatestForPosts` +
    // `aggregateEngagement`; the foreign path never reaches them because the
    // guarded `campaign` existence check short-circuits to NOT_FOUND first.
    const analyticsRead: AnalyticsReadRepositoryPort = {
      getByPostIds: async () => [],
      getByProjectId: async () => [],
      getByChannelId: async () => [],
      getLatestForPosts: async () => [],
      aggregateEngagement: () => ({
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalEngagement: 0,
        avgEngagementRate: 0,
      }),
      getTimeSeriesData: async () => [],
      getPostsWithAnalytics: async () => [],
      getDailySummary: async () => [],
      getMonthlySummary: async () => [],
      getHistoricalTrends: async () => [],
    };

    const container = new Container();
    container.registerInstance(TOKENS.PrismaClient, guarded);
    container.registerInstance(TOKENS.ProjectRepository, projectRepo);
    container.registerInstance(TOKENS.CampaignRepository, campaignRepo);
    container.registerInstance(TOKENS.CampaignQueryRepository, campaignQueryRepo);
    // UnitOfWork is transient per canon (new instance per resolve).
    container.register(TOKENS.UnitOfWork, () => new PrismaUnitOfWork(guarded), false);
    container.register(
      TOKENS.CreateCampaignUseCase,
      () =>
        new CreateCampaignUseCase(campaignRepo, projectRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );
    container.register(
      TOKENS.UpdateCampaignUseCase,
      () => new UpdateCampaignUseCase(campaignRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );
    container.register(
      TOKENS.ArchiveCampaignUseCase,
      () => new ArchiveCampaignUseCase(campaignRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );
    container.register(
      TOKENS.TagPostWithCampaignUseCase,
      () => new TagPostWithCampaignUseCase(campaignRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );
    container.register(
      TOKENS.UntagPostFromCampaignUseCase,
      () => new UntagPostFromCampaignUseCase(campaignRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );
    container.register(
      TOKENS.GetCampaignAnalyticsUseCase,
      () => new GetCampaignAnalyticsUseCase(campaignQueryRepo, analyticsRead),
      true
    );
    container.register(
      TOKENS.ListCampaignsQuery,
      () => new ListCampaignsQuery(campaignQueryRepo),
      true
    );
    container.register(
      TOKENS.GetCampaignQuery,
      () => new GetCampaignQuery(campaignQueryRepo),
      true
    );

    app = Fastify();
    app.decorate("container", container);
    await app.register(campaignRoutes);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    const accountIds = [tenantA.accountId, tenantB.accountId];
    await base.campaignPost
      .deleteMany({ where: { campaignId: { in: [tenantA.campaignId, tenantB.campaignId] } } })
      .catch(() => undefined);
    await base.post
      .deleteMany({ where: { projectId: { in: [tenantA.projectId, tenantB.projectId] } } })
      .catch(() => undefined);
    await base.campaign
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.project
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
    await base.$disconnect();
  });

  describe("cross-tenant IDOR paths are closed (A attacks B)", () => {
    it("A reading B's campaign by id resolves to 404", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/campaigns/${tenantB.campaignId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
    });

    it("A patching B's campaign resolves to 404 and B's name is unchanged", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/campaigns/${tenantB.campaignId}`,
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { name: "hijacked" },
      });
      assert.strictEqual(res.statusCode, 404);
      const still = await base.campaign.findUnique({ where: { id: tenantB.campaignId } });
      assert.strictEqual(still?.name, `${TAG}-B-campaign`, "B's campaign name must be untouched");
    });

    it("A archiving B's campaign resolves to 404 and B's status is unchanged", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/campaigns/${tenantB.campaignId}/archive`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      const still = await base.campaign.findUnique({ where: { id: tenantB.campaignId } });
      assert.strictEqual(still?.status, "DRAFT", "B's campaign status must be untouched");
    });

    it("A tagging a post onto B's campaign resolves to 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/campaigns/${tenantB.campaignId}/posts/${randomUUID()}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
    });

    it("A untagging B's post from B's campaign resolves to 404 AND B's join row survives", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/campaigns/${tenantB.campaignId}/posts/${tenantB.postId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(
        res.statusCode,
        404,
        "foreign untag MUST be 404, never a destructive delete"
      );
      const joinRow = await base.campaignPost.findUnique({
        where: { campaignId_postId: { campaignId: tenantB.campaignId, postId: tenantB.postId } },
      });
      assert.ok(joinRow, "B's campaign-post tag set must be unchanged — the join row must survive");
    });

    it("A creating against B's project resolves to 404 (never 500/403) and persists no row", async () => {
      const beforeCount = await base.campaign.count({ where: { projectId: tenantB.projectId } });
      const res = await app.inject({
        method: "POST",
        url: "/campaigns",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { projectId: tenantB.projectId, name: "pwn" },
      });
      assert.strictEqual(res.statusCode, 404, "foreign-project create MUST be 404, never 500/403");
      const afterCount = await base.campaign.count({ where: { projectId: tenantB.projectId } });
      assert.strictEqual(afterCount, beforeCount, "no row may be persisted under B's project");
    });

    it("A listing with B's projectId returns 200 with an empty set", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/campaigns?projectId=${tenantB.projectId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json() as { ok: boolean; data: unknown[] };
      assert.strictEqual(body.data.length, 0, "A must see ZERO of B's campaigns");
    });

    it("A reading analytics for B's campaign resolves to 404 with no aggregate of B in the body", async () => {
      // The analytics route is the ONE campaign read that traverses the
      // unguarded `campaignPost` join. It is closed because step 2 of
      // GetCampaignAnalyticsUseCase resolves existence through the now-guarded
      // `campaign` model (findUnique + injected accountId → null), returning
      // NOT_FOUND BEFORE `findPostIdsByCampaignId` ever queries the join table.
      const res = await app.inject({
        method: "GET",
        url: `/campaigns/${tenantB.campaignId}/analytics`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(
        res.statusCode,
        404,
        "foreign analytics MUST be 404 via the guarded campaign existence check"
      );
      const body = res.json() as { ok: boolean; data?: unknown };
      assert.strictEqual(
        body.ok,
        false,
        "a foreign analytics request must not return a success envelope"
      );
      assert.strictEqual(body.data, undefined, "no analytics data of B may be returned");
      assert.ok(
        !res.payload.includes("totalViews") && !res.payload.includes("totalEngagement"),
        "no aggregate metric of B may appear in the payload"
      );
    });
  });

  describe("own-tenant regression — the owner path still works and is consistent", () => {
    it("A creating under its OWN project persists a row whose accountId === Project.accountId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/campaigns",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { projectId: tenantA.projectId, name: "owned" },
      });
      assert.strictEqual(res.statusCode, 201);
      const body = res.json() as { ok: boolean; data: { id: string } };
      const persisted = await base.campaign.findUnique({ where: { id: body.data.id } });
      assert.ok(persisted);
      assert.strictEqual(
        persisted?.accountId,
        tenantA.accountId,
        "persisted row must satisfy accountId === Project.accountId"
      );
      await base.campaign.delete({ where: { id: body.data.id } });
    });

    it("A can list its OWN project's campaigns", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/campaigns?projectId=${tenantA.projectId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json() as { ok: boolean; data: Array<{ projectId: string }> };
      assert.ok(body.data.length >= 1, "A must see its own campaigns");
    });

    it("A reading analytics for its OWN campaign returns 200 (proves the 404 is the guard, not a broken route)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/campaigns/${tenantA.campaignId}/analytics`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200, "owner analytics must succeed");
      const body = res.json() as { ok: boolean; data: { campaignId: string; totalPosts: number } };
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data.campaignId, tenantA.campaignId);
      // Seed tags exactly one post onto A's campaign.
      assert.strictEqual(body.data.totalPosts, 1, "owner analytics must count A's tagged post");
    });
  });

  describe("data-layer invariant", () => {
    it("every persisted row satisfies accountId === Project.accountId", async () => {
      const rows = await base.campaign.findMany({
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
        `SELECT count(*)::bigint AS count FROM "Campaign" WHERE "accountId" IS NULL`
      );
      assert.strictEqual(Number(result[0]?.count ?? 0), 0);
    });
  });
});
