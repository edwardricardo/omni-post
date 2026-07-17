/**
 * @file scheduledReportTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant integration test for the
 *   `ScheduledReport` tenant-guard enrollment. Exercises the live report routes
 *   THROUGH HTTP (`app.inject`) against a REAL database with two tenants (A, B),
 *   proving the cross-tenant IDOR paths are closed and — critically — that the
 *   analytics-exfiltration escalation is closed: A cannot repoint `recipients`
 *   on B's report and then generate it, because both the update and the
 *   generate resolve to NOT_FOUND before any analytics is computed or any email
 *   is sent.
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
import { PrismaScheduledReportRepository } from "../../src/infrastructure/repositories/PrismaScheduledReportRepository.js";
import {
  CreateScheduledReportUseCase,
  UpdateScheduledReportUseCase,
  DeleteScheduledReportUseCase,
  ListScheduledReportsQuery,
  GenerateReportUseCase,
} from "@core/reports/index.js";
import type { AnalyticsReadRepositoryPort } from "@core/domain/repositories/AnalyticsReadRepository.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import { ok } from "@shared/types";
import { reportRoutes } from "../../src/reports/reportRoutes.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const TAG = `schedreport-iso-${Date.now()}`;

interface Seeded {
  accountId: string;
  projectId: string;
  reportId: string;
}

const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `schedreport-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

describe("ScheduledReport — two-tenant isolation (MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let app: FastifyInstance;
  let emailSends = 0;

  let tenantA: Seeded;
  let tenantB: Seeded;

  async function seedReport(accountId: string, projectId: string): Promise<string> {
    const row = await base.scheduledReport.create({
      data: {
        accountId,
        projectId,
        name: `${TAG}-report`,
        cronSchedule: "0 9 * * 1",
        format: "CSV",
        recipients: ["owner@test.local"],
        isActive: true,
      },
    });
    return row.id;
  }

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
    const reportId = await seedReport(account.id, project.id);
    return { accountId: account.id, projectId: project.id, reportId };
  }

  before(async () => {
    base = createTestPrismaClient();

    tenantA = await seedTenant("A");
    tenantB = await seedTenant("B");

    // Guarded client — EXACTLY as production wires it (base + tenant guard).
    const guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    const reportRepo = new PrismaScheduledReportRepository(guarded);
    const projectRepo = new PrismaProjectRepository(guarded);
    // Typed test doubles (no `as never`). A foreign report resolves to
    // NOT_FOUND before either double runs, so the exfil test asserts ZERO email
    // sends on the cross-tenant path; the owner-generate control proves the
    // email stub CAN fire, pinning the sentinel's detection power.
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
    const emailPort: EmailPort = {
      send: async () => {
        emailSends += 1;
        return ok(undefined);
      },
    };

    const container = new Container();
    container.registerInstance(TOKENS.PrismaClient, guarded);
    container.registerInstance(TOKENS.ProjectRepository, projectRepo);
    container.registerInstance(TOKENS.ScheduledReportRepository, reportRepo);
    // UnitOfWork is transient per canon (new instance per resolve).
    container.register(TOKENS.UnitOfWork, () => new PrismaUnitOfWork(guarded), false);
    container.register(
      TOKENS.CreateScheduledReportUseCase,
      () =>
        new CreateScheduledReportUseCase(
          reportRepo,
          projectRepo,
          container.resolve(TOKENS.UnitOfWork)
        ),
      true
    );
    container.register(
      TOKENS.UpdateScheduledReportUseCase,
      () => new UpdateScheduledReportUseCase(reportRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );
    container.register(
      TOKENS.DeleteScheduledReportUseCase,
      () => new DeleteScheduledReportUseCase(reportRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );
    container.register(
      TOKENS.ListScheduledReportsQuery,
      () => new ListScheduledReportsQuery(reportRepo),
      true
    );
    container.register(
      TOKENS.GenerateReportUseCase,
      () => new GenerateReportUseCase(reportRepo, analyticsRead, emailPort),
      true
    );

    app = Fastify();
    app.decorate("container", container);
    await app.register(reportRoutes);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await base.scheduledReport
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
    it("A reading B's report by id resolves to 404 with no B data in the payload", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/reports/${tenantB.reportId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      assert.ok(!res.payload.includes(tenantB.projectId), "B's projectId must not leak");
    });

    it("A repointing recipients on B's report resolves to 404 and B's recipients are unchanged", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/reports/${tenantB.reportId}`,
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { recipients: ["attacker@evil.local"] },
      });
      assert.strictEqual(res.statusCode, 404);
      const still = await base.scheduledReport.findUnique({ where: { id: tenantB.reportId } });
      assert.deepStrictEqual(
        still?.recipients,
        ["owner@test.local"],
        "B's recipients must be untouched"
      );
    });

    it("A generating B's report resolves to 404 and NO email carrying B's analytics is sent", async () => {
      const before = emailSends;
      const res = await app.inject({
        method: "POST",
        url: `/reports/${tenantB.reportId}/generate`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(emailSends, before, "no email may be sent on a foreign generate");
    });

    it("A deleting B's report resolves to 404 and B's report still exists", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/reports/${tenantB.reportId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      const still = await base.scheduledReport.findUnique({ where: { id: tenantB.reportId } });
      assert.ok(still, "B's report must survive A's foreign delete");
    });

    it("A creating against B's project resolves to 404 (never 500/403) and persists no row", async () => {
      const beforeCount = await base.scheduledReport.count({
        where: { projectId: tenantB.projectId },
      });
      const res = await app.inject({
        method: "POST",
        url: "/reports",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: {
          projectId: tenantB.projectId,
          name: "pwn",
          cronSchedule: "0 9 * * 1",
          recipients: ["attacker@evil.local"],
        },
      });
      assert.strictEqual(res.statusCode, 404, "foreign-project create MUST be 404, never 500/403");
      const afterCount = await base.scheduledReport.count({
        where: { projectId: tenantB.projectId },
      });
      assert.strictEqual(afterCount, beforeCount, "no row may be persisted under B's project");
    });

    it("A listing B's project returns 200 with an empty set", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/reports?projectId=${tenantB.projectId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json() as { ok: boolean; data: unknown[] };
      assert.strictEqual(body.data.length, 0, "A must see ZERO of B's reports");
    });
  });

  describe("own-tenant regression — the owner path still works and is consistent", () => {
    it("A creating under its OWN project persists a row whose accountId === Project.accountId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/reports",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: {
          projectId: tenantA.projectId,
          name: "owned",
          cronSchedule: "0 9 * * 1",
          recipients: ["a@test.local"],
        },
      });
      assert.strictEqual(res.statusCode, 201);
      const body = res.json() as { ok: boolean; data: { id: string } };
      const persisted = await base.scheduledReport.findUnique({ where: { id: body.data.id } });
      assert.ok(persisted);
      assert.strictEqual(
        persisted?.accountId,
        tenantA.accountId,
        "persisted row must satisfy accountId === Project.accountId"
      );
      await base.scheduledReport.delete({ where: { id: body.data.id } });
    });

    it("A can list its OWN project's reports", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/reports?projectId=${tenantA.projectId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json() as { ok: boolean; data: Array<{ projectId: string }> };
      assert.ok(body.data.length >= 1, "A must see its own reports");
      assert.ok(body.data.every((r) => r.projectId === tenantA.projectId));
    });

    it("A generating its OWN report succeeds and fires exactly one email (pins the exfil sentinel)", async () => {
      const before = emailSends;
      const res = await app.inject({
        method: "POST",
        url: `/reports/${tenantA.reportId}/generate`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200, "owner generate must succeed");
      assert.strictEqual(
        emailSends,
        before + 1,
        "the owner path MUST fire the email stub — proving the sentinel can detect a send"
      );
    });
  });

  describe("data-layer invariant", () => {
    it("every persisted row satisfies accountId === Project.accountId", async () => {
      const rows = await base.scheduledReport.findMany({
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
        `SELECT count(*)::bigint AS count FROM "ScheduledReport" WHERE "accountId" IS NULL`
      );
      assert.strictEqual(Number(result[0]?.count ?? 0), 0);
    });
  });
});
