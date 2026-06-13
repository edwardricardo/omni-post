/**
 * @file schedulingService.test-helpers.ts
 * @description Shared mock factories and fixture helpers for InstagramSchedulingService tests.
 *              Exported for use by schedulingService.scheduling.test.ts and
 *              schedulingService.management.test.ts.
 *
 * NOTE: The queue port is now injected into `InstagramSchedulingService` via its
 * constructor (DI canon — the service no longer self-constructs a BullMQ adapter).
 * `createMockQueueAdapter()` returns a double that satisfies `InstagramQueuePort`
 * and is passed straight into `new InstagramSchedulingService(queue)`.
 */

import { vi } from "vitest";
import type { InstagramScheduleJob, InstagramQueuePort } from "../src/schedulingService.js";
import type { InstagramCredentials } from "../src/apiClient.js";

// ── Mock adapter factories ──

export function createMockQueueAdapter() {
  return {
    enqueue: vi.fn(async () => ({ ok: true as const, value: "queue-job-123" })),
    enqueueBulk: vi.fn(async () => ({ ok: true as const, value: ["queue-job-123"] })),
    close: vi.fn(async () => undefined),
    remove: vi.fn(async () => ({ ok: true as const, value: true })),
    health: vi.fn(async () => ({
      ok: true as const,
      value: {
        connected: true,
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
      },
    })),
    getJobStates: vi.fn(async () => ({
      ok: true as const,
      value: { completed: 0, failed: 0, pending: 0 },
    })),
    getResilienceMetrics: vi.fn(() => ({})),
  };
}

/**
 * Build a mock queue typed as the port the service expects. The constructor of
 * `InstagramSchedulingService` accepts an `InstagramQueuePort`; tests pass this.
 */
export function makeQueuePortDouble(): InstagramQueuePort {
  return createMockQueueAdapter() as unknown as InstagramQueuePort;
}

export function createPassthroughCB() {
  return {
    call: async (_svc: string, _op: string, fn: (...a: any[]) => Promise<any>) => fn(),
    getAllStatuses: () => ({}),
  };
}

export function createMockMediaProcessor() {
  return {
    validateVideo: vi.fn(async () => ({
      valid: true,
      issues: [] as string[],
      recommendations: [] as string[],
    })),
    optimizeForReels: vi.fn(async () => "https://optimized-url.com/reel.mp4"),
    splitVideoForStories: vi.fn(async () => [
      {
        id: "segment-1",
        url: "https://example.com/segment1.mp4",
        duration: 15,
        sequence: 1,
        startTime: 0,
        endTime: 15,
      },
      {
        id: "segment-2",
        url: "https://example.com/segment2.mp4",
        duration: 10,
        sequence: 2,
        startTime: 15,
        endTime: 25,
      },
    ]),
    createThumbnail: vi.fn(async () => "https://thumbnails.com/thumb.jpg"),
    getVideoMetadata: vi.fn(async () => ({
      duration: 45.5,
      width: 1080,
      height: 1920,
      format: "mp4",
      bitrate: 2500000,
      frameRate: 30,
    })),
  };
}

// ── Default credentials ──

export function defaultCredentials(): InstagramCredentials {
  return {
    accessToken: "test-access-token",
    userId: "test-user-id",
    pageId: "test-page-id",
  };
}

// ── Base job fixture ──

export function baseJob(overrides?: Partial<InstagramScheduleJob>): InstagramScheduleJob {
  return {
    id: "test-job-1",
    accountId: "test-account",
    projectId: "test-project",
    queueId: "test-queue-1",
    contentType: "FEED",
    content: {
      text: "Test Instagram post content #test #instagram",
      media: [
        {
          url: "https://example.com/image.jpg",
          type: "image",
          alt: "Test image",
        },
      ],
    },
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    timezone: "UTC",
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

// ── Types ──

export type MockQueueAdapter = ReturnType<typeof createMockQueueAdapter>;
export type MockMediaProcessor = ReturnType<typeof createMockMediaProcessor>;
