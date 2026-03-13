/**
 * Unit Tests for WebhookJobProcessor - Payload/Headers/Timestamps and Business Logic Integration
 *
 * Tests complex payload object handling, header case sensitivity, retry count
 * behavior, timestamp preservation, and end-to-end business logic coordination.
 */

import { describe, it, expect } from "vitest";
import type { Provider, WebhookEventType } from "@infra/prisma";
import {
  createTestJobData,
  calculateJobPriority,
  calculateInitialDelay,
  generateJobId,
} from "./webhookJobProcessor.test-helpers.js";

// ============================================================================
// WebhookJobData - Payload, Headers, Retry, Timestamp Tests
// ============================================================================

describe("WebhookJobProcessor - Job Data Payload and Headers", () => {
  describe("Payload Structure", () => {
    it("should accept complex payload objects", () => {
      const complexPayload = {
        event: {
          type: "like",
          user: { id: "user-123", name: "Test User" },
          post: { id: "post-456", content: "Test content" },
          timestamp: new Date().toISOString(),
        },
        metadata: {
          source: "mobile",
          version: "1.0.0",
        },
      };

      const jobData = createTestJobData({ payload: complexPayload });

      expect(jobData.payload).toStrictEqual(complexPayload);
    });

    it("should accept empty payload object", () => {
      const jobData = createTestJobData({ payload: {} });

      expect(jobData.payload).toStrictEqual({});
    });

    it("should preserve nested payload structure", () => {
      const nestedPayload = {
        level1: {
          level2: {
            level3: {
              value: "deep nested value",
            },
          },
        },
      };

      const jobData = createTestJobData({ payload: nestedPayload });

      expect(jobData.payload.level1.level2.level3.value).toBe("deep nested value");
    });
  });

  describe("Headers Structure", () => {
    it("should accept standard webhook headers", () => {
      const headers = {
        "x-signature": "sig-123",
        "x-hub-signature-256": "sha256=abc123",
        "content-type": "application/json",
        "user-agent": "Provider-Webhook/1.0",
      };

      const jobData = createTestJobData({ headers });

      expect(jobData.headers).toStrictEqual(headers);
    });

    it("should accept empty headers object", () => {
      const jobData = createTestJobData({ headers: {} });

      expect(jobData.headers).toStrictEqual({});
    });

    it("should preserve case-sensitive header names", () => {
      const headers = {
        "X-Custom-Header": "value1",
        "x-custom-header": "value2",
      };

      const jobData = createTestJobData({ headers });

      expect(jobData.headers["X-Custom-Header"]).toBe("value1");
      expect(jobData.headers["x-custom-header"]).toBe("value2");
    });
  });

  describe("Retry Count Behavior", () => {
    it("should start with retryCount 0 for new jobs", () => {
      const jobData = createTestJobData({ retryCount: 0 });

      expect(jobData.retryCount).toBe(0);
    });

    it("should increment retryCount for retried jobs", () => {
      const jobData1 = createTestJobData({ retryCount: 0 });
      const jobData2 = createTestJobData({ retryCount: 1 });
      const jobData3 = createTestJobData({ retryCount: 2 });

      expect(jobData1.retryCount).toBe(0);
      expect(jobData2.retryCount).toBe(1);
      expect(jobData3.retryCount).toBe(2);
    });

    it("should allow high retry counts", () => {
      const jobData = createTestJobData({ retryCount: 10 });

      expect(jobData.retryCount).toBe(10);
    });
  });
});

// ============================================================================
// Integration - Business Logic Coordination Tests
// ============================================================================

describe("WebhookJobProcessor - Business Logic Integration", () => {
  describe("Priority and Delay Coordination", () => {
    it("should prioritize high-priority events even with delays", () => {
      const engagementJob = createTestJobData({
        eventType: "LIKE_RECEIVED" as WebhookEventType,
        retryCount: 2,
      });
      const otherJob = createTestJobData({
        eventType: "POST_ENGAGEMENT_UPDATE" as WebhookEventType,
        retryCount: 0,
      });

      const engagementPriority = calculateJobPriority(engagementJob);
      const otherPriority = calculateJobPriority(otherJob);

      expect(engagementPriority > otherPriority).toBeTruthy();
    });

    it("should apply appropriate delays to all priority levels", () => {
      const highPriorityJob = createTestJobData({
        eventType: "LIKE_RECEIVED" as WebhookEventType,
        retryCount: 3,
      });
      const mediumPriorityJob = createTestJobData({
        eventType: "POST_PUBLISHED" as WebhookEventType,
        retryCount: 3,
      });
      const lowPriorityJob = createTestJobData({
        eventType: "POST_ENGAGEMENT_UPDATE" as WebhookEventType,
        retryCount: 3,
      });

      const highDelay = calculateInitialDelay(highPriorityJob);
      const mediumDelay = calculateInitialDelay(mediumPriorityJob);
      const lowDelay = calculateInitialDelay(lowPriorityJob);

      // All should have same delay (20 seconds for retry 3)
      expect(highDelay).toBe(20000);
      expect(mediumDelay).toBe(20000);
      expect(lowDelay).toBe(20000);
    });
  });

  describe("Job Identity and Idempotency", () => {
    it("should generate consistent job IDs for retry attempts", () => {
      const jobData1 = createTestJobData({
        provider: "X" as Provider,
        eventId: "event-123",
        retryCount: 0,
      });
      const jobData2 = createTestJobData({
        provider: "X" as Provider,
        eventId: "event-123",
        retryCount: 1,
      });

      const jobId1 = generateJobId(jobData1);
      const jobId2 = generateJobId(jobData2);

      expect(jobId1).toBe(jobId2);
    });

    it("should ensure unique job IDs per event per provider", () => {
      const jobs = [
        { provider: "X" as Provider, eventId: "event-1" },
        { provider: "X" as Provider, eventId: "event-2" },
        { provider: "INSTAGRAM" as Provider, eventId: "event-1" },
        { provider: "INSTAGRAM" as Provider, eventId: "event-2" },
      ];

      const jobIds = jobs.map((job) => generateJobId(createTestJobData(job)));

      const uniqueJobIds = new Set(jobIds);
      expect(uniqueJobIds.size).toBe(jobIds.length);
    });
  });

  describe("Retry Strategy Validation", () => {
    it("should demonstrate exponential backoff progression", () => {
      const retrySequence = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      const delays = retrySequence.map((retryCount) => {
        const jobData = createTestJobData({ retryCount });
        return calculateInitialDelay(jobData);
      });

      const expectedDelays = [
        0, // Retry 0: no delay
        5000, // Retry 1: 5 seconds
        10000, // Retry 2: 10 seconds
        20000, // Retry 3: 20 seconds
        40000, // Retry 4: 40 seconds
        80000, // Retry 5: 80 seconds
        160000, // Retry 6: 160 seconds
        300000, // Retry 7: capped at 5 minutes
        300000, // Retry 8: capped at 5 minutes
      ];

      delays.forEach((delay, index) => {
        expect(delay).toBe(expectedDelays[index]);
      });
    });

    it("should validate complete retry workflow", () => {
      const event = {
        provider: "X" as Provider,
        eventType: "LIKE_RECEIVED" as WebhookEventType,
        eventId: "event-123",
      };

      // Initial attempt
      const attempt0 = createTestJobData({ ...event, retryCount: 0 });
      expect(calculateJobPriority(attempt0)).toBe(10);
      expect(calculateInitialDelay(attempt0)).toBe(0);
      expect(generateJobId(attempt0)).toBe("webhook-X-event-123");

      // First retry
      const attempt1 = createTestJobData({ ...event, retryCount: 1 });
      expect(calculateJobPriority(attempt1)).toBe(10);
      expect(calculateInitialDelay(attempt1)).toBe(5000);
      expect(generateJobId(attempt1)).toBe("webhook-X-event-123");

      // Second retry
      const attempt2 = createTestJobData({ ...event, retryCount: 2 });
      expect(calculateJobPriority(attempt2)).toBe(10);
      expect(calculateInitialDelay(attempt2)).toBe(10000);
      expect(generateJobId(attempt2)).toBe("webhook-X-event-123");
    });
  });
});
