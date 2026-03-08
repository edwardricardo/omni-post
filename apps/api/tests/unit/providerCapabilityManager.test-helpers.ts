import type { ProviderAdapter, ProviderId } from "../../src/providers/providerAdapter.interface.js";
import type { CanonicalPost } from "@shared/types";

export const mockXProvider: ProviderAdapter = {
  id: "x" as ProviderId,
  metadata: {
    id: "x",
    name: "X (Twitter)",
    description: "Social media platform",
    status: "active",
    authType: "oauth2",
  },
  limits: {
    maxChars: 280,
    maxMediaPerPost: 4,
    maxVideoLength: 140,
    maxImageSize: 5 * 1024 * 1024,
    maxVideoSize: 512 * 1024 * 1024,
    supportedMediaTypes: ["image/jpeg", "image/png", "video/mp4"],
    maxThreadLength: 25,
  },
  capabilities: {
    publish: true,
    schedule: true,
    analytics: true,
    comments: true,
    replies: true,
    threading: true,
    stories: false,
    reels: false,
    carousel: false,
    liveStreaming: false,
    directMessages: true,
  },
  validateContent: async (content: CanonicalPost) => {
    const errors = [];
    const suggestions = [];

    if (content.body.length > 280) {
      errors.push({
        field: "content",
        message: `Content exceeds 280 character limit (${content.body.length} chars)`,
        severity: "error",
      });
      suggestions.push({
        type: "truncate",
        message: "Consider splitting into a thread",
      });
    }

    if (content.media.length > 4) {
      errors.push({
        field: "media",
        message: `Too many media items (${content.media.length}/4)`,
        severity: "error",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
      suggestions,
    };
  },
} as ProviderAdapter;

export const mockInstagramProvider: ProviderAdapter = {
  id: "instagram" as ProviderId,
  metadata: {
    id: "instagram",
    name: "Instagram",
    description: "Photo and video sharing platform",
    status: "active",
    authType: "oauth2",
  },
  limits: {
    maxChars: 2200,
    maxMediaPerPost: 10,
    maxVideoLength: 60,
    maxImageSize: 8 * 1024 * 1024,
    maxVideoSize: 100 * 1024 * 1024,
    supportedMediaTypes: ["image/jpeg", "image/png", "video/mp4"],
    maxThreadLength: 1,
  },
  capabilities: {
    publish: true,
    schedule: true,
    analytics: true,
    comments: true,
    replies: true,
    threading: false,
    stories: true,
    reels: true,
    carousel: true,
    liveStreaming: true,
    directMessages: true,
  },
  validateContent: async (content: CanonicalPost) => {
    const errors = [];
    const suggestions = [];

    if (content.body.length > 2200) {
      errors.push({
        field: "content",
        message: `Content exceeds 2200 character limit (${content.body.length} chars)`,
        severity: "error",
      });
      suggestions.push({
        type: "truncate",
        message: "Consider shortening the caption",
      });
    }

    if (content.media.length > 10) {
      errors.push({
        field: "media",
        message: `Too many media items (${content.media.length}/10)`,
        severity: "error",
      });
    }

    if (content.media.length === 0) {
      errors.push({
        field: "media",
        message: "Instagram posts require at least one media item",
        severity: "error",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
      suggestions,
    };
  },
} as ProviderAdapter;

export const mockYoutubeProvider: ProviderAdapter = {
  id: "youtube" as ProviderId,
  metadata: {
    id: "youtube",
    name: "YouTube",
    description: "Video sharing platform",
    status: "beta",
    authType: "oauth2",
  },
  limits: {
    maxChars: 5000,
    maxMediaPerPost: 1,
    maxVideoLength: 720,
    maxImageSize: 2 * 1024 * 1024,
    maxVideoSize: 256 * 1024 * 1024,
    supportedMediaTypes: ["video/mp4", "video/webm"],
    maxThreadLength: 1,
  },
  capabilities: {
    publish: true,
    schedule: true,
    analytics: true,
    comments: true,
    replies: true,
    threading: false,
    stories: false,
    reels: true,
    carousel: false,
    liveStreaming: true,
    directMessages: false,
  },
  validateContent: async (content: CanonicalPost) => {
    const errors = [];
    const suggestions = [];

    if (content.body.length > 5000) {
      errors.push({
        field: "content",
        message: `Description exceeds 5000 character limit (${content.body.length} chars)`,
        severity: "error",
      });
    }

    if (content.media.length === 0) {
      errors.push({
        field: "media",
        message: "YouTube posts require a video",
        severity: "error",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
      suggestions,
    };
  },
} as ProviderAdapter;

const USE_REAL_PROVIDERS = process.env.USE_REAL_PROVIDERS === "true";

export function getTestProviders(): ProviderAdapter[] {
  if (USE_REAL_PROVIDERS) {
    return [mockXProvider, mockInstagramProvider, mockYoutubeProvider];
  } else {
    return [mockXProvider, mockInstagramProvider, mockYoutubeProvider];
  }
}
