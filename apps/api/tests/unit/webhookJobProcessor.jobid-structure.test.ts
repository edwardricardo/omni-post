/**
 * Unit Tests for WebhookJobProcessor - Job ID Generation and Job Data Required/Optional Fields
 *
 * Tests job ID format, uniqueness, idempotency across providers and event IDs,
 * plus required and optional field validation in WebhookJobData.
 */

import { describe, it, expect } from "vitest";
import type { Provider } from "@infra/prisma";
import { createTestJobData, generateJobId } from "./webhookJobProcessor.test-helpers.js";

// ============================================================================
// Job ID Generation Tests
// ============================================================================

describe("WebhookJobProcessor - Job ID Generation", () => {
  describe("Job ID Format", () => {
    it("should generate job ID in correct format", () => {
      const jobData = createTestJobData({
        provider: "X" as Provider,
        eventId: "event-123",
      });

      const jobId = generateJobId(jobData);

      expect(jobId).toBe("webhook-X-event-123");
    });

    it("should include provider in job ID", () => {
      const jobData = createTestJobData({
        provider: "INSTAGRAM" as Provider,
        eventId: "ig-456",
      });

      const jobId = generateJobId(jobData);

      expect(jobId.includes("INSTAGRAM")).toBeTruthy();
      expect(jobId).toBe("webhook-INSTAGRAM-ig-456");
    });

    it("should include event ID in job ID", () => {
      const jobData = createTestJobData({
        provider: "FACEBOOK" as Provider,
        eventId: "fb-event-789",
      });

      const jobId = generateJobId(jobData);

      expect(jobId.includes("fb-event-789")).toBeTruthy();
      expect(jobId).toBe("webhook-FACEBOOK-fb-event-789");
    });

    it("should start with 'webhook-' prefix", () => {
      const jobData = createTestJobData();
      const jobId = generateJobId(jobData);

      expect(jobId.startsWith("webhook-")).toBeTruthy();
    });
  });

  describe("Job ID Uniqueness", () => {
    it("should generate different IDs for different event IDs", () => {
      const jobData1 = createTestJobData({ eventId: "event-1" });
      const jobData2 = createTestJobData({ eventId: "event-2" });

      const jobId1 = generateJobId(jobData1);
      const jobId2 = generateJobId(jobData2);

      expect(jobId1).not.toBe(jobId2);
    });

    it("should generate different IDs for different providers", () => {
      const jobData1 = createTestJobData({
        provider: "X" as Provider,
        eventId: "event-123",
      });
      const jobData2 = createTestJobData({
        provider: "INSTAGRAM" as Provider,
        eventId: "event-123",
      });

      const jobId1 = generateJobId(jobData1);
      const jobId2 = generateJobId(jobData2);

      expect(jobId1).not.toBe(jobId2);
    });

    it("should generate same ID for same provider and event ID", () => {
      const jobData1 = createTestJobData({
        provider: "X" as Provider,
        eventId: "event-123",
      });
      const jobData2 = createTestJobData({
        provider: "X" as Provider,
        eventId: "event-123",
      });

      const jobId1 = generateJobId(jobData1);
      const jobId2 = generateJobId(jobData2);

      expect(jobId1).toBe(jobId2);
    });
  });

  describe("Job ID Edge Cases", () => {
    it("should handle special characters in event IDs", () => {
      const jobData = createTestJobData({
        provider: "X" as Provider,
        eventId: "event-123-abc_def",
      });

      const jobId = generateJobId(jobData);

      expect(jobId).toBe("webhook-X-event-123-abc_def");
    });

    it("should handle UUID-style event IDs", () => {
      const jobData = createTestJobData({
        provider: "YOUTUBE" as Provider,
        eventId: "550e8400-e29b-41d4-a716-446655440000",
      });

      const jobId = generateJobId(jobData);

      expect(jobId).toBe("webhook-YOUTUBE-550e8400-e29b-41d4-a716-446655440000");
    });

    it("should handle numeric event IDs", () => {
      const jobData = createTestJobData({
        provider: "TIKTOK" as Provider,
        eventId: "123456789",
      });

      const jobId = generateJobId(jobData);

      expect(jobId).toBe("webhook-TIKTOK-123456789");
    });

    it("should handle all supported providers", () => {
      const providers: Provider[] = ["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"];

      providers.forEach((provider) => {
        const jobData = createTestJobData({ provider, eventId: "test-event" });
        const jobId = generateJobId(jobData);

        expect(jobId.includes(provider)).toBeTruthy();
        expect(jobId).toBe(`webhook-${provider}-test-event`);
      });
    });
  });
});

// ============================================================================
// WebhookJobData Required and Optional Fields Tests
// ============================================================================

describe("WebhookJobProcessor - Job Data Required and Optional Fields", () => {
  describe("Required Fields", () => {
    it("should contain all required fields", () => {
      const jobData = createTestJobData();

      expect(jobData.eventId).toBeTruthy();
      expect(jobData.provider).toBeTruthy();
      expect(jobData.eventType).toBeTruthy();
      expect(jobData.payload).toBeTruthy();
      expect(jobData.headers).toBeTruthy();
      expect(jobData.signature).toBeTruthy();
      expect(jobData.retryCount !== undefined).toBeTruthy();
      expect(jobData.originalReceivedAt).toBeTruthy();
    });

    it("should have correct types for required fields", () => {
      const jobData = createTestJobData();

      expect(typeof jobData.eventId).toBe("string");
      expect(typeof jobData.provider).toBe("string");
      expect(typeof jobData.eventType).toBe("string");
      expect(typeof jobData.payload).toBe("object");
      expect(typeof jobData.headers).toBe("object");
      expect(typeof jobData.signature).toBe("string");
      expect(typeof jobData.retryCount).toBe("number");
      expect(typeof jobData.originalReceivedAt).toBe("string");
    });
  });

  describe("Optional Fields", () => {
    it("should allow optional accountId", () => {
      const jobData = createTestJobData({ accountId: "account-123" });

      expect(jobData.accountId).toBe("account-123");
    });

    it("should allow optional projectId", () => {
      const jobData = createTestJobData({ projectId: "project-456" });

      expect(jobData.projectId).toBe("project-456");
    });

    it("should allow both optional fields together", () => {
      const jobData = createTestJobData({
        accountId: "account-123",
        projectId: "project-456",
      });

      expect(jobData.accountId).toBe("account-123");
      expect(jobData.projectId).toBe("project-456");
    });

    it("should work without optional fields", () => {
      const jobData = createTestJobData();

      expect(jobData.accountId).toBe(undefined);
      expect(jobData.projectId).toBe(undefined);
    });
  });

  describe("Timestamp Behavior", () => {
    it("should store originalReceivedAt as ISO string", () => {
      const now = new Date();
      const jobData = createTestJobData({ originalReceivedAt: now.toISOString() });

      expect(typeof jobData.originalReceivedAt).toBe("string");

      const parsedDate = new Date(jobData.originalReceivedAt);
      expect(isNaN(parsedDate.getTime())).toBeFalsy();
    });

    it("should preserve original received timestamp across retries", () => {
      const originalTime = new Date("2024-01-01T10:00:00Z").toISOString();

      const jobData1 = createTestJobData({
        originalReceivedAt: originalTime,
        retryCount: 0,
      });
      const jobData2 = createTestJobData({
        originalReceivedAt: originalTime,
        retryCount: 1,
      });
      const jobData3 = createTestJobData({
        originalReceivedAt: originalTime,
        retryCount: 2,
      });

      expect(jobData1.originalReceivedAt).toBe(originalTime);
      expect(jobData2.originalReceivedAt).toBe(originalTime);
      expect(jobData3.originalReceivedAt).toBe(originalTime);
    });
  });
});
