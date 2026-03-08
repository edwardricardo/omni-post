/**
 * @file publishingWorker.test-helpers.ts
 * @description Shared mock factories and base payload helper for InstagramPublishingWorker tests.
 *              Exported for use by publishingWorker.test.ts and publishingWorker.integration.test.ts.
 *
 * NOTE: These helpers are designed for use with `mock.module()` tests. The source
 * `InstagramPublishingWorker` uses a parameterless constructor that creates adapters
 * at the module level. Tests must mock those modules BEFORE importing the worker.
 */

import { mock } from "node:test";
import type { InstagramPublishPayload } from "../src/publishingWorker.js";

// ── Mock adapter factories ──

export function createMockConsumerAdapter() {
  return {
    subscribe: mock.fn(async () => undefined),
    close: mock.fn(async () => undefined),
  };
}

export function createMockQueueAdapter() {
  return {
    enqueue: mock.fn(async () => ({ ok: true as const, value: "queue-job-123" })),
    close: mock.fn(async () => undefined),
    remove: mock.fn(async () => ({ ok: true as const, value: true })),
    health: mock.fn(async () => ({
      ok: true as const,
      value: { connected: true, waiting: 0, active: 0, completed: 0, failed: 0 },
    })),
    getResilienceMetrics: mock.fn(() => ({})),
  };
}

export function createMockRepoAdapter() {
  return {
    logPublish: mock.fn(async () => ({ ok: true as const, value: { id: "log-123" } })),
    findPost: mock.fn(async () => ({ ok: true as const, value: null })),
    findChannel: mock.fn(async () => ({ ok: true as const, value: null })),
  };
}

export function createPassthroughCB() {
  return {
    call: async (_svc: string, _op: string, fn: (...a: any[]) => Promise<any>) => fn(),
    getAllStatuses: () => ({}),
  };
}

// ── Mock API client factory ──

export function createMockApiClient() {
  return {
    createMediaContainer: mock.fn(async () => ({
      id: "container-123",
      status: "IN_PROGRESS",
    })),
    getContainerStatus: mock.fn(async () => ({
      id: "container-123",
      status: "FINISHED",
    })),
    publishMedia: mock.fn(async () => ({
      id: "media-456",
      permalink: "https://instagram.com/p/test123",
      timestamp: new Date().toISOString(),
    })),
    createStoriesContainer: mock.fn(async () => ({
      id: "story-container-123",
      status: "IN_PROGRESS",
    })),
    createReelsContainer: mock.fn(async () => ({
      id: "reel-container-123",
      status: "IN_PROGRESS",
    })),
    createCarouselContainer: mock.fn(async () => ({
      id: "carousel-container-123",
      status: "IN_PROGRESS",
    })),
  };
}

// ── Base payload helper ──

export function basePayload(overrides?: Partial<InstagramPublishPayload>): InstagramPublishPayload {
  return {
    type: "instagram_publish",
    contentType: "FEED",
    credentials: { accessToken: "test-token", userId: "test-user" },
    content: {
      text: "Test feed post #test",
      media: [{ url: "https://example.com/image.jpg", type: "image", alt: "Test image" }],
    },
    accountId: "test-account",
    projectId: "test-project",
    queueId: "test-queue-1",
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

// ── Mock media processor (mock.method on real instance) ──

export function createMockMediaProcessor() {
  // We cannot import InstagramMediaProcessor directly here because it also
  // triggers module-level circuit breaker creation. Instead, return a plain
  // object with the methods that publishingWorker calls.
  return {
    validateVideo: mock.fn(async () => ({
      valid: true,
      issues: [] as string[],
      recommendations: [] as string[],
    })),
    optimizeForReels: mock.fn(async () => "https://optimized-url.com/reel.mp4"),
    splitVideoForStories: mock.fn(async () => [
      {
        id: "segment-1",
        url: "https://example.com/segment1.mp4",
        duration: 15,
        sequence: 1,
        startTime: 0,
        endTime: 15,
      },
    ]),
    createThumbnail: mock.fn(async () => "https://thumbnails.com/thumb.jpg"),
    getVideoMetadata: mock.fn(async () => ({
      duration: 45.5,
      width: 1080,
      height: 1920,
      format: "mp4",
      bitrate: 2500000,
      frameRate: 30,
    })),
  };
}

export type MockConsumerAdapter = ReturnType<typeof createMockConsumerAdapter>;
export type MockQueueAdapter = ReturnType<typeof createMockQueueAdapter>;
export type MockRepoAdapter = ReturnType<typeof createMockRepoAdapter>;
export type MockApiClient = ReturnType<typeof createMockApiClient>;
export type MockMediaProcessor = ReturnType<typeof createMockMediaProcessor>;
