/**
 * @file shareOfVoice.test.ts
 * @description Integration tests for the brand-listening read side (the F1-API-1b
 *   DoD): Share of Voice computed from the normalized corpus across providers,
 *   the mention feed, and multi-tenant isolation. Runs against the real database.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { PrismaMentionQueryRepository } from "../../src/infrastructure/repositories/PrismaMentionQueryRepository.js";

describe("Share of Voice integration (read model over the corpus)", () => {
  let prisma: PrismaClient;
  let repo: PrismaMentionQueryRepository;
  let accountAId: string;
  let projectAId: string;
  let accountBId: string;
  let projectBId: string;
  const tag = `sov-int-${Date.now()}`;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const until = new Date(Date.now() + 60_000);
  const now = new Date();

  before(async () => {
    prisma = createTestPrismaClient();
    repo = new PrismaMentionQueryRepository(prisma);

    const accountA = await prisma.account.create({
      data: { email: `${tag}-a@test.com`, name: "SoV Account A" },
    });
    accountAId = accountA.id;
    const projectA = await prisma.project.create({
      data: { accountId: accountAId, name: `SoV Project A ${tag}` },
    });
    projectAId = projectA.id;

    const brandTerm = await prisma.trackedTerm.create({
      data: { accountId: accountAId, projectId: projectAId, term: "acme", kind: "BRAND" },
    });
    const marketTerm = await prisma.trackedTerm.create({
      data: { accountId: accountAId, projectId: projectAId, term: "rival", kind: "MARKET" },
    });

    const mk = (
      provider: "X" | "INSTAGRAM",
      externalId: string,
      source: "SEARCH" | "WEBHOOK",
      trackedTermId: string | null
    ) => ({
      accountId: accountAId,
      projectId: projectAId,
      provider,
      externalId: `${tag}-${externalId}`,
      source,
      ...(trackedTermId !== null && { trackedTermId }),
      authorName: "Author",
      authorProviderId: "u-1",
      body: "mention body",
      providerCreatedAt: now,
    });

    // Brand = 3 (2 via BRAND term on X, 1 via WEBHOOK on IG); Market = 2 (X + IG).
    await prisma.mention.createMany({
      data: [
        mk("X", "b1", "SEARCH", brandTerm.id),
        mk("X", "b2", "SEARCH", brandTerm.id),
        mk("INSTAGRAM", "b3", "WEBHOOK", null),
        mk("X", "m1", "SEARCH", marketTerm.id),
        mk("INSTAGRAM", "m2", "SEARCH", marketTerm.id),
      ],
    });

    // Second tenant — must never appear in account A's results.
    const accountB = await prisma.account.create({
      data: { email: `${tag}-b@test.com`, name: "SoV Account B" },
    });
    accountBId = accountB.id;
    const projectB = await prisma.project.create({
      data: { accountId: accountBId, name: `SoV Project B ${tag}` },
    });
    projectBId = projectB.id;
    await prisma.mention.create({
      data: {
        accountId: accountBId,
        projectId: projectBId,
        provider: "X",
        externalId: `${tag}-tenantB`,
        source: "SEARCH",
        authorName: "Other",
        authorProviderId: "u-b",
        body: "other tenant",
        providerCreatedAt: now,
      },
    });
  });

  after(async () => {
    await prisma.mention.deleteMany({ where: { accountId: { in: [accountAId, accountBId] } } });
    await prisma.trackedTerm.deleteMany({ where: { accountId: accountAId } });
    await prisma.project.deleteMany({ where: { accountId: { in: [accountAId, accountBId] } } });
    await prisma.account.deleteMany({ where: { id: { in: [accountAId, accountBId] } } });
  });

  it("computes SoV = brand/market from the normalized corpus", async () => {
    const dto = await repo.getShareOfVoice({
      accountId: accountAId,
      projectId: projectAId,
      since,
      until,
    });

    assert.strictEqual(dto.totalCount, 5);
    assert.strictEqual(dto.brandCount, 3, "2 BRAND-term + 1 WEBHOOK own-brand");
    assert.strictEqual(dto.marketCount, 2);
    assert.strictEqual(dto.sov, 1.5);
  });

  it("breaks SoV down per provider consistently across platforms", async () => {
    const dto = await repo.getShareOfVoice({
      accountId: accountAId,
      projectId: projectAId,
      since,
      until,
    });

    const x = dto.byProvider.find((p) => p.provider === "X");
    const ig = dto.byProvider.find((p) => p.provider === "INSTAGRAM");
    assert.deepStrictEqual(x, {
      provider: "X",
      brandCount: 2,
      marketCount: 1,
      totalCount: 3,
      sov: 2,
    });
    assert.deepStrictEqual(ig, {
      provider: "INSTAGRAM",
      brandCount: 1,
      marketCount: 1,
      totalCount: 2,
      sov: 1,
    });
  });

  it("does not count another tenant's mentions", async () => {
    const dto = await repo.getShareOfVoice({
      accountId: accountAId,
      projectId: projectAId,
      since,
      until,
    });
    assert.strictEqual(dto.totalCount, 5, "account B's mention must be excluded");
  });

  it("lists mentions for the project and filters by tracked-term kind", async () => {
    const all = await repo.listMentions(
      { accountId: accountAId, projectId: projectAId },
      { limit: 50 }
    );
    assert.strictEqual(all.items.length, 5);

    const market = await repo.listMentions(
      { accountId: accountAId, projectId: projectAId, kind: "MARKET" },
      { limit: 50 }
    );
    assert.strictEqual(market.items.length, 2);
    assert.ok(market.items.every((m) => m.trackedTermKind === "MARKET"));
  });
});
