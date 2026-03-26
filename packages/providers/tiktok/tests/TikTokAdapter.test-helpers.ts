/**
 * TikTokAdapter Test Helpers
 *
 * Shared mock factories, fixtures, and utility functions used across all
 * TikTokAdapter test files. Centralising these here avoids duplication and
 * ensures every split test file exercises the same mock contract.
 *
 * Exports:
 * - createMockApiClient()         — minimal TikTok upload/validate mock
 * - createMockResearchClient()    — TikTok Research API mock (pass shouldFail=true for error paths)
 * - createMockMarketingClient()   — TikTok Marketing API mock
 * - createMockResearchApiClient() — full vi.fn-based research client (for call-count assertions)
 * - createMockHashtagManager()    — full vi.fn-based hashtag manager
 * - createMockSoundManager()      — full vi.fn-based sound manager
 * - createMockMarketingApiClient()— full vi.fn-based marketing client
 * - createTestPost()              — factory for RenderedPost
 * - createTestPublishInput()      — factory for PublishInput
 * - MOCK_CREDENTIALS              — standard valid mock credential object
 * - EMPTY_CREDENTIALS             — credentials with empty strings (simulate auth failure)
 */

import { vi } from "vitest";
import type { PublishInput } from "@ports/core";
import type { RenderedPost } from "@shared/types";

// ============================================================================
// Credential fixtures
// ============================================================================

/** Standard mock credentials for happy-path tests. */
export const MOCK_CREDENTIALS = {
  clientKey: "key",
  clientSecret: "secret",
  accessToken: "token",
  openId: "openid",
} as const;

/** Empty credentials — used to simulate authentication/initialisation failure. */
export const EMPTY_CREDENTIALS = {
  clientKey: "",
  clientSecret: "",
  accessToken: "",
  openId: "",
} as const;

// ============================================================================
// Minimal mock clients (simple async functions, no vi.fn call tracking)
// ============================================================================

/**
 * Create a minimal mock TikTok API Client.
 * Suitable when the test only cares about downstream logic, not call counts.
 */
export function createMockApiClient() {
  return {
    uploadVideo: vi.fn(async (_request: any) => ({
      shareId: "video-123",
      shareUrl: `https://www.tiktok.com/@testuser/video/video-123`,
      publishTime: new Date().toISOString(),
    })),
    validateCredentials: vi.fn(async () => ({
      openId: "user-123",
      displayName: "Test User",
      followerCount: 1000,
      videoCount: 50,
    })),
  };
}

/**
 * Create a mock TikTok Research API Client.
 *
 * @param shouldFail - When true every method throws, simulating API outage.
 *   Used for error-handling / circuit-breaker tests.
 */
export function createMockResearchClient(shouldFail = false): any {
  if (shouldFail) {
    return {
      getTrendingHashtags: async () => {
        throw new Error("Mock API error");
      },
      getTrendingSounds: async () => {
        throw new Error("Mock API error");
      },
      getKeywordTrends: async () => {
        throw new Error("Mock API error");
      },
    };
  }

  return {
    getTrendingHashtags: async () => [
      {
        hashtag: "viral",
        volume: 100000,
        engagement: 85,
        growth: 50,
        difficulty: 40,
        relatedHashtags: ["trending"],
      },
    ],
    getTrendingSounds: async () => [
      {
        soundId: "sound-123",
        title: "Trending Sound",
        author: "Artist",
        duration: 30,
        category: "dance",
        mood: "energetic",
        tempo: "fast",
        isOriginal: false,
        isCopyrightFree: true,
        previewUrl: "https://example.com/sound.mp3",
      },
    ],
    getKeywordTrends: async () => [],
  };
}

/**
 * Create a minimal mock TikTok Marketing API Client.
 * Returns plausible ad-account data without tracking calls.
 */
export function createMockMarketingClient(): any {
  return {
    getAdAccount: async () => ({
      advertiserId: "test-advertiser",
      advertiserName: "Test Advertiser",
      status: "active",
      balance: 10000,
      currency: "USD",
      timezone: "UTC",
      industry: "Entertainment",
      language: "en",
      createdTime: new Date().toISOString(),
    }),
    getCampaigns: async () => [],
    getAdInsights: async () => [],
  };
}

// ============================================================================
// Full vi.fn-based clients (for tests that inspect call counts / arguments)
// ============================================================================

/**
 * Create a full vi.fn TikTok Research API Client.
 * Returns richer hashtag and sound fixture data.
 */
export function createMockResearchApiClient() {
  return {
    getTrendingHashtags: vi.fn(async () => [
      {
        hashtag: "viral",
        volume: 100000,
        engagement: 85,
        growth: 50,
        difficulty: 40,
        relatedHashtags: ["trending", "fyp"],
      },
      {
        hashtag: "dance",
        volume: 80000,
        engagement: 75,
        growth: 30,
        difficulty: 50,
        relatedHashtags: ["music", "choreography"],
      },
      {
        hashtag: "comedy",
        volume: 60000,
        engagement: 90,
        growth: 20,
        difficulty: 35,
        relatedHashtags: ["funny", "humor"],
      },
    ]),
    getTrendingSounds: vi.fn(async () => [
      {
        soundId: "sound-123",
        title: "Trending Dance Track",
        author: "Artist Name",
        duration: 30,
        category: "dance",
        mood: "energetic",
        tempo: "fast",
        isOriginal: false,
        isCopyrightFree: true,
        previewUrl: "https://example.com/sound-123.mp3",
      },
      {
        soundId: "sound-456",
        title: "Calm Background Music",
        author: "Composer",
        duration: 45,
        category: "lifestyle",
        mood: "calm",
        tempo: "slow",
        isOriginal: true,
        isCopyrightFree: true,
        previewUrl: "https://example.com/sound-456.mp3",
      },
    ]),
    getKeywordTrends: vi.fn(async () => []),
  };
}

/**
 * Create a full vi.fn TikTok Hashtag Manager.
 * Returns a realistic HashtagStrategy shape.
 */
export function createMockHashtagManager() {
  return {
    generateHashtagStrategy: vi.fn(async (options: any) => ({
      strategy: {
        primary: ["viral", "trending", "fyp"],
        trending: ["dance", "music", "choreography"],
        niche: ["beginner", "tutorial", "learn", "howto", "tips"],
        branded: options.brandedHashtags || [],
        community: ["creator", "content", "video", "tiktok"],
      },
      totalHashtags: 15,
      estimatedReach: 150000,
      difficultyScore: 45,
      competitionLevel: "medium" as const,
      viralPotential: 75,
      recommendations: ["Add more trending hashtags to increase visibility"],
      warnings: [],
    })),
    analyzeHashtagPerformance: vi.fn(async (hashtag: string) => ({
      hashtag,
      usage: 100000,
      reach: 8500000,
      engagement: 85,
      difficulty: 40,
      trend: "rising" as const,
      competitiveness: 40,
      recommendation: "use" as const,
      optimalTiming: ["12:00 PM", "6:00 PM", "9:00 PM"],
      relatedHashtags: ["trending", "viral"],
    })),
  };
}

/**
 * Create a full vi.fn TikTok Sound Manager.
 * Returns a SoundRecommendation array with scoring metadata.
 */
export function createMockSoundManager() {
  return {
    getSoundRecommendations: vi.fn(async (options: any) => [
      {
        sound: {
          id: "sound-123",
          title: "Trending Dance Track",
          artist: "Artist Name",
          duration: 30,
          url: "https://example.com/sound-123.mp3",
          category: options.contentCategory || "dance",
          mood: options.mood || "energetic",
          tempo: options.tempo || "fast",
          genre: "dance",
          isOriginal: false,
          isCopyrightFree: true,
          isCommericalUse: true,
          createdAt: new Date().toISOString(),
          metadata: {},
        },
        score: 85,
        reasons: ["Currently trending", "High viral potential"],
        bestTimeToUse: "6:00 PM",
        similarSounds: [],
        competitors: [],
        licenseInfo: {
          commercial: true,
          attribution: false,
          modifications: true,
          restrictions: [],
        },
      },
    ]),
  };
}

/**
 * Create a full vi.fn TikTok Marketing API Client.
 */
export function createMockMarketingApiClient() {
  return {
    getAdAccount: vi.fn(async () => ({
      advertiserId: "advertiser-123",
      advertiserName: "Test Advertiser",
      status: "active",
      balance: 10000,
      currency: "USD",
      timezone: "UTC",
      industry: "Entertainment",
      language: "en",
      createdTime: new Date().toISOString(),
    })),
    getCampaigns: vi.fn(async () => []),
    getAdInsights: vi.fn(async () => []),
  };
}

// ============================================================================
// Post / PublishInput factories
// ============================================================================

/**
 * Build a minimal RenderedPost for use in TikTok tests.
 *
 * Note: PublishInput.post is RenderedPost (not CanonicalPost).
 * RenderedPost supports meta for platform-specific settings.
 *
 * @param overrides - Partial fields merged into the default post.
 */
export function createTestPost(overrides: Partial<RenderedPost> = {}): RenderedPost {
  return {
    body: "Test TikTok video description",
    media: [
      {
        type: "video",
        url: "https://example.com/test-video.mp4",
      },
    ],
    meta: {},
    ...overrides,
  };
}

/**
 * Build a minimal PublishInput for use in TikTok tests.
 *
 * @param postOverrides - Partial fields forwarded to createTestPost().
 */
export function createTestPublishInput(postOverrides: Partial<RenderedPost> = {}): PublishInput {
  return {
    channelId: "channel-123",
    post: createTestPost(postOverrides),
    dedupeKey: `test-dedupe-${Date.now()}`,
  };
}
