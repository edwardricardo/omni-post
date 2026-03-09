/**
 * @file publishingWorker.integration.test.ts
 * @description Integration tests for InstagramPublishingWorker -- job processing,
 *              database operations, retry logic with exponential backoff,
 *              environment validation, circuit breaker, and complete workflows.
 *              Unit/lifecycle/content-type tests live in publishingWorker.test.ts.
 *
 * Framework: node:test + node:assert/strict
 * Mocking:   mock.module() for module-level adapter factories.
 */

import { describe, it, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createMockConsumerAdapter,
  createMockQueueAdapter,
  createMockRepoAdapter,
  createMockApiClient,
  createMockMediaProcessor,
  createPassthroughCB,
  basePayload,
  type MockConsumerAdapter,
  type MockQueueAdapter,
  type MockRepoAdapter,
  type MockApiClient,
  type MockMediaProcessor,
} from "./publishingWorker.test-helpers.js";

let InstagramPublishingWorker: any;

const cbPassthrough = createPassthroughCB();

describe("InstagramPublishingWorker -- integration", { concurrency: 1 }, () => {
  let worker: any;
  let mockConsumer: MockConsumerAdapter;
  let mockQueue: MockQueueAdapter;
  let mockRepo: MockRepoAdapter;
  let _mockApiClient: MockApiClient;
  let mockMediaProcessor: MockMediaProcessor;

  before(async () => {
    mock.module("@adapters/queue-bullmq", {
      namedExports: {
        createBullMQConsumerAdapter: () => createMockConsumerAdapter(),
        createBullMQQueueAdapter: () => createMockQueueAdapter(),
      },
    });
    mock.module("@adapters/external-apis", {
      namedExports: {
        createExternalApiCircuitBreaker: () => cbPassthrough,
        resetExternalApiCircuitBreaker: async () => undefined,
      },
    });
    mock.module("@adapters/db-prisma", {
      namedExports: {
        createPrismaRepoAdapter: () => createMockRepoAdapter(),
      },
    });
    mock.module("prom-client", {
      defaultExport: {
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
    });

    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_S3_BUCKET = "test-bucket";

    const mod = await import("../src/publishingWorker.js");
    InstagramPublishingWorker = mod.InstagramPublishingWorker;
  });

  beforeEach(() => {
    mockConsumer = createMockConsumerAdapter();
    mockQueue = createMockQueueAdapter();
    mockRepo = createMockRepoAdapter();
    _mockApiClient = createMockApiClient();
    mockMediaProcessor = createMockMediaProcessor();

    worker = new InstagramPublishingWorker();
    (worker as any).consumerAdapter = mockConsumer;
    (worker as any).queueAdapter = mockQueue;
    (worker as any).repoAdapter = mockRepo;
    (worker as any).mediaProcessor = mockMediaProcessor;
  });

  afterEach(async () => {
    try {
      await worker.stop();
    } catch {
      // ignore cleanup errors
    }
  });

  // ── Job processing integration ──

  describe("job processing integration", { concurrency: 1 }, () => {
    it("should handle complete job processing workflow", async () => {
      // Mock the internal publishContent to use our _mockApiClient
      mock.method(worker as any, "publishContent", async () => ({
        success: true,
        providerPostId: "media-456",
        url: "https://instagram.com/p/test123",
        publishedAt: new Date(),
      }));

      const mockJob = {
        payload: basePayload() as unknown as Record<string, unknown>,
        dedupeKey: "test-job-123",
      };

      await (worker as any).processJob(mockJob);

      assert.ok(mockRepo.logPublish.mock.calls.length > 0);
      const logCall0 = (mockRepo.logPublish.mock.calls as any[])[0];
      assert.ok(logCall0);
      const logCall = logCall0.arguments[0] as any;
      assert.strictEqual(logCall.provider, "instagram");
      assert.strictEqual(logCall.status, "OK");
    });

    it("should handle retry logic for failed jobs", async () => {
      mock.method(worker as any, "publishContent", async () => ({
        success: false,
        error: "temporary network failure",
        retryable: true,
      }));

      const mockJob = {
        payload: basePayload({ retryCount: 1 }) as unknown as Record<string, unknown>,
        dedupeKey: "test-retry-job-123",
      };

      const scheduleRetrySpy = mock.method(worker as any, "scheduleRetry", async () => undefined);

      await (worker as any).processJob(mockJob);

      assert.ok(scheduleRetrySpy.mock.calls.length > 0);
      scheduleRetrySpy.mock.restore();
    });

    it("should mark job as failed when max retries exceeded", async () => {
      mock.method(worker as any, "publishContent", async () => ({
        success: false,
        error: "temporary network failure",
        retryable: true,
      }));

      const mockJob = {
        payload: basePayload({
          retryCount: 3,
          postId: "post-123",
          channelId: "channel-456",
        }) as unknown as Record<string, unknown>,
        dedupeKey: "test-max-retry-job-123",
      };

      await (worker as any).processJob(mockJob);

      assert.ok(mockRepo.logPublish.mock.calls.length > 0);
      const retryLogCall0 = (mockRepo.logPublish.mock.calls as any[])[0];
      assert.ok(retryLogCall0);
      const logCall = retryLogCall0.arguments[0] as any;
      assert.strictEqual(logCall.status, "ERR");
    });
  });

  // ── Database operations ──

  describe("database operations", { concurrency: 1 }, () => {
    it("should update database with successful publish result", async () => {
      const queueId = "test-queue-123";
      const result = {
        success: true,
        providerPostId: "instagram-456",
        url: "https://instagram.com/p/test123",
        publishedAt: new Date("2024-01-01T12:00:00Z"),
      };
      const payload = basePayload({
        postId: "post-123",
        channelId: "channel-456",
        queueId,
      });

      await (worker as any).updatePublishingQueue(queueId, "PUBLISHED", result, payload);

      assert.ok(mockRepo.logPublish.mock.calls.length > 0);
      const logCallDb0 = (mockRepo.logPublish.mock.calls as any[])[0];
      assert.ok(logCallDb0);
      const logCall = logCallDb0.arguments[0] as any;
      assert.strictEqual(logCall.postId, "post-123");
      assert.strictEqual(logCall.provider, "instagram");
      assert.strictEqual(logCall.channelId, "channel-456");
      assert.strictEqual(logCall.status, "OK");
      assert.strictEqual(logCall.payload.success, true);
      assert.strictEqual(logCall.payload.providerPostId, "instagram-456");
    });

    it("should update database with failed publish result", async () => {
      const queueId = "test-queue-failed";
      const result = {
        success: false,
        error: "API rate limit exceeded",
        retryable: true,
      };
      const payload = basePayload({
        postId: "post-456",
        channelId: "channel-789",
        queueId,
      });

      await (worker as any).updatePublishingQueue(queueId, "FAILED", result, payload);

      assert.ok(mockRepo.logPublish.mock.calls.length > 0);
      const failedLogCall0 = (mockRepo.logPublish.mock.calls as any[])[0];
      assert.ok(failedLogCall0);
      const logCall = failedLogCall0.arguments[0] as any;
      assert.strictEqual(logCall.status, "ERR");
      assert.strictEqual(logCall.payload.error, "API rate limit exceeded");
    });

    it("should handle database logging errors gracefully", async () => {
      // Replace logPublish with a failing mock
      const failingLogPublish = mock.fn(async () => ({
        ok: false as const,
        error: "Database connection failed",
      }));
      (worker as any).repoAdapter.logPublish = failingLogPublish;

      const queueId = "test-queue-db-error";

      // Should not throw even when logPublish fails — worker uses Pino logger, not console
      await (worker as any).updatePublishingQueue(queueId, "PUBLISHED", {
        success: true,
        providerPostId: "post-123",
      });

      // Verify logPublish was called
      assert.ok(failingLogPublish.mock.calls.length > 0, "logPublish should have been called");
    });

    it("should extract IDs from queue ID when payload IDs are missing", async () => {
      const queueId = "post-abc_channel-xyz_123456";

      await (worker as any).updatePublishingQueue(queueId, "PUBLISHED", {
        success: true,
        providerPostId: "post-123",
      });

      assert.ok(mockRepo.logPublish.mock.calls.length > 0);
      const extractLogCall0 = (mockRepo.logPublish.mock.calls as any[])[0];
      assert.ok(extractLogCall0);
      const logCall = extractLogCall0.arguments[0] as any;
      assert.strictEqual(logCall.postId, "post-abc");
      assert.strictEqual(logCall.channelId, "channel-xyz");
    });
  });

  // ── Retry logic with exponential backoff ──

  describe("retry logic with exponential backoff", { concurrency: 1 }, () => {
    let dateNowSpy: ReturnType<typeof mock.method>;

    beforeEach(() => {
      dateNowSpy = mock.method(Date, "now", () => 1640995200000);
    });

    afterEach(() => {
      dateNowSpy.mock.restore();
    });

    it("should calculate exponential backoff correctly", async () => {
      const payload = basePayload({
        queueId: "test-retry-queue",
        retryCount: 2,
        maxRetries: 5,
      });
      await (worker as any).scheduleRetry(payload);

      // Exponential backoff: 60000 * 2^2 = 240000ms (4 minutes)
      const expectedRetryTime = new Date(1640995200000 + 240000);

      assert.ok(mockQueue.enqueue.mock.calls.length > 0);
      const backoffEnqueueCall0 = (mockQueue.enqueue.mock.calls as any[])[0];
      assert.ok(backoffEnqueueCall0);
      const enqueueCall = backoffEnqueueCall0.arguments[0] as any;
      assert.strictEqual(enqueueCall.payload.retryCount, 3);
      assert.strictEqual(enqueueCall.dedupeKey, "test-retry-queue_retry_3");
      assert.deepStrictEqual(enqueueCall.runAt, expectedRetryTime);
    });

    it("should cap backoff delay at 30 minutes", async () => {
      const payload = basePayload({
        queueId: "test-max-backoff",
        retryCount: 10,
        maxRetries: 15,
      });
      await (worker as any).scheduleRetry(payload);

      const expectedRetryTime = new Date(1640995200000 + 1800000);

      assert.ok(mockQueue.enqueue.mock.calls.length > 0);
      const capEnqueueCall0 = (mockQueue.enqueue.mock.calls as any[])[0];
      assert.ok(capEnqueueCall0);
      const enqueueCall = capEnqueueCall0.arguments[0] as any;
      assert.strictEqual(enqueueCall.payload.retryCount, 11);
      assert.deepStrictEqual(enqueueCall.runAt, expectedRetryTime);
    });

    it("should handle retry scheduling failures", async () => {
      // Replace enqueue with a failing mock
      const failingEnqueue = mock.fn(async () => ({
        ok: false as const,
        error: "Queue is full",
      }));
      (worker as any).queueAdapter.enqueue = failingEnqueue;

      const payload = basePayload({
        queueId: "test-failed-retry",
        retryCount: 1,
        maxRetries: 3,
      });

      // Should not throw — worker uses Pino logger for error logging, not console
      await (worker as any).scheduleRetry(payload);

      // Verify enqueue was called
      assert.ok(failingEnqueue.mock.calls.length > 0, "enqueue should have been called");
    });
  });

  // ── Circuit breaker integration ──

  describe("circuit breaker integration", () => {
    it("should provide circuit breaker status in health check", () => {
      const health = worker.getHealth();

      assert.ok("circuitBreakerStatus" in health);
      assert.ok(health.circuitBreakerStatus !== undefined);
    });
  });
});
