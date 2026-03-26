/**
 * @file publishingWorker.test.ts
 * @description Unit tests for InstagramPublishingWorker -- worker lifecycle,
 *              content-type publishing (FEED, STORIES, REELS, CAROUSEL),
 *              container status handling, error classification, and health monitoring.
 *
 * Integration/workflow tests (job processing, DB ops, retry backoff, env validation,
 * circuit breaker, complete workflows) live in publishingWorker.integration.test.ts.
 *
 * Framework: vitest + node:assert/strict
 * Mocking:   vi.mock() for module-level adapter factories.
 */

import { describe, it, beforeAll, beforeEach, afterAll, vi } from "vitest";
import assert from "node:assert/strict";
import {
  createMockConsumerAdapter,
  createMockQueueAdapter,
  createMockRepoAdapter,
  createMockApiClient,
  createMockMediaProcessor,
  basePayload,
  type MockConsumerAdapter,
  type MockQueueAdapter,
  type MockRepoAdapter,
  type MockApiClient,
  type MockMediaProcessor,
} from "./publishingWorker.test-helpers.js";

// ── Hoist vi.mock() calls before module evaluation ──

vi.mock("@adapters/queue-bullmq", () => ({
  createBullMQConsumerAdapter: () => createMockConsumerAdapter(),
  createBullMQQueueAdapter: () => createMockQueueAdapter(),
}));

vi.mock("@adapters/external-apis", () => ({
  createExternalApiCircuitBreaker: () => ({
    call: async (_svc: string, _op: string, fn: (...a: any[]) => Promise<any>) => fn(),
    getAllStatuses: () => ({}),
  }),
  resetExternalApiCircuitBreaker: async () => undefined,
}));

vi.mock("@adapters/db-prisma", () => ({
  createPrismaRepoAdapter: () => createMockRepoAdapter(),
}));

vi.mock("prom-client", () => ({
  default: {
    Registry: class FakeRegistry {
      registerMetric() {}
      removeSingleMetric() {}
    },
    Counter: class FakeCounter {
      inc() {}
      labels() {
        return this;
      }
    },
    Histogram: class FakeHistogram {
      observe() {}
      labels() {
        return this;
      }
      startTimer() {
        return () => 0;
      }
    },
    Gauge: class FakeGauge {
      set() {}
      inc() {}
      dec() {}
      labels() {
        return this;
      }
    },
  },
}));

// Static import after mocks (Vitest hoists vi.mock before imports)
import { InstagramPublishingWorker } from "../src/publishingWorker.js";

describe("InstagramPublishingWorker", { concurrent: false }, () => {
  let worker: any;
  let mockConsumer: MockConsumerAdapter;
  let mockQueue: MockQueueAdapter;
  let mockRepo: MockRepoAdapter;
  let mockApiClient: MockApiClient;
  let mockMediaProcessor: MockMediaProcessor;

  beforeAll(() => {
    // Set required env vars before importing the worker (it calls validateEnvironment)
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_S3_BUCKET = "test-bucket";
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mock adapters for each test
    mockConsumer = createMockConsumerAdapter();
    mockQueue = createMockQueueAdapter();
    mockRepo = createMockRepoAdapter();
    mockApiClient = createMockApiClient();
    mockMediaProcessor = createMockMediaProcessor();

    // Create worker -- the constructor calls validateEnvironment() (env already set)
    // and creates module-level adapters (already mocked).
    worker = new InstagramPublishingWorker();

    // Patch instance fields with our per-test mocks so we can verify calls
    (worker as any).consumerAdapter = mockConsumer;
    (worker as any).queueAdapter = mockQueue;
    (worker as any).repoAdapter = mockRepo;
    (worker as any).mediaProcessor = mockMediaProcessor;
  });

  afterAll(async () => {
    try {
      if (worker) await worker.stop();
    } catch {
      // ignore cleanup errors
    }
    delete process.env.AWS_REGION;
    delete process.env.AWS_S3_BUCKET;
  });

  // =========================================================================
  // worker lifecycle
  // =========================================================================

  describe("worker lifecycle", { concurrent: false }, () => {
    it("should start and stop successfully", async () => {
      assert.strictEqual(worker.getHealth().isRunning, false);

      await worker.start();
      assert.strictEqual(worker.getHealth().isRunning, true);

      await worker.stop();
      assert.strictEqual(worker.getHealth().isRunning, false);
    });

    it("should not start if already running", async () => {
      await worker.start();
      assert.strictEqual(worker.getHealth().isRunning, true);

      // Calling start() again should be a no-op (worker uses Pino logger.warn, not console)
      // Verify it doesn't throw and worker is still running
      await worker.start();
      assert.strictEqual(worker.getHealth().isRunning, true);

      await worker.stop();
    });

    it("should handle stop when not running", async () => {
      // Should not throw when stopping a worker that's not running
      await worker.stop();
      assert.strictEqual(worker.getHealth().isRunning, false);
    });
  });

  // =========================================================================
  // FEED post publishing
  // =========================================================================

  describe("FEED post publishing", { concurrent: false }, () => {
    it("should fail when no media is provided for Feed post", async () => {
      // publishFeedPost checks media before calling the API client
      const payload = basePayload({
        content: { text: "Feed post without media", media: [] },
      });

      const result = await (worker as any).publishFeedPost(mockApiClient, payload);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Feed posts require at least one media item");
      assert.strictEqual(result.retryable, false);
    });

    it("should successfully publish a Feed post with image", async () => {
      const payload = basePayload({
        content: {
          text: "Test feed post with image #test",
          media: [
            {
              url: "https://example.com/image.jpg",
              type: "image",
              alt: "Test image",
            },
          ],
        },
      });

      const result = await (worker as any).publishFeedPost(mockApiClient, payload);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.providerPostId, "media-456");
      assert.strictEqual(result.url, "https://instagram.com/p/test123");
      assert.ok(result.publishedAt instanceof Date);

      assert.strictEqual(mockApiClient.createMediaContainer.mock.calls.length, 1);
      const containerCall = (mockApiClient.createMediaContainer.mock.calls as any[])[0];
      assert.ok(containerCall);
      assert.strictEqual(containerCall[0], "https://example.com/image.jpg");
      assert.strictEqual(containerCall[1], "Test feed post with image #test");
      assert.strictEqual(containerCall[2], "IMAGE");
    });

    it("should map video media type correctly", async () => {
      const payload = basePayload({
        content: {
          text: "Feed video post",
          media: [
            {
              url: "https://example.com/video.mp4",
              type: "video",
              alt: "Test video",
            },
          ],
        },
      });

      await (worker as any).publishFeedPost(mockApiClient, payload);

      const videoContainerCall = (mockApiClient.createMediaContainer.mock.calls as any[])[0];
      assert.ok(videoContainerCall);
      assert.strictEqual(videoContainerCall[2], "VIDEO");
    });
  });

  // =========================================================================
  // STORIES publishing
  // =========================================================================

  describe("STORIES publishing", { concurrent: false }, () => {
    it("should successfully publish a Story with image", async () => {
      const payload = basePayload({
        contentType: "STORIES",
        content: {
          media: [
            {
              url: "https://example.com/story-image.jpg",
              type: "image",
              alt: "Story image",
            },
          ],
        },
      });

      const result = await (worker as any).publishStory(mockApiClient, payload);

      assert.strictEqual(result.success, true);
      assert.strictEqual(mockApiClient.createStoriesContainer.mock.calls.length, 1);
      const storyCall = (mockApiClient.createStoriesContainer.mock.calls as any[])[0];
      assert.ok(storyCall);
      assert.strictEqual(storyCall[0], "https://example.com/story-image.jpg");
      assert.strictEqual(storyCall[1], "IMAGE");
    });

    it("should successfully publish a Story with video", async () => {
      const payload = basePayload({
        contentType: "STORIES",
        content: {
          media: [
            {
              url: "https://example.com/story-video.mp4",
              type: "video",
            },
          ],
        },
      });

      const result = await (worker as any).publishStory(mockApiClient, payload);

      assert.strictEqual(result.success, true);
      const storyVideoCall = (mockApiClient.createStoriesContainer.mock.calls as any[])[0];
      assert.ok(storyVideoCall);
      assert.strictEqual(storyVideoCall[1], "VIDEO");
    });

    it("should fail when no media is provided for Stories", async () => {
      const payload = basePayload({
        contentType: "STORIES",
        content: { text: "Story without media", media: [] },
      });

      const result = await (worker as any).publishStory(mockApiClient, payload);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Stories require at least one media item");
    });
  });

  // =========================================================================
  // REELS publishing
  // =========================================================================

  describe("REELS publishing", { concurrent: false }, () => {
    it("should successfully publish a Reel", async () => {
      const payload = basePayload({
        contentType: "REELS",
        content: {
          text: "Amazing reel content! #reels #video",
          media: [
            {
              url: "https://example.com/reel-video.mp4",
              type: "video",
            },
          ],
        },
        options: { shareToFeed: true, enableRemixing: false },
      });

      const result = await (worker as any).publishReel(mockApiClient, payload);

      assert.strictEqual(result.success, true);

      // Verify video validation was called
      assert.strictEqual(mockMediaProcessor.validateVideo.mock.calls.length, 1);
      const validateCall = (mockMediaProcessor.validateVideo.mock.calls as any[])[0];
      assert.ok(validateCall);
      assert.deepStrictEqual(validateCall, ["https://example.com/reel-video.mp4", "REELS"]);

      // Verify video optimization was called
      assert.strictEqual(mockMediaProcessor.optimizeForReels.mock.calls.length, 1);

      // Verify Reels container creation
      assert.strictEqual(mockApiClient.createReelsContainer.mock.calls.length, 1);
      const reelCall = (mockApiClient.createReelsContainer.mock.calls as any[])[0];
      assert.ok(reelCall);
      assert.strictEqual(reelCall[0], "https://optimized-url.com/reel.mp4");
      assert.strictEqual(reelCall[1], "Amazing reel content! #reels #video");
      assert.strictEqual(reelCall[2], true); // shareToFeed
      assert.strictEqual(reelCall[3], false); // enableRemixing
    });

    it("should fail when video validation fails for Reels", async () => {
      mockMediaProcessor.validateVideo.mockImplementation(async () => ({
        valid: false,
        issues: ["Video is too long for Reels"],
        recommendations: ["Trim video to 90 seconds"],
      }));

      const payload = basePayload({
        contentType: "REELS",
        content: {
          text: "Invalid reel",
          media: [
            {
              url: "https://example.com/too-long-video.mp4",
              type: "video",
            },
          ],
        },
      });

      const result = await (worker as any).publishReel(mockApiClient, payload);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Video validation failed: Video is too long for Reels");
      assert.strictEqual(result.retryable, false);
    });

    it("should fail when Reel doesn't have exactly one video", async () => {
      const payload = basePayload({
        contentType: "REELS",
        content: {
          text: "Invalid reel with image",
          media: [
            {
              url: "https://example.com/image.jpg",
              type: "image",
            },
          ],
        },
      });

      const result = await (worker as any).publishReel(mockApiClient, payload);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Reels require exactly one video");
    });
  });

  // =========================================================================
  // CAROUSEL publishing
  // =========================================================================

  describe("CAROUSEL publishing", { concurrent: false }, () => {
    it("should successfully publish a carousel", async () => {
      const payload = basePayload({
        contentType: "CAROUSEL",
        content: {
          text: "Check out these photos! #carousel",
          media: [
            { url: "https://example.com/photo1.jpg", type: "image" },
            { url: "https://example.com/photo2.jpg", type: "image" },
            { url: "https://example.com/video1.mp4", type: "video" },
          ],
        },
      });

      const result = await (worker as any).publishCarousel(mockApiClient, payload);

      assert.strictEqual(result.success, true);
      assert.strictEqual(mockApiClient.createCarouselContainer.mock.calls.length, 1);
      const carouselCall = (mockApiClient.createCarouselContainer.mock.calls as any[])[0];
      assert.ok(carouselCall);
      assert.deepStrictEqual(carouselCall[0], [
        { media_type: "IMAGE", media_url: "https://example.com/photo1.jpg" },
        { media_type: "IMAGE", media_url: "https://example.com/photo2.jpg" },
        { media_type: "VIDEO", media_url: "https://example.com/video1.mp4" },
      ]);
      assert.strictEqual(carouselCall[1], "Check out these photos! #carousel");
    });

    it("should fail when carousel has too few items", async () => {
      const payload = basePayload({
        contentType: "CAROUSEL",
        content: {
          text: "Single item",
          media: [{ url: "https://example.com/single.jpg", type: "image" }],
        },
      });

      const result = await (worker as any).publishCarousel(mockApiClient, payload);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Carousel posts require 2-10 media items");
    });

    it("should fail when carousel has too many items", async () => {
      const tooManyMedia = Array.from({ length: 15 }, (_, i) => ({
        url: `https://example.com/photo${i}.jpg`,
        type: "image" as const,
      }));

      const payload = basePayload({
        contentType: "CAROUSEL",
        content: { text: "Too many items", media: tooManyMedia },
      });

      const result = await (worker as any).publishCarousel(mockApiClient, payload);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Carousel posts require 2-10 media items");
    });
  });

  // =========================================================================
  // container status handling
  // =========================================================================

  describe("container status handling", { concurrent: false }, () => {
    it("should wait for container to be ready before publishing", async () => {
      let statusCallCount = 0;
      mockApiClient.getContainerStatus.mockImplementation(async () => {
        statusCallCount++;
        if (statusCallCount < 3) {
          return { id: "container-123", status: "IN_PROGRESS" };
        }
        return { id: "container-123", status: "FINISHED" };
      });

      // Call waitForContainer directly
      await (worker as any).waitForContainer(mockApiClient, "container-123");

      assert.strictEqual(mockApiClient.getContainerStatus.mock.calls.length, 3);
    });

    it("should fail when container processing fails", async () => {
      mockApiClient.getContainerStatus.mockImplementation(async () => ({
        id: "container-123",
        status: "ERROR",
        status_code: "MEDIA_ERROR",
      }));

      await assert.rejects(
        async () => (worker as any).waitForContainer(mockApiClient, "container-123"),
        (err: any) => {
          assert.ok(err.message.includes("Media container failed: MEDIA_ERROR"));
          return true;
        }
      );
    });

    it("should timeout if container takes too long", async () => {
      mockApiClient.getContainerStatus.mockImplementation(async () => ({
        id: "container-123",
        status: "IN_PROGRESS",
      }));

      // Use a short timeout (2s = 2 attempts)
      await assert.rejects(
        async () => (worker as any).waitForContainer(mockApiClient, "container-123", 2000),
        (err: any) => {
          assert.strictEqual(err.message, "Media container timeout");
          return true;
        }
      );
    });
  });

  // =========================================================================
  // error handling
  // =========================================================================

  describe("error handling", { concurrent: false }, () => {
    it("should identify retryable errors", () => {
      const w = worker as any;

      // Retryable errors
      assert.strictEqual(w.isRetryableError(new Error("timeout occurred")), true);
      assert.strictEqual(w.isRetryableError(new Error("network connection failed")), true);
      assert.strictEqual(w.isRetryableError(new Error("rate limit exceeded")), true);
      assert.strictEqual(w.isRetryableError(new Error("server error 503")), true);
      assert.strictEqual(w.isRetryableError(new Error("temporary failure")), true);

      // Non-retryable errors
      assert.strictEqual(w.isRetryableError(new Error("invalid credentials")), false);
      assert.strictEqual(w.isRetryableError(new Error("bad request")), false);
      assert.strictEqual(w.isRetryableError("not an error object"), false);
    });

    it("should handle unsupported content types", async () => {
      // Call publishContent which uses a switch statement
      const payload = basePayload({ contentType: "IGTV" as any });

      const updateSpy = vi
        .spyOn(worker as any, "updatePublishingQueue")
        .mockResolvedValue(undefined);

      const mockJob = {
        payload: payload as unknown as Record<string, unknown>,
        dedupeKey: "test-unsupported-type",
      };

      await (worker as any).processJob(mockJob);

      // The job should have been processed; the error comes from the switch default
      // or from the API client constructor. Either way, updatePublishingQueue
      // should have been called.
      assert.ok(updateSpy.mock.calls.length > 0);
      updateSpy.mockRestore();
    });
  });

  // =========================================================================
  // health monitoring
  // =========================================================================

  describe("health monitoring", () => {
    it("should provide health status", () => {
      const health = worker.getHealth();

      assert.ok("isRunning" in health);
      assert.ok("circuitBreakerStatus" in health);
      assert.strictEqual(typeof health.isRunning, "boolean");
    });

    it("should provide metrics registry", () => {
      const registry = InstagramPublishingWorker.getMetricsRegistry();
      assert.ok(registry !== undefined);
    });
  });
});
