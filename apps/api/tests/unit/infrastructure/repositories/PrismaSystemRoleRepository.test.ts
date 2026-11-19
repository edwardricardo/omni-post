/**
 * @file PrismaSystemRoleRepository.test.ts
 * @description Unit tests for the Prisma adapter of the SystemRoleRepository port. A client double
 *   applies the one `role.upsert` the adapter sends to an in-memory table, with the meaning
 *   Prisma documents for each nested operation it understands, and refuses any key it does not,
 *   so a case passes only when that call leaves the role holding exactly its definition. The
 *   order in which Prisma runs the nested operations of one write is not documented, so the
 *   replacement is checked in both orders. Tier 0: no database.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import {
  Permission,
  RepositoryFailureError,
  REPOSITORY_FAILURE_CODE,
  SystemRoleConflictError,
  SYSTEM_ROLE_CONFLICT_CODE,
  type SystemRoleDefinition,
} from "@core/domain";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

const { PrismaSystemRoleRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaSystemRoleRepository.js");

/** A `Role` row as the double stores it. */
interface StoredRole {
  id: string;
  name: string;
  description: string;
  level: number;
  isSystem: boolean;
  isActive: boolean;
}

/** The order in which the double runs the nested operations of one write. */
type NestedOrder = "deleteMany first" | "createMany first";

/** What the double holds before a write: a role row and the permissions granted to it. */
interface StoreSeed {
  role: StoredRole;
  permissions: readonly string[];
}

/** @returns True when the value is a non-null object whose keys can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * @param value - A part of the arguments the adapter sent.
 * @param allowed - The only keys the double knows the meaning of at that place.
 * @param where - The place, named in the failure.
 * @returns The value as a record, after refusing any key outside `allowed`.
 */
function readOnly(value: unknown, allowed: readonly string[], where: string) {
  if (!isRecord(value)) throw new Error(`${where} is not an object`);
  const unknownKeys = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${where} has keys the double does not model: ${unknownKeys.join(", ")}`);
  }
  return value;
}

/**
 * @param id - The row's primary key, from `where`.
 * @param fields - The scalar fields of the branch Prisma would run.
 * @param previous - The row before the write, when it existed.
 * @returns The row after the write, refusing a field of the wrong type.
 */
function toStoredRole(
  id: string,
  fields: Record<string, unknown>,
  previous: StoredRole | undefined
): StoredRole {
  const row: Record<string, unknown> = { ...(previous ?? { isActive: true }), ...fields };
  const { name, description, level, isSystem, isActive } = row;
  if (
    typeof name !== "string" ||
    typeof description !== "string" ||
    typeof level !== "number" ||
    typeof isSystem !== "boolean" ||
    typeof isActive !== "boolean"
  ) {
    throw new Error("the branch leaves the role with a missing or mistyped field");
  }
  return { id, name, description, level, isSystem, isActive };
}

/** @returns The permission strings of a `createMany` payload, refusing any other row shape. */
function permissionRows(data: unknown): string[] {
  if (!Array.isArray(data)) throw new Error("createMany.data is not an array");
  return data.map((row) => {
    const { permission } = readOnly(row, ["permission"], "createMany row");
    if (typeof permission !== "string") throw new Error("createMany row has no permission");
    return permission;
  });
}

/** A Prisma P2002 in the measured Prisma 7 shape, naming the given index. */
function uniqueViolation(index: string): Error {
  return Object.assign(new Error("Unique constraint failed"), {
    name: "PrismaClientKnownRequestError",
    code: "P2002",
    meta: {
      driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { index } } },
    },
  });
}

/**
 * A client whose `role.upsert` applies its arguments to an in-memory `Role` table and its
 * `RolePermission` rows: the update branch when the row exists, the create branch otherwise.
 */
function makeRoleStore(order: NestedOrder, seed?: StoreSeed) {
  const roles = new Map<string, StoredRole>();
  const grants = new Map<string, Set<string>>();
  /** The permission rows deleted and inserted since the double was built. */
  const changes = { deleted: 0, inserted: 0 };
  if (seed !== undefined) {
    roles.set(seed.role.id, { ...seed.role });
    grants.set(seed.role.id, new Set(seed.permissions));
  }

  function applyPermissions(roleId: string, nested: unknown): void {
    const { deleteMany, createMany } = readOnly(
      nested,
      ["deleteMany", "createMany"],
      "permissions"
    );
    const held = grants.get(roleId) ?? new Set<string>();
    const remove = () => {
      if (deleteMany === undefined) return;
      // With no filter, Prisma's nested `deleteMany: {}` deletes every related row.
      const { permission } = readOnly(deleteMany, ["permission"], "deleteMany");
      let kept: unknown[] = [];
      if (permission !== undefined) {
        const { notIn } = readOnly(permission, ["notIn"], "deleteMany.permission");
        if (!Array.isArray(notIn)) throw new Error("deleteMany.permission.notIn is not an array");
        kept = notIn;
      }
      for (const granted of [...held]) {
        if (kept.includes(granted)) continue;
        held.delete(granted);
        changes.deleted += 1;
      }
    };
    const insert = () => {
      if (createMany === undefined) return;
      const envelope = readOnly(createMany, ["data", "skipDuplicates"], "createMany");
      for (const permission of permissionRows(envelope.data)) {
        if (held.has(permission)) {
          if (envelope.skipDuplicates !== true) {
            throw uniqueViolation("RolePermission_roleId_permission_key");
          }
          continue;
        }
        held.add(permission);
        changes.inserted += 1;
      }
    };
    const steps = order === "deleteMany first" ? [remove, insert] : [insert, remove];
    for (const step of steps) step();
    grants.set(roleId, held);
  }

  const upsert = vi.fn(async (args: unknown) => {
    const { where, create, update } = readOnly(
      args,
      ["where", "create", "update", "select"],
      "upsert"
    );
    const { id } = readOnly(where, ["id"], "where");
    if (typeof id !== "string") throw new Error("where.id is not a string");
    const existing = roles.get(id);
    const scalars = ["name", "description", "level", "isSystem", "permissions"];
    const branch =
      existing === undefined
        ? readOnly(create, ["id", ...scalars], "create")
        : readOnly(update, scalars, "update");
    const { permissions, id: createdId, ...fields } = branch;
    if (existing === undefined && createdId !== id) throw new Error("create.id is not where.id");
    roles.set(id, toStoredRole(id, fields, existing));
    applyPermissions(id, permissions);
    return { id };
  });

  return { client: { role: { upsert } }, roles, grants, changes };
}

/** A base client and the second double its `$transaction` hands to the callback. */
function makeTransactionalClients() {
  const tx = { role: { upsert: vi.fn(async () => ({ id: DEFINITION.id })) } };
  const base = {
    role: { upsert: vi.fn(async () => ({ id: DEFINITION.id })) },
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { base, tx };
}

/** A tenant provider that reports no context, so the Unit of Work binds no GUC. */
const NO_TENANT: ConstructorParameters<typeof PrismaUnitOfWork>[1] = {
  getTenantContext: () => undefined,
  getSystemContext: () => undefined,
};

/** A system role's definition; its permissions overlap the seeded role's on one value. */
const DEFINITION: SystemRoleDefinition = {
  id: "role-super-admin",
  name: "SUPER_ADMIN",
  description: "Full system access with all permissions",
  level: 100,
  isSystem: true,
  permissions: [Permission.USER_READ, Permission.AUDIT_READ, Permission.SECRETS_VIEW],
};

/** The role as an earlier write left it: other fields and other permissions. */
function makeHeldRole(): StoreSeed {
  return {
    role: {
      id: DEFINITION.id,
      name: "ROLE_UNDER_AN_OLDER_NAME",
      description: "An older description",
      level: 90,
      isSystem: false,
      isActive: true,
    },
    permissions: [Permission.USER_READ, Permission.BILLING_MANAGE, "permission:retired"],
  };
}

/** The row and the permission set the write must leave, whatever the role held before. */
const EXPECTED_ROLE: StoredRole = {
  id: DEFINITION.id,
  name: DEFINITION.name,
  description: DEFINITION.description,
  level: DEFINITION.level,
  isSystem: DEFINITION.isSystem,
  isActive: true,
};

/** Asserts that an error message, which can reach a log, holds no value of the definition. */
function expectNoDefinitionValue(message: string): void {
  for (const value of [DEFINITION.id, DEFINITION.name, DEFINITION.description]) {
    expect(message).not.toContain(value);
  }
  for (const permission of DEFINITION.permissions) expect(message).not.toContain(permission);
}

describe("PrismaSystemRoleRepository save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with the definition's fields and exactly its permissions when the role does not exist", async () => {
    const store = makeRoleStore("deleteMany first");
    const repo = new PrismaSystemRoleRepository(store.client as never);

    const result = await repo.save(DEFINITION);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(store.client.role.upsert).toHaveBeenCalledTimes(1);
    expect([...store.roles.values()]).toEqual([EXPECTED_ROLE]);
    expect([...(store.grants.get(DEFINITION.id) ?? [])].sort()).toEqual(
      [...DEFINITION.permissions].sort()
    );
  });

  it.each<NestedOrder>(["deleteMany first", "createMany first"])(
    "returns ok with the definition's fields and exactly its permissions when the role held others (%s)",
    async (order) => {
      const store = makeRoleStore(order, makeHeldRole());
      const repo = new PrismaSystemRoleRepository(store.client as never);

      const result = await repo.save(DEFINITION);

      expect(result).toEqual({ ok: true, value: undefined });
      expect(store.client.role.upsert).toHaveBeenCalledTimes(1);
      expect([...store.roles.values()]).toEqual([EXPECTED_ROLE]);
      expect([...(store.grants.get(DEFINITION.id) ?? [])].sort()).toEqual(
        [...DEFINITION.permissions].sort()
      );
    }
  );

  it.each<NestedOrder>(["deleteMany first", "createMany first"])(
    "returns ok and deletes or inserts no row when the role already holds the definition (%s)",
    async (order) => {
      const store = makeRoleStore(order);
      const repo = new PrismaSystemRoleRepository(store.client as never);
      await repo.save(DEFINITION);
      const afterFirstSave = { ...store.changes };

      const result = await repo.save(DEFINITION);

      expect(result).toEqual({ ok: true, value: undefined });
      expect(store.client.role.upsert).toHaveBeenCalledTimes(2);
      expect(store.changes).toEqual(afterFirstSave);
      expect([...store.roles.values()]).toEqual([EXPECTED_ROLE]);
      expect([...(store.grants.get(DEFINITION.id) ?? [])].sort()).toEqual(
        [...DEFINITION.permissions].sort()
      );
    }
  );

  it("returns ok from the transaction's client when called inside an open unit of work", async () => {
    const { base, tx } = makeTransactionalClients();
    const repo = new PrismaSystemRoleRepository(base as never);
    const uow = new PrismaUnitOfWork(base as never, NO_TENANT);

    const result = await uow.executeInTransaction(() => repo.save(DEFINITION));

    expect(result).toEqual({ ok: true, value: undefined });
    expect(base.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.role.upsert).toHaveBeenCalledTimes(1);
    expect(base.role.upsert).not.toHaveBeenCalled();
  });

  it("returns ok from the base client when no unit of work is open", async () => {
    const { base, tx } = makeTransactionalClients();
    const repo = new PrismaSystemRoleRepository(base as never);

    const result = await repo.save(DEFINITION);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(base.role.upsert).toHaveBeenCalledTimes(1);
    expect(base.$transaction).not.toHaveBeenCalled();
    expect(tx.role.upsert).not.toHaveBeenCalled();
  });

  it.each(["Role_pkey", "Role_name_key"])(
    "returns a SystemRoleConflictError carrying the violation when another writer holds the role first (%s)",
    async (index) => {
      const { base } = makeTransactionalClients();
      const raised = uniqueViolation(index);
      base.role.upsert.mockRejectedValue(raised);
      const repo = new PrismaSystemRoleRepository(base as never);

      const result = await repo.save(DEFINITION);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(SystemRoleConflictError);
      expect(result.error.code).toBe(SYSTEM_ROLE_CONFLICT_CODE);
      expect(result.error.cause).toBe(raised);
      expect(result.error.message).toBe(
        "Another writer already holds this system role's id or name"
      );
      expectNoDefinitionValue(result.error.message);
    }
  );

  it("returns a SystemRoleConflictError whose cause names only the type when the violation is not an Error", async () => {
    const { base } = makeTransactionalClients();
    base.role.upsert.mockRejectedValue({
      code: "P2002",
      meta: {
        driverAdapterError: {
          cause: { kind: "UniqueConstraintViolation", constraint: { index: "Role_pkey" } },
        },
      },
    });
    const repo = new PrismaSystemRoleRepository(base as never);

    const result = await repo.save(DEFINITION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(SystemRoleConflictError);
    expect(result.error.cause).toEqual(
      new Error("The store raised a value that is not an Error, of type object")
    );
  });

  it("returns a RepositoryFailureError for a unique violation of a constraint that is not the role's", async () => {
    const { base } = makeTransactionalClients();
    const raised = uniqueViolation("RolePermission_roleId_permission_key");
    base.role.upsert.mockRejectedValue(raised);
    const repo = new PrismaSystemRoleRepository(base as never);

    const result = await repo.save(DEFINITION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(RepositoryFailureError);
    expect(result.error.cause).toBe(raised);
  });

  it("returns a RepositoryFailureError whose cause is the client's own error when the client fails otherwise", async () => {
    const { base } = makeTransactionalClients();
    const raised = Object.assign(new Error(`Can't write role ${DEFINITION.id}`), { code: "P1001" });
    base.role.upsert.mockRejectedValue(raised);
    const repo = new PrismaSystemRoleRepository(base as never);

    const result = await repo.save(DEFINITION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(RepositoryFailureError);
    expect(result.error.code).toBe(REPOSITORY_FAILURE_CODE);
    expect(result.error.cause).toBe(raised);
    expect(result.error.message).toBe("Writing a system role failed");
    expectNoDefinitionValue(result.error.message);
  });

  it("returns a RepositoryFailureError whose cause names only the type when the client rejects with a non-Error", async () => {
    const { base } = makeTransactionalClients();
    base.role.upsert.mockRejectedValue(`refused ${DEFINITION.name}`);
    const repo = new PrismaSystemRoleRepository(base as never);

    const result = await repo.save(DEFINITION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(RepositoryFailureError);
    expect(result.error.cause).toBeInstanceOf(Error);
    expect(result.error.cause).toEqual(
      new Error("The store raised a value that is not an Error, of type string")
    );
    expectNoDefinitionValue(result.error.message);
  });
});
