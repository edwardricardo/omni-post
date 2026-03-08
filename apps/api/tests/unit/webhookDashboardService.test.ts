/**
 * Unit Tests for WebhookDashboardService (node:test)
 * Testing dashboard metrics, event queries, DLQ management, and exports
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { webhookDashboardService } from "../../src/webhooks/webhookDashboardService.js";
import { prisma } from "@infra/prisma";
import type { Provider } from "@infra/prisma";

const timestamp = Date.now();
let testAccountId: string;
let testProjectId: string;
let testEvents: Array<{ id: string; eventId: string }> = [];
let testDeadLetterEventId: string;

describe("WebhookDashboardService", { concurrency: 1 }, () => {
  before(async () => {
    // Create test account
    const account = await prisma.account.create({
      data: {
        email: `webhook-test-${timestamp}@example.com`,
        name: "Webhook Test Account",
        subscription: "PRO",
      },
    });
    testAccountId = account.id;

    // Create test project
    const project = await prisma.project.create({
      data: {
        accountId: testAccountId,
        name: `webhook-test-project-${timestamp}`,
        locale: "en",
      },
    });
    testProjectId = project.id;

    // Create test webhook subscription
    await prisma.webhookSubscription.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        provider: "X" as Provider,
        eventTypes: ["POST_PUBLISHED", "POST_DELETED"],
        webhookUrl: "https://example.com/webhook",
        secretKey: "test-secret-key",
        isActive: true,
      },
    });

    // Create test webhook events with different statuses and providers
    // Use safety margins to avoid boundary race conditions with getTimeRange()
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 50 * 60 * 1000); // 50 min ago (within 1h)
    const sixHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000); // 5h ago (within 6h)
    const oneDayAgo = new Date(now.getTime() - 23 * 60 * 60 * 1000); // 23h ago (within 24h)

    // Completed events for X
    for (let i = 0; i < 5; i++) {
      const event = await prisma.webhookEvent.create({
        data: {
          accountId: testAccountId,
          projectId: testProjectId,
          eventId: `evt-x-success-${timestamp}-${i}`,
          eventType: "POST_PUBLISHED",
          provider: "X" as Provider,
          payload: { test: "data" },
          headers: {},
          signature: "test-signature-x-success",
          status: "COMPLETED",
          verified: true,
          processed: true,
          processingTime: 50 + i * 10,
          receivedAt: oneHourAgo,
          processedAt: new Date(oneHourAgo.getTime() + 100),
        },
      });
      testEvents.push({ id: event.id, eventId: event.eventId });
    }

    // Failed events for X
    for (let i = 0; i < 2; i++) {
      const event = await prisma.webhookEvent.create({
        data: {
          accountId: testAccountId,
          projectId: testProjectId,
          eventId: `evt-x-failed-${timestamp}-${i}`,
          eventType: "POST_DELETED",
          provider: "X" as Provider,
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
        },
      });
      testEvents.push({ id: event.id, eventId: event.eventId });
    }

    // Completed events for Instagram
    for (let i = 0; i < 3; i++) {
      const event = await prisma.webhookEvent.create({
        data: {
          accountId: testAccountId,
          projectId: testProjectId,
          eventId: `evt-instagram-success-${timestamp}-${i}`,
          eventType: "POST_PUBLISHED",
          provider: "INSTAGRAM" as Provider,
          payload: { test: "data" },
          headers: {},
          signature: "test-signature-instagram-success",
          status: "COMPLETED",
          verified: true,
          processed: true,
          processingTime: 80 + i * 5,
          receivedAt: oneDayAgo,
          processedAt: new Date(oneDayAgo.getTime() + 150),
        },
      });
      testEvents.push({ id: event.id, eventId: event.eventId });
    }

    // Dead letter event
    const deadLetterOriginal = await prisma.webhookEvent.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        eventId: `evt-dlq-original-${timestamp}`,
        eventType: "POST_PUBLISHED",
        provider: "X" as Provider,
        payload: { test: "data" },
        headers: {},
        signature: "test-signature-dlq",
        status: "DEAD_LETTER",
        verified: true,
        processed: false,
        retryCount: 5,
        lastError: "Maximum retries exceeded",
        receivedAt: oneDayAgo,
      },
    });
    testEvents.push({ id: deadLetterOriginal.id, eventId: deadLetterOriginal.eventId });

    // Create dead letter queue entry
    const dlqEvent = await prisma.webhookDeadLetter.create({
      data: {
        originalEventId: deadLetterOriginal.id,
        provider: "X" as Provider,
        eventType: "POST_PUBLISHED",
        payload: { test: "data" },
        headers: {},
        failureReason: "Maximum retries exceeded",
        retryCount: 5,
        firstFailedAt: oneDayAgo,
        lastRetryAt: new Date(oneDayAgo.getTime() + 1000),
      },
    });
    testDeadLetterEventId = dlqEvent.id;
  });

  after(async () => {
    // Clean up test data
    try {
      // Delete dead letter events
      await prisma.webhookDeadLetter.deleteMany({
        where: { originalEventId: { in: testEvents.map((e) => e.id) } },
      });

      // Delete webhook events
      await prisma.webhookEvent.deleteMany({
        where: { accountId: testAccountId },
      });

      // Delete webhook subscriptions
      await prisma.webhookSubscription.deleteMany({
        where: { accountId: testAccountId },
      });

      // Delete project
      await prisma.project.delete({
        where: { id: testProjectId },
      });

      // Delete account
      await prisma.account.delete({
        where: { id: testAccountId },
      });
    } catch (error) {
      console.error("Cleanup error:", error);
    } finally {
      await prisma.$disconnect();
    }
  });

  describe("getDashboardMetrics", () => {
    it("should calculate overall metrics correctly for 24h", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      assert.strictEqual(metrics.totalEvents, 11); // 5 X success + 2 X failed + 3 Instagram + 1 DLQ
      assert.strictEqual(metrics.processedEvents, 8); // 5 X + 3 Instagram completed
      assert.strictEqual(metrics.failedEvents, 3); // 2 failed + 1 dead letter
      assert.strictEqual(metrics.successRate, (8 / 11) * 100);
      assert.ok(metrics.avgProcessingTime > 0);
      assert.strictEqual(typeof metrics.queueDepth, "number");
      assert.strictEqual(typeof metrics.realtimeConnections, "number");
    });

    it("should calculate metrics for 1h time range", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "1h",
      });

      assert.strictEqual(metrics.totalEvents, 5); // Only events from last hour
      assert.strictEqual(metrics.processedEvents, 5);
      assert.strictEqual(metrics.failedEvents, 0);
    });

    it("should calculate metrics for 6h time range", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "6h",
      });

      assert.strictEqual(metrics.totalEvents, 7); // 5 from 1h + 2 from 6h
      assert.strictEqual(metrics.processedEvents, 5);
      assert.strictEqual(metrics.failedEvents, 2);
    });

    it("should filter metrics by provider", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
        provider: "X" as Provider,
      });

      assert.strictEqual(metrics.totalEvents, 8); // 5 success + 2 failed + 1 DLQ for X
      assert.strictEqual(metrics.processedEvents, 5);
      assert.strictEqual(metrics.failedEvents, 3);
    });

    it("should filter metrics by projectId", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
        projectId: testProjectId,
      });

      assert.strictEqual(metrics.totalEvents, 11); // All events are in this project
    });

    it("should aggregate metrics by provider", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      // Check X provider stats
      assert.ok(metrics.byProvider.X);
      assert.strictEqual(metrics.byProvider.X.total, 8);
      assert.strictEqual(metrics.byProvider.X.success, 5);
      assert.strictEqual(metrics.byProvider.X.failed, 3);
      assert.strictEqual(metrics.byProvider.X.successRate, (5 / 8) * 100);
      assert.ok(metrics.byProvider.X.avgProcessingTime > 0);

      // Check Instagram provider stats
      assert.ok(metrics.byProvider.INSTAGRAM);
      assert.strictEqual(metrics.byProvider.INSTAGRAM.total, 3);
      assert.strictEqual(metrics.byProvider.INSTAGRAM.success, 3);
      assert.strictEqual(metrics.byProvider.INSTAGRAM.failed, 0);
      assert.strictEqual(metrics.byProvider.INSTAGRAM.successRate, 100);
    });

    it("should aggregate metrics by event type", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      assert.ok(metrics.byEventType["POST_PUBLISHED"]);
      assert.ok(metrics.byEventType["POST_DELETED"]);
      assert.strictEqual(metrics.byEventType["POST_PUBLISHED"], 9); // 5 X + 3 Instagram + 1 DLQ
      assert.strictEqual(metrics.byEventType["POST_DELETED"], 2); // 2 X failed
    });

    it("should generate timeline with 24 intervals", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      assert.strictEqual(metrics.timeline.length, 24);

      // Each interval should have required properties
      metrics.timeline.forEach((interval) => {
        assert.ok(interval.timestamp);
        assert.strictEqual(typeof interval.total, "number");
        assert.strictEqual(typeof interval.success, "number");
        assert.strictEqual(typeof interval.failed, "number");
      });

      // Sum of all intervals should equal total events
      const totalFromTimeline = metrics.timeline.reduce((sum, t) => sum + t.total, 0);
      assert.strictEqual(totalFromTimeline, metrics.totalEvents);
    });
  });

  describe("getRecentEvents", () => {
    it("should retrieve paginated events", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 5,
      });

      assert.strictEqual(data.events.length, 5);
      assert.strictEqual(data.pagination.page, 1);
      assert.strictEqual(data.pagination.limit, 5);
      assert.strictEqual(data.pagination.total, 11);
      assert.strictEqual(data.pagination.pages, 3); // Math.ceil(11/5)
    });

    it("should retrieve second page of events", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 2,
        limit: 5,
      });

      assert.strictEqual(data.events.length, 5);
      assert.strictEqual(data.pagination.page, 2);
    });

    it("should filter events by provider", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
        provider: "X" as Provider,
      });

      assert.strictEqual(data.events.length, 8); // 5 success + 2 failed + 1 DLQ
      data.events.forEach((event) => {
        assert.strictEqual(event.provider, "X");
      });
    });

    it("should filter events by status", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
        status: "COMPLETED",
      });

      assert.strictEqual(data.events.length, 8); // 5 X + 3 Instagram
      data.events.forEach((event) => {
        assert.strictEqual(event.status, "COMPLETED");
      });
    });

    it("should filter events by status FAILED", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
        status: "FAILED",
      });

      assert.strictEqual(data.events.length, 2);
      data.events.forEach((event) => {
        assert.strictEqual(event.status, "FAILED");
      });
    });

    it("should search events by eventId", async () => {
      const searchTerm = `evt-x-success-${timestamp}-0`;
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
        search: searchTerm,
      });

      assert.strictEqual(data.events.length, 1);
      assert.ok(data.events[0].eventId.includes(searchTerm));
    });

    it("should search events by eventType", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 1,
        limit: 20,
        search: "DELETED",
      });

      assert.strictEqual(data.events.length, 2); // 2 POST_DELETED events
      data.events.forEach((event) => {
        assert.ok(
          event.eventType.toUpperCase().includes("DELETED"),
          `eventType ${event.eventType} should contain DELETED`
        );
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
        assert.ok(current >= next, "Events should be ordered by receivedAt desc");
      }
    });
  });

  describe("getEventDetails", () => {
    it("should retrieve event details with relations", async () => {
      const eventId = testEvents[0].id;
      const event = await webhookDashboardService.getEventDetails(testAccountId, eventId);

      assert.strictEqual(event.id, eventId);
      assert.ok(event.project);
      assert.strictEqual(event.project.id, testProjectId);
      assert.ok(event.project.name);
    });

    it("should return error for non-existent event", async () => {
      try {
        await webhookDashboardService.getEventDetails(testAccountId, "non-existent-event-id");
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.ok(error.message.includes("not found"));
      }
    });

    it("should not retrieve events from other accounts", async () => {
      const eventId = testEvents[0].id;
      try {
        await webhookDashboardService.getEventDetails("different-account-id", eventId);
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.ok(error.message.includes("not found"));
      }
    });
  });

  describe("getSubscriptions", () => {
    it("should retrieve subscriptions with stats", async () => {
      const subscriptions = await webhookDashboardService.getSubscriptions(testAccountId);

      assert.strictEqual(subscriptions.length, 1);

      const subscription = subscriptions[0];
      assert.strictEqual(subscription.provider, "X");
      assert.strictEqual(subscription.projectId, testProjectId);
      assert.strictEqual(subscription.isActive, true);
      assert.strictEqual("secretKey" in subscription, false); // Should be omitted for security

      // Check stats
      assert.ok(subscription.stats);
      assert.strictEqual(subscription.stats.totalEvents, 8); // All X events
      assert.strictEqual(subscription.stats.failedEvents, 3); // 2 failed + 1 DLQ
      assert.strictEqual(subscription.stats.successRate, (5 / 8) * 100);

      // Recent events (last 24h) should be all events since they're all within 24h
      assert.ok(subscription.stats.recentEvents >= 0);
    });

    it("should return empty array for account with no subscriptions", async () => {
      const emptyAccount = await prisma.account.create({
        data: {
          email: `empty-webhook-${timestamp}@example.com`,
          name: "Empty Account",
          subscription: "PRO",
        },
      });

      const subscriptions = await webhookDashboardService.getSubscriptions(emptyAccount.id);

      assert.strictEqual(subscriptions.length, 0);

      // Cleanup
      await prisma.account.delete({ where: { id: emptyAccount.id } });
    });
  });

  describe("getDeadLetterQueue", () => {
    it("should retrieve dead letter events", async () => {
      const data = await webhookDashboardService.getDeadLetterQueue(testAccountId, {
        page: 1,
        limit: 10,
        provider: "X" as Provider,
      });

      assert.strictEqual(data.events.length, 1);
      assert.strictEqual(data.pagination.total, 1);

      const dlqEvent = data.events[0];
      assert.strictEqual(dlqEvent.provider, "X");
      assert.strictEqual(dlqEvent.eventType, "POST_PUBLISHED");
      assert.strictEqual(dlqEvent.failureReason, "Maximum retries exceeded");
      assert.strictEqual(dlqEvent.retryCount, 5);
      assert.ok(dlqEvent.originalEvent);
      assert.strictEqual(dlqEvent.originalEvent?.accountId, testAccountId);
    });

    it("should filter DLQ events by search term", async () => {
      const data = await webhookDashboardService.getDeadLetterQueue(testAccountId, {
        page: 1,
        limit: 10,
        provider: "X" as Provider,
        search: "retries",
      });

      assert.strictEqual(data.events.length, 1);
      assert.ok(data.events[0].failureReason?.includes("retries"));
    });

    it("should paginate DLQ events correctly", async () => {
      const data = await webhookDashboardService.getDeadLetterQueue(testAccountId, {
        page: 1,
        limit: 10,
        provider: "X" as Provider,
      });

      assert.strictEqual(data.pagination.page, 1);
      assert.strictEqual(data.pagination.limit, 10);
      assert.strictEqual(data.pagination.pages, 1);
    });
  });

  describe("retryDeadLetterEvent", () => {
    it("should retry dead letter event successfully", async () => {
      const data = await webhookDashboardService.retryDeadLetterEvent(
        testAccountId,
        testDeadLetterEventId
      );

      assert.strictEqual(data.success, true);
      assert.ok(data.message);

      // Verify event was marked as resolved
      const dlqEvent = await prisma.webhookDeadLetter.findUnique({
        where: { id: testDeadLetterEventId },
      });
      assert.ok(dlqEvent?.resolvedAt);
    });

    it("should return error for non-existent DLQ event", async () => {
      try {
        await webhookDashboardService.retryDeadLetterEvent(testAccountId, "non-existent-dlq-id");
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.ok(error.message.includes("not found"));
      }
    });

    it("should not retry events from other accounts", async () => {
      try {
        await webhookDashboardService.retryDeadLetterEvent(
          "different-account-id",
          testDeadLetterEventId
        );
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.ok(error.message.includes("not found"));
      }
    });
  });

  describe("exportWebhookEvents", () => {
    it("should export events as CSV", async () => {
      const exportData = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "24h",
      });

      assert.ok(exportData.csv);
      assert.strictEqual(exportData.count, 11);
      assert.strictEqual(exportData.timeRange, "24h");

      // Check CSV format
      const lines = exportData.csv.split("\n");
      assert.strictEqual(lines.length, 12); // 1 header + 11 data rows

      // Check header
      assert.ok(lines[0].includes("Event ID"));
      assert.ok(lines[0].includes("Event Type"));
      assert.ok(lines[0].includes("Provider"));
      assert.ok(lines[0].includes("Status"));
    });

    it("should export filtered events by provider", async () => {
      const exportData = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "24h",
        provider: "X" as Provider,
      });

      assert.strictEqual(exportData.count, 8); // Only X events

      const lines = exportData.csv.split("\n");
      assert.strictEqual(lines.length, 9); // 1 header + 8 data rows
    });

    it("should export filtered events by projectId", async () => {
      const exportData = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "24h",
        projectId: testProjectId,
      });

      assert.strictEqual(exportData.count, 11); // All events in this project
    });

    it("should export events for different time ranges", async () => {
      const data1h = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "1h",
      });

      assert.strictEqual(data1h.count, 5); // Only events from last hour

      const data6h = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "6h",
      });

      assert.strictEqual(data6h.count, 7); // Events from last 6 hours
    });

    it("should properly escape CSV fields", async () => {
      // Create event with special characters
      const specialEvent = await prisma.webhookEvent.create({
        data: {
          accountId: testAccountId,
          projectId: testProjectId,
          eventId: `evt-special-${timestamp}`,
          eventType: "POST_PUBLISHED",
          provider: "X" as Provider,
          payload: { test: "data" },
          headers: {},
          signature: "test-signature-special",
          status: "FAILED",
          verified: true,
          processed: true,
          lastError: 'Error with "quotes" and, commas',
          receivedAt: new Date(),
        },
      });

      const exportData = await webhookDashboardService.exportWebhookEvents(testAccountId, {
        timeRange: "24h",
      });

      const lines = exportData.csv.split("\n");
      const specialLine = lines.find((line) => line.includes(`evt-special-${timestamp}`));
      assert.ok(specialLine);
      assert.ok(specialLine.includes('""quotes""')); // Escaped quotes

      // Cleanup
      await prisma.webhookEvent.delete({ where: { id: specialEvent.id } });
    });
  });

  describe("Performance Metrics", () => {
    it("should calculate average processing time correctly", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      assert.ok(metrics.avgProcessingTime > 0);

      // Average should be reasonable (between min and max processing times)
      assert.ok(metrics.avgProcessingTime >= 50); // Min processing time
      assert.ok(metrics.avgProcessingTime <= 100); // Max processing time
    });

    it("should calculate provider-specific average processing time", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "24h",
      });

      // X provider should have average of completed events (50-90ms range)
      assert.ok(metrics.byProvider.X.avgProcessingTime > 0);
      assert.ok(metrics.byProvider.X.avgProcessingTime >= 50);

      // Instagram provider should have average of completed events (80-90ms range)
      assert.ok(metrics.byProvider.INSTAGRAM.avgProcessingTime > 0);
      assert.ok(metrics.byProvider.INSTAGRAM.avgProcessingTime >= 80);
    });
  });

  describe("Edge Cases", () => {
    it("should handle account with no events", async () => {
      const emptyAccount = await prisma.account.create({
        data: {
          email: `empty-events-${timestamp}@example.com`,
          name: "Empty Events Account",
          subscription: "PRO",
        },
      });

      const metrics = await webhookDashboardService.getDashboardMetrics(emptyAccount.id, {
        timeRange: "24h",
      });

      assert.strictEqual(metrics.totalEvents, 0);
      assert.strictEqual(metrics.processedEvents, 0);
      assert.strictEqual(metrics.failedEvents, 0);
      assert.strictEqual(metrics.successRate, 0);
      assert.strictEqual(metrics.avgProcessingTime, 0);
      assert.strictEqual(Object.keys(metrics.byProvider).length, 0);
      assert.strictEqual(Object.keys(metrics.byEventType).length, 0);
      assert.strictEqual(metrics.timeline.length, 24); // Always 24 intervals

      // Cleanup
      await prisma.account.delete({ where: { id: emptyAccount.id } });
    });

    it("should handle invalid time range with default 24h", async () => {
      const metrics = await webhookDashboardService.getDashboardMetrics(testAccountId, {
        timeRange: "invalid-range",
      });

      // Should default to 24h behavior
      assert.strictEqual(metrics.totalEvents, 11);
    });

    it("should handle pagination beyond available events", async () => {
      const data = await webhookDashboardService.getRecentEvents(testAccountId, {
        page: 999,
        limit: 10,
      });

      assert.strictEqual(data.events.length, 0);
      assert.strictEqual(data.pagination.page, 999);
      assert.strictEqual(data.pagination.total, 11);
    });
  });
});
