/**
 * @file PrismaAdminUserRepository.test.ts
 * @description Unit tests for the Prisma adapter of the AdminUserRepository port.
 *              Locks in the credential-separation contract: the public reads
 *              (findById/findByEmail/findActiveUser/findManyByIds/findByRoleId/
 *              create/update) return objects with NO credential columns, while
 *              findCredentialsById/findCredentialsByEmail return them. Also pins
 *              the query that says whether any administrator exists, the
 *              `mustChangePassword` write of `create`, the guarded
 *              replacement of a single-use password, and that each runs on
 *              the Unit of Work's transaction client when one is open.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import { RepositoryFailureError, REPOSITORY_FAILURE_CODE } from "@core/domain";

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

/**
 * The delegate methods of `adminUser` that the existence query, `create` and the guarded
 * replacement of a single-use password call.
 */
interface AdminUserClientDouble {
  adminUser: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
}

/** A client double whose delegate methods record their calls and resolve nothing by default. */
function makeAdminUserClient(): AdminUserClientDouble {
  return { adminUser: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() } };
}

/**
 * A base client whose `$transaction` hands its callback a second double, as Prisma hands an
 * interactive transaction its own client: a call that lands on `tx` ran inside the transaction.
 */
function makeTransactionalClients() {
  const tx = makeAdminUserClient();
  const base = {
    ...makeAdminUserClient(),
    $transaction: vi.fn(async (work: (client: AdminUserClientDouble) => Promise<unknown>) =>
      work(tx)
    ),
  };
  return { base, tx };
}

/** A tenant provider that reports no context, so the Unit of Work binds no GUC. */
const NO_TENANT: ConstructorParameters<typeof PrismaUnitOfWork>[1] = {
  getTenantContext: () => undefined,
  getSystemContext: () => undefined,
};

/** The fields every creation in this suite gives; each case adds what it is about. */
const CREATE_INPUT = {
  email: "First.Admin@Example.com",
  passwordHash: "argon2-hash",
  name: "First.Admin",
  roleId: "role-super-admin",
} as const;

describe("PrismaAdminUserRepository existsAny", () => {
  let clients: ReturnType<typeof makeTransactionalClients>;
  let repo: InstanceType<typeof PrismaAdminUserRepository>;

  beforeEach(() => {
    clients = makeTransactionalClients();
    repo = new PrismaAdminUserRepository(clients.base as never);
  });

  it("returns false when no administrator row exists, from a query that filters on nothing", async () => {
    clients.base.adminUser.findFirst.mockResolvedValue(null);

    const result = await repo.existsAny();

    expect(result).toEqual({ ok: true, value: false });
    expect(clients.base.adminUser.findFirst).toHaveBeenCalledTimes(1);
    expect(clients.base.adminUser.findFirst.mock.calls[0]).toStrictEqual([
      { select: { id: true } },
    ]);
  });

  it("returns true when an administrator row exists", async () => {
    clients.base.adminUser.findFirst.mockResolvedValue({ id: "u-1" });

    const result = await repo.existsAny();

    expect(result).toEqual({ ok: true, value: true });
    expect(clients.base.adminUser.findFirst).toHaveBeenCalledTimes(1);
  });

  it("returns the answer of the transaction's client when called inside an open unit of work", async () => {
    clients.tx.adminUser.findFirst.mockResolvedValue({ id: "u-1" });
    clients.base.adminUser.findFirst.mockResolvedValue(null);
    const uow = new PrismaUnitOfWork(clients.base as never, NO_TENANT);

    const result = await uow.executeInTransaction(() => repo.existsAny());

    expect(result).toEqual({ ok: true, value: true });
    expect(clients.base.$transaction).toHaveBeenCalledTimes(1);
    expect(clients.tx.adminUser.findFirst).toHaveBeenCalledTimes(1);
    expect(clients.base.adminUser.findFirst).not.toHaveBeenCalled();
  });

  it("returns the answer of the base client when no unit of work is open", async () => {
    clients.base.adminUser.findFirst.mockResolvedValue(null);

    const result = await repo.existsAny();

    expect(result).toEqual({ ok: true, value: false });
    expect(clients.base.$transaction).not.toHaveBeenCalled();
    expect(clients.tx.adminUser.findFirst).not.toHaveBeenCalled();
  });

  it("returns a RepositoryFailureError whose cause is the client's own error when the client fails", async () => {
    const raised = Object.assign(new Error("Can't reach database server at db:5432"), {
      code: "P1001",
    });
    clients.base.adminUser.findFirst.mockRejectedValue(raised);

    const result = await repo.existsAny();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(RepositoryFailureError);
    expect(result.error.code).toBe(REPOSITORY_FAILURE_CODE);
    expect(result.error.cause).toBe(raised);
    expect(result.error.message).toBe("Reading whether an admin user exists failed");
  });
});

describe("PrismaAdminUserRepository create and mustChangePassword", () => {
  let clients: ReturnType<typeof makeTransactionalClients>;
  let repo: InstanceType<typeof PrismaAdminUserRepository>;

  beforeEach(() => {
    clients = makeTransactionalClients();
    repo = new PrismaAdminUserRepository(clients.base as never);
    clients.base.adminUser.create.mockResolvedValue(makeRow({ mustChangePassword: true }));
    clients.tx.adminUser.create.mockResolvedValue(makeRow({ mustChangePassword: true }));
  });

  it("returns the administrator created with mustChangePassword written when the input gives it", async () => {
    const dto = await repo.create({ ...CREATE_INPUT, mustChangePassword: true });

    expect(clients.base.adminUser.create).toHaveBeenCalledTimes(1);
    expect(clients.base.adminUser.create.mock.calls[0]).toStrictEqual([
      {
        data: {
          email: "first.admin@example.com",
          passwordHash: "argon2-hash",
          name: "First.Admin",
          roleId: "role-super-admin",
          mustChangePassword: true,
        },
        include: { role: true },
      },
    ]);
    expect(dto.mustChangePassword).toBe(true);
  });

  it("returns the administrator created with no mustChangePassword key sent when the input omits it", async () => {
    await repo.create({ ...CREATE_INPUT });

    expect(clients.base.adminUser.create.mock.calls[0]).toStrictEqual([
      {
        data: {
          email: "first.admin@example.com",
          passwordHash: "argon2-hash",
          name: "First.Admin",
          roleId: "role-super-admin",
        },
        include: { role: true },
      },
    ]);
  });

  it("returns the administrator created by the transaction's client when called inside an open unit of work", async () => {
    const uow = new PrismaUnitOfWork(clients.base as never, NO_TENANT);

    await uow.executeInTransaction(() =>
      repo.create({ ...CREATE_INPUT, mustChangePassword: true })
    );

    expect(clients.tx.adminUser.create).toHaveBeenCalledTimes(1);
    expect(clients.tx.adminUser.create.mock.calls[0]?.[0]?.data).toMatchObject({
      mustChangePassword: true,
    });
    expect(clients.base.adminUser.create).not.toHaveBeenCalled();
  });
});

describe("PrismaAdminUserRepository replaceSingleUsePassword", () => {
  const CHANGED_AT = new Date("2026-11-20T01:30:00Z");
  const REPLACEMENT = {
    id: "u-1",
    currentPasswordHash: "argon2-hash-as-read",
    currentPasswordResetToken: "reset-token-hash-as-read",
    passwordHash: "argon2-hash-of-the-new-password",
  } as const;
  let clients: ReturnType<typeof makeTransactionalClients>;
  let repo: InstanceType<typeof PrismaAdminUserRepository>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CHANGED_AT);
    clients = makeTransactionalClients();
    repo = new PrismaAdminUserRepository(clients.base as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true after one update guarded by the id, the hash and the reset token as read, the mark and no sign-in date, writing the hash and the change date and clearing the pending reset", async () => {
    clients.base.adminUser.updateMany.mockResolvedValue({ count: 1 });

    const result = await repo.replaceSingleUsePassword(REPLACEMENT);

    expect(result).toEqual({ ok: true, value: true });
    expect(clients.base.adminUser.updateMany).toHaveBeenCalledTimes(1);
    expect(clients.base.adminUser.updateMany.mock.calls[0]).toStrictEqual([
      {
        where: {
          id: "u-1",
          passwordHash: "argon2-hash-as-read",
          passwordResetToken: "reset-token-hash-as-read",
          mustChangePassword: true,
          lastLoginAt: null,
        },
        data: {
          passwordHash: "argon2-hash-of-the-new-password",
          passwordChangedAt: CHANGED_AT,
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      },
    ]);
  });

  it("guards on an empty reset token when none was read", async () => {
    clients.base.adminUser.updateMany.mockResolvedValue({ count: 1 });

    await repo.replaceSingleUsePassword({ ...REPLACEMENT, currentPasswordResetToken: null });

    expect(clients.base.adminUser.updateMany.mock.calls[0]?.[0]?.where).toStrictEqual({
      id: "u-1",
      passwordHash: "argon2-hash-as-read",
      passwordResetToken: null,
      mustChangePassword: true,
      lastLoginAt: null,
    });
  });

  it("returns false when the guard matches no row", async () => {
    clients.base.adminUser.updateMany.mockResolvedValue({ count: 0 });

    const result = await repo.replaceSingleUsePassword(REPLACEMENT);

    expect(result).toEqual({ ok: true, value: false });
    expect(clients.base.adminUser.updateMany).toHaveBeenCalledTimes(1);
  });

  it("returns the answer of the transaction's client when called inside an open unit of work", async () => {
    clients.tx.adminUser.updateMany.mockResolvedValue({ count: 1 });
    const uow = new PrismaUnitOfWork(clients.base as never, NO_TENANT);

    const result = await uow.executeInTransaction(() => repo.replaceSingleUsePassword(REPLACEMENT));

    expect(result).toEqual({ ok: true, value: true });
    expect(clients.tx.adminUser.updateMany).toHaveBeenCalledTimes(1);
    expect(clients.base.adminUser.updateMany).not.toHaveBeenCalled();
  });

  it("returns a RepositoryFailureError whose cause is the client's own error when the client fails", async () => {
    const raised = Object.assign(new Error("Can't reach database server at db:5432"), {
      code: "P1001",
    });
    clients.base.adminUser.updateMany.mockRejectedValue(raised);

    const result = await repo.replaceSingleUsePassword(REPLACEMENT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(RepositoryFailureError);
    expect(result.error.code).toBe(REPOSITORY_FAILURE_CODE);
    expect(result.error.cause).toBe(raised);
    expect(result.error.message).toBe("Replacing an admin user's single-use password failed");
  });
});
