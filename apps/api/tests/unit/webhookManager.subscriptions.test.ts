/**
 * @file webhookManager.subscriptions.test.ts
 * @description Unit tests for WebhookManager subscription CRUD operations.
 *              Builds an in-memory prisma fake and injects it into WebhookManager
 *              via the constructor (DI). No real database connection is needed.
 * @layer infrastructure
 */

import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from "vitest";
import type { PrismaClient } from "@infra/prisma";

// ---------------------------------------------------------------------------
// 1. Hoisted mock setup — runs before any imports
// ---------------------------------------------------------------------------

const { mockModule, stores } = (() => {
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
      // Handle include.project
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
      // Handle orderBy
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
    update: vi.fn(async ({ where, data }: { where: Rec; data: Rec }) => {
      const id = where["id"] as string;
      const rec = subscriptionStore.get(id);
      if (!rec) return null;
      const updated = { ...rec, ...data, updatedAt: new Date() };
      subscriptionStore.set(id, updated);
      return { ...updated };
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

  // ---- webhookEvent model (minimal for this file) ----
  const webhookEvent = {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    createMany: vi.fn(async () => ({ count: 0 })),
    update: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    aggregate: vi.fn(async () => ({ _avg: { processingTime: null } })),
    groupBy: vi.fn(async () => []),
  };

  // ---- webhookDeadLetter model (minimal) ----
  const webhookDeadLetter = {
    count: vi.fn(async () => 0),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  };

  // ---- project model (minimal) ----
  const project = {
    deleteMany: vi.fn(async () => ({ count: 0 })),
  };

  // ---- account model (minimal) ----
  const account = {
    deleteMany: vi.fn(async () => ({ count: 0 })),
  };

  const prisma = {
    webhookSubscription,
    webhookEvent,
    webhookDeadLetter,
    project,
    account,
    $disconnect: vi.fn(async () => undefined),
  };

  return { mockModule: { prisma }, stores: storesObj };
})();

// ---------------------------------------------------------------------------
// 2. Module mocks
// ---------------------------------------------------------------------------

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
  class MockQueue {
    add = vi.fn(async () => ({ id: "mock-job-id" }));
    getJobCounts = vi.fn(async () => ({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    }));
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

describe("WebhookManager - Subscriptions", () => {
  beforeAll(async () => {
    await setupWebhookManagerTestData(mockModule.prisma as unknown as PrismaClient);
    // Seed project store so include.project works
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

  beforeEach(() => {
    // Clear subscriptions between top-level describes is handled per-section
  });

  describe("createSubscription() - Webhook Subscription Creation", () => {
    describe("Basic Subscription Creation", () => {
      it("should create subscription with minimal required fields", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "X",
          eventTypes: ["POST_PUBLISHED"],
        });

        expect(subscription.id).toBeTruthy();
        expect(subscription.accountId).toBe(state.testAccountId);
        expect(subscription.provider).toBe("X");
        expect(subscription.eventTypes).toStrictEqual(["POST_PUBLISHED"]);
        expect(subscription.isActive).toBe(true);
        expect("secretKey" in subscription).toBe(false);
        expect(subscription.webhookUrl).toBeTruthy();
        expect(subscription.setupInstructions).toBeTruthy();
      });

      it("should create subscription with projectId", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "INSTAGRAM",
          projectId: state.testProjectId,
          eventTypes: ["STORY_PUBLISHED", "REEL_PUBLISHED"],
        });

        expect(subscription.projectId).toBe(state.testProjectId);
        expect(subscription.provider).toBe("INSTAGRAM");
        expect(subscription.eventTypes).toStrictEqual(["STORY_PUBLISHED", "REEL_PUBLISHED"]);
      });

      it("should create subscription with custom webhook URL", async () => {
        const customUrl = "https://custom.example.com/webhooks/test";
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "FACEBOOK",
          eventTypes: ["POST_PUBLISHED"],
          webhookUrl: customUrl,
        });

        expect(subscription.webhookUrl).toBe(customUrl);
      });

      it("should create subscription with custom verify token", async () => {
        const customToken = "custom-verify-token-123";
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "FACEBOOK",
          eventTypes: ["POST_PUBLISHED"],
          verifyToken: customToken,
        });

        const dbSubscription = await mockModule.prisma.webhookSubscription.findUnique({
          where: { id: subscription.id },
        });

        expect(dbSubscription?.verifyToken).toBe(customToken);
      });

      it("should generate default webhook URL if not provided", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "YOUTUBE",
          eventTypes: ["VIDEO_PROCESSED"],
        });

        expect(subscription.webhookUrl.includes("/webhooks/youtube")).toBeTruthy();
      });

      it("should generate secret key automatically", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "TIKTOK",
          eventTypes: ["POST_PUBLISHED"],
        });

        const dbSubscription = await mockModule.prisma.webhookSubscription.findUnique({
          where: { id: subscription.id },
        });

        expect(dbSubscription?.secretKey).toBeTruthy();
        expect((dbSubscription?.secretKey as string).length).toBe(64);
      });

      it("should generate verify token automatically for Facebook", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "FACEBOOK",
          eventTypes: ["POST_PUBLISHED"],
        });

        const dbSubscription = await mockModule.prisma.webhookSubscription.findUnique({
          where: { id: subscription.id },
        });

        expect(dbSubscription?.verifyToken).toBeTruthy();
        expect((dbSubscription?.verifyToken as string).length).toBe(32);
      });
    });

    describe("Setup Instructions Generation", () => {
      it("should generate Facebook setup instructions", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "FACEBOOK",
          eventTypes: ["POST_PUBLISHED"],
        });

        expect(subscription.setupInstructions).toBeTruthy();
        expect(subscription.setupInstructions.provider).toBe("FACEBOOK");
        expect(subscription.setupInstructions.webhookUrl).toBeTruthy();
        expect(subscription.setupInstructions.verifyToken).toBeTruthy();
        expect(Array.isArray(subscription.setupInstructions.steps)).toBeTruthy();
        expect(subscription.setupInstructions.steps.length > 0).toBeTruthy();
      });

      it("should generate X/Twitter setup instructions", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "X",
          eventTypes: ["POST_PUBLISHED"],
        });

        expect(subscription.setupInstructions.provider).toBe("X");
        expect(
          subscription.setupInstructions.steps.some((step: string) =>
            step.includes("X Developer Portal")
          )
        ).toBeTruthy();
      });

      it("should generate YouTube setup instructions", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "YOUTUBE",
          eventTypes: ["VIDEO_PROCESSED"],
        });

        expect(subscription.setupInstructions.provider).toBe("YOUTUBE");
        expect(
          subscription.setupInstructions.steps.some((step: string) =>
            step.includes("Google Cloud Console")
          )
        ).toBeTruthy();
      });

      it("should generate TikTok setup instructions", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "TIKTOK",
          eventTypes: ["POST_PUBLISHED"],
        });

        expect(subscription.setupInstructions.provider).toBe("TIKTOK");
        expect(
          subscription.setupInstructions.steps.some((step: string) =>
            step.includes("TikTok Developer Portal")
          )
        ).toBeTruthy();
      });

      it("should generate Instagram setup instructions", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "INSTAGRAM",
          eventTypes: ["STORY_PUBLISHED"],
        });

        expect(subscription.setupInstructions.provider).toBe("INSTAGRAM");
        expect(
          subscription.setupInstructions.steps.some((step: string) =>
            step.includes("Facebook App Dashboard")
          )
        ).toBeTruthy();
      });
    });

    describe("Multiple Event Types Support", () => {
      it("should create subscription with multiple event types", async () => {
        const eventTypes = [
          "POST_PUBLISHED",
          "POST_UPDATED",
          "POST_DELETED",
          "COMMENT_RECEIVED",
          "LIKE_RECEIVED",
        ] as const;

        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "X",
          eventTypes: [...eventTypes],
        });

        expect(subscription.eventTypes).toStrictEqual([...eventTypes]);
      });

      it("should create subscription with all available event types", async () => {
        const allEventTypes = [
          "POST_PUBLISHED",
          "POST_UPDATED",
          "POST_DELETED",
          "POST_ENGAGEMENT_UPDATE",
          "STORY_PUBLISHED",
          "STORY_EXPIRED",
          "REEL_PUBLISHED",
          "LIKE_RECEIVED",
          "COMMENT_RECEIVED",
          "SHARE_RECEIVED",
          "MENTION_RECEIVED",
          "ACCOUNT_CONNECTED",
          "ACCOUNT_DISCONNECTED",
          "PERMISSION_CHANGED",
          "RATE_LIMIT_REACHED",
          "QUOTA_EXCEEDED",
          "API_ERROR",
          "VIDEO_PROCESSED",
          "VIDEO_MONETIZED",
          "LIVE_STREAM_STARTED",
          "LIVE_STREAM_ENDED",
          "MILESTONE_REACHED",
          "VIRAL_CONTENT_DETECTED",
        ] as const;

        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "FACEBOOK",
          eventTypes: [...allEventTypes],
        });

        expect(subscription.eventTypes.length).toBe(allEventTypes.length);
      });
    });
  });

  describe("getSubscriptions() - List Webhook Subscriptions", () => {
    let subscription1Id: string;
    let subscription2Id: string;
    let subscription3Id: string;

    beforeAll(async () => {
      // Clear all subscriptions for a clean state
      stores.subscriptions.clear();

      const sub1 = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });
      subscription1Id = sub1.id;

      const sub2 = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "INSTAGRAM",
        projectId: state.testProjectId,
        eventTypes: ["STORY_PUBLISHED"],
      });
      subscription2Id = sub2.id;

      const sub3 = await state.webhookManager.createSubscription(state.testAccount2Id, {
        provider: "FACEBOOK",
        eventTypes: ["POST_PUBLISHED"],
      });
      subscription3Id = sub3.id;
    });

    it("should get all subscriptions for an account", async () => {
      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);

      expect(subscriptions.length >= 2).toBeTruthy();
      expect(subscriptions.every((sub) => sub.accountId === state.testAccountId)).toBeTruthy();
      expect(subscriptions.every((sub) => !("secretKey" in sub))).toBeTruthy();
    });

    it("should filter subscriptions by provider", async () => {
      const xSubscriptions = await state.webhookManager.getSubscriptions(
        state.testAccountId,
        "X" as never
      );

      expect(xSubscriptions.length >= 1).toBeTruthy();
      expect(xSubscriptions.every((sub) => sub.provider === "X")).toBeTruthy();
    });

    it("should include project information when available", async () => {
      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);
      const subWithProject = subscriptions.find((sub) => sub.projectId === state.testProjectId);

      expect(subWithProject).toBeTruthy();
      expect(subWithProject.project).toBeTruthy();
      expect(subWithProject.project.id).toBe(state.testProjectId);
      expect(subWithProject.project.name).toBeTruthy();
    });

    it("should include subscription statistics", async () => {
      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);

      subscriptions.forEach((sub) => {
        expect(sub.stats).toBeTruthy();
        expect(typeof sub.stats.eventsReceived).toBe("number");
        expect(typeof sub.stats.eventsProcessed).toBe("number");
        expect(
          sub.stats.lastEventAt === null || sub.stats.lastEventAt instanceof Date
        ).toBeTruthy();
      });
    });

    it("should order subscriptions by creation date descending", async () => {
      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);

      if (subscriptions.length > 1) {
        for (let i = 1; i < subscriptions.length; i++) {
          expect(subscriptions[i - 1].createdAt >= subscriptions[i].createdAt).toBeTruthy();
        }
      }
    });

    it("should not return subscriptions from other accounts", async () => {
      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);

      expect(subscriptions.some((sub) => sub.id === subscription3Id)).toBeFalsy();
    });

    afterAll(() => {
      stores.subscriptions.delete(subscription1Id);
      stores.subscriptions.delete(subscription2Id);
      stores.subscriptions.delete(subscription3Id);
    });
  });

  describe("updateSubscription() - Update Webhook Subscription", () => {
    let subscriptionId: string;

    beforeAll(async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });
      subscriptionId = subscription.id;
    });

    it("should update subscription active status", async () => {
      const result = await state.webhookManager.updateSubscription(
        subscriptionId,
        state.testAccountId,
        { isActive: false }
      );

      expect(result.count).toBe(1);

      const updated = await mockModule.prisma.webhookSubscription.findUnique({
        where: { id: subscriptionId },
      });

      expect(updated?.isActive).toBe(false);
    });

    it("should update subscription event types", async () => {
      const newEventTypes = ["POST_UPDATED", "POST_DELETED"] as const;

      const result = await state.webhookManager.updateSubscription(
        subscriptionId,
        state.testAccountId,
        { eventTypes: [...newEventTypes] }
      );

      expect(result.count).toBe(1);

      const updated = await mockModule.prisma.webhookSubscription.findUnique({
        where: { id: subscriptionId },
      });

      expect(updated?.eventTypes).toStrictEqual([...newEventTypes]);
    });

    it("should update subscription verify token", async () => {
      const newVerifyToken = "new-verify-token-456";

      const result = await state.webhookManager.updateSubscription(
        subscriptionId,
        state.testAccountId,
        { verifyToken: newVerifyToken }
      );

      expect(result.count).toBe(1);

      const updated = await mockModule.prisma.webhookSubscription.findUnique({
        where: { id: subscriptionId },
      });

      expect(updated?.verifyToken).toBe(newVerifyToken);
    });

    it("should update multiple fields at once", async () => {
      const result = await state.webhookManager.updateSubscription(
        subscriptionId,
        state.testAccountId,
        {
          isActive: true,
          eventTypes: ["COMMENT_RECEIVED", "LIKE_RECEIVED"],
          verifyToken: "combined-update-token",
        }
      );

      expect(result.count).toBe(1);

      const updated = await mockModule.prisma.webhookSubscription.findUnique({
        where: { id: subscriptionId },
      });

      expect(updated?.isActive).toBe(true);
      expect(updated?.eventTypes).toStrictEqual(["COMMENT_RECEIVED", "LIKE_RECEIVED"]);
      expect(updated?.verifyToken).toBe("combined-update-token");
    });

    it("should throw error when subscription not found", async () => {
      await expect(
        state.webhookManager.updateSubscription("non-existent-id", state.testAccountId, {
          isActive: false,
        })
      ).rejects.toThrow("Webhook subscription not found");
    });

    it("should throw error when updating other account's subscription", async () => {
      await expect(
        state.webhookManager.updateSubscription(subscriptionId, state.testAccount2Id, {
          isActive: false,
        })
      ).rejects.toThrow("Webhook subscription not found");
    });

    afterAll(() => {
      stores.subscriptions.delete(subscriptionId);
    });
  });

  describe("deleteSubscription() - Delete Webhook Subscription", () => {
    it("should delete subscription successfully", async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      const result = await state.webhookManager.deleteSubscription(
        subscription.id,
        state.testAccountId
      );

      expect(result).toStrictEqual({ success: true });

      const deleted = await mockModule.prisma.webhookSubscription.findUnique({
        where: { id: subscription.id },
      });

      expect(deleted).toBe(null);
    });

    it("should throw error when subscription not found", async () => {
      await expect(
        state.webhookManager.deleteSubscription("non-existent-id", state.testAccountId)
      ).rejects.toThrow("Webhook subscription not found");
    });

    it("should throw error when deleting other account's subscription", async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccount2Id, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      await expect(
        state.webhookManager.deleteSubscription(subscription.id, state.testAccountId)
      ).rejects.toThrow("Webhook subscription not found");

      stores.subscriptions.delete(subscription.id);
    });
  });
});
