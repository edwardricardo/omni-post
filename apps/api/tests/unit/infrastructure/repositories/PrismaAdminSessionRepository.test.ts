/**
 * @file PrismaAdminSessionRepository.test.ts
 * @description Unit tests for the Prisma adapter of the AdminSessionRepository
 *              port. The Prisma client is stubbed with vi-mocked adminSession
 *              methods to assert create payload (optional ipAddress/userAgent),
 *              refresh-token rotation, listing filters, and bulk revoke/delete.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

const { PrismaAdminSessionRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaAdminSessionRepository.js");

interface MockPrisma {
  adminSession: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): MockPrisma {
  return {
    adminSession: {
      create: vi.fn().mockResolvedValue({ id: "sess-1" }),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

const expiresAt = new Date("2026-01-01T00:00:00Z");

describe("PrismaAdminSessionRepository", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaAdminSessionRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaAdminSessionRepository(prisma as never);
  });

  it("create omits ipAddress/userAgent when not provided", async () => {
    await repo.create({ userId: "u-1", refreshTokenHash: "h1", expiresAt });
    const data = prisma.adminSession.create.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({ userId: "u-1", refreshTokenHash: "h1", expiresAt });
    expect("ipAddress" in data).toBe(false);
    expect("userAgent" in data).toBe(false);
  });

  it("create includes ipAddress/userAgent when provided (incl. empty string)", async () => {
    await repo.create({
      userId: "u-1",
      refreshTokenHash: "h1",
      ipAddress: "",
      userAgent: "agent",
      expiresAt,
    });
    const data = prisma.adminSession.create.mock.calls[0]?.[0]?.data;
    expect(data.ipAddress).toBe("");
    expect(data.userAgent).toBe("agent");
  });

  it("create returns the persisted row", async () => {
    prisma.adminSession.create.mockResolvedValue({ id: "sess-9", userId: "u-1" });
    const row = await repo.create({ userId: "u-1", refreshTokenHash: "h1", expiresAt });
    expect(row.id).toBe("sess-9");
  });

  it("updateRefreshTokenHash rotates the hash by session id", async () => {
    await repo.updateRefreshTokenHash("sess-1", "h2");
    expect(prisma.adminSession.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: { refreshTokenHash: "h2" },
    });
  });

  it("findByUserId lists newest first without active filter by default", async () => {
    await repo.findByUserId("u-1");
    expect(prisma.adminSession.findMany).toHaveBeenCalledWith({
      where: { userId: "u-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findByUserId applies activeOnly and limit", async () => {
    await repo.findByUserId("u-1", { activeOnly: true, limit: 1 });
    expect(prisma.adminSession.findMany).toHaveBeenCalledWith({
      where: { userId: "u-1", isActive: true },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
  });

  it("revokeAllForUser deactivates active sessions and returns the count", async () => {
    prisma.adminSession.updateMany.mockResolvedValue({ count: 3 });
    const count = await repo.revokeAllForUser("u-1");
    expect(prisma.adminSession.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-1", isActive: true },
      data: { isActive: false, revokedAt: expect.any(Date) },
    });
    expect(count).toBe(3);
  });

  it("deleteAllForUser removes the user's sessions and returns the count", async () => {
    prisma.adminSession.deleteMany.mockResolvedValue({ count: 2 });
    const count = await repo.deleteAllForUser("u-1");
    expect(prisma.adminSession.deleteMany).toHaveBeenCalledWith({ where: { userId: "u-1" } });
    expect(count).toBe(2);
  });
});
