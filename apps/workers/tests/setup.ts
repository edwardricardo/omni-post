/**
 * Test utilities and mock factories for worker tests.
 * Uses node:test mock module for all mocking needs.
 *
 * @file setup.ts
 * @description Test setup for setup
 * @layer infrastructure
 */
import client from "prom-client";
import pino from "pino";
import type {
  CanonicalPost,
  Result,
  Thread,
  Tweet,
  ThreadPlan,
  ThreadReceipt,
  RenderedContent,
  RenderedPost,
  RenderError,
  PublishError,
  TweetStatus,
} from "@shared/types";
import type { PublishReceipt } from "@ports/core";
import { WorkerMetrics } from "../src/metrics/workerMetrics.js";
import type {
  PublishRepo,
  PublishProvider,
  PublishInstrumentation,
  DatabaseInstrumentation,
  BusinessKPITracker,
  PublishHandlerDeps,
} from "../src/publishHandler.js";

// ---------- Data Factories ----------

const NOW = new Date("2026-03-02T12:00:00Z");

export function createTestPost(overrides?: Partial<CanonicalPost>): CanonicalPost {
  return {
    id: "post-001",
    projectId: "project-001",
    locale: "es",
    body: "Test post body",
    ...overrides,
  };
}

export function createTestThread(overrides?: Partial<Thread>): Thread {
  return {
    id: "thread-001",
    postId: "post-001",
    strategy: "AUTO",
    tweets: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function createTestTweet(overrides?: Partial<Tweet>): Tweet {
  return {
    id: "tweet-001",
    threadId: "thread-001",
    sequenceNumber: 1,
    content: "Tweet content",
    status: "PENDING" as TweetStatus,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function createTestThreadPlan(overrides?: Partial<ThreadPlan>): ThreadPlan {
  return {
    strategy: "AUTO",
    tweets: [
      { sequence: 1, text: "Tweet 1", estimatedChars: 7 },
      { sequence: 2, text: "Tweet 2", estimatedChars: 7 },
    ],
    totalChars: 14,
    estimatedReach: 100,
    needsThreading: true,
    ...overrides,
  };
}

export function createTestRenderedPost(overrides?: Partial<RenderedPost>): RenderedPost {
  return {
    body: "Rendered post body",
    ...overrides,
  };
}

export function createTestPublishReceipt(overrides?: Partial<PublishReceipt>): PublishReceipt {
  return {
    providerPostId: "x-post-12345",
    url: "https://x.com/user/status/12345",
    publishedAt: NOW,
    ...overrides,
  };
}

export function createTestThreadReceipt(overrides?: Partial<ThreadReceipt>): ThreadReceipt {
  return {
    threadId: "thread-001",
    tweets: [
      {
        sequence: 1,
        providerTweetId: "x-tweet-001",
        url: "https://x.com/user/status/001",
        publishedAt: NOW,
      },
      {
        sequence: 2,
        providerTweetId: "x-tweet-002",
        url: "https://x.com/user/status/002",
        publishedAt: NOW,
      },
    ],
    totalTweets: 2,
    ...overrides,
  };
}

// ---------- Mock Factories ----------

export function createMockRepo(): PublishRepo {
  return {
    logPublish: async () => ({ ok: true, value: {} }) as Result<unknown, string>,
    getLogByDedupeKey: async () =>
      ({ ok: true, value: null }) as Result<{ status: string } | null, string>,
    getPostById: async () =>
      ({ ok: true, value: createTestPost() }) as Result<CanonicalPost, string>,
    createThread: async () => ({ ok: true, value: createTestThread() }) as Result<Thread, string>,
    getThreadByPostId: async () =>
      ({ ok: true, value: createTestThread() }) as Result<Thread | null, string>,
    getTweetsByThread: async () => ({ ok: true, value: [] }) as Result<Tweet[], string>,
    createTweet: async () => ({ ok: true, value: createTestTweet() }) as Result<Tweet, string>,
    updateTweet: async () => ({ ok: true, value: createTestTweet() }) as Result<Tweet, string>,
  };
}

export function createMockProvider(): PublishProvider {
  return {
    publish: async () =>
      ({
        ok: true,
        value: createTestPublishReceipt(),
      }) as Result<PublishReceipt, PublishError>,
    publishThread: async () =>
      ({
        ok: true,
        value: createTestThreadReceipt(),
      }) as Result<ThreadReceipt, PublishError>,
    render: () =>
      ({
        ok: true,
        value: {
          type: "single" as const,
          content: createTestRenderedPost(),
        },
      }) as Result<RenderedContent, RenderError>,
  };
}

export function createMockInstrumentation(): PublishInstrumentation {
  return {
    instrumentPublishing: async (
      _name: string,
      _provider: string,
      _channelId: string,
      _type: string,
      fn: (span: { setAttributes: (attrs: Record<string, string>) => void }) => Promise<unknown>,
      _metadata?: Record<string, string>
    ) => {
      return await fn({ setAttributes: () => {} });
    },
    instrumentProviderAPI: async (
      _provider: string,
      _operation: string,
      _method: string,
      fn: (span: { setAttributes: (attrs: Record<string, string>) => void }) => Promise<unknown>
    ) => {
      return await fn({ setAttributes: () => {} });
    },
  };
}

export function createMockDatabaseInstrumentation(): DatabaseInstrumentation {
  return {
    instrumentQuery: async (_operation: string, _table: string, fn: () => Promise<unknown>) => {
      return await fn();
    },
  };
}

export function createMockBusinessKPITracker(): BusinessKPITracker {
  return {
    trackContentPublication: () => {},
  };
}

export function createSilentLogger(): pino.Logger {
  return pino({ level: "silent" });
}

/**
 * Creates a fresh WorkerMetrics instance with an isolated registry.
 * Each test gets its own registry to avoid metric name collisions.
 */
export function createTestWorkerMetrics(): WorkerMetrics {
  const registry = new client.Registry();
  return new WorkerMetrics(registry);
}

/**
 * Creates a complete set of mock dependencies for PublishHandler.
 */
/**
 * Creates a provider registry with the mock provider registered under "x".
 * Tests that need to override individual provider methods can do so via
 * `deps.providerRegistry.x`.
 */
export function createMockProviderRegistry(): Record<string, PublishProvider> {
  return {
    x: createMockProvider(),
  };
}

/**
 * Creates a complete set of mock dependencies for PublishHandler.
 */
export function createTestDeps(overrides?: Partial<PublishHandlerDeps>): PublishHandlerDeps {
  return {
    repo: createMockRepo(),
    providerRegistry: createMockProviderRegistry(),
    workerMetrics: createTestWorkerMetrics(),
    logger: createSilentLogger(),
    instrumentation: createMockInstrumentation(),
    databaseInstrumentation: createMockDatabaseInstrumentation(),
    businessKPITracker: createMockBusinessKPITracker(),
    ...overrides,
  };
}
