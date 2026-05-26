/**
 * @file mentionIngest.test.ts
 * @description Integration tests for the brand-mention listening corpus. Validates
 *   the DoD's "idempotente; menciones aterrizan normalizadas" against a real
 *   database: a normalized mention persists with nullable enrichment fields, and
 *   the (provider, externalId) unique constraint plus the worker's
 *   findFirst-then-create dedup pattern both yield exactly one row.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";

describe("Mention listening corpus integration (idempotency)", () => {
  let prisma: PrismaClient;
  let accountId: string;
  let projectId: string;
  const tag = `mention-int-${Date.now()}`;

  before(async () => {
    prisma = createTestPrismaClient();
    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Mention Integration Account" },
    });
    accountId = account.id;
    const project = await prisma.project.create({
      data: { accountId, name: `Mention Project ${tag}` },
    });
    projectId = project.id;
  });

  after(async () => {
    await prisma.mention.deleteMany({ where: { accountId } });
    await prisma.trackedTerm.deleteMany({ where: { accountId } });
    await prisma.project.deleteMany({ where: { accountId } });
    await prisma.account.deleteMany({ where: { id: accountId } });
  });

  const makeMention = (externalId: string) => ({
    accountId,
    projectId,
    provider: "X" as const,
    externalId,
    source: "SEARCH" as const,
    authorName: "Fan",
    authorProviderId: "u-1",
    body: "loving acme",
    providerCreatedAt: new Date(),
  });

  it("persists a normalized mention with nullable enrichment fields", async () => {
    const created = await prisma.mention.create({ data: makeMention(`${tag}-e1`) });

    assert.ok(created.id, "mention should be created");
    assert.strictEqual(created.source, "SEARCH");
    assert.strictEqual(created.sentimentScore, null, "sentiment is enriched later, not at ingest");
    assert.strictEqual(created.sentimentLabel, null);
    assert.strictEqual(created.trackedTermId, null);
  });

  it("rejects a duplicate (provider, externalId) — the idempotency backstop", async () => {
    await prisma.mention.create({ data: makeMention(`${tag}-e2`) });

    await assert.rejects(
      () => prisma.mention.create({ data: makeMention(`${tag}-e2`) }),
      (err: unknown) => (err as { code?: string }).code === "P2002",
      "second insert with the same (provider, externalId) must violate the unique constraint"
    );

    const rows = await prisma.mention.findMany({
      where: { provider: "X", externalId: `${tag}-e2` },
    });
    assert.strictEqual(rows.length, 1);
  });

  it("findFirst-then-create dedup (worker pattern) yields a single row", async () => {
    const externalId = `${tag}-e3`;
    const ingestOnce = async (): Promise<"created" | "skipped"> => {
      const existing = await prisma.mention.findFirst({
        where: { provider: "X", externalId },
        select: { id: true },
      });
      if (existing) {
        return "skipped";
      }
      await prisma.mention.create({ data: makeMention(externalId) });
      return "created";
    };

    assert.strictEqual(await ingestOnce(), "created");
    assert.strictEqual(await ingestOnce(), "skipped");

    const rows = await prisma.mention.findMany({ where: { provider: "X", externalId } });
    assert.strictEqual(rows.length, 1);
  });

  it("stores tracked-term attribution + sentiment when later enriched", async () => {
    const term = await prisma.trackedTerm.create({
      data: { accountId, projectId, term: "acme", kind: "BRAND" },
    });

    const mention = await prisma.mention.create({
      data: { ...makeMention(`${tag}-e4`), trackedTermId: term.id },
    });
    assert.strictEqual(mention.trackedTermId, term.id);

    const enriched = await prisma.mention.update({
      where: { id: mention.id },
      data: { sentimentScore: 0.8, sentimentLabel: "POSITIVE" },
    });
    assert.strictEqual(Number(enriched.sentimentScore), 0.8);
    assert.strictEqual(enriched.sentimentLabel, "POSITIVE");
  });
});
