/**
 * @file mockPrisma.ts
 * @description Stateful in-memory mock of the Prisma client for unit tests.
 *              Maintains internal Maps per model so sequential test flows
 *              (create -> read -> update -> verify) work without a real database.
 *
 *              Usage in test files:
 *              ```ts
 *              import { createMockPrismaModule } from './helpers/mockPrisma.js';
 *              const { mockPrisma, stores } = createMockPrismaModule();
 *              vi.mock('@infra/prisma', async (importOriginal) => {
 *                const orig = await importOriginal<Record<string, unknown>>();
 *                return { ...orig, prisma: mockPrisma.prisma };
 *              });
 *              ```
 * @layer test-infrastructure
 */

import { vi } from "vitest";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelStore<T extends Record<string, unknown>> {
  data: Map<string, T>;
  add(record: T): T;
  get(id: string): T | undefined;
  update(id: string, data: Partial<T>): T | undefined;
  remove(id: string): void;
  clear(): void;
  all(): T[];
}

function createStore<T extends Record<string, unknown>>(idField = "id"): ModelStore<T> {
  const data = new Map<string, T>();
  return {
    data,
    add(record: T): T {
      const id = (record[idField] as string) || randomUUID();
      const full = { ...record, [idField]: id } as T;
      data.set(id, full);
      return full;
    },
    get(id: string) {
      return data.get(id);
    },
    update(id: string, partial: Partial<T>) {
      const existing = data.get(id);
      if (!existing) return undefined;
      const updated = { ...existing, ...partial } as T;
      data.set(id, updated);
      return updated;
    },
    remove(id: string) {
      data.delete(id);
    },
    clear() {
      data.clear();
    },
    all() {
      return [...data.values()];
    },
  };
}

// ---------------------------------------------------------------------------
// Where clause matching (supports Prisma-style operators)
// ---------------------------------------------------------------------------

function matchesWhere(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(where)) {
    if (key === "OR") {
      const clauses = val as Record<string, unknown>[];
      if (!clauses.some((clause) => matchesWhere(record, clause))) return false;
      continue;
    }
    if (key === "AND") {
      const clauses = val as Record<string, unknown>[];
      if (!clauses.every((clause) => matchesWhere(record, clause))) return false;
      continue;
    }
    if (key === "NOT") {
      const clause = val as Record<string, unknown>;
      if (matchesWhere(record, clause)) return false;
      continue;
    }

    const recordVal = record[key];

    if (val === null || val === undefined) {
      if (recordVal !== val) return false;
      continue;
    }

    if (typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      const ops = val as Record<string, unknown>;
      if ("not" in ops) {
        if (recordVal === ops.not) return false;
        continue;
      }
      if ("in" in ops) {
        if (!(ops.in as unknown[]).includes(recordVal)) return false;
        continue;
      }
      if ("contains" in ops) {
        if (typeof recordVal !== "string") return false;
        if (!recordVal.includes(ops.contains as string)) return false;
        continue;
      }
      if ("startsWith" in ops) {
        if (typeof recordVal !== "string") return false;
        if (!recordVal.startsWith(ops.startsWith as string)) return false;
        continue;
      }
      if ("endsWith" in ops) {
        if (typeof recordVal !== "string") return false;
        if (!recordVal.endsWith(ops.endsWith as string)) return false;
        continue;
      }
      if ("gt" in ops) {
        if (!((recordVal as number) > (ops.gt as number))) return false;
        continue;
      }
      if ("gte" in ops) {
        if (!((recordVal as number) >= (ops.gte as number))) return false;
        continue;
      }
      if ("lt" in ops) {
        if (!((recordVal as number) < (ops.lt as number))) return false;
        continue;
      }
      if ("lte" in ops) {
        if (!((recordVal as number) <= (ops.lte as number))) return false;
        continue;
      }
      // Unknown operator object -- fall through to equality
    }

    if (recordVal !== val) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Include resolver (for cross-store joins like include: { user: true })
// ---------------------------------------------------------------------------

type IncludeResolver = (
  record: Record<string, unknown>,
  include: Record<string, boolean | Record<string, unknown>>
) => Record<string, unknown>;

// ---------------------------------------------------------------------------
// Model mock builders
// ---------------------------------------------------------------------------

function buildModelMock<T extends Record<string, unknown>>(
  store: ModelStore<T>,
  defaults: Partial<T> = {},
  idField = "id",
  includeResolver?: IncludeResolver
) {
  function resolveIncludes(
    record: Record<string, unknown>,
    include?: Record<string, boolean | Record<string, unknown>>
  ): Record<string, unknown> {
    if (!include || !includeResolver) return { ...record };
    return includeResolver({ ...record }, include);
  }

  return {
    create: vi.fn(async ({ data }: { data: Partial<T> }) => {
      const now = new Date();
      const record = {
        [idField]: randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...defaults,
        ...data,
      } as T;
      return store.add(record);
    }),

    createMany: vi.fn(async ({ data }: { data: Partial<T>[] }) => {
      const now = new Date();
      for (const item of data) {
        store.add({
          [idField]: randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...defaults,
          ...item,
        } as T);
      }
      return { count: data.length };
    }),

    findUnique: vi.fn(
      async ({
        where,
        include,
      }: {
        where: Record<string, unknown>;
        include?: Record<string, boolean | Record<string, unknown>>;
      }) => {
        const entries = store.all();
        const found = entries.find((entry) => matchesWhere(entry, where)) ?? null;
        if (!found) return null;
        return resolveIncludes(found, include);
      }
    ),

    findFirst: vi.fn(
      async ({
        where,
        include,
      }: {
        where: Record<string, unknown>;
        include?: Record<string, boolean | Record<string, unknown>>;
      }) => {
        const entries = store.all();
        const found = entries.find((entry) => matchesWhere(entry, where)) ?? null;
        if (!found) return null;
        return resolveIncludes(found, include);
      }
    ),

    findMany: vi.fn(
      async ({
        where,
        orderBy,
        take,
        skip,
        include,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, string> | Record<string, string>[];
        take?: number;
        skip?: number;
        include?: Record<string, boolean | Record<string, unknown>>;
      } = {}) => {
        let results = where
          ? store.all().filter((entry) => matchesWhere(entry, where))
          : store.all();

        // Apply ordering
        if (orderBy) {
          const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
          results = [...results].sort((a, b) => {
            for (const order of orders) {
              const [field, dir] = Object.entries(order)[0] ?? [];
              if (!field) continue;
              const aVal = a[field];
              const bVal = b[field];
              if (aVal === bVal) continue;
              const cmp = aVal! < bVal! ? -1 : 1;
              return dir === "desc" ? -cmp : cmp;
            }
            return 0;
          });
        }

        // Apply pagination
        if (typeof skip === "number") results = results.slice(skip);
        if (typeof take === "number") results = results.slice(0, take);

        return results.map((r) => resolveIncludes(r, include));
      }
    ),

    update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<T> }) => {
      // Find by any where field, not just id
      const entries = store.all();
      const found = entries.find((entry) => matchesWhere(entry, where));
      if (!found) return null;
      const id = found[idField] as string;
      const updated = store.update(id, { ...data, updatedAt: new Date() } as Partial<T>);
      return updated ?? null;
    }),

    updateMany: vi.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Partial<T> }) => {
        let count = 0;
        const entries = store.all();
        for (const entry of entries) {
          if (matchesWhere(entry, where)) {
            const id = entry[idField] as string;
            store.update(id, { ...data, updatedAt: new Date() } as Partial<T>);
            count++;
          }
        }
        return { count };
      }
    ),

    upsert: vi.fn(
      async ({
        where,
        create: createData,
        update: updateData,
      }: {
        where: Record<string, unknown>;
        create: Partial<T>;
        update: Partial<T>;
      }) => {
        const entries = store.all();
        const existing = entries.find((entry) => matchesWhere(entry, where));
        if (existing) {
          const id = existing[idField] as string;
          return store.update(id, { ...updateData, updatedAt: new Date() } as Partial<T>);
        }
        const now = new Date();
        return store.add({
          [idField]: randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...defaults,
          ...createData,
        } as T);
      }
    ),

    delete: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const entries = store.all();
      const found = entries.find((entry) => matchesWhere(entry, where));
      if (!found) return null;
      const id = found[idField] as string;
      store.remove(id);
      return found;
    }),

    deleteMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
      if (!where) {
        const count = store.data.size;
        store.clear();
        return { count };
      }
      const entries = store.all();
      let count = 0;
      for (const entry of entries) {
        if (matchesWhere(entry, where)) {
          const id = entry[idField] as string;
          store.remove(id);
          count++;
        }
      }
      return { count };
    }),

    count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
      if (!where) return store.data.size;
      return store.all().filter((entry) => matchesWhere(entry, where)).length;
    }),

    groupBy: vi.fn(
      async (
        {
          by,
          where,
          _count,
          orderBy: _orderBy,
          take: _take,
        }: {
          by: string[];
          where?: Record<string, unknown>;
          _count?: Record<string, boolean> | boolean;
          orderBy?: Record<string, unknown>;
          take?: number;
        } = { by: [] }
      ) => {
        const entries = where
          ? store.all().filter((entry) => matchesWhere(entry, where))
          : store.all();
        const groups = new Map<string, number>();
        const groupField = by[0] ?? "id";
        for (const entry of entries) {
          const key = String(entry[groupField] ?? "");
          groups.set(key, (groups.get(key) ?? 0) + 1);
        }
        const result = [...groups.entries()].map(([key, count]) => {
          // Build _count object matching Prisma's output shape
          let countVal: number | Record<string, number>;
          if (typeof _count === "boolean") {
            countVal = count;
          } else if (_count && typeof _count === "object") {
            // e.g. _count: { action: true } -> _count: { action: count }
            countVal = {};
            for (const [field, enabled] of Object.entries(_count)) {
              if (enabled) (countVal as Record<string, number>)[field] = count;
            }
          } else {
            countVal = { _all: count };
          }
          return { [groupField]: key, _count: countVal };
        });
        return _take ? result.slice(0, _take) : result;
      }
    ),

    aggregate: vi.fn(async () => ({
      _avg: {},
      _count: {},
      _sum: {},
      _min: {},
      _max: {},
    })),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MockPrismaStores {
  adminUser: ModelStore<Record<string, unknown>>;
  adminSession: ModelStore<Record<string, unknown>>;
  auditLog: ModelStore<Record<string, unknown>>;
  account: ModelStore<Record<string, unknown>>;
  project: ModelStore<Record<string, unknown>>;
  apiKey: ModelStore<Record<string, unknown>>;
  webhookEvent: ModelStore<Record<string, unknown>>;
  webhookSubscription: ModelStore<Record<string, unknown>>;
  webhookDeadLetter: ModelStore<Record<string, unknown>>;
}

/**
 * Create a full mock @infra/prisma module with stateful in-memory stores.
 * Returns both the mock module (for vi.mock) and the backing stores
 * (for direct manipulation in test setup/assertions).
 */
export function createMockPrismaModule() {
  const stores: MockPrismaStores = {
    adminUser: createStore(),
    adminSession: createStore(),
    auditLog: createStore(),
    account: createStore(),
    project: createStore(),
    apiKey: createStore(),
    webhookEvent: createStore(),
    webhookSubscription: createStore(),
    webhookDeadLetter: createStore(),
  };

  // Session include resolver: resolves include: { user: true }
  const sessionIncludeResolver: IncludeResolver = (record, include) => {
    const result = { ...record };
    if (include.user) {
      const userId = record.userId as string;
      const user = stores.adminUser.all().find((u) => u.id === userId) ?? null;
      result.user = user ? { ...user } : null;
    }
    return result;
  };

  // Default field values for each model -- mirrors real DB defaults
  const adminUserDefaults = {
    passwordHashAlgo: "argon2id",
    isActive: true,
    mfaEnabled: false,
    mfaSecret: null,
    mfaBackupCodes: [],
    mfaBackupUsedAt: {},
    failedLoginAttempts: 0,
    lockedUntil: null,
    lockReason: null,
    maxConcurrentSessions: 5,
    passwordHistory: [],
    passwordChangedAt: null,
    passwordResetToken: null,
    passwordResetExpires: null,
    mustChangePassword: false,
    emailVerified: false,
    timezone: null,
    locale: null,
    department: null,
    team: null,
    lastLoginAt: null,
  } as Record<string, unknown>;

  const adminSessionDefaults = {
    csrfToken: "",
    ipAddress: null,
    userAgent: null,
    deviceId: null,
    deviceName: null,
    location: null,
    isActive: true,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    lastActivityAt: new Date(),
    revokedAt: null,
    revokeReason: null,
  } as Record<string, unknown>;

  const auditLogDefaults = {
    userId: null,
    action: "",
    resource: null,
    resourceId: null,
    success: true,
    ipAddress: null,
    userAgent: null,
    details: null,
    severity: "LOW",
    category: null,
  } as Record<string, unknown>;

  const prisma = {
    adminUser: buildModelMock(stores.adminUser, adminUserDefaults),
    adminSession: buildModelMock(
      stores.adminSession,
      adminSessionDefaults,
      "id",
      sessionIncludeResolver
    ),
    auditLog: buildModelMock(stores.auditLog, auditLogDefaults),
    account: buildModelMock(stores.account),
    project: buildModelMock(stores.project),
    apiKey: buildModelMock(stores.apiKey),
    webhookEvent: buildModelMock(stores.webhookEvent),
    webhookSubscription: buildModelMock(stores.webhookSubscription),
    webhookDeadLetter: buildModelMock(stores.webhookDeadLetter),
    // Prisma client lifecycle methods
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined),
    $transaction: vi.fn(async (fnOrArray: unknown) => {
      if (typeof fnOrArray === "function") {
        return (fnOrArray as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return Promise.all(fnOrArray as Promise<unknown>[]);
    }),
  };

  // Build the full module mock -- re-export all enums from the real vitest-entry
  const mockModule = {
    prisma,
    // Enums are re-exported from the real module by the vi.mock factory
    // using importOriginal(). This object is merged in the test file.
  };

  return { mockPrisma: mockModule, stores, prisma };
}

// Re-export helpers for tests that need to extend the mock prisma with additional models
export { matchesWhere, createStore, buildModelMock };
