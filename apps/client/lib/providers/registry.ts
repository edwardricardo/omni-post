/**
 * @file registry.ts
 * @description Client-side provider registry that wraps the centralized provider configuration with content validation, threading logic, optimal posting times, and legacy backward-compatible interfaces.
 * @layer infrastructure
 */

import {
  PROVIDER_CONFIGS,
  getProviderConfig,
  validateContentForProvider,
  type ProviderMetadata,
} from "@shared/types";

// Re-export the centralized provider metadata type
export type { ProviderMetadata };

// Legacy ProviderConfig interface for backward compatibility
// @deprecated Use ProviderMetadata from @shared/types instead
export interface ProviderConfig {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  charLimit: number;
  mediaLimits: {
    maxFiles: number;
    maxFileSize: number; // in bytes
    supportedTypes: string[];
  };
  features: {
    threads: boolean;
    polls: boolean;
    scheduling: boolean;
    hashtags: boolean;
    mentions: boolean;
    links: boolean;
  };
  rateLimit: {
    postsPerHour: number;
    postsPerDay: number;
  };
  optimalTimes: {
    [key: string]: string[]; // day of week -> optimal hours
  };
}

interface ProviderRequirement {
  field: string;
  message: string;
  validate: (content: string, media: File[]) => boolean;
}

/**
 * Client-side provider registry that wraps the centralized provider configuration.
 * This provides a backward-compatible API while using the shared provider configs.
 */
class ProviderRegistry {
  private requirements: Map<string, ProviderRequirement[]> = new Map();
  private optimalTimesCache: Map<string, Record<string, string[]>> = new Map();

  constructor() {
    this.initializeRequirements();
    this.initializeOptimalTimes();
  }

  /**
   * Initialize validation requirements for each provider.
   * These complement the centralized config with client-specific validation logic.
   */
  private initializeRequirements() {
    // X (Twitter) requirements
    this.requirements.set("x", [
      {
        field: "content",
        message: "Content is required for X posts",
        validate: (content: string) => content.trim().length > 0,
      },
      {
        field: "charLimit",
        message: "Content exceeds X character limit (280 characters)",
        validate: (content: string) => content.length <= 280,
      },
      {
        field: "media",
        message: "Maximum 4 media files allowed for X",
        validate: (_content: string, media: File[]) => media.length <= 4,
      },
    ]);

    // Instagram requirements
    this.requirements.set("instagram", [
      {
        field: "media",
        message: "At least one image or video is required for Instagram",
        validate: (_content: string, media: File[]) => media.length > 0,
      },
      {
        field: "media",
        message: "Maximum 10 media files allowed for Instagram",
        validate: (_content: string, media: File[]) => media.length <= 10,
      },
      {
        field: "charLimit",
        message: "Caption exceeds Instagram character limit (2,200 characters)",
        validate: (content: string) => content.length <= 2200,
      },
    ]);

    // LinkedIn requirements
    this.requirements.set("linkedin", [
      {
        field: "content",
        message: "Content is required for LinkedIn posts",
        validate: (content: string) => content.trim().length > 0,
      },
      {
        field: "charLimit",
        message: "Content exceeds LinkedIn character limit (3,000 characters)",
        validate: (content: string) => content.length <= 3000,
      },
      {
        field: "media",
        message: "Maximum 9 media files allowed for LinkedIn",
        validate: (_content: string, media: File[]) => media.length <= 9,
      },
    ]);

    // Facebook requirements
    this.requirements.set("facebook", [
      {
        field: "charLimit",
        message: "Content exceeds Facebook character limit (63,206 characters)",
        validate: (content: string) => content.length <= 63206,
      },
      {
        field: "media",
        message: "Maximum 30 media files allowed for Facebook",
        validate: (_content: string, media: File[]) => media.length <= 30,
      },
    ]);

    // YouTube requirements
    this.requirements.set("youtube", [
      {
        field: "content",
        message: "Title is required for YouTube videos",
        validate: (content: string) => content.trim().length > 0,
      },
      {
        field: "charLimit",
        message: "Title exceeds YouTube character limit (100 characters)",
        validate: (content: string) => content.length <= 100,
      },
      {
        field: "media",
        message: "Exactly one video is required for YouTube",
        validate: (_content: string, media: File[]) => media.length === 1,
      },
    ]);

    // TikTok requirements
    this.requirements.set("tiktok", [
      {
        field: "media",
        message: "Exactly one video is required for TikTok",
        validate: (_content: string, media: File[]) => media.length === 1,
      },
      {
        field: "charLimit",
        message: "Caption exceeds TikTok character limit (2,200 characters)",
        validate: (content: string) => content.length <= 2200,
      },
    ]);
  }

  /**
   * Initialize optimal posting times for each provider.
   * Based on industry research and best practices.
   */
  private initializeOptimalTimes() {
    this.optimalTimesCache.set("x", {
      monday: ["09:00", "12:00", "15:00", "18:00"],
      tuesday: ["09:00", "12:00", "15:00", "18:00"],
      wednesday: ["09:00", "12:00", "15:00", "18:00"],
      thursday: ["09:00", "12:00", "15:00", "18:00"],
      friday: ["09:00", "12:00", "15:00"],
      saturday: ["10:00", "14:00"],
      sunday: ["10:00", "14:00", "19:00"],
    });

    this.optimalTimesCache.set("instagram", {
      monday: ["06:00", "12:00", "19:00"],
      tuesday: ["06:00", "12:00", "19:00"],
      wednesday: ["06:00", "12:00", "19:00"],
      thursday: ["06:00", "12:00", "19:00"],
      friday: ["06:00", "12:00", "19:00"],
      saturday: ["10:00", "13:00", "16:00"],
      sunday: ["10:00", "13:00", "16:00"],
    });

    this.optimalTimesCache.set("linkedin", {
      monday: ["08:00", "10:00", "12:00", "14:00", "17:00"],
      tuesday: ["08:00", "10:00", "12:00", "14:00", "17:00"],
      wednesday: ["08:00", "10:00", "12:00", "14:00", "17:00"],
      thursday: ["08:00", "10:00", "12:00", "14:00", "17:00"],
      friday: ["08:00", "10:00", "12:00", "14:00"],
      saturday: [],
      sunday: [],
    });

    this.optimalTimesCache.set("facebook", {
      monday: ["09:00", "13:00", "15:00"],
      tuesday: ["09:00", "13:00", "15:00"],
      wednesday: ["09:00", "13:00", "15:00"],
      thursday: ["09:00", "13:00", "15:00"],
      friday: ["09:00", "13:00", "15:00"],
      saturday: ["12:00", "15:00"],
      sunday: ["12:00", "15:00"],
    });

    this.optimalTimesCache.set("youtube", {
      monday: ["14:00", "16:00", "18:00"],
      tuesday: ["14:00", "16:00", "18:00"],
      wednesday: ["14:00", "16:00", "18:00"],
      thursday: ["14:00", "16:00", "18:00"],
      friday: ["14:00", "16:00", "18:00"],
      saturday: ["09:00", "11:00", "14:00"],
      sunday: ["09:00", "11:00", "14:00"],
    });

    this.optimalTimesCache.set("tiktok", {
      monday: ["06:00", "12:00", "19:00", "22:00"],
      tuesday: ["06:00", "12:00", "19:00", "22:00"],
      wednesday: ["06:00", "12:00", "19:00", "22:00"],
      thursday: ["06:00", "12:00", "19:00", "22:00"],
      friday: ["06:00", "12:00", "19:00", "22:00"],
      saturday: ["10:00", "13:00", "19:00", "22:00"],
      sunday: ["10:00", "13:00", "19:00", "22:00"],
    });
  }

  /**
   * Convert centralized ProviderMetadata to legacy ProviderConfig format.
   * @deprecated Use getProviderMetadata() and ProviderMetadata type instead.
   */
  private convertToLegacyConfig(metadata: ProviderMetadata): ProviderConfig {
    return {
      id: metadata.id,
      name: metadata.name,
      displayName: metadata.displayName,
      icon: metadata.icon,
      color: metadata.color,
      charLimit: metadata.limits.maxChars,
      mediaLimits: {
        maxFiles: metadata.limits.maxMediaPerPost,
        maxFileSize: metadata.limits.maxImageSize ?? 5 * 1024 * 1024, // Default 5MB if undefined
        supportedTypes: metadata.limits.allowedMedia.map(
          (type) =>
            `${type === "gif" ? "image" : type}/${type === "gif" ? "gif" : type === "image" ? "jpeg" : "mp4"}`
        ),
      },
      features: {
        threads: metadata.capabilities.threading || false,
        polls: false, // Not in centralized config yet
        scheduling: metadata.capabilities.schedule,
        hashtags: false, // Not in centralized config yet
        mentions: false, // Not in centralized config yet
        links: true, // Default to true
      },
      rateLimit: {
        postsPerHour: 10, // Default value
        postsPerDay: 50, // Default value
      },
      optimalTimes: this.optimalTimesCache.get(metadata.id) || {},
    };
  }

  /**
   * Get provider configuration (legacy API).
   * @deprecated Use getProviderMetadata() instead.
   */
  getProvider(id: string): ProviderConfig | undefined {
    const metadata = getProviderConfig(id);
    if (!metadata) return undefined;
    return this.convertToLegacyConfig(metadata);
  }

  /**
   * Get provider metadata from centralized config.
   * This is the preferred method for accessing provider information.
   */
  getProviderMetadata(id: string): ProviderMetadata | undefined {
    return getProviderConfig(id);
  }

  /**
   * Get all available providers (legacy API).
   * @deprecated Use getAllProviderMetadata() instead.
   */
  getAllProviders(): ProviderConfig[] {
    return Object.values(PROVIDER_CONFIGS)
      .filter((p) => p.status === "active")
      .map((p) => this.convertToLegacyConfig(p));
  }

  /**
   * Get all available provider metadata.
   * This is the preferred method for accessing all providers.
   */
  getAllProviderMetadata(): ProviderMetadata[] {
    return Object.values(PROVIDER_CONFIGS).filter((p) => p.status === "active");
  }

  /**
   * Get providers that support a specific feature.
   */
  getProvidersByFeature(feature: keyof ProviderConfig["features"]): ProviderConfig[] {
    return this.getAllProviders().filter((provider) => provider.features[feature]);
  }

  /**
   * Validate content for a specific provider.
   * Uses both centralized validation and client-specific requirements.
   */
  validateContent(
    providerId: string,
    content: string,
    media: File[] = []
  ): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Use centralized validation first
    const centralValidation = validateContentForProvider(providerId, content, media.length);
    if (!centralValidation.valid) {
      errors.push(...centralValidation.errors);
    }

    // Apply client-specific requirements
    const requirements = this.requirements.get(providerId) || [];
    requirements.forEach((requirement) => {
      if (!requirement.validate(content, media)) {
        // Avoid duplicate errors
        if (!errors.includes(requirement.message)) {
          errors.push(requirement.message);
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get optimal posting times for a provider on a specific date.
   */
  getOptimalTimes(providerId: string, date: Date): string[] {
    const dayName = date.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    const times = this.optimalTimesCache.get(providerId);
    return times?.[dayName] || [];
  }

  /**
   * Get character limit for a provider.
   */
  getCharLimit(providerId: string): number {
    const metadata = getProviderConfig(providerId);
    return metadata?.limits.maxChars || 280;
  }

  /**
   * Get media limits for a provider.
   */
  getMediaLimits(providerId: string) {
    const metadata = getProviderConfig(providerId);
    if (!metadata) {
      return {
        maxFiles: 1,
        maxFileSize: 5 * 1024 * 1024,
        supportedTypes: ["image/jpeg", "image/png"],
      };
    }

    return {
      maxFiles: metadata.limits.maxMediaPerPost,
      maxFileSize: metadata.limits.maxImageSize ?? 5 * 1024 * 1024, // Default 5MB if undefined
      supportedTypes: metadata.limits.allowedMedia.map(
        (type) =>
          `${type === "gif" ? "image" : type}/${type === "gif" ? "gif" : type === "image" ? "jpeg" : "mp4"}`
      ),
    };
  }

  /**
   * Get rate limits for a provider.
   */
  getRateLimit(providerId: string) {
    // Rate limits not yet in centralized config; using sensible defaults per provider
    const defaults: Record<string, { postsPerHour: number; postsPerDay: number }> = {
      x: { postsPerHour: 20, postsPerDay: 300 },
      instagram: { postsPerHour: 5, postsPerDay: 25 },
      linkedin: { postsPerHour: 10, postsPerDay: 50 },
      facebook: { postsPerHour: 25, postsPerDay: 200 },
      youtube: { postsPerHour: 6, postsPerDay: 10 },
      tiktok: { postsPerHour: 3, postsPerDay: 4 },
    };

    return (
      defaults[providerId] || {
        postsPerHour: 10,
        postsPerDay: 50,
      }
    );
  }

  /**
   * Check if a provider supports a specific feature.
   */
  supportsFeature(providerId: string, feature: keyof ProviderConfig["features"]): boolean {
    const provider = this.getProvider(providerId);
    return provider?.features[feature] || false;
  }

  /**
   * Check if content needs to be split into a thread for the given provider.
   */
  needsThreading(providerId: string, content: string): boolean {
    const charLimit = this.getCharLimit(providerId);
    const metadata = getProviderConfig(providerId);
    const supportsThreading = metadata?.capabilities.threading || false;
    return content.length > charLimit && supportsThreading;
  }

  /**
   * Split content into thread segments for a provider.
   * Uses sentence/word boundary detection.
   */
  getThreadSegments(providerId: string, content: string): string[] {
    if (!this.needsThreading(providerId, content)) {
      return [content];
    }

    const charLimit = this.getCharLimit(providerId);
    const segments: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= charLimit) {
        segments.push(remaining);
        break;
      }

      // Find the best break point (sentence or word boundary)
      let breakPoint = charLimit;
      const sentences = remaining.substring(0, charLimit).split(/[.!?]/);

      if (sentences.length > 1) {
        // Break at sentence boundary
        breakPoint = sentences.slice(0, -1).join(".").length + 1;
      } else {
        // Break at word boundary
        const words = remaining.substring(0, charLimit).split(" ");
        if (words.length > 1) {
          breakPoint = words.slice(0, -1).join(" ").length;
        }
      }

      segments.push(remaining.substring(0, breakPoint).trim());
      remaining = remaining.substring(breakPoint).trim();
    }

    return segments;
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry();

// Export types for use in other components
export type { ProviderRequirement };
