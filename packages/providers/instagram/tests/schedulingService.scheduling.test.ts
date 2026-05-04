/**
 * @file schedulingService.scheduling.test.ts
 * @description Tests for InstagramSchedulingService -- schedule creation,
 *              content validation, and timing optimization.
 *
 * Management tests (cancel, health, carousel, stories) live in
 * schedulingService.management.test.ts.
 *
 * Framework: vitest + node:assert/strict
 * Mocking:   vi.mock() for module-level adapter factories.
 */

import { describe, it, beforeAll, beforeEach, afterAll, vi } from "vitest";
import assert from "node:assert/strict";
import {
  createMockQueueAdapter,
  createMockMediaProcessor,
  defaultCredentials,
  baseJob,
  type MockQueueAdapter,
  type MockMediaProcessor,
} from "./schedulingService.test-helpers.js";

// ── Hoist vi.mock() calls before module evaluation ──

vi.mock("@adapters/queue-bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/queue-bullmq")>();
  return {
    ...actual,
    createBullMQQueueAdapter: () => createMockQueueAdapter(),
  };
});

vi.mock("@adapters/external-apis", () => ({
  createExternalApiCircuitBreaker: () => ({
    call: async (_svc: string, _op: string, fn: (...a: any[]) => Promise<any>) => fn(),
    getAllStatuses: () => ({}),
  }),
  resetExternalApiCircuitBreaker: async () => undefined,
}));

vi.mock("@adapters/storage-s3", () => ({
  createS3StorageAdapter: () => ({
    generateUploadSignature: async () => ({
      ok: true as const,
      value: { url: "https://s3.test/", fields: { key: "k" } },
    }),
  }),
}));

vi.mock("prom-client", () => ({
  default: {
    Registry: class {
      registerMetric() {}
      removeSingleMetric() {}
    },
    Counter: class {
      inc() {}
      labels() {
        return this;
      }
    },
    Histogram: class {
      observe() {}
      labels() {
        return this;
      }
      startTimer() {
        return () => 0;
      }
    },
    Gauge: class {
      set() {}
      inc() {}
      dec() {}
      labels() {
        return this;
      }
    },
  },
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      cb: (err: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      cb(null, { stdout: "{}", stderr: "" });
    }
  ),
}));

// Static import after mocks (Vitest hoists vi.mock before imports)
import { InstagramSchedulingService } from "../src/schedulingService.js";

describe("InstagramSchedulingService -- scheduling", { concurrent: false }, () => {
  let service: any;
  let mockQueue: MockQueueAdapter;
  let mockMedia: MockMediaProcessor;

  beforeAll(() => {
    // No additional setup needed — mocks are registered at module level
  });

  beforeEach(() => {
    mockQueue = createMockQueueAdapter();
    mockMedia = createMockMediaProcessor();

    service = new InstagramSchedulingService();
    (service as any).queueAdapter = mockQueue;
    (service as any).mediaProcessor = mockMedia;
  });

  afterAll(async () => {
    try {
      if (service) await service.close();
    } catch {
      // ignore cleanup errors
    }
  });

  // =========================================================================
  // schedulePost -- basic scheduling
  // =========================================================================

  describe("schedulePost", { concurrent: false }, () => {
    it("should schedule a FEED post successfully", async () => {
      const job = baseJob();
      const result = await service.schedulePost(defaultCredentials(), job);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.success, true);
        assert.ok(result.value.queueJobId);
        assert.ok(result.value.scheduledAt instanceof Date);
        assert.ok(result.value.estimatedPublishTime instanceof Date);
      }

      // Verify enqueue was called
      assert.strictEqual(mockQueue.enqueue.mock.calls.length, 1);
      const firstCall = (mockQueue.enqueue.mock.calls as any[])[0];
      assert.ok(firstCall, "enqueue should have been called");
      const enqueueArg = firstCall[0] as any;
      assert.ok(enqueueArg.dedupeKey.startsWith("instagram-"));
      assert.strictEqual(enqueueArg.payload.contentType, "FEED");
      assert.strictEqual(enqueueArg.payload.type, "instagram_publish");
    });

    it("should schedule a REELS post successfully", async () => {
      const job = baseJob({
        contentType: "REELS",
        content: {
          text: "Amazing reel #reels",
          media: [{ url: "https://example.com/reel.mp4", type: "video" }],
        },
      });

      const result = await service.schedulePost(defaultCredentials(), job);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.success, true);
      }
    });

    it("should reject posts scheduled in the past", async () => {
      const pastJob = baseJob({
        scheduledAt: new Date(Date.now() - 3600000), // 1 hour ago
      });

      const result = await service.schedulePost(defaultCredentials(), pastJob);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });

    it("should reject FEED posts without media", async () => {
      const noMediaJob = baseJob({
        content: { text: "No media feed post", media: [] },
      });

      const result = await service.schedulePost(defaultCredentials(), noMediaJob);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });

    it("should reject REELS without exactly one video", async () => {
      const invalidReelJob = baseJob({
        contentType: "REELS",
        content: {
          text: "Invalid reel",
          media: [{ url: "https://example.com/image.jpg", type: "image" }],
        },
      });

      const result = await service.schedulePost(defaultCredentials(), invalidReelJob);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });

    it("should reject content exceeding 2200 characters", async () => {
      const longContentJob = baseJob({
        content: {
          text: "x".repeat(2201),
          media: [{ url: "https://example.com/image.jpg", type: "image" }],
        },
      });

      const result = await service.schedulePost(defaultCredentials(), longContentJob);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });

    it("should handle queue errors", async () => {
      mockQueue.enqueue.mockImplementation(async () => ({
        ok: false as const,
        error: "Queue connection failed",
      }));

      const job = baseJob();
      const result = await service.schedulePost(defaultCredentials(), job);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "QUEUE_ERROR");
      }
    });
  });

  // =========================================================================
  // schedulePost -- timing optimization
  // =========================================================================

  describe("timing optimization", { concurrent: false }, () => {
    it("should optimize schedule time when requested", async () => {
      // Must use FUTURE date — validateScheduledContent rejects past dates.
      // Create a future Monday at 3am UTC
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7); // 1 week from now
      // Find next Monday
      while (futureDate.getDay() !== 1) futureDate.setDate(futureDate.getDate() + 1);
      futureDate.setHours(3, 0, 0, 0); // 3am local (non-optimal)

      const earlyMorningJob = baseJob({
        scheduledAt: futureDate,
      });

      const result = await service.schedulePost(defaultCredentials(), earlyMorningJob, {
        optimizeForEngagement: true,
      });

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        // Should be moved to 11am (optimal weekday time)
        const scheduledHour = result.value.scheduledAt.getHours();
        assert.ok(
          scheduledHour === 11 || scheduledHour === 19,
          `Expected optimal hour (11 or 19), got ${scheduledHour}`
        );
      }
    });

    it("should not change schedule if already optimal", async () => {
      // Must use FUTURE date
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      // Find next Monday
      while (futureDate.getDay() !== 1) futureDate.setDate(futureDate.getDate() + 1);
      futureDate.setHours(12, 0, 0, 0); // 12pm local (optimal weekday)

      const optimalTimeJob = baseJob({
        scheduledAt: futureDate,
      });

      const result = await service.schedulePost(defaultCredentials(), optimalTimeJob, {
        optimizeForEngagement: true,
      });

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.deepStrictEqual(result.value.scheduledAt, optimalTimeJob.scheduledAt);
      }
    });

    it("should not optimize when not requested", async () => {
      const originalTime = new Date(Date.now() + 3600000);
      const job = baseJob({ scheduledAt: originalTime });

      const result = await service.schedulePost(defaultCredentials(), job, {
        optimizeForEngagement: false,
      });

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.deepStrictEqual(result.value.scheduledAt, originalTime);
      }
    });

    it("should respect maxRetries option", async () => {
      const job = baseJob();
      await service.schedulePost(defaultCredentials(), job, { maxRetries: 10 });

      const firstCall = (mockQueue.enqueue.mock.calls as any[])[0];
      assert.ok(firstCall, "enqueue should have been called");
      const enqueueArg = firstCall[0] as any;
      assert.strictEqual(enqueueArg.payload.maxRetries, 10);
    });
  });

  // =========================================================================
  // content validation -- CAROUSEL
  // =========================================================================

  describe("CAROUSEL validation", { concurrent: false }, () => {
    it("should reject carousel with less than 2 items", async () => {
      const job = baseJob({
        contentType: "CAROUSEL",
        content: {
          text: "Single item carousel",
          media: [{ url: "https://example.com/image.jpg", type: "image" }],
        },
      });

      const result = await service.schedulePost(defaultCredentials(), job);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });

    it("should reject carousel with more than 10 items", async () => {
      const tooManyMedia = Array.from({ length: 11 }, (_, i) => ({
        url: `https://example.com/photo${i}.jpg`,
        type: "image" as const,
      }));

      const job = baseJob({
        contentType: "CAROUSEL",
        content: { text: "Too many items", media: tooManyMedia },
      });

      const result = await service.schedulePost(defaultCredentials(), job);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });

    it("should accept carousel with 2-10 items", async () => {
      const validMedia = Array.from({ length: 5 }, (_, i) => ({
        url: `https://example.com/photo${i}.jpg`,
        type: "image" as const,
      }));

      const job = baseJob({
        contentType: "CAROUSEL",
        content: { text: "Valid carousel", media: validMedia },
      });

      const result = await service.schedulePost(defaultCredentials(), job);

      assert.strictEqual(result.ok, true);
    });
  });

  // =========================================================================
  // content validation -- STORIES
  // =========================================================================

  describe("STORIES validation", { concurrent: false }, () => {
    it("should reject stories without media", async () => {
      const job = baseJob({
        contentType: "STORIES",
        content: { text: "Story without media", media: [] },
      });

      const result = await service.schedulePost(defaultCredentials(), job);

      assert.strictEqual(result.ok, false);
    });

    it("should accept stories with media", async () => {
      const job = baseJob({
        contentType: "STORIES",
        content: {
          media: [{ url: "https://example.com/story.jpg", type: "image" }],
        },
      });

      const result = await service.schedulePost(defaultCredentials(), job);

      assert.strictEqual(result.ok, true);
    });
  });
});
