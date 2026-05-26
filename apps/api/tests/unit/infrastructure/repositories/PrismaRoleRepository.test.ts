/**
 * @file PrismaRoleRepository.test.ts
 * @description Unit tests for the Prisma adapter of the RoleRepository port. The
 *              Prisma client is stubbed with vi-mocked role.findUnique/findMany to
 *              assert row → DTO mapping (permission names, user counts) and the
 *              null/empty results for absent roles.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaRoleRepository } from "../../../../src/infrastructure/repositories/PrismaRoleRepository.js";

interface MockPrisma {
  role: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): MockPrisma {
  return {
    role: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

const roleRow = {
  id: "role-admin",
  name: "ADMIN",
  description: "Admin",
  level: 5,
  isSystem: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("PrismaRoleRepository", () => {
  let prisma: MockPrisma;
  let repo: PrismaRoleRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaRoleRepository(prisma as never);
  });

  it("findByName maps the row to a RoleDto", async () => {
    prisma.role.findUnique.mockResolvedValue(roleRow);
    const role = await repo.findByName("ADMIN");
    expect(role).toEqual({
      id: "role-admin",
      name: "ADMIN",
      description: "Admin",
      level: 5,
      isSystem: true,
      isActive: true,
    });
  });

  it("findByName returns null when the role is absent", async () => {
    prisma.role.findUnique.mockResolvedValue(null);
    expect(await repo.findByName("NOPE")).toBeNull();
  });

  it("findPermissionNamesByName returns the permission name strings", async () => {
    prisma.role.findUnique.mockResolvedValue({
      ...roleRow,
      permissions: [{ permission: "POSTS_READ" }, { permission: "POSTS_WRITE" }],
    });
    expect(await repo.findPermissionNamesByName("ADMIN")).toEqual(["POSTS_READ", "POSTS_WRITE"]);
  });

  it("findPermissionNamesByName returns [] when the role is absent", async () => {
    prisma.role.findUnique.mockResolvedValue(null);
    expect(await repo.findPermissionNamesByName("NOPE")).toEqual([]);
  });

  it("findInfoByName maps permissions and user count", async () => {
    prisma.role.findUnique.mockResolvedValue({
      ...roleRow,
      permissions: [{ permission: "POSTS_READ" }],
      _count: { users: 7 },
    });
    const info = await repo.findInfoByName("ADMIN");
    expect(info?.permissions).toEqual(["POSTS_READ"]);
    expect(info?.userCount).toBe(7);
  });

  it("findInfoByName returns null when the role is absent", async () => {
    prisma.role.findUnique.mockResolvedValue(null);
    expect(await repo.findInfoByName("NOPE")).toBeNull();
  });

  it("findAllActiveInfo maps rows and queries active roles by level desc", async () => {
    prisma.role.findMany.mockResolvedValue([
      { ...roleRow, permissions: [{ permission: "ALL" }], _count: { users: 1 } },
    ]);
    const roles = await repo.findAllActiveInfo();
    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, orderBy: { level: "desc" } })
    );
    expect(roles[0]?.permissions).toEqual(["ALL"]);
    expect(roles[0]?.userCount).toBe(1);
  });
});
