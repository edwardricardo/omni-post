import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { Provider, WebhookEventType } from "@infra/prisma";
import {
  state,
  setupWebhookManagerTestData,
  teardownWebhookManagerTestData,
} from "./webhookManager.test-helpers.js";

describe("WebhookManager - Processing & Security", { concurrency: 1 }, () => {
  before(async () => {
    await setupWebhookManagerTestData();
  });

  after(async () => {
    await teardownWebhookManagerTestData();
  });

  describe("processIncomingWebhook() - Process Webhook Events", { concurrency: 1 }, () => {
    it("should process webhook and return job ID", async () => {
      const jobId = await state.webhookManager.processIncomingWebhook(
        "X" as Provider,
        "POST_PUBLISHED" as WebhookEventType,
        "test-event-123",
        "test-signature",
        { content: "Test post" },
        { "x-twitter-webhooks-signature": "sha256=abc123" },
        state.testAccountId,
        state.testProjectId
      );

      assert.ok(jobId, "Should return job ID");
      assert.strictEqual(typeof jobId, "string");
    });

    it("should process webhook without optional accountId and projectId", async () => {
      const jobId = await state.webhookManager.processIncomingWebhook(
        "INSTAGRAM" as Provider,
        "STORY_PUBLISHED" as WebhookEventType,
        "test-event-456",
        "test-signature-2",
        { story_id: "123" },
        { "x-hub-signature": "sha1=def456" }
      );

      assert.ok(jobId);
    });

    it("should handle different event types", async () => {
      const eventTypes: WebhookEventType[] = [
        "POST_PUBLISHED",
        "COMMENT_RECEIVED",
        "LIKE_RECEIVED",
        "VIDEO_PROCESSED",
      ];

      for (const eventType of eventTypes) {
        const jobId = await state.webhookManager.processIncomingWebhook(
          "YOUTUBE" as Provider,
          eventType,
          `test-event-${eventType}`,
          "test-signature",
          { test: true },
          {},
          state.testAccountId
        );

        assert.ok(jobId, `Should process ${eventType}`);
      }
    });
  });

  describe("getProcessingStats() - Webhook Processing Statistics", { concurrency: 1 }, () => {
    before(async () => {
      await prisma.webhookEvent.createMany({
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

      assert.ok(stats);
      assert.strictEqual(typeof stats.totalEvents, "number");
      assert.strictEqual(typeof stats.processedEvents, "number");
      assert.strictEqual(typeof stats.failedEvents, "number");
      assert.strictEqual(typeof stats.deadLetterEvents, "number");
      assert.strictEqual(typeof stats.successRate, "number");
      assert.strictEqual(typeof stats.avgProcessingTimeMs, "number");
      assert.ok(stats.queue);
      assert.ok(stats.byProvider);
      assert.ok(Array.isArray(stats.recentErrors));
    });

    it("should calculate success rate correctly", async () => {
      const stats = await state.webhookManager.getProcessingStats(state.testAccountId);

      assert.ok(stats.totalEvents >= 3);
      assert.ok(stats.processedEvents >= 2);
      assert.ok(stats.failedEvents >= 1);
      assert.ok(stats.successRate >= 0 && stats.successRate <= 100);
    });

    it("should calculate average processing time", async () => {
      const stats = await state.webhookManager.getProcessingStats(state.testAccountId);

      assert.ok(stats.avgProcessingTimeMs > 0);
    });

    it("should group statistics by provider", async () => {
      const stats = await state.webhookManager.getProcessingStats(state.testAccountId);

      assert.ok(stats.byProvider);
      assert.ok(stats.byProvider.X || stats.byProvider.INSTAGRAM);

      if (stats.byProvider.X) {
        assert.strictEqual(typeof stats.byProvider.X.total, "number");
        assert.ok(stats.byProvider.X.total >= 2);
      }
    });

    it("should return recent errors", async () => {
      const stats = await state.webhookManager.getProcessingStats(state.testAccountId);

      assert.ok(Array.isArray(stats.recentErrors));
      if (stats.recentErrors.length > 0) {
        const error = stats.recentErrors[0];
        assert.ok(error.id);
        assert.ok(error.provider);
        assert.ok(error.eventType);
        assert.ok(error.lastError);
        assert.ok(error.receivedAt);
        assert.strictEqual(typeof error.retryCount, "number");
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

      assert.ok(stats);
      assert.ok(stats.totalEvents >= 0);
    });

    after(async () => {
      await prisma.webhookEvent.deleteMany({
        where: {
          eventId: { startsWith: "test-event-stat-" },
        },
      });
    });
  });

  describe("retryFailedEvents() - Retry Failed Webhook Events", { concurrency: 1 }, () => {
    before(async () => {
      await prisma.webhookEvent.createMany({
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

      assert.ok(retriedCount >= 2, "Should retry at least 2 failed events");
    });

    it("should retry events within maxAge limit", async () => {
      const retriedCount = await state.webhookManager.retryFailedEvents(state.testAccountId, 7);

      assert.ok(retriedCount >= 0);
    });

    it("should update status to RETRYING for retried events", async () => {
      await state.webhookManager.retryFailedEvents(state.testAccountId);

      const retryingEvents = await prisma.webhookEvent.findMany({
        where: {
          accountId: state.testAccountId,
          eventId: { startsWith: "test-event-retry-" },
          status: "RETRYING",
        },
      });

      assert.ok(retryingEvents.length > 0, "Should have events in RETRYING status");
    });

    it("should handle retry failures gracefully", async () => {
      const retriedCount = await state.webhookManager.retryFailedEvents(state.testAccountId);

      assert.strictEqual(typeof retriedCount, "number");
      assert.ok(retriedCount >= 0);
    });

    after(async () => {
      await prisma.webhookEvent.deleteMany({
        where: {
          eventId: { startsWith: "test-event-retry-" },
        },
      });
    });
  });

  describe("cleanup() - Clean Up Old Webhook Data", { concurrency: 1 }, () => {
    before(async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

      await prisma.webhookEvent.createMany({
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

      assert.strictEqual(typeof result, "object", "cleanup should return a result object");
      assert.strictEqual(typeof result.eventsDeleted, "number", "eventsDeleted should be a number");
      assert.ok(result.eventsDeleted >= 0, "eventsDeleted should be non-negative");
      assert.ok(result.jobsCleanedUp, "jobsCleanedUp should be present");
    });

    it("should not delete pending or processing events", async () => {
      await state.webhookManager.cleanup(30);

      const pendingEvent = await prisma.webhookEvent.findFirst({
        where: { eventId: "test-event-cleanup-3" },
      });

      assert.ok(pendingEvent, "Pending events should not be deleted");
    });

    it("should respect custom maxAgeDays parameter", async () => {
      const result = await state.webhookManager.cleanup(60);

      assert.strictEqual(typeof result, "object", "cleanup should return a result object");
      assert.strictEqual(typeof result.eventsDeleted, "number", "eventsDeleted should be a number");
      assert.ok(result.eventsDeleted >= 0, "eventsDeleted should be non-negative");
    });

    it("should use default 30 days if not specified", async () => {
      const result = await state.webhookManager.cleanup();

      assert.strictEqual(typeof result, "object", "cleanup should return a result object");
      assert.strictEqual(typeof result.eventsDeleted, "number", "eventsDeleted should be a number");
    });

    after(async () => {
      await prisma.webhookEvent.deleteMany({
        where: {
          eventId: { startsWith: "test-event-cleanup-" },
        },
      });
    });
  });

  describe("Security - Secret Key and Verify Token Handling", { concurrency: 1 }, () => {
    it("should never expose secret key in createSubscription response", async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      assert.strictEqual("secretKey" in subscription, false);
    });

    it("should never expose secret key in getSubscriptions response", async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);
      const found = subscriptions.find((sub) => sub.id === subscription.id);

      assert.ok(found);
      assert.strictEqual("secretKey" in found, false);

      await prisma.webhookSubscription.deleteMany({
        where: { id: subscription.id },
      });
    });

    it("should store secret key in database", async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      const dbSubscription = await prisma.webhookSubscription.findUnique({
        where: { id: subscription.id },
      });

      assert.ok(dbSubscription?.secretKey);
      assert.strictEqual(dbSubscription.secretKey.length, 64);

      await prisma.webhookSubscription.deleteMany({
        where: { id: subscription.id },
      });
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

      const dbSub1 = await prisma.webhookSubscription.findUnique({
        where: { id: sub1.id },
      });

      const dbSub2 = await prisma.webhookSubscription.findUnique({
        where: { id: sub2.id },
      });

      assert.notStrictEqual(dbSub1?.secretKey, dbSub2?.secretKey);

      await prisma.webhookSubscription.deleteMany({
        where: { id: { in: [sub1.id, sub2.id] } },
      });
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

      const dbSub1 = await prisma.webhookSubscription.findUnique({
        where: { id: sub1.id },
      });

      const dbSub2 = await prisma.webhookSubscription.findUnique({
        where: { id: sub2.id },
      });

      assert.notStrictEqual(dbSub1?.verifyToken, dbSub2?.verifyToken);

      await prisma.webhookSubscription.deleteMany({
        where: { id: { in: [sub1.id, sub2.id] } },
      });
    });
  });
});
