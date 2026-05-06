/**
 * @file SecretRotationLogPrismaReadRepository.test.ts
 * @description Unit tests for the read-side Prisma repository. Mocks the Prisma
 *              client to verify query shape and most-recent-per-name reduction.
 *              Real-DB coverage lives in the integration test for the route.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { SecretRotationLogPrismaReadRepository } from "../../../../src/infrastructure/security/SecretRotationLogPrismaReadRepository.js";

interface PrismaRow {
  secretName: string;
  rotatedAt: Date;
  rotatedBy: string | null;
}

function makePrismaStub(rows: PrismaRow[]) {
  return {
    secretRotationLog: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  };
}

describe("SecretRotationLogPrismaReadRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty Map when names list is empty (no DB call)", async () => {
    const prismaStub = makePrismaStub([]);
    const repo = new SecretRotationLogPrismaReadRepository(
      prismaStub as unknown as Parameters<
        typeof SecretRotationLogPrismaReadRepository.prototype.constructor
      >[0]
    );
    const result = await repo.findLatestBySecretNames([]);
    assert.equal(result.size, 0);
    assert.equal(prismaStub.secretRotationLog.findMany.mock.calls.length, 0);
  });

  it("queries Prisma with `in` filter on secretName", async () => {
    const prismaStub = makePrismaStub([]);
    const repo = new SecretRotationLogPrismaReadRepository(
      prismaStub as unknown as Parameters<
        typeof SecretRotationLogPrismaReadRepository.prototype.constructor
      >[0]
    );
    await repo.findLatestBySecretNames(["JWT_ACCESS_SECRET", "COOKIE_SECRET"]);
    const call = prismaStub.secretRotationLog.findMany.mock.calls[0]?.[0];
    assert.deepEqual(call.where, { secretName: { in: ["JWT_ACCESS_SECRET", "COOKIE_SECRET"] } });
  });

  it("orders by secretName asc, rotatedAt desc to leverage composite index", async () => {
    const prismaStub = makePrismaStub([]);
    const repo = new SecretRotationLogPrismaReadRepository(
      prismaStub as unknown as Parameters<
        typeof SecretRotationLogPrismaReadRepository.prototype.constructor
      >[0]
    );
    await repo.findLatestBySecretNames(["JWT_ACCESS_SECRET"]);
    const call = prismaStub.secretRotationLog.findMany.mock.calls[0]?.[0];
    assert.deepEqual(call.orderBy, [{ secretName: "asc" }, { rotatedAt: "desc" }]);
  });

  it("keeps only the most recent rotation per secret name", async () => {
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-04-21T00:00:00.000Z");
    const prismaStub = makePrismaStub([
      // Already ordered by Prisma (secretName asc, rotatedAt desc)
      { secretName: "JWT_ACCESS_SECRET", rotatedAt: newer, rotatedBy: "admin-1" },
      { secretName: "JWT_ACCESS_SECRET", rotatedAt: older, rotatedBy: "admin-0" },
    ]);
    const repo = new SecretRotationLogPrismaReadRepository(
      prismaStub as unknown as Parameters<
        typeof SecretRotationLogPrismaReadRepository.prototype.constructor
      >[0]
    );
    const result = await repo.findLatestBySecretNames(["JWT_ACCESS_SECRET"]);
    const entry = result.get("JWT_ACCESS_SECRET");
    assert.ok(entry);
    assert.equal(entry.rotatedAt.toISOString(), newer.toISOString());
    assert.equal(entry.rotatedBy, "admin-1");
  });

  it("returns Map keyed by secretName with rotatedAt + rotatedBy", async () => {
    const date = new Date("2026-04-21T00:00:00.000Z");
    const prismaStub = makePrismaStub([
      { secretName: "JWT_ACCESS_SECRET", rotatedAt: date, rotatedBy: null },
      { secretName: "COOKIE_SECRET", rotatedAt: date, rotatedBy: "system" },
    ]);
    const repo = new SecretRotationLogPrismaReadRepository(
      prismaStub as unknown as Parameters<
        typeof SecretRotationLogPrismaReadRepository.prototype.constructor
      >[0]
    );
    const result = await repo.findLatestBySecretNames(["JWT_ACCESS_SECRET", "COOKIE_SECRET"]);
    assert.equal(result.size, 2);
    assert.equal(result.get("COOKIE_SECRET")?.rotatedBy, "system");
    assert.equal(result.get("JWT_ACCESS_SECRET")?.rotatedBy, null);
  });

  it("omits secrets with no rows from the result Map", async () => {
    const date = new Date("2026-04-21T00:00:00.000Z");
    const prismaStub = makePrismaStub([
      { secretName: "JWT_ACCESS_SECRET", rotatedAt: date, rotatedBy: null },
    ]);
    const repo = new SecretRotationLogPrismaReadRepository(
      prismaStub as unknown as Parameters<
        typeof SecretRotationLogPrismaReadRepository.prototype.constructor
      >[0]
    );
    const result = await repo.findLatestBySecretNames(["JWT_ACCESS_SECRET", "COOKIE_SECRET"]);
    assert.ok(result.has("JWT_ACCESS_SECRET"));
    assert.ok(!result.has("COOKIE_SECRET"));
  });
});
