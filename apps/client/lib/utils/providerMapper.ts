/**
 * @file providerMapper.ts
 * @description Utility functions to map backend Provider objects to the ProviderMetadata shape expected by UI components, applying default limits, colors, and OAuth scopes.
 * @layer infrastructure
 */

import type { ProviderMetadata, ProviderCapabilities, ProviderLimits } from "@shared/types";
import type { Provider } from "@/lib/api/types";

// Default platform limits - these would normally come from the backend
const DEFAULT_LIMITS: Record<string, ProviderLimits> = {
  x: {
    maxChars: 280,
    maxMediaPerPost: 4,
    maxPostsPerThread: 25,
    allowedMedia: ["image/jpeg", "image/png", "image/gif", "video/mp4"],
    aspectRatios: ["16:9", "1:1", "4:5"],
    maxVideoDuration: 140,
    maxImageSize: 5 * 1024 * 1024, // 5MB
  },
  twitter: {
    maxChars: 280,
    maxMediaPerPost: 4,
    maxPostsPerThread: 25,
    allowedMedia: ["image/jpeg", "image/png", "image/gif", "video/mp4"],
    aspectRatios: ["16:9", "1:1", "4:5"],
    maxVideoDuration: 140,
    maxImageSize: 5 * 1024 * 1024,
  },
  instagram: {
    maxChars: 2200,
    maxMediaPerPost: 10,
    allowedMedia: ["image/jpeg", "image/png", "video/mp4"],
    aspectRatios: ["1:1", "4:5", "16:9"],
    maxVideoDuration: 60,
    maxImageSize: 8 * 1024 * 1024, // 8MB
  },
  linkedin: {
    maxChars: 3000,
    maxMediaPerPost: 20,
    allowedMedia: ["image/jpeg", "image/png", "image/gif", "video/mp4", "application/pdf"],
    aspectRatios: ["1.91:1", "1:1", "4:5"],
    maxVideoDuration: 600,
    maxImageSize: 10 * 1024 * 1024, // 10MB
  },
  facebook: {
    maxChars: 63206,
    maxMediaPerPost: 30,
    allowedMedia: ["image/jpeg", "image/png", "image/gif", "video/mp4"],
    aspectRatios: ["16:9", "1:1", "4:5"],
    maxVideoDuration: 240,
    maxImageSize: 10 * 1024 * 1024,
  },
};

// Default platform colors
const DEFAULT_COLORS: Record<string, string> = {
  x: "#1DA1F2",
  twitter: "#1DA1F2",
  instagram: "#E4405F",
  linkedin: "#0077B5",
  facebook: "#1877F2",
  youtube: "#FF0000",
  tiktok: "#000000",
  pinterest: "#E60023",
};

function mapCapabilities(capabilities: string[]): ProviderCapabilities {
  return {
    publish: capabilities.includes("publish"),
    schedule: capabilities.includes("schedule"),
    analytics: capabilities.includes("analytics"),
    comments: capabilities.includes("comments"),
    replies: capabilities.includes("replies"),
    threading: capabilities.includes("threading"),
    stories: capabilities.includes("stories"),
    reels: capabilities.includes("reels"),
    carousel: capabilities.includes("carousel"),
  };
}

// Default fallback limits (X/Twitter)
const FALLBACK_LIMITS: ProviderLimits = {
  maxChars: 280,
  maxMediaPerPost: 4,
  maxPostsPerThread: 25,
  allowedMedia: ["image/jpeg", "image/png", "image/gif", "video/mp4"],
  aspectRatios: ["16:9", "1:1", "4:5"],
  maxVideoDuration: 140,
  maxImageSize: 5 * 1024 * 1024,
};

function mapProviderToMetadata(provider: Provider): ProviderMetadata {
  const limits = DEFAULT_LIMITS[provider.id] ?? FALLBACK_LIMITS;
  const color = DEFAULT_COLORS[provider.id] ?? "#6B7280"; // Default to gray color

  return {
    id: provider.id,
    name: provider.name,
    displayName: provider.displayName,
    icon: provider.iconUrl || `/icons/${provider.id}.svg`,
    color,
    capabilities: mapCapabilities(provider.capabilities),
    limits,
    status: provider.isActive ? "active" : "maintenance",
    description: provider.description || `Connect your ${provider.displayName} account`,
    authType: "oauth", // Default assumption
    requiredScopes: getDefaultScopes(provider.id),
  };
}

function getDefaultScopes(providerId: string): string[] {
  const scopeMap: Record<string, string[]> = {
    x: ["read", "write"],
    twitter: ["read", "write"],
    instagram: ["basic", "content_publish"],
    linkedin: ["r_liteprofile", "w_member_social"],
    facebook: ["pages_show_list", "pages_manage_posts"],
  };

  return scopeMap[providerId] || [];
}

export function mapProvidersToMetadata(providers: Provider[]): ProviderMetadata[] {
  return providers.map(mapProviderToMetadata);
}
