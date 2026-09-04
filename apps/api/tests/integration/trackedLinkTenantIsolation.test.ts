/**
 * @file trackedLinkTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant integration test for the `TrackedLink`
 *   tenant-guard enrollment (Slice 3). Exercises the live link routes THROUGH
 *   HTTP (`app.inject`) against a REAL database with two tenants (A, B). Proves:
 *   (1) every management route (get / delete / utm-generate / utm-url / stats /
 *   create / list) closes the cross-tenant IDOR; (2) the stats route — which
 *   traverses the `linkClick` CHILD table (absent from TENANT_SCOPED_MODELS) —
 *   resolves to 404 BEFORE any child-table read, via the upstream guarded
 *   `findById`; (3) delete of a foreign link is 404 AND B's `linkClick` rows
 *   survive; (4) the DELIBERATE public-redirect guard bypass leaks nothing (bare
 *   302 → destination), still records the click (positive control), and is
 *   throttled by the mandatory namespace rate-limit (429 after the cap).
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
import type { RateLimiterPort, RateLimitDecision, RateLimitOptions } from "@ports/core";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { getTenantContext, getSystemContext } from "../../src/security/tenantContext.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { RateLimitConfigs } from "../../src/security/httpRateLimitPreHandler.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { PrismaProjectRepository } from "../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { PrismaTrackedLinkRepository } from "../../src/infrastructure/repositories/PrismaTrackedLinkRepository.js";
import {
  CreateTrackedLinkUseCase,
  GetTrackedLinkUseCase,
  GetLinkStatsUseCase,
  DeleteTrackedLinkUseCase,
  RedirectAndTrackClickUseCase,
} from "@core/links/index.js";
import { GenerateUTMLinksUseCase } from "@core/utm/index.js";
import { linkRoutes } from "../../src/links/linkRoutes.js";
import { utmRoutes } from "../../src/utm/utmRoutes.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const TAG = `linkiso${Date.now()}`;

interface Seeded {
  accountId: string;
  projectId: string;
  linkId: string;
  shortCode: string;
  originalUrl: string;
}

const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `link-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

/**
 * Minimal in-memory RateLimiterPort test double — a monotonic per-key counter
 * (no refill within the test window). Honors the per-call `capacity` the
 * namespace preHandler passes (RateLimitConfigs.REDIRECT), so the Nth+1 hit on a
 * key is denied. Deterministic and Redis-free.
 */
class CountingRateLimiter implements RateLimiterPort {
  private readonly used = new Map<string, number>();
  async tryConsume(key: string, opts?: RateLimitOptions): Promise<RateLimitDecision> {
    const capacity = opts?.capacity ?? 100;
    const windowMs = opts?.refillWindowMs ?? 60_000;
    const next = (this.used.get(key) ?? 0) + 1;
    this.used.set(key, next);
    const allowed = next <= capacity;
    const remaining = Math.max(0, capacity - next);
    return allowed
      ? { allowed, remaining, resetAtMs: Date.now() + windowMs }
      : { allowed, remaining, resetAtMs: Date.now() + windowMs, retryAfterMs: windowMs };
  }
}

describe("TrackedLink — two-tenant isolation (MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let app: FastifyInstance;

  let tenantA: Seeded;
  let tenantB: Seeded;

  async function seedTenant(name: string, withClicks: boolean): Promise<Seeded> {
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
    const shortCode = `${TAG}${name}`;
    const originalUrl = `https://example.com/${name}-destination`;
    const link = await base.trackedLink.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        originalUrl,
        shortCode,
        utmSource: "seed",
        utmMedium: "seed",
        utmCampaign: "seed",
      },
    });
    if (withClicks) {
      await base.linkClick.createMany({
        data: [
          { trackedLinkId: link.id, country: "US" },
          { trackedLinkId: link.id, country: "UK" },
        ],
      });
      await base.trackedLink.update({ where: { id: link.id }, data: { clicks: 2 } });
    }
    return {
      accountId: account.id,
      projectId: project.id,
      linkId: link.id,
      shortCode,
      originalUrl,
    };
  }

  before(async () => {
    base = createTestPrismaClient();

    tenantA = await seedTenant("A", false);
    tenantB = await seedTenant("B", true); // B has linkClick rows

    // Guarded client — EXACTLY as production wires it (base + tenant guard).
    const guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    const linkRepo = new PrismaTrackedLinkRepository(guarded);
    const projectRepo = new PrismaProjectRepository(guarded);

    const container = new Container();
    container.registerInstance(TOKENS.PrismaClient, guarded);
    container.registerInstance(TOKENS.ProjectRepository, projectRepo);
    container.registerInstance(TOKENS.TrackedLinkRepository, linkRepo);
    container.registerInstance(TOKENS.HttpRateLimiter, new CountingRateLimiter());
    container.register(TOKENS.UnitOfWork, () => new PrismaUnitOfWork(guarded), false);
    container.register(
      TOKENS.CreateTrackedLinkUseCase,
      () =>
        new CreateTrackedLinkUseCase(linkRepo, projectRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );
    container.register(
      TOKENS.GetTrackedLinkUseCase,
      () => new GetTrackedLinkUseCase(linkRepo),
      true
    );
    container.register(TOKENS.GetLinkStatsUseCase, () => new GetLinkStatsUseCase(linkRepo), true);
    container.register(
      TOKENS.DeleteTrackedLinkUseCase,
      () => new DeleteTrackedLinkUseCase(linkRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );
    container.register(
      TOKENS.RedirectAndTrackClickUseCase,
      () => new RedirectAndTrackClickUseCase(linkRepo),
      true
    );
    container.register(
      TOKENS.GenerateUTMLinksUseCase,
      () => new GenerateUTMLinksUseCase(linkRepo, container.resolve(TOKENS.UnitOfWork)),
      true
    );

    app = Fastify();
    app.decorate("container", container);
    await app.register(linkRoutes);
    await app.register(utmRoutes);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    const accountIds = [tenantA.accountId, tenantB.accountId];
    const linkIds = [tenantA.linkId, tenantB.linkId];
    await base.linkClick
      .deleteMany({ where: { trackedLinkId: { in: linkIds } } })
      .catch(() => undefined);
    await base.trackedLink
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.project
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
    await base.$disconnect();
  });

  describe("management-surface IDOR is closed (A attacks B)", () => {
    it("A reading B's link by id resolves to 404", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/links/${tenantB.linkId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      assert.ok(!res.payload.includes(tenantB.originalUrl), "no B link data may leak");
    });

    it("A deleting B's link resolves to 404 AND B's linkClick rows survive", async () => {
      const before = await base.linkClick.count({ where: { trackedLinkId: tenantB.linkId } });
      assert.strictEqual(before, 2, "precondition: B has 2 click rows");
      const res = await app.inject({
        method: "DELETE",
        url: `/links/${tenantB.linkId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404, "foreign delete MUST be 404, never destructive");
      const stillLink = await base.trackedLink.findUnique({ where: { id: tenantB.linkId } });
      assert.ok(stillLink, "B's link must survive");
      const after = await base.linkClick.count({ where: { trackedLinkId: tenantB.linkId } });
      assert.strictEqual(after, 2, "B's child linkClick rows must survive untouched");
    });

    it("A generating UTM for B's link resolves to 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/links/${tenantB.linkId}/utm`,
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { source: "hijack", medium: "hijack", campaign: "hijack" },
      });
      assert.strictEqual(res.statusCode, 404);
    });

    it("A reading B's UTM url resolves to 404", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/links/${tenantB.linkId}/utm-url`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
    });

    it("A reading B's stats resolves to 404 BEFORE any child-table (linkClick) read", async () => {
      // The stats route traverses `linkClick.findMany` (unenrolled child table).
      // Enrollment closes it ONLY via the upstream guarded `findById(linkId)`:
      // foreign link → NOT_FOUND before getClickStats ever runs.
      const res = await app.inject({
        method: "GET",
        url: `/links/${tenantB.linkId}/stats`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404, "foreign stats MUST be 404 via the guarded findById");
      assert.ok(
        !res.payload.includes("clicksByCountry") && !res.payload.includes("totalClicks"),
        "no aggregate of B's clicks may appear"
      );
    });

    it("A creating a link against B's project resolves to 404 (never 500/403) and persists no row", async () => {
      const before = await base.trackedLink.count({ where: { projectId: tenantB.projectId } });
      const res = await app.inject({
        method: "POST",
        url: "/links",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { projectId: tenantB.projectId, originalUrl: "https://evil.example.com/pwn" },
      });
      assert.strictEqual(res.statusCode, 404, "foreign-project create MUST be 404, never 500/403");
      const after = await base.trackedLink.count({ where: { projectId: tenantB.projectId } });
      assert.strictEqual(after, before, "no row may be persisted under B's project");
    });
  });

  describe("public redirect — deliberate capability-URL bypass with compensating controls", () => {
    it("anonymous redirect to B's shortCode returns a bare 302 to the destination and leaks NO tenant data", async () => {
      const res = await app.inject({ method: "GET", url: `/r/${tenantB.shortCode}` });
      assert.strictEqual(
        res.statusCode,
        302,
        "public redirect must resolve globally (system context)"
      );
      assert.strictEqual(res.headers.location, tenantB.originalUrl, "302 → destination URL only");
      // Leaks-nothing: the response carries no tenant/accountId/analytics data.
      assert.ok(!res.payload.includes(tenantB.accountId), "no accountId may leak in the body");
      assert.ok(!res.payload.includes(tenantB.projectId), "no projectId may leak in the body");
      assert.strictEqual(res.headers["x-account-id"], undefined, "no tenant header may leak");
    });

    it("anonymous redirect to A's OWN shortCode works and records the click (positive control)", async () => {
      const beforeClicks = await base.trackedLink.findUnique({
        where: { id: tenantA.linkId },
        select: { clicks: true },
      });
      const res = await app.inject({ method: "GET", url: `/r/${tenantA.shortCode}` });
      assert.strictEqual(res.statusCode, 302);
      assert.strictEqual(res.headers.location, tenantA.originalUrl);
      // recordClick is fire-and-forget — poll briefly for the increment.
      let recorded = false;
      for (let i = 0; i < 20 && !recorded; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const now = await base.trackedLink.findUnique({
          where: { id: tenantA.linkId },
          select: { clicks: true },
        });
        recorded = (now?.clicks ?? 0) > (beforeClicks?.clicks ?? 0);
      }
      assert.ok(recorded, "the click must be recorded on A's own link");
    });

    it("the /r namespace is rate-limited by the trusted socket peer, not a spoofable header", async () => {
      const cap = RateLimitConfigs.REDIRECT.maxRequests;
      // A distinct SOCKET peer → an isolated bucket. `resolveClientIp` keys on the
      // socket under TRUSTED_PROXY_MODE=socket-only (the test default), never on a
      // client-controlled `X-Forwarded-For` — so the bucket is driven by
      // `remoteAddress`, not the header (that is the N-SEC-2 invariant).
      const ip = "203.0.113.77";
      // Exhaust the bucket: `cap` allowed hits from one socket peer.
      for (let i = 0; i < cap; i++) {
        const res = await app.inject({
          method: "GET",
          url: `/r/${tenantA.shortCode}`,
          remoteAddress: ip,
        });
        assert.notStrictEqual(
          res.statusCode,
          429,
          `hit ${i + 1} within the cap must not be throttled`
        );
      }
      // The next hit crosses the threshold.
      const throttled = await app.inject({
        method: "GET",
        url: `/r/${tenantA.shortCode}`,
        remoteAddress: ip,
      });
      assert.strictEqual(
        throttled.statusCode,
        429,
        "the namespace rate limit must engage after the cap"
      );
      // Spoof-resistance (N-SEC-2): rotating a client-controlled `X-Forwarded-For`
      // must NOT mint a fresh bucket — the same socket peer stays throttled.
      const spoofed = await app.inject({
        method: "GET",
        url: `/r/${tenantA.shortCode}`,
        remoteAddress: ip,
        headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.9" },
      });
      assert.strictEqual(
        spoofed.statusCode,
        429,
        "a spoofed X-Forwarded-For must not escape the socket-keyed bucket"
      );
    });
  });

  describe("own-tenant regression + data-layer invariant", () => {
    it("A creating under its OWN project persists a row whose accountId === Project.accountId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/links",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { projectId: tenantA.projectId, originalUrl: "https://example.com/owned-link" },
      });
      assert.strictEqual(res.statusCode, 201);
      const body = res.json() as { ok: boolean; data: { id: string } };
      const persisted = await base.trackedLink.findUnique({ where: { id: body.data.id } });
      assert.ok(persisted);
      assert.strictEqual(
        persisted?.accountId,
        tenantA.accountId,
        "persisted row must satisfy accountId === Project.accountId"
      );
      await base.linkClick.deleteMany({ where: { trackedLinkId: body.data.id } });
      await base.trackedLink.delete({ where: { id: body.data.id } });
    });

    it("A reads its OWN link and stats (proves the 404s are the guard, not a broken route)", async () => {
      const getRes = await app.inject({
        method: "GET",
        url: `/links/${tenantA.linkId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(getRes.statusCode, 200);
      const statsRes = await app.inject({
        method: "GET",
        url: `/links/${tenantA.linkId}/stats`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(statsRes.statusCode, 200);
    });

    it("every persisted row satisfies accountId === Project.accountId", async () => {
      const rows = await base.trackedLink.findMany({
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
        `SELECT count(*)::bigint AS count FROM "TrackedLink" WHERE "accountId" IS NULL`
      );
      assert.strictEqual(Number(result[0]?.count ?? 0), 0);
    });
  });
});
