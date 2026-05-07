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

function makePrismaStub(behaviors: { updateResult?: { id: string }[] } = {}) {
  const updateManyAndReturn = vi.fn(async () => behaviors.updateResult ?? []);
  return {
    prisma: {
      providerConnection: { updateManyAndReturn },
    } as unknown as Parameters<typeof PrismaProviderConnectionRepository.prototype.constructor>[0],
    updateManyAndReturn,
  };
}

describe("PrismaProviderConnectionRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 + empty ids when no rows match (single updateManyAndReturn call)", async () => {
    const stub = makePrismaStub({ updateResult: [] });
    const repo = new PrismaProviderConnectionRepository(stub.prisma);
    const result = await repo.bulkDisableByProvider("FACEBOOK");
    assert.equal(result.count, 0);
    assert.deepEqual(result.connectionIds, []);
    assert.equal(stub.updateManyAndReturn.mock.calls.length, 1);
  });

  it("filters by providerId + isActive=true on updateManyAndReturn", async () => {
    const stub = makePrismaStub({ updateResult: [{ id: "pc1" }] });
    const repo = new PrismaProviderConnectionRepository(stub.prisma);
    await repo.bulkDisableByProvider("FACEBOOK");
    const where = (stub.updateManyAndReturn.mock.calls[0]?.[0] as Record<string, unknown>).where;
    assert.deepEqual(where, { providerId: "FACEBOOK", isActive: true });
  });

  it("sets isActive=false + updatedAt + select narrowed to id (canon: prisma-updatemanyandreturn-bulk-ops-returning)", async () => {
    const stub = makePrismaStub({ updateResult: [{ id: "pc1" }, { id: "pc2" }] });
    const repo = new PrismaProviderConnectionRepository(stub.prisma);
    const result = await repo.bulkDisableByProvider("FACEBOOK");
    assert.equal(result.count, 2);
    assert.deepEqual(result.connectionIds, ["pc1", "pc2"]);
    const args = stub.updateManyAndReturn.mock.calls[0]?.[0] as Record<string, unknown>;
    const data = args.data as Record<string, unknown>;
    assert.equal(data.isActive, false);
    assert.ok(data.updatedAt instanceof Date);
    assert.deepEqual(args.select, { id: true });
  });
});
