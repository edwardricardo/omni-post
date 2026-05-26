/**
 * @file PrismaAdminUserRepository.test.ts
 * @description Unit tests for the Prisma adapter of the AdminUserRepository port.
 *              Locks in the credential-separation contract: the public reads
 *              (findById/findByEmail/findActiveUser/findManyByIds/findByRoleId/
 *              create/update) return objects with NO credential columns, while
 *              findCredentialsById/findCredentialsByEmail return them.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

const { PrismaAdminUserRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaAdminUserRepository.js");

const CREDENTIAL_KEYS = [
  "passwordHash",
  "passwordResetToken",
  "passwordResetExpires",
  "mfaSecret",
  "passwordHistory",
  "mfaBackupCodes",
  "mfaBackupUsedAt",
] as const;

function makeRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    id: "u-1",
    email: "admin@example.com",
    passwordHash: "argon2-hash",
    name: "Admin",
    roleId: "role-admin",
    role: { id: "role-admin", name: "ADMIN" },
    isActive: true,
    emailVerified: true,
    lastLoginAt: null,
    passwordResetToken: "reset-token",
    passwordResetExpires: now,
    mfaEnabled: true,
    mfaSecret: "totp-secret",
    passwordHashAlgo: "argon2id",
    passwordChangedAt: now,
    passwordHistory: ["old-hash"],
    mustChangePassword: false,
    mfaBackupCodes: ["code-hash"],
    mfaBackupUsedAt: {},
    failedLoginAttempts: 0,
    lockedUntil: null,
    lockReason: null,
    maxConcurrentSessions: 5,
    timezone: null,
    locale: null,
    department: null,
    team: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface MockPrisma {
  adminUser: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): MockPrisma {
  return {
    adminUser: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaAdminUserRepository credential separation", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaAdminUserRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaAdminUserRepository(prisma as never);
  });

  it("findById returns a public DTO with NO credential columns", async () => {
    prisma.adminUser.findUnique.mockResolvedValue(makeRow());
    const result = await repo.findById("u-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.role).toBe("ADMIN");
      expect(result.value.email).toBe("admin@example.com");
      for (const key of CREDENTIAL_KEYS) {
        expect(key in result.value).toBe(false);
      }
    }
  });

  it("findByEmail returns a public DTO with NO credential columns", async () => {
    prisma.adminUser.findUnique.mockResolvedValue(makeRow());
    const result = await repo.findByEmail("Admin@Example.com");
    expect(prisma.adminUser.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "admin@example.com" } })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const key of CREDENTIAL_KEYS) expect(key in result.value).toBe(false);
    }
  });

  it("findActiveUser strips credentials and enforces active status", async () => {
    prisma.adminUser.findUnique.mockResolvedValue(makeRow({ isActive: false }));
    const inactive = await repo.findActiveUser("u-1");
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) expect(inactive.error).toBe("USER_INACTIVE");

    prisma.adminUser.findUnique.mockResolvedValue(makeRow());
    const active = await repo.findActiveUser("u-1");
    expect(active.ok).toBe(true);
    if (active.ok) {
      for (const key of CREDENTIAL_KEYS) expect(key in active.value).toBe(false);
    }
  });

  it("findManyByIds and findByRoleId strip credentials", async () => {
    prisma.adminUser.findMany.mockResolvedValue([makeRow(), makeRow({ id: "u-2" })]);
    const many = await repo.findManyByIds(["u-1", "u-2"]);
    expect(many).toHaveLength(2);
    for (const dto of many) {
      for (const key of CREDENTIAL_KEYS) expect(key in dto).toBe(false);
    }

    prisma.adminUser.findMany.mockResolvedValue([makeRow()]);
    const byRole = await repo.findByRoleId("role-admin");
    for (const key of CREDENTIAL_KEYS) expect(key in (byRole[0] ?? {})).toBe(false);
  });

  it("findCredentialsById returns the DTO WITH credential columns", async () => {
    prisma.adminUser.findUnique.mockResolvedValue(makeRow());
    const result = await repo.findCredentialsById("u-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.passwordHash).toBe("argon2-hash");
      expect(result.value.mfaSecret).toBe("totp-secret");
      expect(result.value.passwordResetToken).toBe("reset-token");
      expect(result.value.role).toBe("ADMIN");
    }
  });

  it("findCredentialsByEmail lowercases the email and returns credentials", async () => {
    prisma.adminUser.findUnique.mockResolvedValue(makeRow());
    const result = await repo.findCredentialsByEmail("Admin@Example.com");
    expect(prisma.adminUser.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "admin@example.com" } })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.passwordHash).toBe("argon2-hash");
  });

  it("findCredentialsById returns NOT_FOUND when absent", async () => {
    prisma.adminUser.findUnique.mockResolvedValue(null);
    const result = await repo.findCredentialsById("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("create returns a public DTO with NO credential columns", async () => {
    prisma.adminUser.create.mockResolvedValue(makeRow());
    const dto = await repo.create({
      email: "admin@example.com",
      passwordHash: "argon2-hash",
      name: "Admin",
      roleId: "role-admin",
      emailVerified: true,
    });
    for (const key of CREDENTIAL_KEYS) expect(key in dto).toBe(false);
    expect(dto.role).toBe("ADMIN");
  });

  it("update returns a public DTO and clears mfaSecret via null", async () => {
    prisma.adminUser.update.mockResolvedValue(makeRow({ mfaSecret: null }));
    const dto = await repo.update("u-1", { mfaEnabled: false, mfaSecret: null });
    const data = prisma.adminUser.update.mock.calls[0]?.[0]?.data;
    expect(data.mfaEnabled).toBe(false);
    expect(data.mfaSecret).toBeNull();
    for (const key of CREDENTIAL_KEYS) expect(key in dto).toBe(false);
  });
});
