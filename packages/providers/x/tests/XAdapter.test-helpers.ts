/**
 * @file XAdapter.test-helpers.ts
 * @description Test helpers for XAdapter test suites. Centralises mock API
 *   client factories, fixtures, and post/thread input builders so every split
 *   test file exercises the same mock contract. The adapter takes credentials
 *   per-call; helpers below construct adapters via injected fake apiClientFactory.
 * @layer infrastructure
 */

import { vi } from "vitest";
import type { PublishInput } from "@ports/core";
import type {
  CanonicalPost,
  RenderedPost,
  ThreadPlan,
  ThreadPublishInput,
  TweetFragment,
} from "@shared/types";
import { XAdapter, type XApiClientFactory } from "../src/XAdapter.js";
import type { XApiClient, XCredentials } from "../src/apiClient.js";

// ============================================================================
// Credential fixtures
// ============================================================================

/** Standard mock credentials for happy-path tests. */
export const MOCK_CREDENTIALS: XCredentials = {
  apiKey: "test-api-key",
  apiSecret: "test-api-secret",
  accessToken: "test-access-token",
  accessTokenSecret: "test-access-token-secret",
  bearerToken: "test-bearer-token",
};

// ============================================================================
// Pre-built body strings
// ============================================================================

/** Short body that fits within 280 chars. */
export const SHORT_BODY = "Hello from OmniPost! This is a test tweet.";

/**
 * Long body that exceeds 280 chars and will trigger threading.
 * ~600 chars — enough to split into 3 tweets.
 */
export const LONG_BODY =
  "This is a long-form content piece that needs to be split into a thread. " +
  "Social media management requires careful planning of content across multiple platforms. " +
  "Each platform has different character limits, media requirements, and audience expectations. " +
  "The X/Twitter platform limits individual tweets to 280 characters. " +
  "However, threads allow us to share longer content by chaining multiple tweets together. " +
  "This is very useful for sharing detailed updates, stories, or analysis. " +
  "OmniPost makes this process seamless by automatically splitting content. " +
  "It preserves sentence boundaries for natural reading flow.";

// ============================================================================
// Mock API client factories
// ============================================================================

let tweetCounter = 0;

/**
 * Create a minimal mock X API Client for happy-path tests.
 * Supports call-count assertions via vi.fn.
 */
export function createMockApiClient() {
  tweetCounter = 0;

  return {
    validateCredentials: vi.fn(async () => ({
      data: {
        id: "user-123",
        name: "Test User",
        username: "testuser",
      },
    })),
    postTweet: vi.fn(async (_text: string, _mediaIds?: string[], _replyToTweetId?: string) => {
      tweetCounter++;
      const id = `tweet-${tweetCounter}`;
      return {
        data: {
          id,
          text: _text,
          author_id: "user-123",
          created_at: new Date().toISOString(),
        },
      };
    }),
    uploadMedia: vi.fn(async (_mediaUrl: string) => ({
      media_id_string: `media-${Date.now()}`,
      media_id: Date.now(),
      size: 1024,
      media_key: `7_media-${Date.now()}`,
    })),
    getTweetAnalytics: vi.fn(async (tweetIds: string[]) => ({
      data: tweetIds.map((id) => ({
        id,
        public_metrics: {
          retweet_count: 10,
          like_count: 50,
          reply_count: 5,
          quote_count: 3,
        },
      })),
    })),
    deleteTweet: vi.fn(async (_tweetId: string) => ({
      data: { deleted: true },
    })),
    searchReplies: vi.fn(async () => ({ data: [], meta: { result_count: 0 } })),
    getCircuitBreakerStatus: vi.fn(() => ({})),
    clearCache: vi.fn(() => undefined),
    forceCircuitBreakerOpen: vi.fn(() => true),
    forceCircuitBreakerClose: vi.fn(() => true),
  };
}

export type MockApiClient = ReturnType<typeof createMockApiClient>;

/**
 * Create an API client that throws on all operations.
 * Used for error-handling / circuit-breaker tests.
 */
export function createFailingApiClient(errorMessage = "API error", statusCode?: number) {
  const makeError = () => {
    const error = new Error(errorMessage) as Error & { status?: number };
    if (statusCode !== undefined) {
      error.status = statusCode;
    }
    return error;
  };

  return {
    validateCredentials: vi.fn(async () => {
      throw makeError();
    }),
    postTweet: vi.fn(async () => {
      throw makeError();
    }),
    uploadMedia: vi.fn(async () => {
      throw makeError();
    }),
    getTweetAnalytics: vi.fn(async () => {
      throw makeError();
    }),
    deleteTweet: vi.fn(async () => {
      throw makeError();
    }),
    searchReplies: vi.fn(async () => {
      throw makeError();
    }),
    getCircuitBreakerStatus: vi.fn(() => ({})),
    clearCache: vi.fn(() => undefined),
    forceCircuitBreakerOpen: vi.fn(() => true),
    forceCircuitBreakerClose: vi.fn(() => true),
  };
}

// ============================================================================
// Adapter factory — wires the fake client through dependency injection
// ============================================================================

/**
 * Build an `XAdapter` whose `apiClientFactory` returns the supplied fake.
 * Returns both the adapter and the client so tests can assert on the client.
 */
export function makeAdapter(client: MockApiClient = createMockApiClient()) {
  const factory: XApiClientFactory = () => client as unknown as XApiClient;
  return { adapter: new XAdapter({ apiClientFactory: factory }), client };
}

// ============================================================================
// CanonicalPost / PublishInput / ThreadPlan factories
// ============================================================================

export function createTestCanonicalPost(overrides: Partial<CanonicalPost> = {}): CanonicalPost {
  return {
    id: `post-${Date.now()}`,
    projectId: "project-test",
    locale: "en",
    body: SHORT_BODY,
    ...overrides,
  };
}

export function createTestRenderedPost(overrides: Partial<RenderedPost> = {}): RenderedPost {
  return {
    body: SHORT_BODY,
    meta: {},
    ...overrides,
  };
}

export function createTestPublishInput(postOverrides: Partial<RenderedPost> = {}): PublishInput {
  return {
    channelId: "channel-x-123",
    post: createTestRenderedPost(postOverrides),
    dedupeKey: `dedupe-${Date.now()}`,
  };
}

export function createTestThreadPlan(tweetCount = 3): ThreadPlan {
  const tweets: TweetFragment[] = [];
  for (let i = 1; i <= tweetCount; i++) {
    tweets.push({
      sequence: i,
      text: `${i}/${tweetCount} This is tweet number ${i} in the thread.`,
      estimatedChars: 50,
      threadIndicator: `${i}/${tweetCount} `,
    });
  }

  return {
    strategy: "AUTO",
    tweets,
    totalChars: tweetCount * 50,
    estimatedReach: tweetCount,
    needsThreading: true,
  };
}

export function createTestThreadPublishInput(tweetCount = 3): ThreadPublishInput {
  return {
    channelId: "channel-x-123",
    threadPlan: createTestThreadPlan(tweetCount),
    dedupeKey: `thread-dedupe-${Date.now()}`,
  };
}
