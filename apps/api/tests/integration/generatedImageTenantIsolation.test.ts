/**
 * @file generatedImageTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant integration test for the `GeneratedImage`
 *   tenant-guard enrollment (Slice 4). Exercises the live AI-image routes THROUGH
 *   HTTP (`app.inject`) against a REAL database with two tenants (A, B), proving:
 *   - the list IDOR is closed guard-naturally (A listing B's projectId → 200 + []),
 *     and no prompt / revised prompt / image URL of B leaks;
 *   - the paid-AI-spend escalation is closed: A generating into B's project → 404
 *     (never 403/500) BEFORE the paid provider call — the image-generation port
 *     (a sentinel spy fake overriding `TOKENS.ImageGenerationPort`) is NEVER
 *     invoked and NO row is planted in B's project;
 *   - responses never expose the server-only `accountId` (single generate + list);
 *   - usage billing is server-derived: the `aiCallsMade` increment attributes to
 *     the caller's context account, and a FOREIGN `accountId` in the body is
 *     ignored (never increments another tenant's counter).
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
import { ok } from "@shared/types";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import type {
  ImageGenerationPort,
  ImageGenerationOptions,
} from "@core/domain/repositories/ImageGenerationPort.js";
import { getTenantContext, getSystemContext } from "../../src/security/tenantContext.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { PrismaProjectRepository } from "../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { PrismaGeneratedImageRepository } from "../../src/infrastructure/repositories/PrismaGeneratedImageRepository.js";
import { PrismaUsageMetricRepository } from "../../src/infrastructure/repositories/PrismaUsageMetricRepository.js";
import { GenerateImageUseCase } from "@core/ai-image/GenerateImageUseCase.js";
import { ListGeneratedImagesQuery } from "@core/ai-image/ListGeneratedImagesQuery.js";
import { IncrementUsageUseCase } from "@core/usage/IncrementUsageUseCase.js";
import { aiImageRoutes } from "../../src/ai-image/aiImageRoutes.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const TAG = `genimg-iso-${Date.now()}`;
const NOW = new Date();
const PERIOD_YEAR = NOW.getUTCFullYear();
const PERIOD_MONTH = NOW.getUTCMonth() + 1;

interface Seeded {
  accountId: string;
  projectId: string;
  imageId: string;
}

// Sentinel spy fake for the image-generation port. Records every invocation so
// the test can prove the paid provider call is NEVER reached for a foreign
// project. NEVER a real provider call.
let imageGenCalls: ImageGenerationOptions[] = [];
const sentinelImageGen: ImageGenerationPort = {
  generateImage: async (options: ImageGenerationOptions) => {
    imageGenCalls.push(options);
    return ok({
      imageUrl: "https://sentinel.test/generated.png",
      revisedPrompt: "sentinel revised prompt",
    });
  },
};

const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `genimg-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

describe("GeneratedImage — two-tenant isolation (MERGE-BLOCKING)", () => {
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
    const image = await base.generatedImage.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        prompt: `${TAG}-${name}-secret-prompt`,
        revisedPrompt: `${TAG}-${name}-secret-revised`,
        imageUrl: `https://cdn.test/${TAG}-${name}-secret.png`,
        size: "1024x1024",
        quality: "standard",
        style: "vivid",
      },
    });
    return { accountId: account.id, projectId: project.id, imageId: image.id };
  }

  async function readAiCalls(accountId: string): Promise<number> {
    const row = await base.usageMetric.findUnique({
      where: {
        accountId_periodYear_periodMonth: {
          accountId,
          periodYear: PERIOD_YEAR,
          periodMonth: PERIOD_MONTH,
        },
      },
    });
    return row?.aiCallsMade ?? 0;
  }

  // The usage increment is best-effort (fire-and-forget), so it may land after
  // the HTTP response resolves. Poll until the counter reaches `expected`.
  async function waitForAiCalls(accountId: string, expected: number): Promise<number> {
    const deadline = Date.now() + 3000;
    let last = await readAiCalls(accountId);
    while (last < expected && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      last = await readAiCalls(accountId);
    }
    return last;
  }

  before(async () => {
    base = createTestPrismaClient();

    tenantA = await seedTenant("A");
    tenantB = await seedTenant("B");

    // Guarded client — EXACTLY as production wires it (base + tenant guard).
    const guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    const generatedImageRepo = new PrismaGeneratedImageRepository(guarded);
    const projectRepo = new PrismaProjectRepository(guarded);
    const usageRepo = new PrismaUsageMetricRepository(guarded);

    const container = new Container();
    container.registerInstance(TOKENS.PrismaClient, guarded);
    container.registerInstance(TOKENS.ProjectRepository, projectRepo);
    container.registerInstance(TOKENS.GeneratedImageRepository, generatedImageRepo);
    container.registerInstance(TOKENS.UsageMetricRepository, usageRepo);
    // UnitOfWork is transient per canon (new instance per resolve).
    container.register(TOKENS.UnitOfWork, () => new PrismaUnitOfWork(guarded), false);
    // Override the image-generation port with the sentinel spy fake.
    container.registerInstance(TOKENS.ImageGenerationPort, sentinelImageGen);
    container.register(
      TOKENS.GenerateImageUseCase,
      () => new GenerateImageUseCase(generatedImageRepo, projectRepo, sentinelImageGen),
      true
    );
    container.register(
      TOKENS.ListGeneratedImagesQuery_AIImage,
      () => new ListGeneratedImagesQuery(generatedImageRepo),
      true
    );
    container.register(
      TOKENS.IncrementUsageUseCase,
      () => new IncrementUsageUseCase(usageRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );

    app = Fastify();
    app.decorate("container", container);
    await app.register(aiImageRoutes);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    const accountIds = [tenantA.accountId, tenantB.accountId];
    const projectIds = [tenantA.projectId, tenantB.projectId];
    await base.generatedImage
      .deleteMany({ where: { projectId: { in: projectIds } } })
      .catch(() => undefined);
    await base.usageMetric
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.project
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
    await base.$disconnect();
  });

  describe("cross-tenant IDOR paths are closed (A attacks B)", () => {
    it("A listing B's generated images via a foreign projectId returns 200 with an empty set, no B content leaks", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/ai/generated-images?projectId=${tenantB.projectId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json() as { ok: boolean; data: unknown[] };
      assert.strictEqual(body.data.length, 0, "A must see ZERO of B's generated images");
      assert.ok(
        !res.payload.includes("secret-prompt") &&
          !res.payload.includes("secret-revised") &&
          !res.payload.includes("secret.png"),
        "no prompt / revised prompt / image URL of B may appear in the payload"
      );
    });

    it("A generating into B's project resolves to 404 (never 403/500), burns NO AI call, persists no row", async () => {
      imageGenCalls = [];
      const beforeCount = await base.generatedImage.count({
        where: { projectId: tenantB.projectId },
      });
      const res = await app.inject({
        method: "POST",
        url: "/ai/generate-image",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { projectId: tenantB.projectId, prompt: "steal into B" },
      });
      assert.strictEqual(
        res.statusCode,
        404,
        "foreign-project generate MUST be 404, never 403/500"
      );
      assert.strictEqual(
        imageGenCalls.length,
        0,
        "the paid AI provider call must NEVER be invoked for a foreign project"
      );
      const afterCount = await base.generatedImage.count({
        where: { projectId: tenantB.projectId },
      });
      assert.strictEqual(afterCount, beforeCount, "no row may be persisted under B's project");
    });
  });

  describe("own-tenant regression — the owner path still works and never exposes accountId", () => {
    it("A generating into its OWN project returns 201, fires the AI sentinel, persists accountId === Project.accountId, and the response carries NO accountId key", async () => {
      imageGenCalls = [];
      const res = await app.inject({
        method: "POST",
        url: "/ai/generate-image",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { projectId: tenantA.projectId, prompt: "my own art" },
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(imageGenCalls.length, 1, "the AI sentinel must fire for an owned project");
      const body = res.json() as { ok: boolean; data: Record<string, unknown> & { id: string } };
      assert.ok(
        !("accountId" in body.data),
        "the single-generate response must NOT carry an accountId key"
      );
      const persisted = await base.generatedImage.findUnique({ where: { id: body.data.id } });
      assert.ok(persisted);
      assert.strictEqual(
        persisted?.accountId,
        tenantA.accountId,
        "persisted row must satisfy accountId === Project.accountId"
      );
      await base.generatedImage.delete({ where: { id: body.data.id } });
    });

    it("A listing its OWN project returns its images, and every item carries NO accountId key", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/ai/generated-images?projectId=${tenantA.projectId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json() as { ok: boolean; data: Array<Record<string, unknown>> };
      assert.ok(body.data.length >= 1, "A must see its own generated images");
      for (const item of body.data) {
        assert.ok(!("accountId" in item), "no list item may carry an accountId key");
      }
    });
  });

  describe("usage billing is attributed by server-derived accountId (SIGNED, obs 306)", () => {
    it("an own generate WITHOUT a body accountId increments the caller's own aiCallsMade", async () => {
      const before = await readAiCalls(tenantA.accountId);
      const res = await app.inject({
        method: "POST",
        url: "/ai/generate-image",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { projectId: tenantA.projectId, prompt: "billing check" },
      });
      assert.strictEqual(res.statusCode, 201);
      const after = await waitForAiCalls(tenantA.accountId, before + 1);
      assert.ok(after >= before + 1, "the caller's own aiCallsMade counter must increment");
      const body = res.json() as { ok: boolean; data: { id: string } };
      await base.generatedImage.delete({ where: { id: body.data.id } });
    });

    it("a FOREIGN accountId in the body is ignored: B's counter is UNCHANGED, the caller's is incremented", async () => {
      const bBefore = await readAiCalls(tenantB.accountId);
      const aBefore = await readAiCalls(tenantA.accountId);
      const res = await app.inject({
        method: "POST",
        url: "/ai/generate-image",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        // Body carries B's accountId — the schema strips it; the increment must
        // attribute to A's context, never B.
        payload: {
          projectId: tenantA.projectId,
          prompt: "spoofed billing",
          accountId: tenantB.accountId,
        },
      });
      assert.strictEqual(
        res.statusCode,
        201,
        "a spoofed body accountId must not break the request"
      );
      const aAfter = await waitForAiCalls(tenantA.accountId, aBefore + 1);
      assert.ok(aAfter >= aBefore + 1, "the caller's OWN counter must be the one incremented");
      const bAfter = await readAiCalls(tenantB.accountId);
      assert.strictEqual(
        bAfter,
        bBefore,
        "the foreign tenant's aiCallsMade counter must be UNCHANGED"
      );
      const body = res.json() as { ok: boolean; data: { id: string } };
      await base.generatedImage.delete({ where: { id: body.data.id } });
    });
  });

  describe("data-layer invariant", () => {
    it("every persisted row satisfies accountId === Project.accountId", async () => {
      const rows = await base.generatedImage.findMany({
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
        `SELECT count(*)::bigint AS count FROM "GeneratedImage" WHERE "accountId" IS NULL`
      );
      assert.strictEqual(Number(result[0]?.count ?? 0), 0);
    });
  });
});
