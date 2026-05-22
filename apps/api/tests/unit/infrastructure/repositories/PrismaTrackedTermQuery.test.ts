/**
 * @file PrismaTrackedTermQuery.test.ts
 * @description Unit tests for PrismaTrackedTermQuery — verifies it queries only
 *   active terms on non-deleted projects, scopes by account when given, and maps
 *   rows to the TrackedTermForSearch shape. Prisma is mocked (no DB).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { PrismaTrackedTermQuery } from "../../../../src/infrastructure/repositories/PrismaTrackedTermQuery.js";
import type { PrismaClient } from "@infra/prisma";

function makeMockPrisma(
  rows: Array<{
    id: string;
    accountId: string;
    projectId: string;
    term: string;
    kind: "BRAND" | "MARKET";
  }> = [
    { id: "t-1", accountId: "acc-1", projectId: "proj-1", term: "acme", kind: "BRAND" },
    { id: "t-2", accountId: "acc-1", projectId: "proj-1", term: "rival", kind: "MARKET" },
  ]
) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const prisma = { trackedTerm: { findMany } } as unknown as PrismaClient;
  return { prisma, findMany };
}

describe("PrismaTrackedTermQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps rows to the TrackedTermForSearch shape", async () => {
    const { prisma } = makeMockPrisma();
    const query = new PrismaTrackedTermQuery(prisma);

    const result = await query.findActiveTerms();

    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result[0], {
      id: "t-1",
      accountId: "acc-1",
      projectId: "proj-1",
      term: "acme",
      kind: "BRAND",
    });
  });

  it("queries only active terms on non-deleted projects", async () => {
    const { prisma, findMany } = makeMockPrisma();
    const query = new PrismaTrackedTermQuery(prisma);

    await query.findActiveTerms();

    const args = findMany.mock.calls[0]?.[0] as {
      where: { isActive: boolean; project: { deletedAt: null; accountId?: string } };
    };
    assert.strictEqual(args.where.isActive, true);
    assert.strictEqual(args.where.project.deletedAt, null);
    assert.strictEqual(args.where.project.accountId, undefined);
  });

  it("scopes by accountId when provided", async () => {
    const { prisma, findMany } = makeMockPrisma();
    const query = new PrismaTrackedTermQuery(prisma);

    await query.findActiveTerms("acc-42");

    const args = findMany.mock.calls[0]?.[0] as {
      where: { project: { accountId?: string } };
    };
    assert.strictEqual(args.where.project.accountId, "acc-42");
  });

  it("returns an empty array when no terms match", async () => {
    const { prisma } = makeMockPrisma([]);
    const query = new PrismaTrackedTermQuery(prisma);

    const result = await query.findActiveTerms("acc-none");

    assert.deepStrictEqual(result, []);
  });
});
