/**
 * Unit Tests for WebhookJobProcessor - Job ID Generation and Job Data Required/Optional Fields
 *
 * Tests job ID format, uniqueness, idempotency across providers and event IDs,
 * plus required and optional field validation in WebhookJobData.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

      assert.strictEqual(
        jobId,
        "webhook-X-event-123",
        "Job ID should follow webhook-{provider}-{eventId} format"
      );
    });

    it("should include provider in job ID", () => {
      const jobData = createTestJobData({
        provider: "INSTAGRAM" as Provider,
        eventId: "ig-456",
      });

      const jobId = generateJobId(jobData);

      assert.ok(jobId.includes("INSTAGRAM"), "Job ID should include provider");
      assert.strictEqual(jobId, "webhook-INSTAGRAM-ig-456");
    });

    it("should include event ID in job ID", () => {
      const jobData = createTestJobData({
        provider: "FACEBOOK" as Provider,
        eventId: "fb-event-789",
      });

      const jobId = generateJobId(jobData);

      assert.ok(jobId.includes("fb-event-789"), "Job ID should include event ID");
      assert.strictEqual(jobId, "webhook-FACEBOOK-fb-event-789");
    });

    it("should start with 'webhook-' prefix", () => {
      const jobData = createTestJobData();
      const jobId = generateJobId(jobData);

      assert.ok(jobId.startsWith("webhook-"), "Job ID should start with webhook- prefix");
    });
  });

  describe("Job ID Uniqueness", () => {
    it("should generate different IDs for different event IDs", () => {
      const jobData1 = createTestJobData({ eventId: "event-1" });
      const jobData2 = createTestJobData({ eventId: "event-2" });

      const jobId1 = generateJobId(jobData1);
      const jobId2 = generateJobId(jobData2);

      assert.notStrictEqual(jobId1, jobId2, "Different event IDs should produce different job IDs");
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

      assert.notStrictEqual(
        jobId1,
        jobId2,
        "Different providers with same event ID should produce different job IDs"
      );
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

      assert.strictEqual(
        jobId1,
        jobId2,
        "Same provider and event ID should produce same job ID (idempotency)"
      );
    });
  });

  describe("Job ID Edge Cases", () => {
    it("should handle special characters in event IDs", () => {
      const jobData = createTestJobData({
        provider: "X" as Provider,
        eventId: "event-123-abc_def",
      });

      const jobId = generateJobId(jobData);

      assert.strictEqual(jobId, "webhook-X-event-123-abc_def");
    });

    it("should handle UUID-style event IDs", () => {
      const jobData = createTestJobData({
        provider: "YOUTUBE" as Provider,
        eventId: "550e8400-e29b-41d4-a716-446655440000",
      });

      const jobId = generateJobId(jobData);

      assert.strictEqual(jobId, "webhook-YOUTUBE-550e8400-e29b-41d4-a716-446655440000");
    });

    it("should handle numeric event IDs", () => {
      const jobData = createTestJobData({
        provider: "TIKTOK" as Provider,
        eventId: "123456789",
      });

      const jobId = generateJobId(jobData);

      assert.strictEqual(jobId, "webhook-TIKTOK-123456789");
    });

    it("should handle all supported providers", () => {
      const providers: Provider[] = ["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"];

      providers.forEach((provider) => {
        const jobData = createTestJobData({ provider, eventId: "test-event" });
        const jobId = generateJobId(jobData);

        assert.ok(jobId.includes(provider), `Job ID should include provider ${provider}`);
        assert.strictEqual(jobId, `webhook-${provider}-test-event`);
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

      assert.ok(jobData.eventId, "Should have eventId");
      assert.ok(jobData.provider, "Should have provider");
      assert.ok(jobData.eventType, "Should have eventType");
      assert.ok(jobData.payload, "Should have payload");
      assert.ok(jobData.headers, "Should have headers");
      assert.ok(jobData.signature, "Should have signature");
      assert.ok(jobData.retryCount !== undefined, "Should have retryCount");
      assert.ok(jobData.originalReceivedAt, "Should have originalReceivedAt");
    });

    it("should have correct types for required fields", () => {
      const jobData = createTestJobData();

      assert.strictEqual(typeof jobData.eventId, "string");
      assert.strictEqual(typeof jobData.provider, "string");
      assert.strictEqual(typeof jobData.eventType, "string");
      assert.strictEqual(typeof jobData.payload, "object");
      assert.strictEqual(typeof jobData.headers, "object");
      assert.strictEqual(typeof jobData.signature, "string");
      assert.strictEqual(typeof jobData.retryCount, "number");
      assert.strictEqual(typeof jobData.originalReceivedAt, "string");
    });
  });

  describe("Optional Fields", () => {
    it("should allow optional accountId", () => {
      const jobData = createTestJobData({ accountId: "account-123" });

      assert.strictEqual(jobData.accountId, "account-123");
    });

    it("should allow optional projectId", () => {
      const jobData = createTestJobData({ projectId: "project-456" });

      assert.strictEqual(jobData.projectId, "project-456");
    });

    it("should allow both optional fields together", () => {
      const jobData = createTestJobData({
        accountId: "account-123",
        projectId: "project-456",
      });

      assert.strictEqual(jobData.accountId, "account-123");
      assert.strictEqual(jobData.projectId, "project-456");
    });

    it("should work without optional fields", () => {
      const jobData = createTestJobData();

      assert.strictEqual(jobData.accountId, undefined);
      assert.strictEqual(jobData.projectId, undefined);
    });
  });

  describe("Timestamp Behavior", () => {
    it("should store originalReceivedAt as ISO string", () => {
      const now = new Date();
      const jobData = createTestJobData({ originalReceivedAt: now.toISOString() });

      assert.strictEqual(typeof jobData.originalReceivedAt, "string");

      const parsedDate = new Date(jobData.originalReceivedAt);
      assert.ok(!isNaN(parsedDate.getTime()), "Should be valid date string");
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

      assert.strictEqual(jobData1.originalReceivedAt, originalTime);
      assert.strictEqual(jobData2.originalReceivedAt, originalTime);
      assert.strictEqual(jobData3.originalReceivedAt, originalTime);
    });
  });
});
