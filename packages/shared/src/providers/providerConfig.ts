/**
 * Provider Configuration - Single Source of Truth
 *
 * This file defines all provider constraints, capabilities, and metadata.
 * It should be imported by both frontend and backend code to ensure consistency.
 */

export type ProviderId =
  | "x"
  | "instagram"
  | "facebook"
  | "youtube"
  | "tiktok"
  | "linkedin"
  | "pinterest"
  | "snapchat"
  | "telegram"
  | "reddit"
  | "discord"
  | "twitch";

export interface ProviderCapabilities {
  publish: boolean;
  schedule: boolean;
  analytics: boolean;
  comments: boolean;
  replies: boolean;
  threading: boolean;
  stories?: boolean;
  reels?: boolean;
  carousel?: boolean;
}

export interface ProviderLimits {
  maxChars: number;
  maxMediaPerPost: number;
  maxPostsPerThread?: number;
  allowedMedia: string[];
  aspectRatios: string[];
  maxVideoDuration?: number; // seconds
  maxImageSize?: number; // bytes
  maxVideoSize?: number; // bytes
}

export interface ProviderMetadata {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  capabilities: ProviderCapabilities;
  limits: ProviderLimits;
  status: "active" | "beta" | "coming_soon" | "maintenance";
  description: string;
  authType: "oauth" | "api_key" | "username_password";
  requiredScopes?: string[];
}

/**
 * Provider Configurations
 * All provider constraints and capabilities in one place
 */
export const PROVIDER_CONFIGS: Record<string, ProviderMetadata> = {
  x: {
    id: "x",
    name: "x",
    displayName: "X (Twitter)",
    icon: "/providers/x-icon.svg",
    color: "#000000",
    capabilities: {
      publish: true,
      schedule: true,
      analytics: true,
      comments: true,
      replies: true,
      threading: true,
    },
    limits: {
      maxChars: 280,
      maxMediaPerPost: 4,
      maxPostsPerThread: 25,
      allowedMedia: ["image", "video", "gif"],
      aspectRatios: ["16:9", "1:1", "4:5"],
      maxVideoDuration: 140, // seconds
      maxImageSize: 5 * 1024 * 1024, // 5MB
      maxVideoSize: 512 * 1024 * 1024, // 512MB
    },
    status: "active",
    description: "Post tweets, threads, and media to X (formerly Twitter)",
    authType: "oauth",
    requiredScopes: ["tweet.read", "tweet.write", "users.read"],
  },

  instagram: {
    id: "instagram",
    name: "instagram",
    displayName: "Instagram",
    icon: "/providers/instagram-icon.svg",
    color: "#E4405F",
    capabilities: {
      publish: true,
      schedule: false, // Instagram requires immediate posting
      analytics: true,
      comments: true,
      replies: false,
      threading: false,
      stories: true,
      reels: true,
      carousel: true,
    },
    limits: {
      maxChars: 2200,
      maxMediaPerPost: 10, // carousel
      allowedMedia: ["image", "video"],
      aspectRatios: ["1:1", "4:5", "9:16"],
      maxVideoDuration: 60, // 60 seconds for feed, 90 for reels
      maxImageSize: 8 * 1024 * 1024, // 8MB
      maxVideoSize: 100 * 1024 * 1024, // 100MB
    },
    status: "active",
    description: "Share photos, videos, and stories on Instagram",
    authType: "oauth",
    requiredScopes: ["instagram_basic", "instagram_content_publish", "pages_read_engagement"],
  },

  facebook: {
    id: "facebook",
    name: "facebook",
    displayName: "Facebook",
    icon: "/providers/facebook-icon.svg",
    color: "#1877F2",
    capabilities: {
      publish: true,
      schedule: true,
      analytics: true,
      comments: true,
      replies: true,
      threading: false,
      stories: true,
      reels: true,
    },
    limits: {
      maxChars: 63206, // Very long posts allowed
      maxMediaPerPost: 10,
      allowedMedia: ["image", "video", "link"],
      aspectRatios: ["1:1", "16:9", "9:16", "4:5"],
      maxVideoDuration: 240 * 60, // 240 minutes
      maxImageSize: 10 * 1024 * 1024, // 10MB
      maxVideoSize: 4 * 1024 * 1024 * 1024, // 4GB
    },
    status: "active",
    description: "Post to Facebook pages and groups",
    authType: "oauth",
    requiredScopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
  },

  youtube: {
    id: "youtube",
    name: "youtube",
    displayName: "YouTube",
    icon: "/providers/youtube-icon.svg",
    color: "#FF0000",
    capabilities: {
      publish: true,
      schedule: true,
      analytics: true,
      comments: true,
      replies: true,
      threading: false,
    },
    limits: {
      maxChars: 5000, // description
      maxMediaPerPost: 1, // videos only
      allowedMedia: ["video"],
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxVideoDuration: 12 * 60 * 60, // 12 hours (verified accounts)
      maxVideoSize: 256 * 1024 * 1024 * 1024, // 256GB
    },
    status: "active",
    description: "Upload and manage YouTube videos",
    authType: "oauth",
    requiredScopes: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube",
    ],
  },

  tiktok: {
    id: "tiktok",
    name: "tiktok",
    displayName: "TikTok",
    icon: "/providers/tiktok-icon.svg",
    color: "#000000",
    capabilities: {
      publish: true,
      schedule: false, // TikTok doesn't support scheduling via API
      analytics: true,
      comments: true,
      replies: false,
      threading: false,
    },
    limits: {
      maxChars: 2200, // description
      maxMediaPerPost: 1,
      allowedMedia: ["video"],
      aspectRatios: ["9:16", "1:1"],
      maxVideoDuration: 10 * 60, // 10 minutes
      maxVideoSize: 4 * 1024 * 1024 * 1024, // 4GB
    },
    status: "active",
    description: "Create and share short-form videos on TikTok",
    authType: "oauth",
    requiredScopes: ["video.publish", "video.upload"],
  },

  linkedin: {
    id: "linkedin",
    name: "linkedin",
    displayName: "LinkedIn",
    icon: "/providers/linkedin-icon.svg",
    color: "#0A66C2",
    capabilities: {
      publish: true,
      schedule: true,
      analytics: true,
      comments: true,
      replies: true,
      threading: false,
    },
    limits: {
      maxChars: 3000,
      maxMediaPerPost: 9,
      allowedMedia: ["image", "video", "document"],
      aspectRatios: ["1:1", "1.91:1", "16:9"],
      maxVideoDuration: 10 * 60, // 10 minutes
      maxImageSize: 10 * 1024 * 1024, // 10MB
      maxVideoSize: 5 * 1024 * 1024 * 1024, // 5GB
    },
    status: "active",
    description: "Share professional content on LinkedIn",
    authType: "oauth",
    requiredScopes: ["w_member_social", "w_organization_social", "openid", "profile"],
  },

  snapchat: {
    id: "snapchat",
    name: "snapchat",
    displayName: "Snapchat",
    icon: "/providers/snapchat-icon.svg",
    color: "#FFFC00",
    capabilities: {
      publish: true,
      schedule: false,
      analytics: true,
      comments: false,
      replies: false,
      threading: false,
      stories: true,
    },
    limits: {
      maxChars: 250,
      maxMediaPerPost: 1,
      allowedMedia: ["image", "video"],
      aspectRatios: ["9:16"],
      maxVideoDuration: 60,
      maxImageSize: 5 * 1024 * 1024, // 5MB
      maxVideoSize: 32 * 1024 * 1024, // 32MB
    },
    status: "active",
    description: "Share stories and spotlight content on Snapchat",
    authType: "oauth",
    requiredScopes: ["snapchat-marketing-api"],
  },

  telegram: {
    id: "telegram",
    name: "telegram",
    displayName: "Telegram",
    icon: "/providers/telegram-icon.svg",
    color: "#26A5E4",
    capabilities: {
      publish: true,
      schedule: false,
      analytics: false,
      comments: false,
      replies: false,
      threading: false,
    },
    limits: {
      maxChars: 4096,
      maxMediaPerPost: 10,
      allowedMedia: ["image", "video"],
      aspectRatios: [],
      maxVideoDuration: 60,
      maxImageSize: 10 * 1024 * 1024, // 10MB
      maxVideoSize: 50 * 1024 * 1024, // 50MB
    },
    status: "active",
    description: "Send messages to Telegram channels and groups via bot",
    authType: "api_key",
  },

  pinterest: {
    id: "pinterest",
    name: "pinterest",
    displayName: "Pinterest",
    icon: "/providers/pinterest-icon.svg",
    color: "#BD081C",
    capabilities: {
      publish: true,
      schedule: true,
      analytics: true,
      comments: false,
      replies: false,
      threading: false,
    },
    limits: {
      maxChars: 500,
      maxMediaPerPost: 1,
      allowedMedia: ["image", "video"],
      aspectRatios: ["2:3", "1:1"],
      maxVideoDuration: 15 * 60, // 15 minutes
      maxImageSize: 20 * 1024 * 1024, // 20MB
      maxVideoSize: 2 * 1024 * 1024 * 1024, // 2GB
    },
    status: "active",
    description: "Create and share pins on Pinterest boards",
    authType: "oauth",
    requiredScopes: ["boards:read", "pins:read", "pins:write"],
  },
} as const;

/**
 * Get provider configuration by ID
 */
export function getProviderConfig(providerId: string): ProviderMetadata | undefined {
  return PROVIDER_CONFIGS[providerId];
}

/**
 * Get all active providers
 */
export function getActiveProviders(): ProviderMetadata[] {
  return Object.values(PROVIDER_CONFIGS).filter((p) => p.status === "active");
}

/**
 * Get provider IDs
 */
export function getProviderIds(): string[] {
  return Object.keys(PROVIDER_CONFIGS);
}

/**
 * Validate content against provider constraints
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateContentForProvider(
  providerId: string,
  content: string,
  mediaCount: number = 0
): ValidationResult {
  const config = getProviderConfig(providerId);

  if (!config) {
    return {
      valid: false,
      errors: [`Unknown provider: ${providerId}`],
      warnings: [],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check character limit
  if (content.length > config.limits.maxChars) {
    errors.push(
      `Content exceeds ${config.displayName} character limit (${content.length}/${config.limits.maxChars})`
    );
  }

  // Check media limit
  if (mediaCount > config.limits.maxMediaPerPost) {
    errors.push(
      `Too many media files for ${config.displayName} (${mediaCount}/${config.limits.maxMediaPerPost})`
    );
  }

  // Warnings for approaching limits
  const charUsagePercent = (content.length / config.limits.maxChars) * 100;
  if (charUsagePercent > 80 && charUsagePercent <= 100) {
    warnings.push(
      `Approaching ${config.displayName} character limit (${content.length}/${config.limits.maxChars})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate content for multiple providers
 */
export function validateContentForProviders(
  providerIds: string[],
  content: string,
  mediaCount: number = 0
): Record<string, ValidationResult> {
  const results: Record<string, ValidationResult> = {};

  for (const providerId of providerIds) {
    results[providerId] = validateContentForProvider(providerId, content, mediaCount);
  }

  return results;
}

/**
 * Get the most restrictive character limit from selected providers
 */
export function getMostRestrictiveCharLimit(providerIds: string[]): number {
  let minLimit = Infinity;

  for (const providerId of providerIds) {
    const config = getProviderConfig(providerId);
    if (config && config.limits.maxChars < minLimit) {
      minLimit = config.limits.maxChars;
    }
  }

  return minLimit === Infinity ? 280 : minLimit; // Default to X's limit
}

/**
 * Get the most restrictive media limit from selected providers
 */
export function getMostRestrictiveMediaLimit(providerIds: string[]): number {
  let minLimit = Infinity;

  for (const providerId of providerIds) {
    const config = getProviderConfig(providerId);
    if (config && config.limits.maxMediaPerPost < minLimit) {
      minLimit = config.limits.maxMediaPerPost;
    }
  }

  return minLimit === Infinity ? 4 : minLimit; // Default to X's limit
}
