/**
 * @file statefulAdminUserPrismaFake.ts
 * @description Map-backed fake of the Prisma `adminUser` and `adminSession`
 *   delegates, built so the REAL `PasswordService` can be constructed over it and
 *   execute its actual predicate and write construction against real stored state.
 *
 *   It fakes the CLIENT, never a repository. A repository double records which
 *   methods a flow called, and that recording stays green whether the row ends up
 *   correct or silently overwritten by a later write in the same flow — so it
 *   certifies nothing about the outcome. Here the row IS state, so every assertion
 *   names a stored value.
 *
 *   Fail-closed by construction: an unknown column, an unsupported filter operator,
 *   or an unsupported `select` key throws instead of quietly matching nothing. A
 *   predicate the fake cannot evaluate would otherwise answer "zero rows matched" —
 *   the same answer a correct count gate gives — and an invisible false green is the
 *   defect class this harness exists to make visible. The scalar-list `equals` the
 *   claim predicate carries is modelled NATIVELY for that reason: the shared
 *   `mockPrisma` helper falls an unknown operator through to `===`, which answers
 *   "0 rows" for the very predicate under test.
 *
 *   The tenant guard is deliberately NOT routed through this fake. `adminUser` and
 *   `adminSession` are absent from `TENANT_SCOPED_MODELS`, so a guard call here
 *   would decide nothing and prove nothing — unlike the customer twin, whose model
 *   IS enrolled.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";

/** The persisted shape of an `AdminUser` row — every scalar column, no relations. */
export interface FakeAdminUserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  roleId: string;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  passwordHashAlgo: string;
  passwordChangedAt: Date;
  passwordHistory: string[];
  mustChangePassword: boolean;
  mfaBackupCodes: string[];
  mfaBackupUsedAt: unknown;
  mfaLastUsedTotpStep: number | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lockReason: string | null;
  maxConcurrentSessions: number;
  timezone: string | null;
  locale: string | null;
  department: string | null;
  team: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The persisted shape of an `AdminSession` row — every scalar column. */
export interface FakeAdminSessionRow {
  id: string;
  userId: string;
  refreshTokenHash: string;
  ipAddress: string | null;
  userAgent: string | null;
  isActive: boolean;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  csrfToken: string;
  deviceId: string | null;
  deviceName: string | null;
  location: unknown;
  lastActivityAt: Date;
  revokedBy: string | null;
  revokeReason: string | null;
}

const ADMIN_USER_COLUMNS: ReadonlySet<string> = new Set<string>([
  "id",
  "email",
  "passwordHash",
  "name",
  "roleId",
  "isActive",
  "emailVerified",
  "lastLoginAt",
  "passwordResetToken",
  "passwordResetExpires",
  "mfaEnabled",
  "mfaSecret",
  "passwordHashAlgo",
  "passwordChangedAt",
  "passwordHistory",
  "mustChangePassword",
  "mfaBackupCodes",
  "mfaBackupUsedAt",
  "mfaLastUsedTotpStep",
  "failedLoginAttempts",
  "lockedUntil",
  "lockReason",
  "maxConcurrentSessions",
  "timezone",
  "locale",
  "department",
  "team",
  "avatarUrl",
  "createdAt",
  "updatedAt",
]);

const ADMIN_SESSION_COLUMNS: ReadonlySet<string> = new Set<string>([
  "id",
  "userId",
  "refreshTokenHash",
  "ipAddress",
  "userAgent",
  "isActive",
  "expiresAt",
  "createdAt",
  "revokedAt",
  "csrfToken",
  "deviceId",
  "deviceName",
  "location",
  "lastActivityAt",
  "revokedBy",
  "revokeReason",
]);

/** Scalar-list columns: `equals` on these compares element-wise, not by identity. */
const LIST_COLUMNS: ReadonlySet<string> = new Set<string>(["passwordHistory", "mfaBackupCodes"]);

/** Operators the fake can evaluate FAITHFULLY. Anything else throws. */
const SUPPORTED_FILTER_OPERATORS: ReadonlySet<string> = new Set<string>([
  "equals",
  "not",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
]);

function fail(message: string): never {
  throw new Error(`statefulAdminUserPrismaFake: ${message}`);
}

/**
 * Reduce a stored value to something orderable. `undefined` means "not orderable",
 * which is how a null column declines every range predicate — Prisma's own
 * behaviour, and the reason an expired-token row and a never-issued-token row both
 * fail a `{ gt: now }` gate.
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

/** Element-wise list equality — the semantics Postgres gives `"col" = $n` on `text[]`. */
function equalList(value: unknown, operand: unknown): boolean {
  if (!Array.isArray(value) || !Array.isArray(operand)) return false;
  return value.length === operand.length && value.every((entry, i) => entry === operand[i]);
}

function equalColumn(column: string, value: unknown, operand: unknown): boolean {
  return LIST_COLUMNS.has(column) ? equalList(value, operand) : equalScalar(value, operand);
}

function compare(column: string, value: unknown, operand: unknown, operator: string): boolean {
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
      return fail(`unreachable comparator "${operator}" on column "${column}"`);
  }
}

function matchesColumn(column: string, value: unknown, predicate: unknown): boolean {
  if (predicate === null) return value === null;
  if (predicate instanceof Date) return equalScalar(value, predicate);
  if (Array.isArray(predicate)) {
    return fail(
      `bare array predicate on "${column}" is not supported — use { equals: [...] } for a list column or { in: [...] } for a scalar`
    );
  }
  if (typeof predicate === "object") {
    for (const [operator, operand] of Object.entries(predicate as Record<string, unknown>)) {
      if (!SUPPORTED_FILTER_OPERATORS.has(operator)) {
        return fail(
          `unsupported filter operator "${operator}" on column "${column}" — refusing to answer "zero rows" for a predicate it cannot model`
        );
      }
      let satisfied: boolean;
      switch (operator) {
        case "equals":
          satisfied = operand === null ? value === null : equalColumn(column, value, operand);
          break;
        case "not":
          satisfied = operand === null ? value !== null : !equalColumn(column, value, operand);
          break;
        case "in":
          if (!Array.isArray(operand)) return fail(`"in" on column "${column}" requires an array`);
          satisfied = operand.some((candidate) => equalScalar(value, candidate));
          break;
        default:
          satisfied = compare(column, value, operand, operator);
          break;
      }
      if (!satisfied) return false;
    }
    return true;
  }
  return equalColumn(column, value, predicate);
}

function matchesWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown> | undefined,
  columns: ReadonlySet<string>,
  model: string
): boolean {
  if (!where) return true;
  for (const [column, predicate] of Object.entries(where)) {
    if (predicate === undefined) continue;
    if (!columns.has(column)) {
      return fail(
        `unknown column "${column}" in a ${model} where clause — the fake refuses to evaluate a predicate it cannot model`
      );
    }
    if (!matchesColumn(column, row[column], predicate)) return false;
  }
  return true;
}

function applyData(
  row: Record<string, unknown>,
  data: Record<string, unknown>,
  columns: ReadonlySet<string>,
  model: string,
  managed: string | null
): Record<string, unknown> {
  const next = { ...row };
  for (const [column, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (!columns.has(column)) {
      return fail(
        `unknown column "${column}" in ${model} write data — the fake refuses to store a column the schema does not have`
      );
    }
    next[column] = value;
  }
  if (managed !== null) next[managed] = new Date();
  return next;
}

/**
 * Project a row through a `select`. Prisma leaves an unselected column absent, so
 * a flow that reads a field it never selected sees `undefined` here exactly as it
 * would in production — which is what lets a test decide that the single read
 * really does select the current `passwordHash`.
 */
function project(
  row: Record<string, unknown>,
  select: unknown,
  columns: ReadonlySet<string>,
  model: string
): Record<string, unknown> {
  if (!select || typeof select !== "object") return { ...row };
  const projected: Record<string, unknown> = {};
  for (const [column, wanted] of Object.entries(select as Record<string, unknown>)) {
    if (wanted !== true) continue;
    if (!columns.has(column)) {
      return fail(`unknown column "${column}" in a ${model} select`);
    }
    projected[column] = row[column];
  }
  return projected;
}

function recordNotFoundError(operation: string): Error & { code: string } {
  const error = new Error(
    `An operation failed because it depends on one or more records that were required but not found. (${operation})`
  ) as Error & { code: string };
  error.code = "P2025";
  return error;
}

/** The harness handed back to a suite. */
export interface StatefulAdminUserPrismaFake {
  /** Pass this to `new PasswordService(fake.client)`. */
  readonly client: PrismaClient;
  /** Insert an admin row directly (fixture setup, not a flow). */
  seedAdmin(overrides: Partial<FakeAdminUserRow> & { id: string }): FakeAdminUserRow;
  /**
   * Move named columns on an EXISTING row, leaving every other column alone —
   * what a concurrent writer does. Distinct from `seedAdmin`, which rebuilds the
   * row from defaults: a "concurrent writer" that silently reset the columns it
   * did not name would manufacture the very refusal the test is trying to earn.
   */
  mutateAdmin(id: string, patch: Partial<FakeAdminUserRow>): void;
  /** Insert a session row directly (fixture setup, not a flow). */
  seedSession(overrides: Partial<FakeAdminSessionRow> & { id: string; userId: string }): void;
  /** Read stored admin state directly — the subject of every outcome assertion. */
  readAdmin(id: string): FakeAdminUserRow | undefined;
  /** Read stored session state directly. */
  readSessions(userId: string): FakeAdminSessionRow[];
  /**
   * Run `hook` once, immediately AFTER the next `adminUser.findFirst` resolves.
   * This is the concurrent writer: it moves the row between the flow's deciding
   * read and its claim, which is the interleaving the claim exists to refuse.
   */
  afterNextRead(hook: () => void): void;
  /** Make every write touching `userId` throw, modelling a per-row write failure. */
  failWritesFor(userId: string): void;
  /**
   * Every `adminUser` write the flow attempted, in order, with the predicate it
   * carried and the count it matched. The predicate is recorded because "the CAS
   * names the snapshot the read returned" is a property of the predicate, and no
   * stored value can witness it: a claim naming a FILTERED history would still
   * store the right row whenever the unfiltered and filtered snapshots agree.
   */
  writes(): FakeAdminUserWrite[];
}

/** One recorded `adminUser` write attempt. */
export interface FakeAdminUserWrite {
  op: "update" | "updateMany";
  where: Record<string, unknown>;
  data: Record<string, unknown>;
  count: number | null;
}

/**
 * @function createStatefulAdminUserPrismaFake
 * @description Builds the Map-backed `adminUser` + `adminSession` delegates above.
 * @returns The harness: the client to inject, plus direct state accessors.
 */
export function createStatefulAdminUserPrismaFake(): StatefulAdminUserPrismaFake {
  const admins = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const failing = new Set<string>();
  const attempted: FakeAdminUserWrite[] = [];
  let afterRead: (() => void) | null = null;

  const record = (
    op: "update" | "updateMany",
    args: Record<string, unknown>,
    count: number | null
  ): void => {
    attempted.push({
      op,
      where: (args.where ?? {}) as Record<string, unknown>,
      data: (args.data ?? {}) as Record<string, unknown>,
      count,
    });
  };

  const blankAdmin = (id: string): Record<string, unknown> => {
    const now = new Date();
    return {
      id,
      email: `${id}@fake.invalid`,
      passwordHash: "",
      name: "Fake Admin",
      roleId: "fake-role",
      isActive: true,
      emailVerified: true,
      lastLoginAt: null,
      passwordResetToken: null,
      passwordResetExpires: null,
      mfaEnabled: false,
      mfaSecret: null,
      passwordHashAlgo: "argon2id",
      passwordChangedAt: now,
      passwordHistory: [],
      mustChangePassword: false,
      mfaBackupCodes: [],
      mfaBackupUsedAt: {},
      mfaLastUsedTotpStep: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lockReason: null,
      maxConcurrentSessions: 3,
      timezone: "UTC",
      locale: "en",
      department: null,
      team: null,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    };
  };

  const blankSession = (id: string, userId: string): Record<string, unknown> => {
    const now = new Date();
    return {
      id,
      userId,
      refreshTokenHash: `hash-${id}`,
      ipAddress: null,
      userAgent: null,
      isActive: true,
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      revokedAt: null,
      csrfToken: `csrf-${id}`,
      deviceId: null,
      deviceName: null,
      location: null,
      lastActivityAt: now,
      revokedBy: null,
      revokeReason: null,
    };
  };

  const refuseIfFailing = (row: Record<string, unknown>, operation: string): void => {
    if (failing.has(row.id as string)) {
      fail(`write failure armed for "${String(row.id)}" (${operation})`);
    }
  };

  const selectAdmins = (where: Record<string, unknown> | undefined): Record<string, unknown>[] =>
    [...admins.values()].filter((row) => matchesWhere(row, where, ADMIN_USER_COLUMNS, "adminUser"));

  const adminUser = {
    findFirst: async (args: Record<string, unknown>): Promise<unknown> => {
      const [row] = selectAdmins(args.where as Record<string, unknown> | undefined);
      const projected = row ? project(row, args.select, ADMIN_USER_COLUMNS, "adminUser") : null;
      // The post-read hook runs AFTER the snapshot is taken and BEFORE the caller
      // resumes, which is exactly the window a concurrent writer occupies.
      if (afterRead) {
        const hook = afterRead;
        afterRead = null;
        hook();
      }
      return projected;
    },

    findUnique: async (args: Record<string, unknown>): Promise<unknown> => {
      const [row] = selectAdmins(args.where as Record<string, unknown> | undefined);
      return row ? project(row, args.select, ADMIN_USER_COLUMNS, "adminUser") : null;
    },

    update: async (args: Record<string, unknown>): Promise<unknown> => {
      const [row] = selectAdmins(args.where as Record<string, unknown> | undefined);
      if (!row) throw recordNotFoundError("adminUser.update");
      refuseIfFailing(row, "update");
      const next = applyData(
        row,
        args.data as Record<string, unknown>,
        ADMIN_USER_COLUMNS,
        "adminUser",
        "updatedAt"
      );
      admins.set(next.id as string, next);
      record("update", args, null);
      return project(next, args.select, ADMIN_USER_COLUMNS, "adminUser");
    },

    updateMany: async (args: Record<string, unknown>): Promise<{ count: number }> => {
      const matched = selectAdmins(args.where as Record<string, unknown> | undefined);
      for (const row of matched) refuseIfFailing(row, "updateMany");
      for (const row of matched) {
        const next = applyData(
          row,
          args.data as Record<string, unknown>,
          ADMIN_USER_COLUMNS,
          "adminUser",
          "updatedAt"
        );
        admins.set(next.id as string, next);
      }
      record("updateMany", args, matched.length);
      return { count: matched.length };
    },
  };

  const adminSession = {
    updateMany: async (args: Record<string, unknown>): Promise<{ count: number }> => {
      const matched = [...sessions.values()].filter((row) =>
        matchesWhere(
          row,
          args.where as Record<string, unknown> | undefined,
          ADMIN_SESSION_COLUMNS,
          "adminSession"
        )
      );
      for (const row of matched) {
        const next = applyData(
          row,
          args.data as Record<string, unknown>,
          ADMIN_SESSION_COLUMNS,
          "adminSession",
          null
        );
        sessions.set(next.id as string, next);
      }
      return { count: matched.length };
    },
  };

  return {
    client: { adminUser, adminSession } as unknown as PrismaClient,

    seedAdmin(overrides) {
      const row = { ...blankAdmin(overrides.id), ...overrides };
      admins.set(row.id, row as unknown as Record<string, unknown>);
      return row as FakeAdminUserRow;
    },

    mutateAdmin(id, patch) {
      const row = admins.get(id);
      if (!row) fail(`mutateAdmin: no row "${id}" to move`);
      admins.set(id, { ...row, ...patch, updatedAt: new Date() });
    },

    seedSession(overrides) {
      const row = { ...blankSession(overrides.id, overrides.userId), ...overrides };
      sessions.set(row.id as string, row as unknown as Record<string, unknown>);
    },

    readAdmin(id) {
      const row = admins.get(id);
      return row as unknown as FakeAdminUserRow | undefined;
    },

    readSessions(userId) {
      return [...sessions.values()].filter(
        (row) => row.userId === userId
      ) as unknown as FakeAdminSessionRow[];
    },

    afterNextRead(hook) {
      afterRead = hook;
    },

    failWritesFor(userId) {
      failing.add(userId);
    },

    writes() {
      return [...attempted];
    },
  };
}
