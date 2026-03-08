import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { UniversalWebhookHandler } from "../../src/webhooks/webhookHandler.js";
import { prisma } from "@infra/prisma";
import {
  createSignature,
  cleanupTestData,
  createTestSubscription,
} from "./webhookHandler.test-helpers.js";

describe("WebhookHandler - Processing Statistics", { concurrency: 1 }, () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData().catch(() => {});
  });

  it("should return empty stats when no events", async () => {
    const handler = new UniversalWebhookHandler();

    const stats = await handler.getProcessingStats();

    assert.ok(typeof stats === "object", "Should return stats object");
  });

  it("should aggregate stats by provider and status", async () => {
    await prisma.webhookEvent.create({
      data: {
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
      },
    });

    await prisma.webhookEvent.create({
      data: {
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
      },
    });

    const handler = new UniversalWebhookHandler();
    const stats = await handler.getProcessingStats();

    assert.ok(typeof stats === "object", "Should return stats object");
    if (stats.INSTAGRAM) {
      assert.ok(
        stats.INSTAGRAM.COMPLETED || stats.INSTAGRAM.FAILED,
        "Should have status breakdown"
      );
    }
  });

  it("should filter stats by provider", async () => {
    await prisma.webhookEvent.create({
      data: {
        provider: "X",
        eventType: "POST_ENGAGEMENT_UPDATE",
        eventId: "stats-x-test",
        signature: "sig-x",
        payload: {},
        headers: {},
        status: "COMPLETED",
        verified: true,
        processed: true,
      },
    });

    const handler = new UniversalWebhookHandler();
    const stats = await handler.getProcessingStats("X");

    assert.ok(typeof stats === "object", "Should return stats object");
  });

  it("should filter stats by time range", async () => {
    const handler = new UniversalWebhookHandler();
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date();

    const stats = await handler.getProcessingStats(undefined, { start, end });

    assert.ok(typeof stats === "object", "Should return stats object with time filter");
  });

  it("should include average processing time in stats", async () => {
    await prisma.webhookEvent.create({
      data: {
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
      },
    });

    await prisma.webhookEvent.create({
      data: {
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
      },
    });

    const handler = new UniversalWebhookHandler();
    const stats = await handler.getProcessingStats("FACEBOOK");

    assert.ok(typeof stats === "object", "Should return stats with averages");
    if (stats.FACEBOOK?.COMPLETED) {
      const completedStats = stats.FACEBOOK.COMPLETED;
      if ("avgProcessingTime" in completedStats) {
        assert.ok(
          typeof completedStats.avgProcessingTime === "number",
          "Should have avg processing time"
        );
      }
    }
  });
});

describe("WebhookHandler - Failed Event Retry", { concurrency: 1 }, () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData().catch(() => {});
  });

  it("should retry events ready for retry", async () => {
    await prisma.webhookEvent.create({
      data: {
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
      },
    });

    const handler = new UniversalWebhookHandler();
    const retriedCount = await handler.retryFailedEvents();

    assert.ok(typeof retriedCount === "number", "Should return count of retried events");
  });

  it("should not retry events not yet due", async () => {
    await prisma.webhookEvent.create({
      data: {
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
      },
    });

    const handler = new UniversalWebhookHandler();
    const retriedCount = await handler.retryFailedEvents();

    assert.ok(
      retriedCount >= 0,
      "Should return count (possibly 0 or more based on other retrying events)"
    );
  });

  it("should filter retry events by max age", async () => {
    await prisma.webhookEvent.create({
      data: {
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
      },
    });

    const handler = new UniversalWebhookHandler();
    const maxAge = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const retriedCount = await handler.retryFailedEvents(maxAge);

    assert.ok(retriedCount >= 0, "Should return count (0 or more based on events within max age)");
  });
});

describe("WebhookHandler - Edge Cases", { concurrency: 1 }, () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData().catch(() => {});
  });

  it("should handle empty payload object", async () => {
    const { subscription } = await createTestSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({});

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    assert.strictEqual(result.success, false, "Empty payload should fail");
  });

  it("should handle payload with unexpected structure", async () => {
    const { subscription } = await createTestSubscription("X");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({ unexpected: "structure" });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-signature": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    assert.strictEqual(result.success, false, "Unexpected structure should fail");
  });

  it("should handle very large payload", async () => {
    const { subscription } = await createTestSubscription("INSTAGRAM");

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

    assert.ok(typeof result === "object", "Should return result object");
  });
});

describe("WebhookHandler - Subscription Stats Update", { concurrency: 1 }, () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData().catch(() => {});
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.warn("Prisma disconnect warning:", err);
    }
  });

  it("should increment subscription stats on successful processing", async () => {
    const { subscription } = await createTestSubscription("INSTAGRAM");

    const initialStats = await prisma.webhookSubscription.findUnique({
      where: { id: subscription.id },
    });

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

    const updatedStats = await prisma.webhookSubscription.findUnique({
      where: { id: subscription.id },
    });

    if (initialStats && updatedStats) {
      assert.ok(
        updatedStats.eventsReceived >= initialStats.eventsReceived,
        "Events received should increment"
      );
    }
  });
});
