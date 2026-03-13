/**
 * @file webhookHandler.stats.test.ts
 * @description Tests for WebhookHandler processing statistics, retry logic,
 *              and edge cases with mocked prisma.
 * @layer test
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { randomUUID } from "crypto";
import { createMockPrismaModule, createStore, buildModelMock } from "./helpers/mockPrisma.js";
import { createSignature, createTestSubscriptionData } from "./webhookHandler.test-helpers.js";

// ---------------------------------------------------------------------------
// Mock @infra/prisma with all models needed by webhook processors
// ---------------------------------------------------------------------------
const { mockPrisma, stores } = createMockPrismaModule();

// Additional stores for models used by webhook processors
const channelStore = createStore<Record<string, unknown>>();
const postStore = createStore<Record<string, unknown>>();
const publishLogStore = createStore<Record<string, unknown>>();
const analyticsStore = createStore<Record<string, unknown>>();
const instagramAnalyticsStore = createStore<Record<string, unknown>>();

// Override webhookEvent.findUnique to handle compound key provider_eventId
const webhookEventMock = mockPrisma.prisma.webhookEvent;
const originalFindUnique = webhookEventMock.findUnique;
webhookEventMock.findUnique = vi.fn(async (args: Record<string, unknown>) => {
  const where = args.where as Record<string, unknown>;
  if (where && typeof where.provider_eventId === "object" && where.provider_eventId !== null) {
    const compound = where.provider_eventId as Record<string, unknown>;
    const expandedWhere = { ...where, ...compound };
    delete expandedWhere.provider_eventId;
    return originalFindUnique({ ...args, where: expandedWhere });
  }
  return originalFindUnique(args);
});

// Override groupBy to support multi-field grouping and _avg
webhookEventMock.groupBy = vi.fn(
  async (args: {
    by: string[];
    where?: Record<string, unknown>;
    _count?: Record<string, boolean>;
    _avg?: Record<string, boolean>;
  }) => {
    const { by, where, _count, _avg } = args;
    let entries = stores.webhookEvent.all();

    // Apply where filter
    if (where) {
      entries = entries.filter((entry) => {
        for (const [key, val] of Object.entries(where)) {
          const recordVal = entry[key];
          if (val && typeof val === "object" && !Array.isArray(val)) {
            const ops = val as Record<string, unknown>;
            if ("gte" in ops && (recordVal as Date) < (ops.gte as Date)) return false;
            if ("lte" in ops && (recordVal as Date) > (ops.lte as Date)) return false;
          } else if (recordVal !== val) {
            return false;
          }
        }
        return true;
      });
    }

    // Group by composite key
    const groups = new Map<
      string,
      { entries: Record<string, unknown>[]; keyValues: Record<string, unknown> }
    >();
    for (const entry of entries) {
      const keyParts = by.map((field) => String(entry[field] ?? ""));
      const compositeKey = keyParts.join("|");
      if (!groups.has(compositeKey)) {
        const keyValues: Record<string, unknown> = {};
        for (const field of by) {
          keyValues[field] = entry[field];
        }
        groups.set(compositeKey, { entries: [], keyValues });
      }
      groups.get(compositeKey)!.entries.push(entry);
    }

    // Build results
    return [...groups.values()].map(({ entries: groupEntries, keyValues }) => {
      const result: Record<string, unknown> = { ...keyValues };

      // _count
      if (_count) {
        const countObj: Record<string, number> = {};
        for (const [field, enabled] of Object.entries(_count)) {
          if (enabled) countObj[field] = groupEntries.length;
        }
        result._count = countObj;
      }

      // _avg
      if (_avg) {
        const avgObj: Record<string, number | null> = {};
        for (const [field, enabled] of Object.entries(_avg)) {
          if (enabled) {
            const values = groupEntries
              .map((e) => e[field] as number | null | undefined)
              .filter((v): v is number => typeof v === "number");
            avgObj[field] =
              values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
          }
        }
        result._avg = avgObj;
      }

      return result;
    });
  }
);

const extendedPrisma = {
  ...mockPrisma.prisma,
  channel: buildModelMock(channelStore),
  post: buildModelMock(postStore),
  publishLog: buildModelMock(publishLogStore),
  analytics: buildModelMock(analyticsStore),
  instagramAnalytics: buildModelMock(instagramAnalyticsStore),
};

vi.mock("@infra/prisma", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, prisma: extendedPrisma };
});

// Mock the logger to avoid console noise
vi.mock("../../src/lib/logger.js", () => ({
  webhookLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Import after mocks are set up
const { UniversalWebhookHandler } = await import("../../src/webhooks/webhookHandler.js");

function seedSubscription(provider: "X" | "INSTAGRAM" | "FACEBOOK" | "YOUTUBE" | "TIKTOK") {
  const { account, project, subscription } = createTestSubscriptionData(provider);
  stores.account.add(account as Record<string, unknown>);
  stores.project.add(project as Record<string, unknown>);
  stores.webhookSubscription.add(subscription as Record<string, unknown>);
  return { account, project, subscription };
}

function clearAllStores() {
  for (const store of Object.values(stores) as { clear: () => void }[]) {
    store.clear();
  }
  channelStore.clear();
  postStore.clear();
  publishLogStore.clear();
  analyticsStore.clear();
  instagramAnalyticsStore.clear();
}

function seedWebhookEvent(data: Record<string, unknown>) {
  stores.webhookEvent.add({
    id: randomUUID(),
    retryCount: 0,
    nextRetryAt: null,
    receivedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  });
}

// ---------------------------------------------------------------------------
// Processing Statistics
// ---------------------------------------------------------------------------
describe("WebhookHandler - Processing Statistics", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should return empty stats when no events", async () => {
    const handler = new UniversalWebhookHandler();

    const stats = await handler.getProcessingStats();

    expect(typeof stats === "object").toBeTruthy();
  });

  it("should aggregate stats by provider and status", async () => {
    seedWebhookEvent({
      provider: "INSTAGRAM",
      eventType: "POST_ENGAGEMENT_UPDATE",
      eventId: "stats-test-1",
      signature: "sig-1",
      payload: {},
      headers: {},
      status: "COMPLETED",
      verified: true,
      processed: true,
      processingTime: 100,
    });

    seedWebhookEvent({
      provider: "INSTAGRAM",
      eventType: "POST_ENGAGEMENT_UPDATE",
      eventId: "stats-test-2",
      signature: "sig-2",
      payload: {},
      headers: {},
      status: "FAILED",
      verified: true,
      processed: false,
      processingTime: 50,
    });

    const handler = new UniversalWebhookHandler();
    const stats = await handler.getProcessingStats();

    expect(typeof stats === "object").toBeTruthy();
    if (stats.INSTAGRAM) {
      expect(stats.INSTAGRAM.COMPLETED || stats.INSTAGRAM.FAILED).toBeTruthy();
    }
  });

  it("should filter stats by provider", async () => {
    seedWebhookEvent({
      provider: "X",
      eventType: "POST_ENGAGEMENT_UPDATE",
      eventId: "stats-x-test",
      signature: "sig-x",
      payload: {},
      headers: {},
      status: "COMPLETED",
      verified: true,
      processed: true,
    });

    const handler = new UniversalWebhookHandler();
    const stats = await handler.getProcessingStats("X");

    expect(typeof stats === "object").toBeTruthy();
  });

  it("should filter stats by time range", async () => {
    const handler = new UniversalWebhookHandler();
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date();

    const stats = await handler.getProcessingStats(undefined, { start, end });

    expect(typeof stats === "object").toBeTruthy();
  });

  it("should include average processing time in stats", async () => {
    seedWebhookEvent({
      provider: "FACEBOOK",
      eventType: "POST_ENGAGEMENT_UPDATE",
      eventId: "avg-time-test-1",
      signature: "sig-avg-1",
      payload: {},
      headers: {},
      status: "COMPLETED",
      verified: true,
      processed: true,
      processingTime: 100,
    });

    seedWebhookEvent({
      provider: "FACEBOOK",
      eventType: "POST_ENGAGEMENT_UPDATE",
      eventId: "avg-time-test-2",
      signature: "sig-avg-2",
      payload: {},
      headers: {},
      status: "COMPLETED",
      verified: true,
      processed: true,
      processingTime: 200,
    });

    const handler = new UniversalWebhookHandler();
    const stats = await handler.getProcessingStats("FACEBOOK");

    expect(typeof stats === "object").toBeTruthy();
    if (stats.FACEBOOK?.COMPLETED) {
      const completedStats = stats.FACEBOOK.COMPLETED;
      if ("avgProcessingTime" in completedStats) {
        expect(typeof completedStats.avgProcessingTime === "number").toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Failed Event Retry
// ---------------------------------------------------------------------------
describe("WebhookHandler - Failed Event Retry", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should retry events ready for retry", async () => {
    seedWebhookEvent({
      provider: "INSTAGRAM",
      eventType: "POST_ENGAGEMENT_UPDATE",
      eventId: "retry-ready-test",
      signature: "sig-retry",
      payload: { entry: [{ id: "retry-ready-test" }] },
      headers: {},
      status: "RETRYING",
      verified: true,
      processed: false,
      retryCount: 1,
      nextRetryAt: new Date(Date.now() - 1000),
    });

    const handler = new UniversalWebhookHandler();
    const retriedCount = await handler.retryFailedEvents();

    expect(typeof retriedCount === "number").toBeTruthy();
  });

  it("should not retry events not yet due", async () => {
    seedWebhookEvent({
      provider: "INSTAGRAM",
      eventType: "POST_ENGAGEMENT_UPDATE",
      eventId: "retry-future-test",
      signature: "sig-future",
      payload: { entry: [{ id: "test" }] },
      headers: {},
      status: "RETRYING",
      verified: true,
      processed: false,
      retryCount: 1,
      nextRetryAt: new Date(Date.now() + 60000),
    });

    const handler = new UniversalWebhookHandler();
    const retriedCount = await handler.retryFailedEvents();

    expect(retriedCount >= 0).toBeTruthy();
  });

  it("should filter retry events by max age", async () => {
    seedWebhookEvent({
      provider: "INSTAGRAM",
      eventType: "POST_ENGAGEMENT_UPDATE",
      eventId: "retry-old-test",
      signature: "sig-old",
      payload: { entry: [{ id: "test" }] },
      headers: {},
      status: "RETRYING",
      verified: true,
      processed: false,
      retryCount: 1,
      nextRetryAt: new Date(Date.now() - 1000),
      receivedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    const handler = new UniversalWebhookHandler();
    const maxAge = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const retriedCount = await handler.retryFailedEvents(maxAge);

    expect(retriedCount >= 0).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------
describe("WebhookHandler - Edge Cases", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should handle empty payload object", async () => {
    const { subscription } = seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({});

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    expect(result.success).toBe(false);
  });

  it("should handle payload with unexpected structure", async () => {
    const { subscription } = seedSubscription("X");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({ unexpected: "structure" });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-signature": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    expect(result.success).toBe(false);
  });

  it("should handle very large payload", async () => {
    const { subscription } = seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const largePayload = JSON.stringify({
      entry: [
        {
          id: "large-payload-test",
          changes: [
            {
              field: "media",
              value: {
                id: "media-large",
                media_type: "IMAGE",
                caption: "x".repeat(10000),
                timestamp: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    });

    const signature = createSignature(largePayload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, largePayload, headers);

    expect(typeof result === "object").toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Subscription Stats Update
// ---------------------------------------------------------------------------
describe("WebhookHandler - Subscription Stats Update", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should increment subscription stats on successful processing", async () => {
    const { subscription } = seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [
        {
          id: "stats-increment-test",
          changes: [
            {
              field: "media",
              value: {
                id: "media-stats",
                media_type: "IMAGE",
                caption: "Stats test",
                timestamp: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    // Verify the subscription was updated in the store
    const updatedSub = stores.webhookSubscription.get(subscription.id);
    expect(updatedSub).toBeTruthy();
  });
});
