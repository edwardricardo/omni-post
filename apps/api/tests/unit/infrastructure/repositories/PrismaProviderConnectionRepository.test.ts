/**
 * @file PrismaProviderConnectionRepository.test.ts
 * @description Unit tests for the bulk-disable adapter. Mocks Prisma to verify
 *              the query shape (findMany + updateMany) and the no-op short-
 *              circuit when zero rows match.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { PrismaProviderConnectionRepository } from "../../../../src/infrastructure/repositories/PrismaProviderConnectionRepository.js";

function makePrismaStub(behaviors: { findManyResult?: { id: string }[] } = {}) {
  const findMany = vi.fn(async () => behaviors.findManyResult ?? []);
  const updateMany = vi.fn(async () => ({ count: behaviors.findManyResult?.length ?? 0 }));
  return {
    prisma: {
      providerConnection: { findMany, updateMany },
    } as unknown as Parameters<typeof PrismaProviderConnectionRepository.prototype.constructor>[0],
    findMany,
    updateMany,
  };
}

describe("PrismaProviderConnectionRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 + empty ids when no active rows exist (no updateMany call)", async () => {
    const stub = makePrismaStub({ findManyResult: [] });
    const repo = new PrismaProviderConnectionRepository(stub.prisma);
    const result = await repo.bulkDisableByProvider("FACEBOOK");
    assert.equal(result.count, 0);
    assert.deepEqual(result.connectionIds, []);
    assert.equal(stub.updateMany.mock.calls.length, 0);
  });

  it("filters by providerId + isActive=true on findMany", async () => {
    const stub = makePrismaStub({ findManyResult: [{ id: "pc1" }] });
    const repo = new PrismaProviderConnectionRepository(stub.prisma);
    await repo.bulkDisableByProvider("FACEBOOK");
    const where = (stub.findMany.mock.calls[0]?.[0] as Record<string, unknown>).where;
    assert.deepEqual(where, { providerId: "FACEBOOK", isActive: true });
  });

  it("updateMany sets isActive=false + updatedAt for the affected ids", async () => {
    const stub = makePrismaStub({ findManyResult: [{ id: "pc1" }, { id: "pc2" }] });
    const repo = new PrismaProviderConnectionRepository(stub.prisma);
    const result = await repo.bulkDisableByProvider("FACEBOOK");
    assert.equal(result.count, 2);
    assert.deepEqual(result.connectionIds, ["pc1", "pc2"]);
    const args = stub.updateMany.mock.calls[0]?.[0] as Record<string, unknown>;
    assert.deepEqual(args.where, { id: { in: ["pc1", "pc2"] } });
    const data = args.data as Record<string, unknown>;
    assert.equal(data.isActive, false);
    assert.ok(data.updatedAt instanceof Date);
  });
});
