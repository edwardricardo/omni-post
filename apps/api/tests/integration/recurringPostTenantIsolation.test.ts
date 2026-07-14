/**
 * @file recurringPostTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant integration test for the `RecurringPost`
 *   tenant-guard enrollment (Slice 3). Exercises the live recurring-post routes
 *   THROUGH HTTP (`app.inject`) against a REAL database with two tenants (A, B),
 *   proving the cross-tenant IDOR paths are closed AND the template-clone
 *   content-exfil escalation is closed at CREATE (foreign `templatePostId` /
 *   `channels[]` → 404 before persist, so the scheduler's system-context sweep
 *   can never clone B's post content into A's account). Also proves the
 *   recurrence sweep runs under an explicit `withSystemContext("recurrence-sweep")`
 *   (no `TenantContextMissingError` after the guard flip).
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
import {
  getTenantContext,
  getSystemContext,
  withSystemContext,
} from "../../src/security/tenantContext.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { PrismaProjectRepository } from "../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { PrismaPostRepository } from "../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PrismaChannelRepository } from "../../src/infrastructure/repositories/PrismaChannelRepository.js";
import { PrismaRecurringPostRepository } from "../../src/infrastructure/repositories/PrismaRecurringPostRepository.js";
import {
  CreateRecurringPostUseCase,
  UpdateRecurringPostUseCase,
  DeactivateRecurringPostUseCase,
  ListRecurringPostsQuery,
  GetRecurringPostQuery,
  ProcessRecurrenceUseCase,
} from "@core/recurring/index.js";
import { recurringPostRoutes } from "../../src/recurring/recurringPostRoutes.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const TAG = `recpost-iso-${Date.now()}`;
// Far-future so the seed recurrences are never "due" — keeps the sweep test
// deterministic (no unrelated clone side effects from these rows).
const NEXT_RUN = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

interface Seeded {
  accountId: string;
  projectId: string;
  templatePostId: string;
  channelId: string;
  recurringPostId: string;
}

const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `recpost-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

describe("RecurringPost — two-tenant isolation (MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let app: FastifyInstance;
  let guarded: PrismaClient;

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
    const templatePost = await base.post.create({ data: { projectId: project.id } });
    const channel = await base.channel.create({
      data: {
        projectId: project.id,
        provider: "X",
        handle: `${TAG}-${name}-handle`,
        credentialsCiphertext: "placeholder",
        credentialsIv: "placeholder",
        credentialsAuthTag: "placeholder",
      },
    });
    const recurringPost = await base.recurringPost.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        templatePostId: templatePost.id,
        name: `${TAG}-${name}-recurrence`,
        cronExpression: "0 9 * * MON",
        startDate: new Date("2025-01-01T00:00:00.000Z"),
        channels: [channel.id],
        isActive: true,
        nextScheduledAt: NEXT_RUN,
      },
    });
    return {
      accountId: account.id,
      projectId: project.id,
      templatePostId: templatePost.id,
      channelId: channel.id,
      recurringPostId: recurringPost.id,
    };
  }

  before(async () => {
    base = createTestPrismaClient();

    tenantA = await seedTenant("A");
    tenantB = await seedTenant("B");

    // Guarded client — EXACTLY as production wires it (base + tenant guard).
    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    const recurringRepo = new PrismaRecurringPostRepository(guarded);
    const projectRepo = new PrismaProjectRepository(guarded);
    const postRepo = new PrismaPostRepository(guarded);
    const channelRepo = new PrismaChannelRepository(guarded as never);

    const container = new Container();
    container.registerInstance(TOKENS.PrismaClient, guarded);
    container.registerInstance(TOKENS.ProjectRepository, projectRepo);
    container.registerInstance(TOKENS.PostRepository, postRepo);
    container.registerInstance(TOKENS.ChannelRepository, channelRepo);
    container.registerInstance(TOKENS.RecurringPostRepository, recurringRepo);
    container.register(TOKENS.UnitOfWork, () => new PrismaUnitOfWork(guarded), false);
    container.register(
      TOKENS.CreateRecurringPostUseCase,
      () =>
        new CreateRecurringPostUseCase(
          recurringRepo,
          projectRepo,
          postRepo,
          channelRepo,
          container.resolve(TOKENS.UnitOfWork)
        ),
      true
    );
    container.register(
      TOKENS.UpdateRecurringPostUseCase,
      () =>
        new UpdateRecurringPostUseCase(
          recurringRepo,
          channelRepo,
          container.resolve(TOKENS.UnitOfWork)
        ),
      true
    );
    container.register(
      TOKENS.DeactivateRecurringPostUseCase,
      () => new DeactivateRecurringPostUseCase(recurringRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );
    container.register(
      TOKENS.ListRecurringPostsQuery_Recurring,
      () => new ListRecurringPostsQuery(recurringRepo),
      true
    );
    container.register(
      TOKENS.GetRecurringPostQuery,
      () => new GetRecurringPostQuery(recurringRepo),
      true
    );

    app = Fastify();
    app.decorate("container", container);
    await app.register(recurringPostRoutes);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    const accountIds = [tenantA.accountId, tenantB.accountId];
    const projectIds = [tenantA.projectId, tenantB.projectId];
    // FK order: recurringPost (Restrict on templatePost) → channel → post → project → account.
    await base.recurringPost
      .deleteMany({ where: { projectId: { in: projectIds } } })
      .catch(() => undefined);
    await base.channel
      .deleteMany({ where: { projectId: { in: projectIds } } })
      .catch(() => undefined);
    await base.post.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
    await base.project
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
    await base.$disconnect();
  });

  describe("cross-tenant IDOR paths are closed (A attacks B)", () => {
    it("A reading B's recurring post by id resolves to 404", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/recurring-posts/${tenantB.recurringPostId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      assert.ok(!res.payload.includes(`${TAG}-B-recurrence`), "no B recurrence data may leak");
    });

    it("A patching B's recurring post resolves to 404 and B's name is unchanged", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/recurring-posts/${tenantB.recurringPostId}`,
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { name: "hijacked" },
      });
      assert.strictEqual(res.statusCode, 404);
      const still = await base.recurringPost.findUnique({ where: { id: tenantB.recurringPostId } });
      assert.strictEqual(
        still?.name,
        `${TAG}-B-recurrence`,
        "B's recurrence name must be untouched"
      );
    });

    it("A deactivating B's recurring post resolves to 404 and B stays active", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/recurring-posts/${tenantB.recurringPostId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      const still = await base.recurringPost.findUnique({ where: { id: tenantB.recurringPostId } });
      assert.strictEqual(still?.isActive, true, "B's recurrence must stay active");
    });

    it("A listing with B's projectId returns 200 with an empty set", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/recurring-posts?projectId=${tenantB.projectId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json() as { ok: boolean; data: unknown[] };
      assert.strictEqual(body.data.length, 0, "A must see ZERO of B's recurring posts");
    });

    it("A creating against B's project resolves to 404 (never 500/403) and persists no row", async () => {
      const before = await base.recurringPost.count({ where: { projectId: tenantB.projectId } });
      const res = await app.inject({
        method: "POST",
        url: "/recurring-posts",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: {
          projectId: tenantB.projectId,
          templatePostId: randomUUID(),
          name: "pwn",
          cronExpression: "0 9 * * MON",
          startDate: "2025-01-01T00:00:00.000Z",
          channels: [randomUUID()],
        },
      });
      assert.strictEqual(res.statusCode, 404, "foreign-project create MUST be 404, never 500/403");
      const after = await base.recurringPost.count({ where: { projectId: tenantB.projectId } });
      assert.strictEqual(after, before, "no row may be persisted under B's project");
    });

    it("A seeding a recurrence from B's template post resolves to 404 — content-exfil closed, no clone", async () => {
      const recBefore = await base.recurringPost.count({ where: { projectId: tenantA.projectId } });
      const postBefore = await base.post.count({ where: { projectId: tenantA.projectId } });
      const res = await app.inject({
        method: "POST",
        url: "/recurring-posts",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: {
          projectId: tenantA.projectId,
          templatePostId: tenantB.templatePostId, // FOREIGN template
          name: "steal-content",
          cronExpression: "0 9 * * MON",
          startDate: "2025-01-01T00:00:00.000Z",
          channels: [tenantA.channelId],
        },
      });
      assert.strictEqual(res.statusCode, 404, "foreign templatePostId MUST be 404, never 500/403");
      const recAfter = await base.recurringPost.count({ where: { projectId: tenantA.projectId } });
      const postAfter = await base.post.count({ where: { projectId: tenantA.projectId } });
      assert.strictEqual(
        recAfter,
        recBefore,
        "no recurrence may be persisted referencing B's template"
      );
      assert.strictEqual(postAfter, postBefore, "the sweep never clones B's post into A's account");
    });

    it("A targeting B's channel resolves to 404 (cross-tenant publish targeting closed)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/recurring-posts",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: {
          projectId: tenantA.projectId,
          templatePostId: tenantA.templatePostId,
          name: "hijack-channel",
          cronExpression: "0 9 * * MON",
          startDate: "2025-01-01T00:00:00.000Z",
          channels: [tenantB.channelId], // FOREIGN channel
        },
      });
      assert.strictEqual(res.statusCode, 404, "foreign channel MUST be 404, never 500/403");
    });

    it("A repointing its OWN recurrence to B's channel resolves to 404", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/recurring-posts/${tenantA.recurringPostId}`,
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { channels: [tenantB.channelId] },
      });
      assert.strictEqual(res.statusCode, 404, "repoint to a foreign channel MUST be 404");
      const still = await base.recurringPost.findUnique({ where: { id: tenantA.recurringPostId } });
      assert.deepStrictEqual(
        still?.channels,
        [tenantA.channelId],
        "A's channels must be untouched"
      );
    });
  });

  describe("own-tenant regression — the owner path still works and is consistent", () => {
    it("A creating under its OWN refs persists a row whose accountId === Project.accountId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/recurring-posts",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: {
          projectId: tenantA.projectId,
          templatePostId: tenantA.templatePostId,
          name: "owned-recurrence",
          cronExpression: "0 9 * * MON",
          startDate: "2025-01-01T00:00:00.000Z",
          channels: [tenantA.channelId],
        },
      });
      assert.strictEqual(res.statusCode, 201);
      const body = res.json() as { ok: boolean; data: { id: string } };
      const persisted = await base.recurringPost.findUnique({ where: { id: body.data.id } });
      assert.ok(persisted);
      assert.strictEqual(
        persisted?.accountId,
        tenantA.accountId,
        "persisted row must satisfy accountId === Project.accountId"
      );
      await base.recurringPost.delete({ where: { id: body.data.id } });
    });

    it("A can read and list its OWN recurring posts", async () => {
      const getRes = await app.inject({
        method: "GET",
        url: `/recurring-posts/${tenantA.recurringPostId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(getRes.statusCode, 200);
      const listRes = await app.inject({
        method: "GET",
        url: `/recurring-posts?projectId=${tenantA.projectId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(listRes.statusCode, 200);
      const body = listRes.json() as { ok: boolean; data: unknown[] };
      assert.ok(body.data.length >= 1, "A must see its own recurring posts");
    });
  });

  describe("no caller regression — the recurrence sweep runs under system context", () => {
    it("ProcessRecurrenceUseCase SUCCEEDS inside withSystemContext('recurrence-sweep')", async () => {
      const processUseCase = new ProcessRecurrenceUseCase(
        new PrismaRecurringPostRepository(guarded),
        new PrismaUnitOfWork(guarded)
      );
      // This is exactly the wrap RecurrenceScheduler.tick applies. Under the
      // system context the guard bypasses enforcement, so the cross-account
      // `findActiveByNextScheduled` sweep resolves ok — no TenantContextMissingError.
      const wrapped = await withSystemContext("recurrence-sweep", () => processUseCase.execute({}));
      assert.ok(wrapped.ok, "the sweep must succeed under system context");
    });

    it("the same sweep is BLOCKED without a context wrap (proves the guard is active on RecurringPost)", async () => {
      const processUseCase = new ProcessRecurrenceUseCase(
        new PrismaRecurringPostRepository(guarded),
        new PrismaUnitOfWork(guarded)
      );
      // No tenant context bound: the guard throws TenantContextMissingError on the
      // enrolled RecurringPost findMany. The repo's defensive try/catch surfaces
      // it as an err Result — the sweep returns NO rows (never B's unscoped data),
      // which is exactly why the scheduler MUST declare its context explicitly.
      const unwrapped = await processUseCase.execute({});
      assert.ok(!unwrapped.ok, "without a context wrap the sweep must be blocked (guard active)");
    });
  });

  describe("data-layer invariant", () => {
    it("every persisted row satisfies accountId === Project.accountId", async () => {
      const rows = await base.recurringPost.findMany({
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
        `SELECT count(*)::bigint AS count FROM "RecurringPost" WHERE "accountId" IS NULL`
      );
      assert.strictEqual(Number(result[0]?.count ?? 0), 0);
    });
  });
});
