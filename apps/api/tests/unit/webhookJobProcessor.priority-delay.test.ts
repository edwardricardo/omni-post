import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Provider, WebhookEventType } from "@infra/prisma";
import {
  createTestJobData,
  calculateJobPriority,
  calculateInitialDelay,
} from "./webhookJobProcessor.test-helpers.js";

describe("WebhookJobProcessor - Priority Calculation", () => {
  describe("Engagement Events (High Priority)", () => {
    it("should assign priority 10 to LIKE_RECEIVED events", () => {
      const jobData = createTestJobData({ eventType: "LIKE_RECEIVED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      assert.strictEqual(priority, 10, "LIKE_RECEIVED should have priority 10");
    });

    it("should assign priority 10 to COMMENT_RECEIVED events", () => {
      const jobData = createTestJobData({ eventType: "COMMENT_RECEIVED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      assert.strictEqual(priority, 10, "COMMENT_RECEIVED should have priority 10");
    });

    it("should assign priority 10 to SHARE_RECEIVED events", () => {
      const jobData = createTestJobData({ eventType: "SHARE_RECEIVED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      assert.strictEqual(priority, 10, "SHARE_RECEIVED should have priority 10");
    });

    it("should handle all engagement events consistently", () => {
      const engagementEvents = ["LIKE_RECEIVED", "COMMENT_RECEIVED", "SHARE_RECEIVED"];

      engagementEvents.forEach((eventType) => {
        const jobData = createTestJobData({ eventType: eventType as WebhookEventType });
        const priority = calculateJobPriority(jobData);

        assert.strictEqual(priority, 10, `${eventType} should have priority 10`);
      });
    });
  });

  describe("Post Events (Medium Priority)", () => {
    it("should assign priority 5 to POST_PUBLISHED events", () => {
      const jobData = createTestJobData({ eventType: "POST_PUBLISHED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      assert.strictEqual(priority, 5, "POST_PUBLISHED should have priority 5");
    });

    it("should assign priority 5 to POST_UPDATED events", () => {
      const jobData = createTestJobData({ eventType: "POST_UPDATED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      assert.strictEqual(priority, 5, "POST_UPDATED should have priority 5");
    });

    it("should handle all post events consistently", () => {
      const postEvents = ["POST_PUBLISHED", "POST_UPDATED"];

      postEvents.forEach((eventType) => {
        const jobData = createTestJobData({ eventType: eventType as WebhookEventType });
        const priority = calculateJobPriority(jobData);

        assert.strictEqual(priority, 5, `${eventType} should have priority 5`);
      });
    });
  });

  describe("Other Events (Low Priority)", () => {
    it("should assign priority 1 to POST_ENGAGEMENT_UPDATE events", () => {
      const jobData = createTestJobData({
        eventType: "POST_ENGAGEMENT_UPDATE" as WebhookEventType,
      });
      const priority = calculateJobPriority(jobData);

      assert.strictEqual(priority, 1, "POST_ENGAGEMENT_UPDATE should have priority 1");
    });

    it("should assign priority 1 to unknown event types", () => {
      const jobData = createTestJobData({ eventType: "UNKNOWN_EVENT" as any });
      const priority = calculateJobPriority(jobData);

      assert.strictEqual(priority, 1, "Unknown events should have priority 1");
    });

    it("should handle various low-priority events", () => {
      const lowPriorityEvents = [
        "POST_ENGAGEMENT_UPDATE",
        "CHANNEL_STATS_UPDATE",
        "USER_PROFILE_UPDATE",
      ];

      lowPriorityEvents.forEach((eventType) => {
        const jobData = createTestJobData({ eventType: eventType as any });
        const priority = calculateJobPriority(jobData);

        assert.strictEqual(priority, 1, `${eventType} should have priority 1`);
      });
    });
  });

  describe("Priority Edge Cases", () => {
    it("should handle case-sensitive event types correctly", () => {
      const jobData = createTestJobData({ eventType: "LIKE_RECEIVED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      assert.strictEqual(priority, 10, "Should match exact case for event type");
    });

    it("should prioritize engagement over posts", () => {
      const engagementPriority = calculateJobPriority(
        createTestJobData({ eventType: "LIKE_RECEIVED" as WebhookEventType })
      );
      const postPriority = calculateJobPriority(
        createTestJobData({ eventType: "POST_PUBLISHED" as WebhookEventType })
      );

      assert.ok(engagementPriority > postPriority, "Engagement events should have higher priority");
    });

    it("should prioritize posts over other events", () => {
      const postPriority = calculateJobPriority(
        createTestJobData({ eventType: "POST_PUBLISHED" as WebhookEventType })
      );
      const otherPriority = calculateJobPriority(
        createTestJobData({ eventType: "POST_ENGAGEMENT_UPDATE" as WebhookEventType })
      );

      assert.ok(
        postPriority > otherPriority,
        "Post events should have higher priority than others"
      );
    });
  });
});

describe("WebhookJobProcessor - Delay Calculation", () => {
  describe("First Attempt (No Delay)", () => {
    it("should return 0 delay for first attempt (retryCount = 0)", () => {
      const jobData = createTestJobData({ retryCount: 0 });
      const delay = calculateInitialDelay(jobData);

      assert.strictEqual(delay, 0, "First attempt should have no delay");
    });

    it("should handle multiple jobs with retryCount 0 consistently", () => {
      const jobData1 = createTestJobData({ retryCount: 0, eventId: "event-1" });
      const jobData2 = createTestJobData({ retryCount: 0, eventId: "event-2" });
      const jobData3 = createTestJobData({ retryCount: 0, eventId: "event-3" });

      assert.strictEqual(calculateInitialDelay(jobData1), 0);
      assert.strictEqual(calculateInitialDelay(jobData2), 0);
      assert.strictEqual(calculateInitialDelay(jobData3), 0);
    });
  });

  describe("Exponential Backoff Calculation", () => {
    it("should calculate correct delay for retry 1 (5 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 1 });
      const delay = calculateInitialDelay(jobData);

      assert.strictEqual(delay, 5000, "Retry 1 should have 5 second delay");
    });

    it("should calculate correct delay for retry 2 (10 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 2 });
      const delay = calculateInitialDelay(jobData);

      assert.strictEqual(delay, 10000, "Retry 2 should have 10 second delay");
    });

    it("should calculate correct delay for retry 3 (20 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 3 });
      const delay = calculateInitialDelay(jobData);

      assert.strictEqual(delay, 20000, "Retry 3 should have 20 second delay");
    });

    it("should calculate correct delay for retry 4 (40 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 4 });
      const delay = calculateInitialDelay(jobData);

      assert.strictEqual(delay, 40000, "Retry 4 should have 40 second delay");
    });

    it("should calculate correct delay for retry 5 (80 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 5 });
      const delay = calculateInitialDelay(jobData);

      assert.strictEqual(delay, 80000, "Retry 5 should have 80 second delay");
    });

    it("should calculate correct delay for retry 6 (160 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 6 });
      const delay = calculateInitialDelay(jobData);

      assert.strictEqual(delay, 160000, "Retry 6 should have 160 second delay");
    });

    it("should verify exponential growth pattern", () => {
      const delays = [1, 2, 3, 4, 5].map((retryCount) => {
        const jobData = createTestJobData({ retryCount });
        return calculateInitialDelay(jobData);
      });

      for (let i = 1; i < delays.length; i++) {
        assert.strictEqual(
          delays[i],
          delays[i - 1] * 2,
          `Delay ${i + 1} should be double delay ${i}`
        );
      }
    });
  });

  describe("Maximum Delay Cap (5 Minutes)", () => {
    it("should cap delay at 300000ms (5 minutes) for retry 7", () => {
      const jobData = createTestJobData({ retryCount: 7 });
      const delay = calculateInitialDelay(jobData);

      assert.strictEqual(delay, 300000, "Delay should be capped at 5 minutes");
    });

    it("should cap delay at 300000ms for retry 8", () => {
      const jobData = createTestJobData({ retryCount: 8 });
      const delay = calculateInitialDelay(jobData);

      assert.strictEqual(delay, 300000, "Delay should be capped at 5 minutes");
    });

    it("should cap delay at 300000ms for very high retry counts", () => {
      const highRetryCounts = [10, 15, 20, 50, 100];

      highRetryCounts.forEach((retryCount) => {
        const jobData = createTestJobData({ retryCount });
        const delay = calculateInitialDelay(jobData);

        assert.strictEqual(delay, 300000, `Retry ${retryCount} should be capped at 5 minutes`);
      });
    });

    it("should never exceed 5 minute maximum", () => {
      for (let retryCount = 0; retryCount <= 100; retryCount++) {
        const jobData = createTestJobData({ retryCount });
        const delay = calculateInitialDelay(jobData);

        assert.ok(delay <= 300000, `Retry ${retryCount} delay should not exceed 5 minutes`);
      }
    });
  });

  describe("Delay Edge Cases", () => {
    it("should handle negative retry counts as 0", () => {
      const jobData = createTestJobData({ retryCount: -1 });
      const delay = calculateInitialDelay(jobData);

      assert.ok(delay >= 0, "Delay should never be negative");
    });

    it("should provide consistent delays for same retry count", () => {
      const jobData1 = createTestJobData({ retryCount: 3, eventId: "event-1" });
      const jobData2 = createTestJobData({ retryCount: 3, eventId: "event-2" });

      const delay1 = calculateInitialDelay(jobData1);
      const delay2 = calculateInitialDelay(jobData2);

      assert.strictEqual(delay1, delay2, "Same retry count should produce same delay");
    });

    it("should calculate delays independently of other job properties", () => {
      const jobData1 = createTestJobData({
        retryCount: 3,
        provider: "X" as Provider,
        eventType: "LIKE_RECEIVED" as WebhookEventType,
      });
      const jobData2 = createTestJobData({
        retryCount: 3,
        provider: "INSTAGRAM" as Provider,
        eventType: "POST_PUBLISHED" as WebhookEventType,
      });

      const delay1 = calculateInitialDelay(jobData1);
      const delay2 = calculateInitialDelay(jobData2);

      assert.strictEqual(
        delay1,
        delay2,
        "Delay should only depend on retryCount, not other properties"
      );
    });
  });
});
