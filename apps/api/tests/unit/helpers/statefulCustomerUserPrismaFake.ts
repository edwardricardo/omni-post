/**
 * @file statefulCustomerUserPrismaFake.ts
 * @description Map-backed fake of the Prisma `customerUser` delegate, built so the
 *   REAL `PrismaCustomerUserRepository` can be constructed over it and execute its
 *   actual write construction against real stored state.
 *
 *   It fakes the CLIENT, never the repository. A repository double records which
 *   methods a flow called, and that recording stays green whether the row ends up
 *   correct or silently reverted by a later write in the same flow — so it certifies
 *   nothing about the outcome. Here the row IS state, so an assertion can name the
 *   stored value.
 *
 *   Every delegate operation is routed through the REAL `tenantGuardCheck` with the
 *   REAL ambient context provider. A flow that reaches this delegate with no bound
 *   context therefore fails exactly the way production fails, which is what lets a
 *   unit test decide whether a context failure is surfaced as a context failure or
 *   degraded into a credential verdict.
 *
 *   Fail-closed by construction: an unknown column, an unsupported filter operator,
 *   or an unsupported `orderBy` throws instead of quietly matching nothing. A
 *   predicate the fake cannot evaluate would otherwise answer "zero rows matched" —
 *   the same answer a correct count gate gives — and an invisible false green is the
 *   defect class this harness exists to make visible.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { tenantGuardCheck } from "@infra/prisma/extensions/tenantGuard.js";
import { getTenantContext, getSystemContext } from "../../../src/security/tenantContext.js";

/**
 * The persisted shape of a `CustomerUser` row. Mirrors the scalar columns the
 * adapter reads and writes; the `customerRole` relation is projected by the
 * read operations, never stored here.
 */
export interface FakeCustomerUserRow {
  id: string;
  accountId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roleId: string | null;
  isActive: boolean;
  isEmailVerified: boolean;
  emailVerifyToken: string | null;
  emailVerifyExpiry: Date | null;
  resetToken: string | null;
  resetTokenExpiry: Date | null;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  lastLoginAt: Date | null;
  invitedBy: string | null;
  inviteToken: string | null;
  inviteTokenExpiry: Date | null;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const SCALAR_COLUMNS: ReadonlySet<string> = new Set<string>([
  "id",
  "accountId",
  "email",
  "passwordHash",
  "firstName",
  "lastName",
  "roleId",
  "isActive",
  "isEmailVerified",
  "emailVerifyToken",
  "emailVerifyExpiry",
  "resetToken",
  "resetTokenExpiry",
  "mfaEnabled",
  "mfaSecret",
  "lastLoginAt",
  "invitedBy",
  "inviteToken",
  "inviteTokenExpiry",
  "joinedAt",
  "createdAt",
  "updatedAt",
  "deletedAt",
]);

/**
 * Columns Prisma maintains on the row's behalf, which therefore move on every
 * write without any intent naming them. A caller that diffs a row before and
 * after a command subtracts these before comparing against a declared write set.
 */
export const FAKE_MANAGED_COLUMNS: ReadonlySet<string> = new Set<string>(["updatedAt"]);

const SUPPORTED_FILTER_OPERATORS: ReadonlySet<string> = new Set<string>([
  "equals",
  "not",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
]);

/** Shape of the error the fake raises for a unique-constraint collision. */
interface UniqueConstraintError extends Error {
  code: string;
  meta: { target: string[] };
}

function uniqueConstraintError(target: string[]): UniqueConstraintError {
  const error = new Error(
    `Unique constraint failed on the fields: (${target.join(", ")})`
  ) as UniqueConstraintError;
  error.code = "P2002";
  error.meta = { target };
  return error;
}

function recordNotFoundError(operation: string): Error & { code: string } {
  const error = new Error(
    `An operation failed because it depends on one or more records that were required but not found. (${operation})`
  ) as Error & { code: string };
  error.code = "P2025";
  return error;
}

/**
 * Reduce a stored value to something orderable. `undefined` means "not
 * orderable", which is how a null column declines every range predicate —
 * Prisma's own behaviour, and the reason an expired-token row and a
 * never-issued-token row both fail a `{ gt: now }` gate.
 */
function comparable(value: unknown): number | string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" || typeof value === "string") return value;
  return undefined;
}

function equalScalar(value: unknown, operand: unknown): boolean {
  if (value instanceof Date && operand instanceof Date) {
    return value.getTime() === operand.getTime();
  }
  return value === operand;
}

function compare(value: unknown, operand: unknown, operator: string): boolean {
  const left = comparable(value);
  const right = comparable(operand);
  if (left === undefined || right === undefined) return false;
  if (typeof left !== typeof right) return false;
  switch (operator) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    default:
      throw new Error(`statefulCustomerUserPrismaFake: unreachable comparator "${operator}"`);
  }
}

function matchesColumn(column: string, value: unknown, predicate: unknown): boolean {
  if (predicate === null) return value === null;
  if (predicate instanceof Date) return equalScalar(value, predicate);
  if (Array.isArray(predicate)) {
    throw new Error(
      `statefulCustomerUserPrismaFake: bare array predicate on "${column}" is not supported — use { in: [...] }`
    );
  }
  if (typeof predicate === "object") {
    const entries = Object.entries(predicate as Record<string, unknown>);
    for (const [operator, operand] of entries) {
      if (!SUPPORTED_FILTER_OPERATORS.has(operator)) {
        throw new Error(
          `statefulCustomerUserPrismaFake: unsupported filter operator "${operator}" on column "${column}"`
        );
      }
      let satisfied: boolean;
      switch (operator) {
        case "equals":
          satisfied = operand === null ? value === null : equalScalar(value, operand);
          break;
        case "not":
          satisfied = operand === null ? value !== null : !equalScalar(value, operand);
          break;
        case "in":
          if (!Array.isArray(operand)) {
            throw new Error(
              `statefulCustomerUserPrismaFake: "in" on column "${column}" requires an array`
            );
          }
          satisfied = operand.some((candidate) => equalScalar(value, candidate));
          break;
        default:
          satisfied = compare(value, operand, operator);
          break;
      }
      if (!satisfied) return false;
    }
    return true;
  }
  return equalScalar(value, predicate);
}

function matchesWhere(
  row: FakeCustomerUserRow,
  where: Record<string, unknown> | undefined
): boolean {
  if (!where) return true;
  for (const [column, predicate] of Object.entries(where)) {
    if (predicate === undefined) continue;
    if (!SCALAR_COLUMNS.has(column)) {
      throw new Error(
        `statefulCustomerUserPrismaFake: unknown column "${column}" in where clause — the fake refuses to evaluate a predicate it cannot model`
      );
    }
    if (!matchesColumn(column, (row as unknown as Record<string, unknown>)[column], predicate)) {
      return false;
    }
  }
  return true;
}

function applyData(row: FakeCustomerUserRow, data: Record<string, unknown>): FakeCustomerUserRow {
  const next = { ...row } as unknown as Record<string, unknown>;
  for (const [column, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (!SCALAR_COLUMNS.has(column)) {
      throw new Error(
        `statefulCustomerUserPrismaFake: unknown column "${column}" in write data — the fake refuses to store a column the schema does not have`
      );
    }
    next[column] = value;
  }
  next.updatedAt = new Date();
  return next as unknown as FakeCustomerUserRow;
}

/**
 * Project a stored row for a read. The `customerRole` relation is always
 * projected as `null` when the caller asked to include it: the adapter's
 * `toDomain` has a documented role-less fallback, and exercising that fallback
 * here keeps the fake from needing a role table it never stores.
 */
function project(row: FakeCustomerUserRow, include: unknown): Record<string, unknown> {
  const projected: Record<string, unknown> = { ...row };
  if (include && typeof include === "object" && "customerRole" in include) {
    projected.customerRole = null;
  }
  return projected;
}

/** The harness handed back to a suite. */
export interface StatefulCustomerUserPrismaFake {
  /** Pass this to `new PrismaCustomerUserRepository(fake.client)`. */
  readonly client: PrismaClient;
  /** Insert a row directly, bypassing the guard (fixture setup, not a flow). */
  seed(
    overrides: Partial<FakeCustomerUserRow> & { id: string; accountId: string; email: string }
  ): FakeCustomerUserRow;
  /** Read stored state directly — the subject of every outcome assertion. */
  read(id: string): FakeCustomerUserRow | undefined;
  /** Every stored row, insertion-ordered. */
  rows(): FakeCustomerUserRow[];
  /** Make any write touching `userId` throw, modelling a per-row write failure. */
  failWritesFor(userId: string): void;
  /** Clear every write failure previously armed. */
  clearWriteFailures(): void;
}

/**
 * @function createStatefulCustomerUserPrismaFake
 * @description Builds the Map-backed `customerUser` delegate described above.
 * @returns The harness: the client to inject, plus direct state accessors.
 */
export function createStatefulCustomerUserPrismaFake(): StatefulCustomerUserPrismaFake {
  const store = new Map<string, FakeCustomerUserRow>();
  const failing = new Set<string>();

  const guard = <T>(
    operation: string,
    args: Record<string, unknown>,
    impl: (resolved: Record<string, unknown>) => Promise<T>
  ): Promise<T> =>
    tenantGuardCheck(
      {
        model: "CustomerUser",
        operation,
        args,
        query: (resolved: unknown) => impl(resolved as Record<string, unknown>),
      },
      { getTenantContext, getSystemContext }
    ) as Promise<T>;

  const refuseIfFailing = (row: FakeCustomerUserRow, operation: string): void => {
    if (failing.has(row.id)) {
      throw new Error(
        `statefulCustomerUserPrismaFake: write failure armed for "${row.id}" (${operation})`
      );
    }
  };

  /**
   * Enforce the row's unique indexes against the rest of the store. Applied to
   * UPDATES as well as inserts on purpose: `resetToken` is globally unique, so
   * writing one token onto a second row is a constraint violation in the real
   * database. A fake that only checked inserts would let that write succeed and
   * would quietly certify the very collision the reset flow has to stop making.
   */
  const enforceUniques = (candidate: FakeCustomerUserRow): void => {
    for (const other of store.values()) {
      if (other.id === candidate.id) continue;
      if (other.accountId === candidate.accountId && other.email === candidate.email) {
        throw uniqueConstraintError(["accountId", "email"]);
      }
      if (candidate.resetToken !== null && other.resetToken === candidate.resetToken) {
        throw uniqueConstraintError(["resetToken"]);
      }
      if (candidate.inviteToken !== null && other.inviteToken === candidate.inviteToken) {
        throw uniqueConstraintError(["inviteToken"]);
      }
    }
  };

  const commit = (row: FakeCustomerUserRow, data: Record<string, unknown>): FakeCustomerUserRow => {
    const next = applyData(row, data);
    enforceUniques(next);
    store.set(next.id, next);
    return next;
  };

  const select = (where: Record<string, unknown> | undefined): FakeCustomerUserRow[] =>
    [...store.values()].filter((row) => matchesWhere(row, where));

  const sort = (rows: FakeCustomerUserRow[], orderBy: unknown): FakeCustomerUserRow[] => {
    if (!orderBy) return rows;
    const entries = Object.entries(orderBy as Record<string, unknown>);
    if (entries.length !== 1) {
      throw new Error(
        "statefulCustomerUserPrismaFake: orderBy supports exactly one column in this harness"
      );
    }
    const [column, direction] = entries[0] as [string, unknown];
    if (!SCALAR_COLUMNS.has(column)) {
      throw new Error(`statefulCustomerUserPrismaFake: unknown orderBy column "${column}"`);
    }
    if (direction !== "asc" && direction !== "desc") {
      throw new Error(`statefulCustomerUserPrismaFake: unsupported orderBy direction`);
    }
    const factor = direction === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = comparable((a as unknown as Record<string, unknown>)[column]);
      const right = comparable((b as unknown as Record<string, unknown>)[column]);
      if (left === undefined || right === undefined) return 0;
      if (left === right) return 0;
      return (left < right ? -1 : 1) * factor;
    });
  };

  const customerUser = {
    findFirst: (args: Record<string, unknown>) =>
      guard("findFirst", args, async (resolved) => {
        const [row] = sort(
          select(resolved.where as Record<string, unknown> | undefined),
          resolved.orderBy
        );
        return row ? project(row, resolved.include) : null;
      }),

    findMany: (args: Record<string, unknown>) =>
      guard("findMany", args, async (resolved) => {
        const rows = sort(
          select(resolved.where as Record<string, unknown> | undefined),
          resolved.orderBy
        );
        return rows.map((row) => project(row, resolved.include));
      }),

    update: (args: Record<string, unknown>) =>
      guard("update", args, async (resolved) => {
        const [row] = select(resolved.where as Record<string, unknown> | undefined);
        if (!row) throw recordNotFoundError("customerUser.update");
        refuseIfFailing(row, "update");
        return project(commit(row, resolved.data as Record<string, unknown>), resolved.include);
      }),

    updateMany: (args: Record<string, unknown>) =>
      guard("updateMany", args, async (resolved) => {
        const matched = select(resolved.where as Record<string, unknown> | undefined);
        for (const row of matched) refuseIfFailing(row, "updateMany");
        for (const row of matched) {
          commit(row, resolved.data as Record<string, unknown>);
        }
        return { count: matched.length };
      }),

    upsert: (args: Record<string, unknown>) =>
      guard("upsert", args, async (resolved) => {
        const [row] = select(resolved.where as Record<string, unknown> | undefined);
        if (row) {
          refuseIfFailing(row, "upsert");
          return project(commit(row, resolved.update as Record<string, unknown>), resolved.include);
        }
        const created = insert(resolved.create as Record<string, unknown>, "upsert");
        return project(created, resolved.include);
      }),

    create: (args: Record<string, unknown>) =>
      guard("create", args, async (resolved) => {
        const created = insert(resolved.data as Record<string, unknown>, "create");
        return project(created, resolved.include);
      }),
  };

  function insert(data: Record<string, unknown>, operation: string): FakeCustomerUserRow {
    const id = typeof data.id === "string" ? data.id : `fake-${store.size + 1}`;
    if (failing.has(id)) {
      throw new Error(
        `statefulCustomerUserPrismaFake: write failure armed for "${id}" (${operation})`
      );
    }
    if (store.has(id)) throw uniqueConstraintError(["id"]);
    const accountId = typeof data.accountId === "string" ? data.accountId : "";
    const email = typeof data.email === "string" ? data.email : "";
    return commit(blankRow(id, accountId, email), data);
  }

  function blankRow(id: string, accountId: string, email: string): FakeCustomerUserRow {
    const now = new Date();
    return {
      id,
      accountId,
      email,
      passwordHash: "",
      firstName: "",
      lastName: "",
      roleId: null,
      isActive: true,
      isEmailVerified: false,
      emailVerifyToken: null,
      emailVerifyExpiry: null,
      resetToken: null,
      resetTokenExpiry: null,
      mfaEnabled: false,
      mfaSecret: null,
      lastLoginAt: null,
      invitedBy: null,
      inviteToken: null,
      inviteTokenExpiry: null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }

  return {
    client: { customerUser } as unknown as PrismaClient,

    seed(overrides) {
      const row = { ...blankRow(overrides.id, overrides.accountId, overrides.email), ...overrides };
      store.set(row.id, row);
      return row;
    },

    read(id) {
      return store.get(id);
    },

    rows() {
      return [...store.values()];
    },

    failWritesFor(userId) {
      failing.add(userId);
    },

    clearWriteFailures() {
      failing.clear();
    },
  };
}
