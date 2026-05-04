/**
 * @file schedulingService.management.test.ts
 * @description Tests for InstagramSchedulingService -- cancel, health, stories
 *              scheduling with video splitting, carousel scheduling, close/cleanup,
 *              and metrics.
 *
 * Schedule creation and validation tests live in schedulingService.scheduling.test.ts.
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

describe("InstagramSchedulingService -- management", { concurrent: false }, () => {
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
  // cancelScheduledPost
  // =========================================================================

  describe("cancelScheduledPost", { concurrent: false }, () => {
    it("should cancel a scheduled post successfully", async () => {
      const result = await service.cancelScheduledPost("queue-job-123");

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value, true);
      }

      assert.strictEqual(mockQueue.remove.mock.calls.length, 1);
      const removeCall0 = (mockQueue.remove.mock.calls as any[])[0];
      assert.ok(removeCall0);
      assert.strictEqual(removeCall0[0], "queue-job-123");
    });

    it("should handle cancel errors gracefully", async () => {
      mockQueue.remove.mockImplementation(async () => {
        throw new Error("Redis connection lost");
      });

      const result = await service.cancelScheduledPost("queue-job-456");

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "QUEUE_ERROR");
      }
    });

    it("should propagate adapter not-found errors", async () => {
      mockQueue.remove.mockImplementation(async () => ({
        ok: false as const,
        error: "NOT_FOUND" as const,
      }));

      const result = await service.cancelScheduledPost("nonexistent-job");

      assert.strictEqual(result.ok, false);
    });
  });

  // =========================================================================
  // getSchedulingHealth
  // =========================================================================

  describe("getSchedulingHealth", { concurrent: false }, () => {
    it("should return health status when queue is healthy", async () => {
      const result = await service.getSchedulingHealth();

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.connected, true);
        assert.strictEqual(result.value.waiting, 5);
        assert.strictEqual(result.value.active, 2);
        assert.strictEqual(result.value.completed, 100);
        assert.strictEqual(result.value.failed, 3);
        assert.ok("circuitBreakerStatus" in result.value);
        assert.ok("resilienceMetrics" in result.value);
      }
    });

    it("should return error when queue health check fails", async () => {
      mockQueue.health.mockImplementation(async () => ({
        ok: false as const,
        error: "Queue disconnected",
      }));

      const result = await service.getSchedulingHealth();

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "QUEUE_ERROR");
      }
    });

    it("should handle exceptions during health check", async () => {
      mockQueue.health.mockImplementation(async () => {
        throw new Error("Redis timeout");
      });

      const result = await service.getSchedulingHealth();

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "QUEUE_ERROR");
      }
    });
  });

  // =========================================================================
  // scheduleStories -- video splitting
  // =========================================================================

  describe("scheduleStories", { concurrent: false }, () => {
    it("should schedule stories with video splitting", async () => {
      const storiesJob = baseJob({
        contentType: "STORIES",
        content: {
          text: "Amazing story sequence",
          media: [{ url: "https://example.com/long-video.mp4", type: "video" }],
        },
      });

      const result = await service.scheduleStories(defaultCredentials(), storiesJob);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        // mockMedia.splitVideoForStories returns 2 segments
        assert.strictEqual(result.value.length, 2);
        assert.ok(result.value[0].success);
        assert.ok(result.value[1].success);
      }

      // Verify splitVideoForStories was called
      assert.strictEqual(mockMedia.splitVideoForStories.mock.calls.length, 1);
    });

    it("should schedule image-only stories without splitting", async () => {
      const imageStoriesJob = baseJob({
        contentType: "STORIES",
        content: {
          text: "Image story",
          media: [
            { url: "https://example.com/photo1.jpg", type: "image" },
            { url: "https://example.com/photo2.jpg", type: "image" },
          ],
        },
      });

      const result = await service.scheduleStories(defaultCredentials(), imageStoriesJob);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.length, 2);
        // Only first story gets text
        assert.ok(result.value[0].success);
        assert.ok(result.value[1].success);
      }

      // No video splitting needed
      assert.strictEqual(mockMedia.splitVideoForStories.mock.calls.length, 0);
    });

    it("should reject non-STORIES content type", async () => {
      const feedJob = baseJob({ contentType: "FEED" });

      const result = await service.scheduleStories(defaultCredentials(), feedJob);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });

    it("should schedule story segments sequentially with 1s gap", async () => {
      const storiesJob = baseJob({
        contentType: "STORIES",
        content: {
          media: [{ url: "https://example.com/video.mp4", type: "video" }],
        },
      });

      const result = await service.scheduleStories(defaultCredentials(), storiesJob);

      assert.strictEqual(result.ok, true);
      if (result.ok && result.value.length >= 2) {
        const time1 = result.value[0].scheduledAt.getTime();
        const time2 = result.value[1].scheduledAt.getTime();
        const gap = time2 - time1;
        assert.strictEqual(gap, 1000, `Expected 1000ms gap, got ${gap}ms`);
      }
    });

    it("should handle video splitting errors", async () => {
      mockMedia.splitVideoForStories.mockImplementation(async () => {
        throw new Error("FFmpeg processing error");
      });

      const storiesJob = baseJob({
        contentType: "STORIES",
        content: {
          media: [{ url: "https://example.com/corrupt.mp4", type: "video" }],
        },
      });

      const result = await service.scheduleStories(defaultCredentials(), storiesJob);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "PROCESSING_ERROR");
      }
    });
  });

  // =========================================================================
  // scheduleCarousel
  // =========================================================================

  describe("scheduleCarousel", { concurrent: false }, () => {
    it("should schedule a valid carousel", async () => {
      const carouselJob = baseJob({
        contentType: "CAROUSEL",
        content: {
          text: "Multi-image carousel #carousel",
          media: [
            { url: "https://example.com/photo1.jpg", type: "image" },
            { url: "https://example.com/photo2.jpg", type: "image" },
            { url: "https://example.com/photo3.jpg", type: "image" },
          ],
        },
      });

      const result = await service.scheduleCarousel(defaultCredentials(), carouselJob);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.success, true);
      }
    });

    it("should reject non-CAROUSEL content type", async () => {
      const feedJob = baseJob({ contentType: "FEED" });

      const result = await service.scheduleCarousel(defaultCredentials(), feedJob);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });

    it("should reject carousel with less than 2 items", async () => {
      const singleMediaJob = baseJob({
        contentType: "CAROUSEL",
        content: {
          text: "Not enough items",
          media: [{ url: "https://example.com/single.jpg", type: "image" }],
        },
      });

      const result = await service.scheduleCarousel(defaultCredentials(), singleMediaJob);

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

      const overloadedJob = baseJob({
        contentType: "CAROUSEL",
        content: { text: "Too many", media: tooManyMedia },
      });

      const result = await service.scheduleCarousel(defaultCredentials(), overloadedJob);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });
  });

  // =========================================================================
  // close / cleanup
  // =========================================================================

  describe("close", { concurrent: false }, () => {
    it("should close the queue adapter", async () => {
      await service.close();

      assert.strictEqual(mockQueue.close.mock.calls.length, 1);
    });

    it("should handle close errors gracefully", async () => {
      mockQueue.close.mockImplementation(async () => {
        throw new Error("Close failed");
      });

      // Should not throw
      await service.close();
    });
  });

  // =========================================================================
  // metrics
  // =========================================================================

  describe("metrics", () => {
    it("should provide metrics registry", () => {
      const registry = InstagramSchedulingService.getMetricsRegistry();
      assert.ok(registry !== undefined);
    });
  });
});
