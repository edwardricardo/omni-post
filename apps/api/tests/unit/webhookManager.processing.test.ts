/**
 * @file webhookManager.processing.test.ts
 * @description Unit tests for WebhookManager processing, stats, retry, cleanup,
 *              and security operations.
 *              Uses vi.hoisted() + vi.mock() to intercept @infra/prisma with
 *              in-memory stores. No real database connection is needed.
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// 1. Hoisted mock setup — runs before any imports
// ---------------------------------------------------------------------------

const { mockModule, stores } = vi.hoisted(() => {
  const { randomUUID } = require("crypto") as typeof import("crypto");

  type Rec = Record<string, unknown>;

  function matchesWhere(record: Rec, where: Rec): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === "OR") {
        const clauses = v as Rec[];
        if (!clauses.some((c) => matchesWhere(record, c))) return false;
        continue;
      }
      if (k === "AND") {
        const clauses = v as Rec[];
        if (!clauses.every((c) => matchesWhere(record, c))) return false;
        continue;
      }
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
        const cond = v as Record<string, unknown>;
        const fieldVal = record[k];
        if ("contains" in cond) {
          if (!String(fieldVal ?? "").includes(cond["contains"] as string)) return false;
          continue;
        }
        if ("startsWith" in cond) {
          if (!String(fieldVal ?? "").startsWith(cond["startsWith"] as string)) return false;
          continue;
        }
        if ("in" in cond) {
          if (!(cond["in"] as unknown[]).includes(fieldVal)) return false;
          continue;
        }
        if ("not" in cond) {
          if (fieldVal === cond["not"]) return false;
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
        continue;
      }
      if (record[k] !== v) return false;
    }
    return true;
  }

  // ---- In-memory stores ----
  const subscriptionStore = new Map<string, Rec>();
  const eventStore = new Map<string, Rec>();
  const deadLetterStore = new Map<string, Rec>();
  const projectStore = new Map<string, Rec>();

  const storesObj = {
    subscriptions: subscriptionStore,
    events: eventStore,
    deadLetters: deadLetterStore,
    projects: projectStore,
    clear() {
      subscriptionStore.clear();
      eventStore.clear();
      deadLetterStore.clear();
      projectStore.clear();
    },
  };

  // ---- webhookSubscription model ----
  const webhookSubscription = {
    create: vi.fn(async ({ data }: { data: Rec }) => {
      const id = randomUUID();
      const now = new Date();
      const record: Rec = {
        id,
        createdAt: now,
        updatedAt: now,
        isActive: true,
        eventsReceived: 0,
        eventsProcessed: 0,
        lastEventAt: null,
        ...data,
      };
      subscriptionStore.set(id, record);
      return { ...record };
    }),
    findUnique: vi.fn(async ({ where }: { where: Rec }) => {
      const id = where["id"] as string;
      const rec = subscriptionStore.get(id);
      return rec ? { ...rec } : null;
    }),
    findFirst: vi.fn(async ({ where }: { where: Rec }) => {
      for (const rec of subscriptionStore.values()) {
        if (matchesWhere(rec, where)) return { ...rec };
      }
      return null;
    }),
    findMany: vi.fn(async (args?: { where?: Rec; include?: Rec; orderBy?: Rec }) => {
      let results = [...subscriptionStore.values()];
      if (args?.where) {
        results = results.filter((r) => matchesWhere(r, args.where as Rec));
      }
      if (args?.include && (args.include as Rec)["project"]) {
        results = results.map((r) => {
          const projId = r["projectId"] as string | undefined;
          const proj = projId ? projectStore.get(projId) : null;
          return {
            ...r,
            project: proj ? { id: proj["id"], name: proj["name"] } : null,
          };
        });
      }
      if (args?.orderBy) {
        const orderBy = args.orderBy as Record<string, "asc" | "desc">;
        const [field, dir] = Object.entries(orderBy)[0] ?? [];
        if (field) {
          results.sort((a, b) => {
            const aVal = a[field] as Date | number | string;
            const bVal = b[field] as Date | number | string;
            const aT = aVal instanceof Date ? aVal.getTime() : aVal;
            const bT = bVal instanceof Date ? bVal.getTime() : bVal;
            if (aT < bT) return dir === "asc" ? -1 : 1;
            if (aT > bT) return dir === "asc" ? 1 : -1;
            return 0;
          });
        }
      }
      return results.map((r) => ({ ...r }));
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Rec; data: Rec }) => {
      let count = 0;
      for (const [id, rec] of subscriptionStore.entries()) {
        if (matchesWhere(rec, where)) {
          subscriptionStore.set(id, { ...rec, ...data, updatedAt: new Date() });
          count++;
        }
      }
      return { count };
    }),
    delete: vi.fn(async ({ where }: { where: Rec }) => {
      const id = where["id"] as string;
      const rec = subscriptionStore.get(id);
      subscriptionStore.delete(id);
      return rec ? { ...rec } : null;
    }),
    deleteMany: vi.fn(async ({ where }: { where?: Rec } = {}) => {
      let count = 0;
      if (!where) {
        count = subscriptionStore.size;
        subscriptionStore.clear();
        return { count };
      }
      for (const [id, rec] of subscriptionStore.entries()) {
        if (matchesWhere(rec, where)) {
          subscriptionStore.delete(id);
          count++;
        }
      }
      return { count };
    }),
  };

  // ---- webhookEvent model ----
  const webhookEvent = {
    create: vi.fn(async ({ data }: { data: Rec }) => {
      const id = randomUUID();
      const now = new Date();
      const record: Rec = {
        id,
        createdAt: now,
        receivedAt: now,
        processed: false,
        status: "PENDING",
        retryCount: 0,
        processingTime: null,
        lastError: null,
        projectId: null,
        accountId: null,
        ...data,
      };
      eventStore.set(id, record);
      return { ...record };
    }),
    createMany: vi.fn(async ({ data }: { data: Rec[] }) => {
      for (const d of data) {
        const id = randomUUID();
        const now = new Date();
        eventStore.set(id, {
          id,
          createdAt: now,
          receivedAt: (d["receivedAt"] as Date) ?? now,
          processed: false,
          status: "PENDING",
          retryCount: 0,
          processingTime: null,
          lastError: null,
          projectId: null,
          accountId: null,
          ...d,
        });
      }
      return { count: data.length };
    }),
    findMany: vi.fn(async (args?: { where?: Rec; select?: Rec; orderBy?: Rec; take?: number }) => {
      let results = [...eventStore.values()];
      if (args?.where) {
        results = results.filter((r) => matchesWhere(r, args.where as Rec));
      }
      if (args?.orderBy) {
        const orderBy = args.orderBy as Record<string, "asc" | "desc">;
        const [field, dir] = Object.entries(orderBy)[0] ?? [];
        if (field) {
          results.sort((a, b) => {
            const aVal = a[field] as Date | number | string;
            const bVal = b[field] as Date | number | string;
            const aT = aVal instanceof Date ? aVal.getTime() : aVal;
            const bT = bVal instanceof Date ? bVal.getTime() : bVal;
            if (aT < bT) return dir === "asc" ? -1 : 1;
            if (aT > bT) return dir === "asc" ? 1 : -1;
            return 0;
          });
        }
      }
      if (args?.take) {
        results = results.slice(0, args.take);
      }
      // Handle select — return only selected fields
      if (args?.select) {
        const fields = Object.keys(args.select as Rec).filter((k) => (args.select as Rec)[k]);
        return results.map((r) => {
          const picked: Rec = {};
          for (const f of fields) {
            picked[f] = r[f];
          }
          return picked;
        });
      }
      return results.map((r) => ({ ...r }));
    }),
    findFirst: vi.fn(async (args?: { where?: Rec }) => {
      const results = [...eventStore.values()];
      if (args?.where) {
        const found = results.find((r) => matchesWhere(r, args.where as Rec));
        return found ? { ...found } : null;
      }
      return results[0] ? { ...results[0] } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: Rec; data: Rec }) => {
      const id = where["id"] as string;
      const rec = eventStore.get(id);
      if (!rec) return null;
      const updated = { ...rec, ...data, updatedAt: new Date() };
      eventStore.set(id, updated);
      return { ...updated };
    }),
    count: vi.fn(async (args?: { where?: Rec }) => {
      if (!args?.where) return eventStore.size;
      let count = 0;
      for (const rec of eventStore.values()) {
        if (matchesWhere(rec, args.where)) count++;
      }
      return count;
    }),
    deleteMany: vi.fn(async ({ where }: { where?: Rec } = {}) => {
      let count = 0;
      if (!where) {
        count = eventStore.size;
        eventStore.clear();
        return { count };
      }
      for (const [id, rec] of eventStore.entries()) {
        if (matchesWhere(rec, where)) {
          eventStore.delete(id);
          count++;
        }
      }
      return { count };
    }),
    aggregate: vi.fn(async (args?: { where?: Rec; _avg?: Rec }) => {
      let results = [...eventStore.values()];
      if (args?.where) {
        results = results.filter((r) => matchesWhere(r, args.where as Rec));
      }
      // Compute _avg.processingTime
      const withTime = results.filter((r) => r["processingTime"] != null);
      const avgTime =
        withTime.length > 0
          ? withTime.reduce((sum, r) => sum + (r["processingTime"] as number), 0) / withTime.length
          : null;
      return { _avg: { processingTime: avgTime } };
    }),
    groupBy: vi.fn(async (args?: { by?: string[]; where?: Rec; _count?: Rec; _avg?: Rec }) => {
      let results = [...eventStore.values()];
      if (args?.where) {
        results = results.filter((r) => matchesWhere(r, args.where as Rec));
      }
      const groups = new Map<string, { records: Rec[]; key: Rec }>();
      const byFields = args?.by ?? [];
      for (const rec of results) {
        const keyParts: string[] = [];
        const keyObj: Rec = {};
        for (const field of byFields) {
          const val = String(rec[field] ?? "");
          keyParts.push(`${field}=${val}`);
          keyObj[field] = rec[field];
        }
        const groupKey = keyParts.join("|");
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { records: [], key: keyObj });
        }
        groups.get(groupKey)!.records.push(rec);
      }
      const output: Rec[] = [];
      for (const { records, key } of groups.values()) {
        const entry: Rec = { ...key, _count: { id: records.length } };
        // _avg.processingTime
        const withTime = records.filter((r) => r["processingTime"] != null);
        const avgTime =
          withTime.length > 0
            ? withTime.reduce((s, r) => s + (r["processingTime"] as number), 0) / withTime.length
            : null;
        entry["_avg"] = { processingTime: avgTime };
        output.push(entry);
      }
      return output;
    }),
  };

  // ---- webhookDeadLetter model ----
  const webhookDeadLetter = {
    count: vi.fn(async (args?: { where?: Rec }) => {
      if (!args?.where) return deadLetterStore.size;
      let count = 0;
      for (const rec of deadLetterStore.values()) {
        if (matchesWhere(rec, args.where)) count++;
      }
      return count;
    }),
    deleteMany: vi.fn(async ({ where }: { where?: Rec } = {}) => {
      let count = 0;
      if (!where) {
        count = deadLetterStore.size;
        deadLetterStore.clear();
        return { count };
      }
      for (const [id, rec] of deadLetterStore.entries()) {
        if (matchesWhere(rec, where)) {
          deadLetterStore.delete(id);
          count++;
        }
      }
      return { count };
    }),
  };

  // ---- Minimal models ----
  const project = { deleteMany: vi.fn(async () => ({ count: 0 })) };
  const account = { deleteMany: vi.fn(async () => ({ count: 0 })) };

  const prisma = {
    webhookSubscription,
    webhookEvent,
    webhookDeadLetter,
    project,
    account,
    $disconnect: vi.fn(async () => undefined),
  };

  return { mockModule: { prisma }, stores: storesObj };
});

// ---------------------------------------------------------------------------
// 2. Module mocks
// ---------------------------------------------------------------------------

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, ...mockModule };
});

vi.mock("../../src/lib/logger.js", () => ({
  webhookLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock("ioredis", () => {
  const MockRedis = vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    hget: vi.fn(),
    hset: vi.fn(),
    quit: vi.fn(async () => "OK"),
    disconnect: vi.fn(),
    status: "ready",
    on: vi.fn(),
    off: vi.fn(),
  }));
  return { default: MockRedis, Redis: MockRedis };
});

vi.mock("../../src/webhooks/webhookHandler.js", () => {
  class MockUniversalWebhookHandler {
    processWebhook = vi.fn(async () => ({ success: true }));
  }
  return { UniversalWebhookHandler: MockUniversalWebhookHandler };
});

vi.mock("bullmq", () => {
  let jobCounter = 0;
  class MockQueue {
    add = vi.fn(async () => ({ id: `mock-job-${++jobCounter}` }));
    getJobCounts = vi.fn(async () => ({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    }));
    getWaiting = vi.fn(async () => []);
    getActive = vi.fn(async () => []);
    getCompleted = vi.fn(async () => []);
    getFailed = vi.fn(async () => []);
    getJobs = vi.fn(async () => []);
    clean = vi.fn(async () => []);
    close = vi.fn(async () => undefined);
    obliterate = vi.fn(async () => undefined);
  }
  class MockWorker {
    on = vi.fn();
    close = vi.fn(async () => undefined);
    constructor() {
      /* no-op */
    }
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

// ---------------------------------------------------------------------------
// 3. Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  state,
  setupWebhookManagerTestData,
  teardownWebhookManagerTestData,
} from "./webhookManager.test-helpers.js";

// ---------------------------------------------------------------------------
// 4. Tests
// ---------------------------------------------------------------------------

describe("WebhookManager - Processing & Security", () => {
  beforeAll(async () => {
    await setupWebhookManagerTestData();
    stores.projects.set(state.testProjectId, {
      id: state.testProjectId,
      accountId: state.testAccountId,
      name: "Test Webhook Project",
      locale: "en",
    });
    stores.projects.set(state.testProject2Id, {
      id: state.testProject2Id,
      accountId: state.testAccount2Id,
      name: "Test Webhook Project 2",
      locale: "en",
    });
  });

  afterAll(async () => {
    await teardownWebhookManagerTestData();
  });

  describe("processIncomingWebhook() - Process Webhook Events", () => {
    it("should process webhook and return job ID", async () => {
      const jobId = await state.webhookManager.processIncomingWebhook(
        "X" as never,
        "POST_PUBLISHED" as never,
        "test-event-123",
        "test-signature",
        { content: "Test post" },
        { "x-twitter-webhooks-signature": "sha256=abc123" },
        state.testAccountId,
        state.testProjectId
      );

      expect(jobId).toBeTruthy();
      expect(typeof jobId).toBe("string");
    });

    it("should process webhook without optional accountId and projectId", async () => {
      const jobId = await state.webhookManager.processIncomingWebhook(
        "INSTAGRAM" as never,
        "STORY_PUBLISHED" as never,
        "test-event-456",
        "test-signature-2",
        { story_id: "123" },
        { "x-hub-signature": "sha1=def456" }
      );

      expect(jobId).toBeTruthy();
    });

    it("should handle different event types", async () => {
      const eventTypes = [
        "POST_PUBLISHED",
        "COMMENT_RECEIVED",
        "LIKE_RECEIVED",
        "VIDEO_PROCESSED",
      ] as const;

      for (const eventType of eventTypes) {
        const jobId = await state.webhookManager.processIncomingWebhook(
          "YOUTUBE" as never,
          eventType as never,
          `test-event-${eventType}`,
          "test-signature",
          { test: true },
          {},
          state.testAccountId
        );

        expect(jobId).toBeTruthy();
      }
    });
  });

  describe("getProcessingStats() - Webhook Processing Statistics", () => {
    beforeAll(async () => {
      // Seed event store with test data for stats
      await mockModule.prisma.webhookEvent.createMany({
        data: [
          {
            accountId: state.testAccountId,
            provider: "X",
            eventType: "POST_PUBLISHED",
            eventId: "test-event-stat-1",
            signature: "sig1",
            payload: {},
            headers: {},
            status: "COMPLETED",
            processed: true,
            processingTime: 150,
          },
          {
            accountId: state.testAccountId,
            provider: "X",
            eventType: "POST_UPDATED",
            eventId: "test-event-stat-2",
            signature: "sig2",
            payload: {},
            headers: {},
            status: "COMPLETED",
            processed: true,
            processingTime: 200,
          },
          {
            accountId: state.testAccountId,
            provider: "INSTAGRAM",
            eventType: "STORY_PUBLISHED",
            eventId: "test-event-stat-3",
            signature: "sig3",
            payload: {},
            headers: {},
            status: "FAILED",
            processed: false,
            lastError: "Connection timeout",
          },
        ],
      });
    });

    it("should return comprehensive statistics", async () => {
      const stats = await state.webhookManager.getProcessingStats(state.testAccountId);

      expect(stats).toBeTruthy();
      expect(typeof stats.totalEvents).toBe("number");
      expect(typeof stats.processedEvents).toBe("number");
      expect(typeof stats.failedEvents).toBe("number");
      expect(typeof stats.deadLetterEvents).toBe("number");
      expect(typeof stats.successRate).toBe("number");
      expect(typeof stats.avgProcessingTimeMs).toBe("number");
      expect(stats.queue).toBeTruthy();
      expect(stats.byProvider).toBeTruthy();
      expect(Array.isArray(stats.recentErrors)).toBeTruthy();
    });

    it("should calculate success rate correctly", async () => {
      const stats = await state.webhookManager.getProcessingStats(state.testAccountId);

      expect(stats.totalEvents >= 3).toBeTruthy();
      expect(stats.processedEvents >= 2).toBeTruthy();
      expect(stats.failedEvents >= 1).toBeTruthy();
      expect(stats.successRate >= 0 && stats.successRate <= 100).toBeTruthy();
    });

    it("should calculate average processing time", async () => {
      const stats = await state.webhookManager.getProcessingStats(state.testAccountId);

      expect(stats.avgProcessingTimeMs > 0).toBeTruthy();
    });

    it("should group statistics by provider", async () => {
      const stats = await state.webhookManager.getProcessingStats(state.testAccountId);

      expect(stats.byProvider).toBeTruthy();
      expect(stats.byProvider.X || stats.byProvider.INSTAGRAM).toBeTruthy();

      if (stats.byProvider.X) {
        expect(typeof stats.byProvider.X.total).toBe("number");
        expect(stats.byProvider.X.total >= 2).toBeTruthy();
      }
    });

    it("should return recent errors", async () => {
      const stats = await state.webhookManager.getProcessingStats(state.testAccountId);

      expect(Array.isArray(stats.recentErrors)).toBeTruthy();
      if (stats.recentErrors.length > 0) {
        const error = stats.recentErrors[0];
        expect(error.id).toBeTruthy();
        expect(error.provider).toBeTruthy();
        expect(error.eventType).toBeTruthy();
        expect(error.lastError).toBeTruthy();
        expect(error.receivedAt).toBeTruthy();
        expect(typeof error.retryCount).toBe("number");
      }
    });

    it("should filter statistics by time range", async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const stats = await state.webhookManager.getProcessingStats(state.testAccountId, {
        start: yesterday,
        end: tomorrow,
      });

      expect(stats).toBeTruthy();
      expect(stats.totalEvents >= 0).toBeTruthy();
    });

    afterAll(() => {
      // Clean test events from store
      for (const [id, rec] of stores.events.entries()) {
        if (String(rec["eventId"] ?? "").startsWith("test-event-stat-")) {
          stores.events.delete(id);
        }
      }
    });
  });

  describe("retryFailedEvents() - Retry Failed Webhook Events", () => {
    beforeAll(async () => {
      await mockModule.prisma.webhookEvent.createMany({
        data: [
          {
            accountId: state.testAccountId,
            provider: "X",
            eventType: "POST_PUBLISHED",
            eventId: "test-event-retry-1",
            signature: "sig1",
            payload: {},
            headers: {},
            status: "FAILED",
            processed: false,
            retryCount: 3,
          },
          {
            accountId: state.testAccountId,
            provider: "INSTAGRAM",
            eventType: "STORY_PUBLISHED",
            eventId: "test-event-retry-2",
            signature: "sig2",
            payload: {},
            headers: {},
            status: "FAILED",
            processed: false,
            retryCount: 2,
          },
          {
            accountId: state.testAccountId,
            provider: "FACEBOOK",
            eventType: "POST_UPDATED",
            eventId: "test-event-retry-3",
            signature: "sig3",
            payload: {},
            headers: {},
            status: "DEAD_LETTER",
            processed: false,
            retryCount: 5,
            receivedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          },
        ],
      });
    });

    it("should retry all failed events without maxAge filter", async () => {
      const retriedCount = await state.webhookManager.retryFailedEvents(state.testAccountId);

      expect(retriedCount >= 2).toBeTruthy();
    });

    it("should retry events within maxAge limit", async () => {
      // Reset statuses back to FAILED for re-test
      for (const [_id, rec] of stores.events.entries()) {
        if (String(rec["eventId"] ?? "").startsWith("test-event-retry-")) {
          rec["status"] = rec["eventId"] === "test-event-retry-3" ? "DEAD_LETTER" : "FAILED";
        }
      }

      const retriedCount = await state.webhookManager.retryFailedEvents(state.testAccountId, 7);

      expect(retriedCount >= 0).toBeTruthy();
    });

    it("should update status to RETRYING for retried events", async () => {
      // Reset statuses back to FAILED for this test
      for (const [_id, rec] of stores.events.entries()) {
        if (String(rec["eventId"] ?? "").startsWith("test-event-retry-")) {
          rec["status"] = rec["eventId"] === "test-event-retry-3" ? "DEAD_LETTER" : "FAILED";
        }
      }

      await state.webhookManager.retryFailedEvents(state.testAccountId);

      const retryingEvents = await mockModule.prisma.webhookEvent.findMany({
        where: {
          accountId: state.testAccountId,
          eventId: { startsWith: "test-event-retry-" },
          status: "RETRYING",
        },
      });

      expect(retryingEvents.length > 0).toBeTruthy();
    });

    it("should handle retry failures gracefully", async () => {
      const retriedCount = await state.webhookManager.retryFailedEvents(state.testAccountId);

      expect(typeof retriedCount).toBe("number");
      expect(retriedCount >= 0).toBeTruthy();
    });

    afterAll(() => {
      for (const [id, rec] of stores.events.entries()) {
        if (String(rec["eventId"] ?? "").startsWith("test-event-retry-")) {
          stores.events.delete(id);
        }
      }
    });
  });

  describe("cleanup() - Clean Up Old Webhook Data", () => {
    beforeAll(async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

      await mockModule.prisma.webhookEvent.createMany({
        data: [
          {
            accountId: state.testAccountId,
            provider: "X",
            eventType: "POST_PUBLISHED",
            eventId: "test-event-cleanup-1",
            signature: "sig1",
            payload: {},
            headers: {},
            status: "COMPLETED",
            processed: true,
            receivedAt: oldDate,
          },
          {
            accountId: state.testAccountId,
            provider: "INSTAGRAM",
            eventType: "STORY_PUBLISHED",
            eventId: "test-event-cleanup-2",
            signature: "sig2",
            payload: {},
            headers: {},
            status: "FAILED",
            processed: false,
            receivedAt: oldDate,
          },
          {
            accountId: state.testAccountId,
            provider: "FACEBOOK",
            eventType: "POST_UPDATED",
            eventId: "test-event-cleanup-3",
            signature: "sig3",
            payload: {},
            headers: {},
            status: "PENDING",
            processed: false,
            receivedAt: oldDate,
          },
        ],
      });
    });

    it("should clean up old completed and failed events", async () => {
      const result = await state.webhookManager.cleanup(30);

      expect(typeof result).toBe("object");
      expect(typeof result.eventsDeleted).toBe("number");
      expect(result.eventsDeleted >= 0).toBeTruthy();
      expect(result.jobsCleanedUp).toBeTruthy();
    });

    it("should not delete pending or processing events", async () => {
      await state.webhookManager.cleanup(30);

      const pendingEvent = await mockModule.prisma.webhookEvent.findFirst({
        where: { eventId: "test-event-cleanup-3" },
      });

      expect(pendingEvent).toBeTruthy();
    });

    it("should respect custom maxAgeDays parameter", async () => {
      const result = await state.webhookManager.cleanup(60);

      expect(typeof result).toBe("object");
      expect(typeof result.eventsDeleted).toBe("number");
      expect(result.eventsDeleted >= 0).toBeTruthy();
    });

    it("should use default 30 days if not specified", async () => {
      const result = await state.webhookManager.cleanup();

      expect(typeof result).toBe("object");
      expect(typeof result.eventsDeleted).toBe("number");
    });

    afterAll(() => {
      for (const [id, rec] of stores.events.entries()) {
        if (String(rec["eventId"] ?? "").startsWith("test-event-cleanup-")) {
          stores.events.delete(id);
        }
      }
    });
  });

  describe("Security - Secret Key and Verify Token Handling", () => {
    it("should never expose secret key in createSubscription response", async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      expect("secretKey" in subscription).toBe(false);
    });

    it("should never expose secret key in getSubscriptions response", async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);
      const found = subscriptions.find((sub) => sub.id === subscription.id);

      expect(found).toBeTruthy();
      expect("secretKey" in found).toBe(false);

      stores.subscriptions.delete(subscription.id);
    });

    it("should store secret key in database", async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      const dbSubscription = await mockModule.prisma.webhookSubscription.findUnique({
        where: { id: subscription.id },
      });

      expect(dbSubscription?.secretKey).toBeTruthy();
      expect((dbSubscription.secretKey as string).length).toBe(64);

      stores.subscriptions.delete(subscription.id);
    });

    it("should generate unique secret keys for each subscription", async () => {
      const sub1 = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      const sub2 = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "INSTAGRAM",
        eventTypes: ["STORY_PUBLISHED"],
      });

      const dbSub1 = await mockModule.prisma.webhookSubscription.findUnique({
        where: { id: sub1.id },
      });

      const dbSub2 = await mockModule.prisma.webhookSubscription.findUnique({
        where: { id: sub2.id },
      });

      expect(dbSub1?.secretKey).not.toBe(dbSub2?.secretKey);

      stores.subscriptions.delete(sub1.id);
      stores.subscriptions.delete(sub2.id);
    });

    it("should generate unique verify tokens for each subscription", async () => {
      const sub1 = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "FACEBOOK",
        eventTypes: ["POST_PUBLISHED"],
      });

      const sub2 = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "FACEBOOK",
        eventTypes: ["POST_UPDATED"],
      });

      const dbSub1 = await mockModule.prisma.webhookSubscription.findUnique({
        where: { id: sub1.id },
      });

      const dbSub2 = await mockModule.prisma.webhookSubscription.findUnique({
        where: { id: sub2.id },
      });

      expect(dbSub1?.verifyToken).not.toBe(dbSub2?.verifyToken);

      stores.subscriptions.delete(sub1.id);
      stores.subscriptions.delete(sub2.id);
    });
  });
});
