/**
 * @file webhookDashboardService.test.ts
 * @description Unit tests for WebhookDashboardService — dashboard metrics,
 *              event queries, DLQ management, subscriptions, and CSV exports.
 *
 *              Uses vi.hoisted() + vi.mock() to intercept @infra/prisma so the
 *              module-level singleton receives a fully mocked PrismaClient backed
 *              by in-memory stores. No real database connection is needed.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";

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

  // ---- Helper: match a "where" clause against a record ----
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
        if ("not" in cond) {
          if (fieldVal === cond["not"]) return false;
          if (cond["not"] === null && fieldVal == null) return false;
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
        // Nested object — skip (e.g. include/select)
        continue;
      }
      if (record[k] !== v) return false;
    }
    return true;
  }

  // ---- Stores ----
  const webhookEventStore = createStore();
  const webhookSubscriptionStore = createStore();
  const webhookDeadLetterStore = createStore();
  const accountStore = createStore();
  const projectStore = createStore();

  // ---- webhookEvent model ----
  const webhookEventModel = {
    create: vi.fn(async ({ data }: { data: StoreRecord }) => {
      const now = new Date();
      const record = {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        lastError: null,
        processingTime: null,
        processedAt: null,
        nextRetryAt: null,
        postId: null,
        channelId: null,
        ...data,
      };
      return webhookEventStore.add(record);
    }),
    findMany: vi.fn(
      async (args?: {
        where?: StoreRecord;
        orderBy?: StoreRecord;
        skip?: number;
        take?: number;
        select?: StoreRecord;
        include?: StoreRecord;
      }) => {
        let results = webhookEventStore.all();
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
        // If include.project, attach project data
        if (args?.include && (args.include as StoreRecord)["project"]) {
          results = results.map((r) => {
            const proj = projectStore.find((p) => p["id"] === r["projectId"]);
            return {
              ...r,
              project: proj ? { id: proj["id"], name: proj["name"] } : null,
              post: null,
            };
          });
        }
        return results;
      }
    ),
    findFirst: vi.fn(async (args?: { where?: StoreRecord; include?: StoreRecord }) => {
      let results = webhookEventStore.all();
      if (args?.where) {
        results = results.filter((r) => matchesWhere(r, args.where as StoreRecord));
      }
      const found = results[0] ?? null;
      if (!found) return null;
      if (args?.include && (args.include as StoreRecord)["project"]) {
        const proj = projectStore.find((p) => p["id"] === found["projectId"]);
        return {
          ...found,
          project: proj ? { id: proj["id"], name: proj["name"] } : null,
          post: null,
        };
      }
      return found;
    }),
    count: vi.fn(async (args?: { where?: StoreRecord }) => {
      if (!args?.where) return webhookEventStore.data.size;
      return webhookEventStore.filter((r) => matchesWhere(r, args.where as StoreRecord)).length;
    }),
    aggregate: vi.fn(async (args?: { where?: StoreRecord; _avg?: StoreRecord }) => {
      let results = webhookEventStore.all();
      if (args?.where) {
        results = results.filter((r) => matchesWhere(r, args.where as StoreRecord));
      }
      // Compute _avg.processingTime
      const times = results
        .map((r) => r["processingTime"] as number | null)
        .filter((t): t is number => t != null);
      const avg = times.length > 0 ? times.reduce((s, t) => s + t, 0) / times.length : null;
      return { _avg: { processingTime: avg } };
    }),
    groupBy: vi.fn(
      async (args: {
        by: string[];
        where?: StoreRecord;
        _count?: StoreRecord;
        _avg?: StoreRecord;
      }) => {
        let results = webhookEventStore.all();
        if (args.where) {
          results = results.filter((r) => matchesWhere(r, args.where as StoreRecord));
        }
        const byFields = args.by;

        // Build composite key from all by fields
        const groups = new Map<string, StoreRecord[]>();
        for (const record of results) {
          const key = byFields.map((f) => String(record[f] ?? "null")).join("||");
          const group = groups.get(key);
          if (group) {
            group.push(record);
          } else {
            groups.set(key, [record]);
          }
        }

        return [...groups.entries()].map(([_key, records]) => {
          const base: StoreRecord = {};
          for (const f of byFields) {
            base[f] = records[0]![f];
          }
          base["_count"] = { id: records.length };
          // _avg processingTime
          if (args._avg) {
            const times = records
              .map((r) => r["processingTime"] as number | null)
              .filter((t): t is number => t != null);
            const avg = times.length > 0 ? times.reduce((s, t) => s + t, 0) / times.length : null;
            base["_avg"] = { processingTime: avg };
          }
          return base;
        });
      }
    ),
    delete: vi.fn(async (args: { where: StoreRecord }) => {
      const id = args.where["id"] as string;
      const record = webhookEventStore.get(id);
      if (record) webhookEventStore.remove(id);
      return record ?? null;
    }),
    deleteMany: vi.fn(async (args?: { where?: StoreRecord }) => {
      if (!args?.where) {
        const count = webhookEventStore.data.size;
        webhookEventStore.clear();
        return { count };
      }
      const matching = webhookEventStore.filter((r) => matchesWhere(r, args.where as StoreRecord));
      for (const r of matching) {
        webhookEventStore.remove(r["id"] as string);
      }
      return { count: matching.length };
    }),
  };

  // ---- webhookSubscription model ----
  const webhookSubscriptionModel = {
    create: vi.fn(async ({ data }: { data: StoreRecord }) => {
      const now = new Date();
      const record = {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      return webhookSubscriptionStore.add(record);
    }),
    findMany: vi.fn(
      async (args?: { where?: StoreRecord; include?: StoreRecord; orderBy?: StoreRecord }) => {
        let results = webhookSubscriptionStore.all();
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
        // If include.project, attach project data
        if (args?.include && (args.include as StoreRecord)["project"]) {
          results = results.map((r) => {
            const proj = projectStore.find((p) => p["id"] === r["projectId"]);
            return {
              ...r,
              project: proj ? { id: proj["id"], name: proj["name"] } : null,
            };
          });
        }
        return results;
      }
    ),
    deleteMany: vi.fn(async (args?: { where?: StoreRecord }) => {
      if (!args?.where) {
        const count = webhookSubscriptionStore.data.size;
        webhookSubscriptionStore.clear();
        return { count };
      }
      const matching = webhookSubscriptionStore.filter((r) =>
        matchesWhere(r, args.where as StoreRecord)
      );
      for (const r of matching) {
        webhookSubscriptionStore.remove(r["id"] as string);
      }
      return { count: matching.length };
    }),
  };

  // ---- webhookDeadLetter model ----
  const webhookDeadLetterModel = {
    create: vi.fn(async ({ data }: { data: StoreRecord }) => {
      const now = new Date();
      const record = {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        resolvedBy: null,
        finalError: null,
        ...data,
      };
      return webhookDeadLetterStore.add(record);
    }),
    findMany: vi.fn(
      async (args?: {
        where?: StoreRecord;
        orderBy?: StoreRecord;
        skip?: number;
        take?: number;
      }) => {
        let results = webhookDeadLetterStore.all();
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
        return results;
      }
    ),
    findFirst: vi.fn(async (args?: { where?: StoreRecord }) => {
      let results = webhookDeadLetterStore.all();
      if (args?.where) {
        results = results.filter((r) => matchesWhere(r, args.where as StoreRecord));
      }
      return results[0] ?? null;
    }),
    findUnique: vi.fn(async (args: { where: StoreRecord }) => {
      const id = args.where["id"] as string;
      return webhookDeadLetterStore.get(id) ?? null;
    }),
    count: vi.fn(async (args?: { where?: StoreRecord }) => {
      if (!args?.where) return webhookDeadLetterStore.data.size;
      return webhookDeadLetterStore.filter((r) => matchesWhere(r, args.where as StoreRecord))
        .length;
    }),
    update: vi.fn(async (args: { where: StoreRecord; data: StoreRecord }) => {
      const id = args.where["id"] as string;
      const updated = webhookDeadLetterStore.update(id, {
        ...args.data,
        updatedAt: new Date(),
      });
      return updated ?? null;
    }),
    deleteMany: vi.fn(async (args?: { where?: StoreRecord }) => {
      if (!args?.where) {
        const count = webhookDeadLetterStore.data.size;
        webhookDeadLetterStore.clear();
        return { count };
      }
      const matching = webhookDeadLetterStore.filter((r) =>
        matchesWhere(r, args.where as StoreRecord)
      );
      for (const r of matching) {
        webhookDeadLetterStore.remove(r["id"] as string);
      }
      return { count: matching.length };
    }),
  };

  // ---- account model (minimal) ----
  const accountModel = {
    create: vi.fn(async ({ data }: { data: StoreRecord }) => {
      const now = new Date();
      const record = { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
      return accountStore.add(record);
    }),
    delete: vi.fn(async (args: { where: StoreRecord }) => {
      const id = args.where["id"] as string;
      const record = accountStore.get(id);
      if (record) accountStore.remove(id);
      return record ?? null;
    }),
  };

  // ---- project model (minimal) ----
  const projectModel = {
    create: vi.fn(async ({ data }: { data: StoreRecord }) => {
      const now = new Date();
      const record = { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
      return projectStore.add(record);
    }),
    delete: vi.fn(async (args: { where: StoreRecord }) => {
      const id = args.where["id"] as string;
      const record = projectStore.get(id);
      if (record) projectStore.remove(id);
      return record ?? null;
    }),
  };

  const prisma = {
    webhookEvent: webhookEventModel,
    webhookSubscription: webhookSubscriptionModel,
    webhookDeadLetter: webhookDeadLetterModel,
    account: accountModel,
    project: projectModel,
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  return {
    mockModule: { prisma },
    stores: {
      webhookEvent: webhookEventStore,
      webhookSubscription: webhookSubscriptionStore,
      webhookDeadLetter: webhookDeadLetterStore,
      account: accountStore,
      project: projectStore,
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
  return { logger: silentLogger, createLogger: () => silentLogger };
});

// ---------------------------------------------------------------------------
// 2. Imports (after mocks are wired)
// ---------------------------------------------------------------------------

import { webhookDashboardService } from "../../src/webhooks/webhookDashboardService.js";
import type { Provider } from "@infra/prisma";

// ---------------------------------------------------------------------------
// 3. Test data setup helpers
// ---------------------------------------------------------------------------

let testAccountId: string;
let testProjectId: string;
let testEvents: Array<{ id: string; eventId: string }> = [];
let testDeadLetterEventId: string;

const now = new Date();
const oneHourAgo = new Date(now.getTime() - 50 * 60 * 1000);
const sixHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
const oneDayAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000);
const timestamp = Date.now();

function seedTestData(): void {
  // Create test account
  const account = stores.account.add({
    email: `webhook-test-${timestamp}@example.com`,
    name: "Webhook Test Account",
    subscription: "PRO",
    createdAt: now,
    updatedAt: now,
  });
  testAccountId = account["id"] as string;

  // Create test project
  const project = stores.project.add({
    accountId: testAccountId,
    name: `webhook-test-project-${timestamp}`,
    locale: "en",
    createdAt: now,
    updatedAt: now,
  });
  testProjectId = project["id"] as string;

  // Create test webhook subscription
  stores.webhookSubscription.add({
    accountId: testAccountId,
    projectId: testProjectId,
    provider: "X",
    eventTypes: ["POST_PUBLISHED", "POST_DELETED"],
    webhookUrl: "https://example.com/webhook",
    secretKey: "test-secret-key",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  testEvents = [];

  // Completed events for X (5)
  for (let i = 0; i < 5; i++) {
    const event = stores.webhookEvent.add({
      accountId: testAccountId,
      projectId: testProjectId,
      eventId: `evt-x-success-${timestamp}-${i}`,
      eventType: "POST_PUBLISHED",
      provider: "X",
      payload: { test: "data" },
      headers: {},
      signature: "test-signature-x-success",
      status: "COMPLETED",
      verified: true,
      processed: true,
      processingTime: 50 + i * 10,
      retryCount: 0,
      lastError: null,
      receivedAt: oneHourAgo,
      processedAt: new Date(oneHourAgo.getTime() + 100),
      nextRetryAt: null,
      postId: null,
      channelId: null,
    });
    testEvents.push({ id: event["id"] as string, eventId: event["eventId"] as string });
  }

  // Failed events for X (2)
  for (let i = 0; i < 2; i++) {
    const event = stores.webhookEvent.add({
      accountId: testAccountId,
      projectId: testProjectId,
      eventId: `evt-x-failed-${timestamp}-${i}`,
      eventType: "POST_DELETED",
      provider: "X",
      payload: { test: "data" },
      headers: {},
      signature: "test-signature-x-failed",
      status: "FAILED",
      verified: true,
      processed: true,
      retryCount: 3,
      lastError: "Connection timeout",
      processingTime: 100,
      receivedAt: sixHoursAgo,
      processedAt: null,
      nextRetryAt: null,
      postId: null,
      channelId: null,
    });
    testEvents.push({ id: event["id"] as string, eventId: event["eventId"] as string });
  }

  // Completed events for Instagram (3)
  for (let i = 0; i < 3; i++) {
    const event = stores.webhookEvent.add({
      accountId: testAccountId,
      projectId: testProjectId,
      eventId: `evt-instagram-success-${timestamp}-${i}`,
      eventType: "POST_PUBLISHED",
      provider: "INSTAGRAM",
      payload: { test: "data" },
      headers: {},
      signature: "test-signature-instagram-success",
      status: "COMPLETED",
      verified: true,
      processed: true,
      processingTime: 80 + i * 5,
      retryCount: 0,
      lastError: null,
      receivedAt: oneDayAgo,
      processedAt: new Date(oneDayAgo.getTime() + 150),
      nextRetryAt: null,
      postId: null,
      channelId: null,
    });
    testEvents.push({ id: event["id"] as string, eventId: event["eventId"] as string });
  }

  // Dead letter event (original)
  const deadLetterOriginal = stores.webhookEvent.add({
    accountId: testAccountId,
    projectId: testProjectId,
    eventId: `evt-dlq-original-${timestamp}`,
    eventType: "POST_PUBLISHED",
    provider: "X",
    payload: { test: "data" },
    headers: {},
    signature: "test-signature-dlq",
    status: "DEAD_LETTER",
    verified: true,
    processed: false,
    retryCount: 5,
    lastError: "Maximum retries exceeded",
    receivedAt: oneDayAgo,
    processedAt: null,
    processingTime: null,
    nextRetryAt: null,
    postId: null,
    channelId: null,
  });
  testEvents.push({
    id: deadLetterOriginal["id"] as string,
    eventId: deadLetterOriginal["eventId"] as string,
  });

  // Dead letter queue entry
  const dlqEvent = stores.webhookDeadLetter.add({
    originalEventId: deadLetterOriginal["id"] as string,
    provider: "X",
    eventType: "POST_PUBLISHED",
    payload: { test: "data" },
    headers: {},
    failureReason: "Maximum retries exceeded",
    retryCount: 5,
    firstFailedAt: oneDayAgo,
    lastRetryAt: new Date(oneDayAgo.getTime() + 1000),
    resolvedAt: null,
    resolvedBy: null,
    finalError: null,
  });
  testDeadLetterEventId = dlqEvent["id"] as string;
}

// ---------------------------------------------------------------------------
// 4. Tests
// ---------------------------------------------------------------------------

describe("WebhookDashboardService", () => {
  beforeEach(() => {
    stores.webhookEvent.clear();
    stores.webhookSubscription.clear();
    stores.webhookDeadLetter.clear();
    stores.account.clear();
    stores.project.clear();
    seedTestData();
  });

  describe("getDashboardMetrics", () => {
    it("should calculate overall metrics correctly for 24h", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      expect(metrics.totalEvents).toBe(11);
      expect(metrics.processedEvents).toBe(8);
      expect(metrics.failedEvents).toBe(3);
      expect(metrics.successRate).toBe((8 / 11) * 100);
      expect(metrics.avgProcessingTime > 0).toBeTruthy();
      expect(typeof metrics.queueDepth).toBe("number");
      expect(typeof metrics.realtimeConnections).toBe("number");
    });

    it("should calculate metrics for 1h time range", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "1h",
      });

      expect(metrics.totalEvents).toBe(5);
      expect(metrics.processedEvents).toBe(5);
      expect(metrics.failedEvents).toBe(0);
    });

    it("should calculate metrics for 6h time range", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "6h",
      });

      expect(metrics.totalEvents).toBe(7);
      expect(metrics.processedEvents).toBe(5);
      expect(metrics.failedEvents).toBe(2);
    });

    it("should filter metrics by provider", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
        provider: "X" as Provider,
      });

      expect(metrics.totalEvents).toBe(8);
      expect(metrics.processedEvents).toBe(5);
      expect(metrics.failedEvents).toBe(3);
    });

    it("should filter metrics by projectId", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
        projectId: testProjectId,
      });

      expect(metrics.totalEvents).toBe(11);
    });

    it("should aggregate metrics by provider", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      expect(metrics.byProvider.X).toBeTruthy();
      expect(metrics.byProvider.X.total).toBe(8);
      expect(metrics.byProvider.X.success).toBe(5);
      expect(metrics.byProvider.X.failed).toBe(3);
      expect(metrics.byProvider.X.successRate).toBe((5 / 8) * 100);
      expect(metrics.byProvider.X.avgProcessingTime > 0).toBeTruthy();

      expect(metrics.byProvider.INSTAGRAM).toBeTruthy();
      expect(metrics.byProvider.INSTAGRAM.total).toBe(3);
      expect(metrics.byProvider.INSTAGRAM.success).toBe(3);
      expect(metrics.byProvider.INSTAGRAM.failed).toBe(0);
      expect(metrics.byProvider.INSTAGRAM.successRate).toBe(100);
    });

    it("should aggregate metrics by event type", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      expect(metrics.byEventType["POST_PUBLISHED"]).toBeTruthy();
      expect(metrics.byEventType["POST_DELETED"]).toBeTruthy();
      expect(metrics.byEventType["POST_PUBLISHED"]).toBe(9);
      expect(metrics.byEventType["POST_DELETED"]).toBe(2);
    });

    it("should generate timeline with 24 intervals", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      expect(metrics.timeline.length).toBe(24);

      metrics.timeline.forEach((interval) => {
        expect(interval.timestamp).toBeTruthy();
        expect(typeof interval.total).toBe("number");
        expect(typeof interval.success).toBe("number");
        expect(typeof interval.failed).toBe("number");
      });

      const totalFromTimeline = metrics.timeline.reduce((sum, t) => sum + t.total, 0);
      expect(totalFromTimeline).toBe(metrics.totalEvents);
    });
  });

  describe("getRecentEvents", () => {
    it("should retrieve paginated events", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 5,
      });

      expect(data.events.length).toBe(5);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(5);
      expect(data.pagination.total).toBe(11);
      expect(data.pagination.pages).toBe(3);
    });

    it("should retrieve second page of events", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 2,
        limit: 5,
      });

      expect(data.events.length).toBe(5);
      expect(data.pagination.page).toBe(2);
    });

    it("should filter events by provider", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
        provider: "X" as Provider,
      });

      expect(data.events.length).toBe(8);
      data.events.forEach((event) => {
        expect(event.provider).toBe("X");
      });
    });

    it("should filter events by status", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
        status: "COMPLETED",
      });

      expect(data.events.length).toBe(8);
      data.events.forEach((event) => {
        expect(event.status).toBe("COMPLETED");
      });
    });

    it("should filter events by status FAILED", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
        status: "FAILED",
      });

      expect(data.events.length).toBe(2);
      data.events.forEach((event) => {
        expect(event.status).toBe("FAILED");
      });
    });

    it("should search events by eventId", async () => {
      const searchTerm = `evt-x-success-${timestamp}-0`;
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
        search: searchTerm,
      });

      expect(data.events.length).toBe(1);
      expect(data.events[0].eventId.includes(searchTerm)).toBeTruthy();
    });

    it("should search events by eventType", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
        search: "DELETED",
      });

      expect(data.events.length).toBe(2);
      data.events.forEach((event) => {
        expect(event.eventType.toUpperCase().includes("DELETED")).toBeTruthy();
      });
    });

    it("should return events ordered by receivedAt desc", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
      });

      for (let i = 0; i < data.events.length - 1; i++) {
        const current = new Date(data.events[i].receivedAt).getTime();
        const next = new Date(data.events[i + 1].receivedAt).getTime();
        expect(current >= next).toBeTruthy();
      }
    });
  });

  describe("getEventDetails", () => {
    it("should retrieve event details with relations", async () => {
      const eventId = testEvents[0].id;
      const event = await webhookDashboardService.getEventDetails(testAccountId, eventId);

      expect(event.id).toBe(eventId);
      expect(event.project).toBeTruthy();
      expect(event.project.id).toBe(testProjectId);
      expect(event.project.name).toBeTruthy();
    });

    it("should return error for non-existent event", async () => {
      try {
        await webhookDashboardService.getEventDetails(testAccountId, "non-existent-event-id");
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect((error as Error).message.includes("not found")).toBeTruthy();
      }
    });

    it("should not retrieve events from other accounts", async () => {
      const eventId = testEvents[0].id;
      try {
        await webhookDashboardService.getEventDetails("different-account-id", eventId);
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect((error as Error).message.includes("not found")).toBeTruthy();
      }
    });
  });

  describe("getSubscriptions", () => {
    it("should retrieve subscriptions with stats", async () => {
      const subscriptions = await webhookDashboardService.getSubscriptions(testAccountId);

      expect(subscriptions.length).toBe(1);

      const subscription = subscriptions[0];
      expect(subscription.provider).toBe("X");
      expect(subscription.projectId).toBe(testProjectId);
      expect(subscription.isActive).toBe(true);
      expect("secretKey" in subscription).toBe(false);

      expect(subscription.stats).toBeTruthy();
      expect(subscription.stats.totalEvents).toBe(8);
      expect(subscription.stats.failedEvents).toBe(3);
      expect(subscription.stats.successRate).toBe((5 / 8) * 100);

      expect(subscription.stats.recentEvents >= 0).toBeTruthy();
    });

    it("should return empty array for account with no subscriptions", async () => {
      const emptyAccount = stores.account.add({
        email: `empty-webhook-${timestamp}@example.com`,
        name: "Empty Account",
        subscription: "PRO",
        createdAt: now,
        updatedAt: now,
      });

      const subscriptions = await webhookDashboardService.getSubscriptions(
        emptyAccount["id"] as string
      );

      expect(subscriptions.length).toBe(0);
    });
  });

  describe("getDeadLetterQueue", () => {
    it("should retrieve dead letter events", async () => {
      const data = await webhookDashboardService.getDeadLetterQueue(testAccountId, {
        page: 1,
        limit: 10,
        provider: "X" as Provider,
      });

      expect(data.events.length).toBe(1);
      expect(data.pagination.total).toBe(1);

      const dlqEvent = data.events[0];
      expect(dlqEvent.provider).toBe("X");
      expect(dlqEvent.eventType).toBe("POST_PUBLISHED");
      expect(dlqEvent.failureReason).toBe("Maximum retries exceeded");
      expect(dlqEvent.retryCount).toBe(5);
      expect(dlqEvent.originalEvent).toBeTruthy();
      expect(dlqEvent.originalEvent?.accountId).toBe(testAccountId);
    });

    it("should filter DLQ events by search term", async () => {
      const data = await webhookDashboardService.getDeadLetterQueue(testAccountId, {
        page: 1,
        limit: 10,
        provider: "X" as Provider,
        search: "retries",
      });

      expect(data.events.length).toBe(1);
      expect(data.events[0].failureReason?.includes("retries")).toBeTruthy();
    });

    it("should paginate DLQ events correctly", async () => {
      const data = await webhookDashboardService.getDeadLetterQueue(testAccountId, {
        page: 1,
        limit: 10,
        provider: "X" as Provider,
      });

      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(10);
      expect(data.pagination.pages).toBe(1);
    });
  });

  describe("retryDeadLetterEvent", () => {
    it("should retry dead letter event successfully", async () => {
      const data = await webhookDashboardService.retryDeadLetterEvent(
        testAccountId,
        testDeadLetterEventId
      );

      expect(data.success).toBe(true);
      expect(data.message).toBeTruthy();

      // Verify event was marked as resolved
      const dlqEvent = stores.webhookDeadLetter.get(testDeadLetterEventId);
      expect(dlqEvent?.["resolvedAt"]).toBeTruthy();
    });

    it("should return error for non-existent DLQ event", async () => {
      try {
        await webhookDashboardService.retryDeadLetterEvent(testAccountId, "non-existent-dlq-id");
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect((error as Error).message.includes("not found")).toBeTruthy();
      }
    });

    it("should not retry events from other accounts", async () => {
      try {
        await webhookDashboardService.retryDeadLetterEvent(
          "different-account-id",
          testDeadLetterEventId
        );
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect((error as Error).message.includes("not found")).toBeTruthy();
      }
    });
  });

  describe("exportWebhookEvents", () => {
    it("should export events as CSV", async () => {
      const exportData = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "24h",
      });

      expect(exportData.csv).toBeTruthy();
      expect(exportData.count).toBe(11);
      expect(exportData.timeRange).toBe("24h");

      const lines = exportData.csv.split("\n");
      expect(lines.length).toBe(12);

      expect(lines[0].includes("Event ID")).toBeTruthy();
      expect(lines[0].includes("Event Type")).toBeTruthy();
      expect(lines[0].includes("Provider")).toBeTruthy();
      expect(lines[0].includes("Status")).toBeTruthy();
    });

    it("should export filtered events by provider", async () => {
      const exportData = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "24h",
        provider: "X" as Provider,
      });

      expect(exportData.count).toBe(8);

      const lines = exportData.csv.split("\n");
      expect(lines.length).toBe(9);
    });

    it("should export filtered events by projectId", async () => {
      const exportData = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "24h",
        projectId: testProjectId,
      });

      expect(exportData.count).toBe(11);
    });

    it("should export events for different time ranges", async () => {
      const data1h = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "1h",
      });

      expect(data1h.count).toBe(5);

      const data6h = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "6h",
      });

      expect(data6h.count).toBe(7);
    });

    it("should properly escape CSV fields", async () => {
      // Add event with special characters
      stores.webhookEvent.add({
        accountId: testAccountId,
        projectId: testProjectId,
        eventId: `evt-special-${timestamp}`,
        eventType: "POST_PUBLISHED",
        provider: "X",
        payload: { test: "data" },
        headers: {},
        signature: "test-signature-special",
        status: "FAILED",
        verified: true,
        processed: true,
        processingTime: null,
        retryCount: 0,
        lastError: 'Error with "quotes" and, commas',
        receivedAt: new Date(),
        processedAt: null,
        nextRetryAt: null,
        postId: null,
        channelId: null,
      });

      const exportData = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "24h",
      });

      const lines = exportData.csv.split("\n");
      const specialLine = lines.find((line) => line.includes(`evt-special-${timestamp}`));
      expect(specialLine).toBeTruthy();
      expect(specialLine!.includes('""quotes""')).toBeTruthy();
    });
  });

  describe("Performance Metrics", () => {
    it("should calculate average processing time correctly", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      expect(metrics.avgProcessingTime > 0).toBeTruthy();
      expect(metrics.avgProcessingTime >= 50).toBeTruthy();
      expect(metrics.avgProcessingTime <= 100).toBeTruthy();
    });

    it("should calculate provider-specific average processing time", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      expect(metrics.byProvider.X.avgProcessingTime > 0).toBeTruthy();
      expect(metrics.byProvider.X.avgProcessingTime >= 50).toBeTruthy();

      expect(metrics.byProvider.INSTAGRAM.avgProcessingTime > 0).toBeTruthy();
      expect(metrics.byProvider.INSTAGRAM.avgProcessingTime >= 80).toBeTruthy();
    });
  });

  describe("Edge Cases", () => {
    it("should handle account with no events", async () => {
      const emptyAccount = stores.account.add({
        email: `empty-events-${timestamp}@example.com`,
        name: "Empty Events Account",
        subscription: "PRO",
        createdAt: now,
        updatedAt: now,
      });

      const metrics = await webhookDashboardService.getDashboardMetrics(
        emptyAccount["id"] as string,
        { timeRange: "24h" }
      );

      expect(metrics.totalEvents).toBe(0);
      expect(metrics.processedEvents).toBe(0);
      expect(metrics.failedEvents).toBe(0);
      expect(metrics.successRate).toBe(0);
      expect(metrics.avgProcessingTime).toBe(0);
      expect(Object.keys(metrics.byProvider).length).toBe(0);
      expect(Object.keys(metrics.byEventType).length).toBe(0);
      expect(metrics.timeline.length).toBe(24);
    });

    it("should handle invalid time range with default 24h", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "invalid-range",
      });

      expect(metrics.totalEvents).toBe(11);
    });

    it("should handle pagination beyond available events", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 999,
        limit: 10,
      });

      expect(data.events.length).toBe(0);
      expect(data.pagination.page).toBe(999);
      expect(data.pagination.total).toBe(11);
    });
  });
});
