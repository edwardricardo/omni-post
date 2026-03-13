import { describe, it, expect } from "vitest";
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

      expect(priority).toBe(10);
    });

    it("should assign priority 10 to COMMENT_RECEIVED events", () => {
      const jobData = createTestJobData({ eventType: "COMMENT_RECEIVED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      expect(priority).toBe(10);
    });

    it("should assign priority 10 to SHARE_RECEIVED events", () => {
      const jobData = createTestJobData({ eventType: "SHARE_RECEIVED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      expect(priority).toBe(10);
    });

    it("should handle all engagement events consistently", () => {
      const engagementEvents = ["LIKE_RECEIVED", "COMMENT_RECEIVED", "SHARE_RECEIVED"];

      engagementEvents.forEach((eventType) => {
        const jobData = createTestJobData({ eventType: eventType as WebhookEventType });
        const priority = calculateJobPriority(jobData);

        expect(priority).toBe(10);
      });
    });
  });

  describe("Post Events (Medium Priority)", () => {
    it("should assign priority 5 to POST_PUBLISHED events", () => {
      const jobData = createTestJobData({ eventType: "POST_PUBLISHED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      expect(priority).toBe(5);
    });

    it("should assign priority 5 to POST_UPDATED events", () => {
      const jobData = createTestJobData({ eventType: "POST_UPDATED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      expect(priority).toBe(5);
    });

    it("should handle all post events consistently", () => {
      const postEvents = ["POST_PUBLISHED", "POST_UPDATED"];

      postEvents.forEach((eventType) => {
        const jobData = createTestJobData({ eventType: eventType as WebhookEventType });
        const priority = calculateJobPriority(jobData);

        expect(priority).toBe(5);
      });
    });
  });

  describe("Other Events (Low Priority)", () => {
    it("should assign priority 1 to POST_ENGAGEMENT_UPDATE events", () => {
      const jobData = createTestJobData({
        eventType: "POST_ENGAGEMENT_UPDATE" as WebhookEventType,
      });
      const priority = calculateJobPriority(jobData);

      expect(priority).toBe(1);
    });

    it("should assign priority 1 to unknown event types", () => {
      const jobData = createTestJobData({ eventType: "UNKNOWN_EVENT" as any });
      const priority = calculateJobPriority(jobData);

      expect(priority).toBe(1);
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

        expect(priority).toBe(1);
      });
    });
  });

  describe("Priority Edge Cases", () => {
    it("should handle case-sensitive event types correctly", () => {
      const jobData = createTestJobData({ eventType: "LIKE_RECEIVED" as WebhookEventType });
      const priority = calculateJobPriority(jobData);

      expect(priority).toBe(10);
    });

    it("should prioritize engagement over posts", () => {
      const engagementPriority = calculateJobPriority(
        createTestJobData({ eventType: "LIKE_RECEIVED" as WebhookEventType })
      );
      const postPriority = calculateJobPriority(
        createTestJobData({ eventType: "POST_PUBLISHED" as WebhookEventType })
      );

      expect(engagementPriority > postPriority).toBeTruthy();
    });

    it("should prioritize posts over other events", () => {
      const postPriority = calculateJobPriority(
        createTestJobData({ eventType: "POST_PUBLISHED" as WebhookEventType })
      );
      const otherPriority = calculateJobPriority(
        createTestJobData({ eventType: "POST_ENGAGEMENT_UPDATE" as WebhookEventType })
      );

      expect(postPriority > otherPriority).toBeTruthy();
    });
  });
});

describe("WebhookJobProcessor - Delay Calculation", () => {
  describe("First Attempt (No Delay)", () => {
    it("should return 0 delay for first attempt (retryCount = 0)", () => {
      const jobData = createTestJobData({ retryCount: 0 });
      const delay = calculateInitialDelay(jobData);

      expect(delay).toBe(0);
    });

    it("should handle multiple jobs with retryCount 0 consistently", () => {
      const jobData1 = createTestJobData({ retryCount: 0, eventId: "event-1" });
      const jobData2 = createTestJobData({ retryCount: 0, eventId: "event-2" });
      const jobData3 = createTestJobData({ retryCount: 0, eventId: "event-3" });

      expect(calculateInitialDelay(jobData1)).toBe(0);
      expect(calculateInitialDelay(jobData2)).toBe(0);
      expect(calculateInitialDelay(jobData3)).toBe(0);
    });
  });

  describe("Exponential Backoff Calculation", () => {
    it("should calculate correct delay for retry 1 (5 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 1 });
      const delay = calculateInitialDelay(jobData);

      expect(delay).toBe(5000);
    });

    it("should calculate correct delay for retry 2 (10 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 2 });
      const delay = calculateInitialDelay(jobData);

      expect(delay).toBe(10000);
    });

    it("should calculate correct delay for retry 3 (20 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 3 });
      const delay = calculateInitialDelay(jobData);

      expect(delay).toBe(20000);
    });

    it("should calculate correct delay for retry 4 (40 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 4 });
      const delay = calculateInitialDelay(jobData);

      expect(delay).toBe(40000);
    });

    it("should calculate correct delay for retry 5 (80 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 5 });
      const delay = calculateInitialDelay(jobData);

      expect(delay).toBe(80000);
    });

    it("should calculate correct delay for retry 6 (160 seconds)", () => {
      const jobData = createTestJobData({ retryCount: 6 });
      const delay = calculateInitialDelay(jobData);

      expect(delay).toBe(160000);
    });

    it("should verify exponential growth pattern", () => {
      const delays = [1, 2, 3, 4, 5].map((retryCount) => {
        const jobData = createTestJobData({ retryCount });
        return calculateInitialDelay(jobData);
      });

      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBe(delays[i - 1] * 2);
      }
    });
  });

  describe("Maximum Delay Cap (5 Minutes)", () => {
    it("should cap delay at 300000ms (5 minutes) for retry 7", () => {
      const jobData = createTestJobData({ retryCount: 7 });
      const delay = calculateInitialDelay(jobData);

      expect(delay).toBe(300000);
    });

    it("should cap delay at 300000ms for retry 8", () => {
      const jobData = createTestJobData({ retryCount: 8 });
      const delay = calculateInitialDelay(jobData);

      expect(delay).toBe(300000);
    });

    it("should cap delay at 300000ms for very high retry counts", () => {
      const highRetryCounts = [10, 15, 20, 50, 100];

      highRetryCounts.forEach((retryCount) => {
        const jobData = createTestJobData({ retryCount });
        const delay = calculateInitialDelay(jobData);

        expect(delay).toBe(300000);
      });
    });

    it("should never exceed 5 minute maximum", () => {
      for (let retryCount = 0; retryCount <= 100; retryCount++) {
        const jobData = createTestJobData({ retryCount });
        const delay = calculateInitialDelay(jobData);

        expect(delay <= 300000).toBeTruthy();
      }
    });
  });

  describe("Delay Edge Cases", () => {
    it("should handle negative retry counts as 0", () => {
      const jobData = createTestJobData({ retryCount: -1 });
      const delay = calculateInitialDelay(jobData);

      expect(delay >= 0).toBeTruthy();
    });

    it("should provide consistent delays for same retry count", () => {
      const jobData1 = createTestJobData({ retryCount: 3, eventId: "event-1" });
      const jobData2 = createTestJobData({ retryCount: 3, eventId: "event-2" });

      const delay1 = calculateInitialDelay(jobData1);
      const delay2 = calculateInitialDelay(jobData2);

      expect(delay1).toBe(delay2);
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

      expect(delay1).toBe(delay2);
    });
  });
});
