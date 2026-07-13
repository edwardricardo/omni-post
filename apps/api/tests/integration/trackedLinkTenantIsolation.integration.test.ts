/**
 * @file trackedLinkTenantIsolation.integration.test.ts
 * @description Two-tenant, real-DB proof that TrackedLink read/delete resolve ONLY
 *              within the caller's account (CWE-639 IDOR closure). Boots the full API
 *              in-process via `createApp()` + `app.inject` so the customer-auth
 *              middleware binds the AsyncLocalStorage tenant context the repository
 *              reads through `requireTenantContext()`. A live-server / fetch style
 *              would silently skip when no server is up and yield a false green, so it
 *              is deliberately avoided. Also proves the public redirect stays
 *              unauthenticated, the UTM url endpoint inherits the same scoping, the
 *              mutating UTM write-path refuses foreign ids without touching the row,
 *              and `getClickStats` is scoped by construction at the repository level.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/index.js";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";
import { PrismaTrackedLinkRepository } from "../../src/infrastructure/repositories/PrismaTrackedLinkRepository.js";
import { withTenantContext } from "../../src/security/tenantContext.js";
import { TrackedLinkId } from "@core/domain/index.js";

/**
 * Mints a customer Bearer bound to `accountId`. The `/links` routes sit behind
 * `requireClientAuth`, which decodes the token and binds the tenant context, so
 * the token's accountId is the account the request resolves within.
 */
const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `idor-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

/**
 * Rewrites the concrete id out of a NOT_FOUND body so a foreign-id response and a
 * nonexistent-id response — which each echo their own requested id — can be
 * compared for structural identity. The only legitimate difference between the
 * two is the id the caller already supplied; anything else would be an
 * enumeration signal.
 */
const normalizeBody = (body: string, id: string): string => body.split(id).join("<REQUESTED_ID>");

describe("TrackedLink tenant isolation (CWE-639 IDOR)", { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  const suffix = Date.now();

  // Tenant A is the attacker; tenant B is the victim whose data must stay sealed.
  let accountAId: string;
  let accountBId: string;
  let projectAId: string;
  let linkAId: string; // owned by A — drives owner-success reads
  let linkBId: string; // owned by B — the cross-tenant target (must remain intact)
  let linkBShortCode: string; // B's public short code
  const linkBOriginalUrl = `https://example.com/victim-${suffix}`;
  const clickCountB = 2;

  before(async () => {
    prisma = createTestPrismaClient();

    const accountA = await prisma.account.create({
      data: { email: `idor-a-${suffix}@test.com`, name: "IDOR Tenant A" },
    });
    const accountB = await prisma.account.create({
      data: { email: `idor-b-${suffix}@test.com`, name: "IDOR Tenant B" },
    });
    accountAId = accountA.id;
    accountBId = accountB.id;

    const projectA = await prisma.project.create({
      data: { accountId: accountA.id, name: `IDOR Proj A ${suffix}` },
    });
    const projectB = await prisma.project.create({
      data: { accountId: accountB.id, name: `IDOR Proj B ${suffix}` },
    });
    projectAId = projectA.id;

    const linkA = await prisma.trackedLink.create({
      data: {
        projectId: projectA.id,
        originalUrl: `https://example.com/a-${suffix}`,
        shortCode: `ida-${suffix}`,
      },
    });
    linkAId = linkA.id;

    linkBShortCode = `idb-${suffix}`;
    const linkB = await prisma.trackedLink.create({
      data: {
        projectId: projectB.id,
        originalUrl: linkBOriginalUrl,
        shortCode: linkBShortCode,
      },
    });
    linkBId = linkB.id;

    for (let i = 0; i < clickCountB; i++) {
      await prisma.linkClick.create({
        data: { trackedLinkId: linkB.id, timestamp: new Date() },
      });
    }

    app = await createApp();
  });

  after(async () => {
    try {
      await app?.close();
    } catch {
      // ignore close errors during teardown
    }
    try {
      const links = await prisma.trackedLink.findMany({
        where: { project: { accountId: { in: [accountAId, accountBId] } } },
        select: { id: true },
      });
      const ids = links.map((l) => l.id);
      await prisma.linkClick.deleteMany({ where: { trackedLinkId: { in: ids } } });
      await prisma.trackedLink.deleteMany({ where: { id: { in: ids } } });
      await prisma.project.deleteMany({ where: { accountId: { in: [accountAId, accountBId] } } });
      await prisma.account.deleteMany({ where: { id: { in: [accountAId, accountBId] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("resolves the owner's own link on get, stats, and delete", async () => {
    const authA = bearerFor(accountAId);

    const getRes = await app.inject({
      method: "GET",
      url: `/links/${linkAId}`,
      headers: { authorization: authA },
    });
    assert.equal(getRes.statusCode, 200, "owner GET should succeed");
    const getBody = getRes.json();
    assert.equal(getBody.ok, true);
    assert.equal(getBody.data.id, linkAId);

    const statsRes = await app.inject({
      method: "GET",
      url: `/links/${linkAId}/stats`,
      headers: { authorization: authA },
    });
    assert.equal(statsRes.statusCode, 200, "owner GET stats should succeed");
    const statsBody = statsRes.json();
    assert.equal(statsBody.ok, true);
    assert.equal(statsBody.data.totalClicks, 0);

    // Dedicated deletable link owned by A so the shared fixture links survive.
    const deletable = await prisma.trackedLink.create({
      data: {
        projectId: projectAId,
        originalUrl: `https://example.com/del-${suffix}`,
        shortCode: `idd-${suffix}`,
      },
    });
    const delRes = await app.inject({
      method: "DELETE",
      url: `/links/${deletable.id}`,
      headers: { authorization: authA },
    });
    assert.equal(delRes.statusCode, 200, "owner DELETE should succeed");
    assert.equal(delRes.json().ok, true);
    const gone = await prisma.trackedLink.findUnique({ where: { id: deletable.id } });
    assert.equal(gone, null, "owner's link should be deleted");
  });

  it("returns 404 for a foreign-account link id on get, stats, and delete", async () => {
    const authA = bearerFor(accountAId);

    const getRes = await app.inject({
      method: "GET",
      url: `/links/${linkBId}`,
      headers: { authorization: authA },
    });
    assert.equal(getRes.statusCode, 404, "foreign GET must be 404");
    assert.equal(getRes.json().ok, false);

    const statsRes = await app.inject({
      method: "GET",
      url: `/links/${linkBId}/stats`,
      headers: { authorization: authA },
    });
    assert.equal(statsRes.statusCode, 404, "foreign GET stats must be 404");
    assert.equal(statsRes.json().ok, false);

    const delRes = await app.inject({
      method: "DELETE",
      url: `/links/${linkBId}`,
      headers: { authorization: authA },
    });
    assert.equal(delRes.statusCode, 404, "foreign DELETE must be 404");
    assert.equal(delRes.json().ok, false);
  });

  it("makes a foreign id indistinguishable from a nonexistent id (anti-enumeration)", async () => {
    const authA = bearerFor(accountAId);
    const absentId = randomUUID();

    const foreignGet = await app.inject({
      method: "GET",
      url: `/links/${linkBId}`,
      headers: { authorization: authA },
    });
    const absentGet = await app.inject({
      method: "GET",
      url: `/links/${absentId}`,
      headers: { authorization: authA },
    });
    assert.equal(foreignGet.statusCode, 404);
    assert.equal(foreignGet.statusCode, absentGet.statusCode, "same status for both");
    assert.equal(
      normalizeBody(foreignGet.body, linkBId),
      normalizeBody(absentGet.body, absentId),
      "foreign-id and nonexistent-id GET bodies must be identical modulo the echoed id"
    );

    const foreignDel = await app.inject({
      method: "DELETE",
      url: `/links/${linkBId}`,
      headers: { authorization: authA },
    });
    const absentDel = await app.inject({
      method: "DELETE",
      url: `/links/${absentId}`,
      headers: { authorization: authA },
    });
    assert.equal(foreignDel.statusCode, absentDel.statusCode, "same status for both DELETEs");
    assert.equal(
      normalizeBody(foreignDel.body, linkBId),
      normalizeBody(absentDel.body, absentId),
      "foreign-id and nonexistent-id DELETE bodies must be identical modulo the echoed id"
    );

    const foreignStats = await app.inject({
      method: "GET",
      url: `/links/${linkBId}/stats`,
      headers: { authorization: authA },
    });
    const absentStats = await app.inject({
      method: "GET",
      url: `/links/${absentId}/stats`,
      headers: { authorization: authA },
    });
    assert.equal(foreignStats.statusCode, absentStats.statusCode, "same status for both stats");
    assert.equal(
      normalizeBody(foreignStats.body, linkBId),
      normalizeBody(absentStats.body, absentId),
      "foreign-id and nonexistent-id stats bodies must be identical modulo the echoed id"
    );

    const foreignUtm = await app.inject({
      method: "GET",
      url: `/links/${linkBId}/utm-url`,
      headers: { authorization: authA },
    });
    const absentUtm = await app.inject({
      method: "GET",
      url: `/links/${absentId}/utm-url`,
      headers: { authorization: authA },
    });
    assert.equal(foreignUtm.statusCode, absentUtm.statusCode, "same status for both utm-url");
    assert.equal(
      normalizeBody(foreignUtm.body, linkBId),
      normalizeBody(absentUtm.body, absentId),
      "foreign-id and nonexistent-id utm-url bodies must be identical modulo the echoed id"
    );
  });

  it("does not remove tenant B's link or its click rows on a foreign DELETE", async () => {
    const authA = bearerFor(accountAId);

    const clicksBefore = await prisma.linkClick.count({ where: { trackedLinkId: linkBId } });
    assert.equal(clicksBefore, clickCountB, "victim clicks seeded");

    const delRes = await app.inject({
      method: "DELETE",
      url: `/links/${linkBId}`,
      headers: { authorization: authA },
    });
    assert.equal(delRes.statusCode, 404, "foreign DELETE must be 404");

    const stillThere = await prisma.trackedLink.findUnique({ where: { id: linkBId } });
    assert.ok(stillThere, "tenant B's link must still exist after a foreign DELETE");
    const clicksAfter = await prisma.linkClick.count({ where: { trackedLinkId: linkBId } });
    assert.equal(clicksAfter, clickCountB, "tenant B's click rows must be intact");
  });

  it("keeps the public redirect resolving B's link for an unauthenticated visitor", async () => {
    // No authorization header — the public short-code path must stay open.
    const res = await app.inject({ method: "GET", url: `/r/${linkBShortCode}` });
    assert.equal(res.statusCode, 302, "public redirect must still 302");
    assert.equal(res.headers.location, linkBOriginalUrl, "redirect target preserved");
  });

  it("also refuses a foreign link id on the UTM url endpoint (latent IDOR closed)", async () => {
    const authA = bearerFor(accountAId);

    const foreign = await app.inject({
      method: "GET",
      url: `/links/${linkBId}/utm-url`,
      headers: { authorization: authA },
    });
    assert.equal(foreign.statusCode, 404, "foreign UTM url must be 404");
    assert.equal(foreign.json().ok, false);

    const own = await app.inject({
      method: "GET",
      url: `/links/${linkAId}/utm-url`,
      headers: { authorization: authA },
    });
    assert.equal(own.statusCode, 200, "owner UTM url must resolve");
    assert.equal(own.json().ok, true);
  });

  it("refuses a foreign link id on the mutating UTM write-path without touching the row", async () => {
    const authA = bearerFor(accountAId);

    // Snapshot the victim row's mutable UTM fields BEFORE the attempted write.
    // `updatedAt` is deliberately excluded: the public redirect records clicks
    // fire-and-forget (`void recordClick`), so it can bump `updatedAt`/`clicks`
    // asynchronously between snapshots — noise unrelated to the UTM write-path.
    // The UTM fields are what the mutating path would change, so they are the
    // precise regression signal.
    const before = await prisma.trackedLink.findUnique({
      where: { id: linkBId },
      select: { utmSource: true, utmMedium: true, utmCampaign: true },
    });
    assert.ok(before, "victim link must exist before the write attempt");
    assert.equal(before.utmSource, null, "victim link starts with no UTM parameters");

    const res = await app.inject({
      method: "POST",
      url: `/links/${linkBId}/utm`,
      headers: { authorization: authA, "content-type": "application/json" },
      payload: { source: "attacker", medium: "email", campaign: "takeover" },
    });
    assert.equal(res.statusCode, 404, "foreign UTM write must be 404");
    assert.equal(res.json().ok, false);

    // The NOT_FOUND gate fires before setUTMParameters/save, so the row is untouched.
    const after = await prisma.trackedLink.findUnique({
      where: { id: linkBId },
      select: { utmSource: true, utmMedium: true, utmCampaign: true },
    });
    assert.equal(after?.utmSource, null, "victim link's utmSource must remain null");
    assert.deepEqual(
      after,
      before,
      "tenant B's UTM fields must be unchanged after a foreign UTM write"
    );
  });

  it("scopes getClickStats by construction so a foreign context reads no click data", async () => {
    // Repository-level proof: a plain test client (no tenant-guard extension) means
    // TrackedLink isolation rests ENTIRELY on the adapter's transitive project.accountId
    // join. Binding tenant A's context and asking for tenant B's stats must return the
    // empty result BEFORE any LinkClick row is read — a future direct caller of
    // getClickStats (e.g. a bulk-stats use case) cannot re-open the IDOR.
    const repository = new PrismaTrackedLinkRepository(prisma);
    const targetId = TrackedLinkId.fromStringUnsafe(linkBId);

    const foreignStats = await withTenantContext({ accountId: accountAId }, () =>
      repository.getClickStats(targetId)
    );
    assert.equal(
      foreignStats.totalClicks,
      0,
      "foreign getClickStats must not leak B's click total"
    );
    assert.deepEqual(
      foreignStats.clicksByCountry,
      {},
      "foreign getClickStats must not leak B's per-country breakdown"
    );

    // Same-account owner still reads the real click rows — scoping does not break
    // the owner. Assert via the row-derived per-country breakdown (LinkClick rows),
    // not the `clicks` counter, which the redirect increments fire-and-forget.
    const ownerStats = await withTenantContext({ accountId: accountBId }, () =>
      repository.getClickStats(targetId)
    );
    const ownerClickRows = Object.values(ownerStats.clicksByCountry).reduce(
      (sum, count) => sum + count,
      0
    );
    assert.ok(
      ownerClickRows >= clickCountB,
      "owner getClickStats returns the real per-country click rows"
    );
  });
});
