/**
 * @file subscriptionService.test.ts
 * @description Unit tests for SubscriptionService — subscription management,
 *              upgrades, downgrades, trials, suspension, limits, stats, and listing.
 *
 *              Uses vi.hoisted() + vi.mock() to intercept @infra/prisma so the
 *              module-level singleton in billing/subscription/index.ts receives
 *              a fully mocked PrismaClient backed by in-memory stores.
 *
 *              No real database connection is needed.
 * @layer test
 */

import { describe, it, beforeAll, beforeEach, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// 1. Hoisted mock setup — runs before any imports
// ---------------------------------------------------------------------------

const { mockModule, stores } = vi.hoisted(() => {
  const { randomUUID } = require("crypto") as typeof import("crypto");

  type StoreRecord = Record<string, unknown>;

  interface ModelStore {
    data: Map<string, StoreRecord>;
    add(record: StoreRecord): StoreRecord;
    get(id: string): StoreRecord | undefined;
    update(id: string, data: Partial<StoreRecord>): StoreRecord | undefined;
    remove(id: string): void;
    clear(): void;
    all(): StoreRecord[];
    find(predicate: (r: StoreRecord) => boolean): StoreRecord | undefined;
    filter(predicate: (r: StoreRecord) => boolean): StoreRecord[];
  }

  function createStore(): ModelStore {
    const data = new Map<string, StoreRecord>();
    return {
      data,
      add(record) {
        const id = (record["id"] as string) || randomUUID();
        const full = { ...record, id };
        data.set(id, full);
        return full;
      },
      get(id) {
        return data.get(id);
      },
      update(id, partial) {
        const existing = data.get(id);
        if (!existing) return undefined;
        const updated = { ...existing, ...partial };
        data.set(id, updated);
        return updated;
      },
      remove(id) {
        data.delete(id);
      },
      clear() {
        data.clear();
      },
      all() {
        return [...data.values()];
      },
      find(predicate) {
        return [...data.values()].find(predicate);
      },
      filter(predicate) {
        return [...data.values()].filter(predicate);
      },
    };
  }

  // ---- Stores for each model used by the subscription services ----
  const accountStore = createStore();
  const projectStore = createStore();
  const auditLogStore = createStore();
  const postStore = createStore();
  const postMediaStore = createStore();

  // ---- Helper: match a "where" clause against a record (basic subset) ----
  function matchesWhere(record: StoreRecord, where: StoreRecord): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === "OR") {
        const orClauses = v as StoreRecord[];
        const anyMatch = orClauses.some((clause) => matchesWhere(record, clause));
        if (!anyMatch) return false;
        continue;
      }
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
        const cond = v as Record<string, unknown>;
        const fieldVal = record[k];
        if ("contains" in cond) {
          const mode = cond["mode"] as string | undefined;
          const needle = cond["contains"] as string;
          const haystack = String(fieldVal ?? "");
          if (mode === "insensitive") {
            if (!haystack.toLowerCase().includes(needle.toLowerCase())) return false;
          } else {
            if (!haystack.includes(needle)) return false;
          }
          continue;
        }
        if ("in" in cond) {
          const arr = cond["in"] as unknown[];
          if (!arr.includes(fieldVal)) return false;
          continue;
        }
        if ("gte" in cond || "lte" in cond || "lt" in cond) {
          const val = fieldVal as Date | number | null;
          if (val == null) return false;
          const t = val instanceof Date ? val.getTime() : val;
          if ("gte" in cond) {
            const gte = cond["gte"] as Date | number;
            if (t < (gte instanceof Date ? gte.getTime() : gte)) return false;
          }
          if ("lte" in cond) {
            const lte = cond["lte"] as Date | number;
            if (t > (lte instanceof Date ? lte.getTime() : lte)) return false;
          }
          if ("lt" in cond) {
            const lt = cond["lt"] as Date | number;
            if (t >= (lt instanceof Date ? lt.getTime() : lt)) return false;
          }
          continue;
        }
        // Nested object match (e.g. { project: { select: ... } })
        continue;
      }
      if (record[k] !== v) return false;
    }
    return true;
  }

  // ---- Build account model mock ----
  const accountModel = {
    create: vi.fn(async ({ data }: { data: StoreRecord }) => {
      const now = new Date();
      const record = {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        trialStartDate: null,
        trialEndDate: null,
        nextBillingDate: null,
        lastBillingDate: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        ...data,
      };
      const stored = accountStore.add(record);
      return stored;
    }),
    findUnique: vi.fn(async (args: { where: StoreRecord; include?: StoreRecord }) => {
      const id = args.where["id"] as string | undefined;
      const email = args.where["email"] as string | undefined;
      let account: StoreRecord | undefined;
      if (id) {
        account = accountStore.get(id);
      } else if (email) {
        account = accountStore.find((a) => a["email"] === email);
      }
      if (!account) return null;
      if (args.include && (args.include as StoreRecord)["projects"]) {
        const acctId = account["id"] as string;
        const projects = projectStore.filter((p) => p["accountId"] === acctId);
        return { ...account, projects };
      }
      return { ...account };
    }),
    findMany: vi.fn(
      async (args?: {
        where?: StoreRecord;
        orderBy?: StoreRecord;
        skip?: number;
        take?: number;
        include?: StoreRecord;
        select?: StoreRecord;
        distinct?: string[];
      }) => {
        let results = accountStore.all();
        if (args?.where) {
          results = results.filter((r) => matchesWhere(r, args.where as StoreRecord));
        }
        if (args?.orderBy) {
          const orderBy = args.orderBy as Record<string, "asc" | "desc">;
          const [field, dir] = Object.entries(orderBy)[0] ?? [];
          if (field) {
            results.sort((a, b) => {
              const aVal = a[field] as string | number | Date;
              const bVal = b[field] as string | number | Date;
              const aTime = aVal instanceof Date ? aVal.getTime() : aVal;
              const bTime = bVal instanceof Date ? bVal.getTime() : bVal;
              if (aTime < bTime) return dir === "asc" ? -1 : 1;
              if (aTime > bTime) return dir === "asc" ? 1 : -1;
              return 0;
            });
          }
        }
        if (args?.skip) results = results.slice(args.skip);
        if (args?.take) results = results.slice(0, args.take);
        if (args?.include && (args.include as StoreRecord)["projects"]) {
          results = results.map((r) => {
            const acctId = r["id"] as string;
            const projects = projectStore.filter((p) => p["accountId"] === acctId);
            return { ...r, projects };
          });
        }
        return results;
      }
    ),
    update: vi.fn(
      async (args: { where: StoreRecord; data: StoreRecord; include?: StoreRecord }) => {
        const id = args.where["id"] as string;
        const updated = accountStore.update(id, { ...args.data, updatedAt: new Date() });
        if (!updated) return null;
        if (args.include && (args.include as StoreRecord)["projects"]) {
          const projects = projectStore.filter((p) => p["accountId"] === id);
          return { ...updated, projects };
        }
        return { ...updated };
      }
    ),
    count: vi.fn(async (args?: { where?: StoreRecord }) => {
      if (!args?.where) return accountStore.data.size;
      return accountStore.filter((r) => matchesWhere(r, args.where as StoreRecord)).length;
    }),
    deleteMany: vi.fn(async () => {
      const count = accountStore.data.size;
      accountStore.clear();
      return { count };
    }),
    groupBy: vi.fn(async (args: { by: string[]; _count: StoreRecord }) => {
      const field = args.by[0];
      if (!field) return [];
      const groups = new Map<string, number>();
      for (const record of accountStore.all()) {
        const key = String(record[field] ?? "UNKNOWN");
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      return [...groups.entries()].map(([val, count]) => ({
        [field]: val,
        _count: { id: count },
      }));
    }),
  };

  // ---- Build auditLog model mock ----
  const auditLogModel = {
    create: vi.fn(async ({ data }: { data: StoreRecord }) => {
      const now = new Date();
      const record = { id: randomUUID(), createdAt: now, ...data };
      return auditLogStore.add(record);
    }),
    count: vi.fn(async (args?: { where?: StoreRecord }) => {
      if (!args?.where) return auditLogStore.data.size;
      return auditLogStore.filter((r) => {
        for (const [k, v] of Object.entries(args.where as StoreRecord)) {
          if (v && typeof v === "object" && "contains" in (v as Record<string, unknown>)) {
            const needle = (v as Record<string, unknown>)["contains"] as string;
            if (!String(r[k] ?? "").includes(needle)) return false;
          }
        }
        return true;
      }).length;
    }),
  };

  // ---- Build post model mock ----
  const postModel = {
    findMany: vi.fn(async () => []),
  };

  // ---- Build postMedia model mock ----
  const postMediaModel = {
    groupBy: vi.fn(async () => []),
  };

  // ---- Build accountSubscription model mock ----
  const accountSubscriptionModel = {
    groupBy: vi.fn(async (_args: { by: string[]; _count: StoreRecord; _sum?: StoreRecord }) => {
      // Return empty distribution by default
      return [];
    }),
    count: vi.fn(async () => 0),
    updateMany: vi.fn(async () => ({ count: 0 })),
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
  };

  const prisma = {
    account: accountModel,
    accountSubscription: accountSubscriptionModel,
    project: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    auditLog: auditLogModel,
    post: postModel,
    postMedia: postMediaModel,
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  return {
    mockModule: { prisma },
    stores: {
      account: accountStore,
      project: projectStore,
      auditLog: auditLogStore,
      post: postStore,
      postMedia: postMediaStore,
    },
  };
});

// Mock @infra/prisma — merge with original to preserve re-exported enums/types
vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, ...mockModule };
});

// Silence logger output in tests
vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const silentLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => silentLogger,
  };
  return {
    logger: silentLogger,
    authLogger: silentLogger,
    createLogger: () => silentLogger,
  };
});

// ---------------------------------------------------------------------------
// 2. Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { subscriptionService } from "../../src/billing/subscriptionService.js";

// ---------------------------------------------------------------------------
// 3. Test data
// ---------------------------------------------------------------------------

const testAccountEmail = `test-subscription-unit@example.com`;
const trialAccountEmail = `test-trial-unit@example.com`;

let testAccountId: string;
let trialAccountId: string;

// ========== SETUP ==========

beforeAll(async () => {
  // Create test account for subscription tests via the mock store
  const testAccount = stores.account.add({
    name: "Test Subscription Account",
    email: testAccountEmail,
    maxProjects: 1,
    isOnTrial: false,
    autoRenewal: false,
    billingCycle: "monthly",
    trialStartDate: null,
    trialEndDate: null,
    nextBillingDate: null,
    lastBillingDate: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  testAccountId = testAccount["id"] as string;
});

beforeEach(() => {
  // Clear audit logs between tests to keep stores lean
  stores.auditLog.clear();
});

// ========== SUBSCRIPTION PLAN TESTS ==========

describe("Subscription Plan Management", () => {
  it("should get plan details for BASIC tier", () => {
    const basicPlan = subscriptionService.getSubscriptionPlan("BASIC");

    expect(basicPlan.tier).toBe("BASIC");
    expect(basicPlan.name).toBe("Basic Plan");
    expect(basicPlan.maxProjects).toBe(1);
    expect(basicPlan.monthlyPrice > 0).toBeTruthy();
    expect(basicPlan.yearlyPrice > 0).toBeTruthy();
  });

  it("should get all available plans", () => {
    const allPlans = subscriptionService.getAllPlans();

    expect(allPlans.length).toBe(3);
    expect(allPlans.find((p) => p.tier === "BASIC")).toBeTruthy();
    expect(allPlans.find((p) => p.tier === "PRO")).toBeTruthy();
    expect(allPlans.find((p) => p.tier === "ENTERPRISE")).toBeTruthy();
  });
});

// ========== ACCOUNT SUBSCRIPTION TESTS ==========

describe("Account Subscription Retrieval", () => {
  it("should get account subscription info", async () => {
    const result = await subscriptionService.getAccountSubscription(testAccountId);

    expect(result.ok).toBeTruthy();
    expect(result.value.subscription).toBe("BASIC");
    expect(result.value.plan.tier).toBe("BASIC");
    expect(result.value.email).toBe(testAccountEmail);
    expect(result.value.isActive).toBe(true);
  });

  it("should return NOT_FOUND for non-existent account", async () => {
    const result = await subscriptionService.getAccountSubscription("non-existent-id");

    expect(result.ok).toBeFalsy();
    expect(result.error).toBe("NOT_FOUND");
  });
});

// ========== SUBSCRIPTION UPDATE TESTS ==========

describe("Subscription Updates (deprecated — Account.subscription removed)", () => {
  it("should return INVALID_TIER for any update (deprecated method)", async () => {
    const result = await subscriptionService.updateSubscription(testAccountId, {
      newTier: "PRO",
      billingCycle: "monthly",
      reason: "User upgrade request",
    });

    expect(result.ok).toBeFalsy();
    expect(result.error).toBe("INVALID_TIER");
  });

  it("should return INVALID_TIER for non-existent account (deprecated method)", async () => {
    const result = await subscriptionService.updateSubscription("non-existent-id", {
      newTier: "PRO",
      billingCycle: "monthly",
    });

    expect(result.ok).toBeFalsy();
    expect(result.error).toBe("INVALID_TIER");
  });
});

// ========== TRIAL MANAGEMENT TESTS ==========

describe("Trial Period Management", () => {
  it("should start trial period successfully", async () => {
    // Create new account for trial test via store
    const trialAccount = stores.account.add({
      name: "Test Trial Account",
      email: trialAccountEmail,
      maxProjects: 1,
      isOnTrial: false,
      autoRenewal: false,
      billingCycle: "monthly",
      trialStartDate: null,
      trialEndDate: null,
      nextBillingDate: null,
      lastBillingDate: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    trialAccountId = trialAccount["id"] as string;

    const result = await subscriptionService.startTrial({
      accountId: trialAccountId,
      tier: "PRO",
      trialDurationDays: 14,
      autoRenewal: false,
      billingCycle: "monthly",
    });

    expect(result.ok).toBeTruthy();
    expect(result.value.trial.isOnTrial).toBe(true);
    expect(result.value.trial.trialDaysRemaining > 0).toBeTruthy();
    // After removing Account.subscription, mapAccountToSubscriptionInfo defaults to "BASIC"
    expect(result.value.subscription).toBe("BASIC");
  });

  it("should reject starting trial when already on trial", async () => {
    const result = await subscriptionService.startTrial({
      accountId: trialAccountId,
      tier: "PRO",
      trialDurationDays: 14,
    });

    expect(result.ok).toBeFalsy();
    expect(result.error).toBe("ALREADY_ON_TRIAL");
  });

  it("should end trial period successfully", async () => {
    const result = await subscriptionService.endTrial(trialAccountId, "User cancelled trial");

    expect(result.ok).toBeTruthy();
    expect(result.value.trial.isOnTrial).toBe(false);
    expect(result.value.subscription).toBe("BASIC");
  });

  it("should reject ending trial when not on trial", async () => {
    const result = await subscriptionService.endTrial(trialAccountId, "Already ended");

    expect(result.ok).toBeFalsy();
    expect(result.error).toBe("NOT_ON_TRIAL");
  });

  it("should return NOT_FOUND for non-existent account", async () => {
    const result = await subscriptionService.startTrial({
      accountId: "non-existent-id",
      tier: "PRO",
      trialDurationDays: 14,
    });

    expect(result.ok).toBeFalsy();
    expect(result.error).toBe("NOT_FOUND");
  });
});

// ========== SUBSCRIPTION SUSPENSION TESTS ==========

describe("Subscription Suspension", () => {
  it("should suspend subscription successfully", async () => {
    const result = await subscriptionService.suspendSubscription(
      testAccountId,
      "Payment failure",
      undefined
    );

    expect(result.ok).toBeTruthy();
  });

  it("should return NOT_FOUND for non-existent account", async () => {
    const result = await subscriptionService.suspendSubscription(
      "non-existent-id",
      "Test",
      undefined
    );

    expect(result.ok).toBeFalsy();
    expect(result.error).toBe("NOT_FOUND");
  });
});

// ========== SUBSCRIPTION LIMITS VALIDATION TESTS ==========

describe("Subscription Limits Validation", () => {
  it("should validate CREATE_PROJECT operation within limits", async () => {
    const result = await subscriptionService.validateSubscriptionLimits(
      testAccountId,
      "CREATE_PROJECT",
      1
    );

    expect(result.ok).toBeTruthy();
    expect(result.value.allowed).toBeTruthy();
    expect(result.value.remaining >= 0).toBeTruthy();
  });

  it("should validate ADD_TEAM_MEMBER operation", async () => {
    const result = await subscriptionService.validateSubscriptionLimits(
      testAccountId,
      "ADD_TEAM_MEMBER",
      1
    );

    expect(result.ok).toBeTruthy();
    expect(typeof result.value.allowed === "boolean").toBeTruthy();
    expect(result.value.limit >= 0).toBeTruthy();
  });

  it("should validate UPLOAD_MEDIA operation", async () => {
    const result = await subscriptionService.validateSubscriptionLimits(
      testAccountId,
      "UPLOAD_MEDIA",
      0.5 // 0.5 GB
    );

    expect(result.ok).toBeTruthy();
    expect(typeof result.value.allowed === "boolean").toBeTruthy();
    expect(result.value.limit > 0).toBeTruthy();
  });

  it("should return NOT_FOUND for non-existent account", async () => {
    const result = await subscriptionService.validateSubscriptionLimits(
      "non-existent-id",
      "CREATE_PROJECT",
      1
    );

    expect(result.ok).toBeFalsy();
    expect(result.error).toBe("NOT_FOUND");
  });
});

// ========== SUBSCRIPTION STATISTICS TESTS ==========

describe("Subscription Statistics", () => {
  it("should get subscription statistics", async () => {
    const result = await subscriptionService.getSubscriptionStats();

    expect(result.ok).toBeTruthy();
    expect(typeof result.value.totalSubscriptions === "number").toBeTruthy();
    expect(result.value.subscriptionsByTier).toBeTruthy();
    expect(result.value.totalRevenue).toBeTruthy();
    expect(result.value.conversionRates).toBeTruthy();
    expect(result.value.churnRisk).toBeTruthy();
    expect(result.value.growthMetrics).toBeTruthy();
  });
});

// ========== EXPIRING TRIALS TESTS ==========

describe("Expiring Trials Management", () => {
  it("should get expiring trials", async () => {
    const result = await subscriptionService.getExpiringTrials(7);

    expect(result.ok).toBeTruthy();
    expect(Array.isArray(result.value)).toBeTruthy();
  });
});

// ========== LIST SUBSCRIPTIONS TESTS ==========

describe("List Account Subscriptions", () => {
  it("should list all subscriptions with pagination", async () => {
    const result = await subscriptionService.listAccountSubscriptions({}, 1, 10);

    expect(result.ok).toBeTruthy();
    expect(Array.isArray(result.value.subscriptions)).toBeTruthy();
    expect(result.value.total >= 0).toBeTruthy();
    expect(result.value.page).toBe(1);
    expect(result.value.limit).toBe(10);
  });

  it("should filter subscriptions by tier", async () => {
    const result = await subscriptionService.listAccountSubscriptions({ tier: "BASIC" }, 1, 10);

    expect(result.ok).toBeTruthy();
    expect(result.value.subscriptions.every((sub) => sub.subscription === "BASIC")).toBeTruthy();
  });

  it("should search subscriptions by email", async () => {
    const result = await subscriptionService.listAccountSubscriptions(
      { search: testAccountEmail.substring(0, 20) },
      1,
      10
    );

    expect(result.ok).toBeTruthy();
    // Search should return results or empty array
    expect(Array.isArray(result.value.subscriptions)).toBeTruthy();
  });

  it("should sort subscriptions by different fields", async () => {
    const result = await subscriptionService.listAccountSubscriptions(
      { sortBy: "createdAt", sortOrder: "desc" },
      1,
      10
    );

    expect(result.ok).toBeTruthy();
    expect(Array.isArray(result.value.subscriptions)).toBeTruthy();
  });
});
