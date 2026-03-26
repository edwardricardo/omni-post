/**
 * YouTubeAdapter - Shared Test Helper Functions and Mocks
 *
 * Exports mock factory functions and test data builders used across all
 * YouTubeAdapter test files. Mocks cover the external services the adapter
 * delegates to: YouTubeApiClient, YouTubeShortsService, YouTubeCommunityService,
 * and YouTubeLiveStreamingService.
 *
 * Note: These helpers mock external services to focus on business logic
 * validation without external dependencies.
 */

import { vi } from "vitest";
import type { RenderedPost } from "@shared/types";

type RenderedMedia = NonNullable<RenderedPost["media"]>[number];

/**
 * Create a mock YouTube API Client
 */
export function createMockApiClient() {
  return {
    uploadVideo: vi.fn(async (request: any) => ({
      id: "video-123",
      title: request.title,
      description: request.description,
      publishedAt: new Date().toISOString(),
      channelId: "channel-123",
    })),
    validateCredentials: vi.fn(async () => ({
      id: "channel-123",
      title: "Test Channel",
      description: "Test Description",
      subscriberCount: 1000,
      videoCount: 50,
      viewCount: 10000,
    })),
  };
}

/**
 * Create a mock YouTube Shorts Service
 */
export function createMockShortsService() {
  return {
    uploadShort: vi.fn(async (request: any) => ({
      id: "short-123",
      title: request.title,
      description: request.description,
      publishedAt: new Date().toISOString(),
      channelId: "channel-123",
      duration: 30,
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
      isShort: true,
    })),
  };
}

/**
 * Create a mock YouTube Community Service
 */
export function _createMockCommunityService() {
  return {
    // Note: Community service doesn't have real API methods in current implementation
    // It's a placeholder for future YouTube Community Tab API
  };
}

/**
 * Create a mock YouTube Live Streaming Service
 */
export function _createMockLiveStreamingService() {
  return {
    createLiveStream: vi.fn(async (config: any) => ({
      id: "live-123",
      title: config.title,
      description: config.description,
      status: "created" as const,
      scheduledStartTime: config.scheduledStartTime?.toISOString(),
      streamName: "stream-key-123",
      ingestionInfo: {
        streamName: "stream-key-123",
        ingestionAddress: "rtmp://stream.youtube.com/ingestion",
      },
      monitoring: {
        broadcastStatus: "created",
        lifeCycleStatus: "created",
        streamStatus: "created",
      },
    })),
  };
}

/**
 * Create test rendered post with flexible configuration
 */
export function createTestPost(overrides: Partial<RenderedPost> = {}): RenderedPost {
  return {
    body: "Test post content",
    media: [],
    meta: {},
    ...overrides,
  };
}

/**
 * Create test video media
 */
export function createVideoMedia(overrides: Partial<RenderedMedia> = {}): RenderedMedia {
  return {
    type: "video",
    url: "https://example.com/video.mp4",
    ...overrides,
  };
}

/**
 * Create test image media
 */
export function createImageMedia(overrides: Partial<RenderedMedia> = {}): RenderedMedia {
  return {
    type: "image",
    url: "https://example.com/image.jpg",
    ...overrides,
  };
}
