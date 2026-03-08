/**
 * Domain Layer - Provider Value Object
 *
 * Part of Sprint 3: DDD Architecture Implementation
 * Represents a social media provider with its capabilities and constraints.
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

/**
 * Supported provider types (matches Prisma enum)
 */
export const PROVIDERS = {
  X: "X",
  INSTAGRAM: "INSTAGRAM",
  FACEBOOK: "FACEBOOK",
  YOUTUBE: "YOUTUBE",
  TIKTOK: "TIKTOK",
} as const;

export type ProviderType = (typeof PROVIDERS)[keyof typeof PROVIDERS];

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  supportsImages: boolean;
  supportsVideos: boolean;
  supportsGifs: boolean;
  supportsThreads: boolean;
  supportsStories: boolean;
  supportsReels: boolean;
  supportsScheduling: boolean;
  supportsCarousel: boolean;
  supportsHashtags: boolean;
  supportsMentions: boolean;
  supportsLinks: boolean;
  supportsPolls: boolean;
  maxCharacters: number;
  maxImages: number;
  maxVideoDurationSeconds: number;
}

/**
 * Provider-specific capabilities
 */
const PROVIDER_CAPABILITIES: Record<ProviderType, ProviderCapabilities> = {
  [PROVIDERS.X]: {
    supportsImages: true,
    supportsVideos: true,
    supportsGifs: true,
    supportsThreads: true,
    supportsStories: false,
    supportsReels: false,
    supportsScheduling: true,
    supportsCarousel: false,
    supportsHashtags: true,
    supportsMentions: true,
    supportsLinks: true,
    supportsPolls: true,
    maxCharacters: 280,
    maxImages: 4,
    maxVideoDurationSeconds: 140,
  },
  [PROVIDERS.INSTAGRAM]: {
    supportsImages: true,
    supportsVideos: true,
    supportsGifs: false,
    supportsThreads: false,
    supportsStories: true,
    supportsReels: true,
    supportsScheduling: true,
    supportsCarousel: true,
    supportsHashtags: true,
    supportsMentions: true,
    supportsLinks: false, // Only in bio
    supportsPolls: false,
    maxCharacters: 2200,
    maxImages: 10,
    maxVideoDurationSeconds: 60,
  },
  [PROVIDERS.FACEBOOK]: {
    supportsImages: true,
    supportsVideos: true,
    supportsGifs: true,
    supportsThreads: false,
    supportsStories: true,
    supportsReels: true,
    supportsScheduling: true,
    supportsCarousel: true,
    supportsHashtags: true,
    supportsMentions: true,
    supportsLinks: true,
    supportsPolls: true,
    maxCharacters: 63206,
    maxImages: 10,
    maxVideoDurationSeconds: 14400, // 240 minutes
  },
  [PROVIDERS.YOUTUBE]: {
    supportsImages: false, // Thumbnails only
    supportsVideos: true,
    supportsGifs: false,
    supportsThreads: false,
    supportsStories: false,
    supportsReels: true, // Shorts
    supportsScheduling: true,
    supportsCarousel: false,
    supportsHashtags: true,
    supportsMentions: true,
    supportsLinks: true,
    supportsPolls: true,
    maxCharacters: 5000,
    maxImages: 0,
    maxVideoDurationSeconds: 43200, // 12 hours
  },
  [PROVIDERS.TIKTOK]: {
    supportsImages: true,
    supportsVideos: true,
    supportsGifs: false,
    supportsThreads: false,
    supportsStories: false,
    supportsReels: false, // TikTok IS short-form video
    supportsScheduling: true,
    supportsCarousel: true, // Photo carousels
    supportsHashtags: true,
    supportsMentions: true,
    supportsLinks: false, // Only for verified accounts
    supportsPolls: false,
    maxCharacters: 2200,
    maxImages: 35,
    maxVideoDurationSeconds: 600, // 10 minutes
  },
};

/**
 * Provider display information
 */
const PROVIDER_DISPLAY: Record<ProviderType, { name: string; icon: string; color: string }> = {
  [PROVIDERS.X]: { name: "X (Twitter)", icon: "x", color: "#000000" },
  [PROVIDERS.INSTAGRAM]: { name: "Instagram", icon: "instagram", color: "#E4405F" },
  [PROVIDERS.FACEBOOK]: { name: "Facebook", icon: "facebook", color: "#1877F2" },
  [PROVIDERS.YOUTUBE]: { name: "YouTube", icon: "youtube", color: "#FF0000" },
  [PROVIDERS.TIKTOK]: { name: "TikTok", icon: "tiktok", color: "#000000" },
};

/**
 * Provider - Immutable value object representing a social media platform
 *
 * @example
 * const provider = Provider.fromString('X');
 * if (provider.ok) {
 *   console.log(provider.value.capabilities.supportsThreads); // true
 * }
 */
export class Provider {
  private readonly _type: ProviderType;

  private constructor(type: ProviderType) {
    this._type = type;
  }

  /**
   * Create a Provider from a string value
   */
  static fromString(value: string): Result<Provider, InvalidValueError> {
    const upperValue = value.toUpperCase();
    if (!Object.values(PROVIDERS).includes(upperValue as ProviderType)) {
      return err(
        new InvalidValueError(
          "provider",
          value,
          `Invalid provider: "${value}". Valid providers: ${Object.values(PROVIDERS).join(", ")}`
        )
      );
    }
    return ok(new Provider(upperValue as ProviderType));
  }

  /**
   * Factory methods for each provider
   */
  static x(): Provider {
    return new Provider(PROVIDERS.X);
  }

  static instagram(): Provider {
    return new Provider(PROVIDERS.INSTAGRAM);
  }

  static facebook(): Provider {
    return new Provider(PROVIDERS.FACEBOOK);
  }

  static youtube(): Provider {
    return new Provider(PROVIDERS.YOUTUBE);
  }

  static tiktok(): Provider {
    return new Provider(PROVIDERS.TIKTOK);
  }

  /**
   * Get all supported providers
   */
  static all(): Provider[] {
    return Object.values(PROVIDERS).map((type) => new Provider(type));
  }

  /**
   * Get the raw provider type
   */
  get type(): ProviderType {
    return this._type;
  }

  /**
   * Get provider capabilities
   */
  get capabilities(): ProviderCapabilities {
    return { ...PROVIDER_CAPABILITIES[this._type] };
  }

  /**
   * Get display name
   */
  get displayName(): string {
    return PROVIDER_DISPLAY[this._type].name;
  }

  /**
   * Get icon identifier
   */
  get icon(): string {
    return PROVIDER_DISPLAY[this._type].icon;
  }

  /**
   * Get brand color
   */
  get color(): string {
    return PROVIDER_DISPLAY[this._type].color;
  }

  /**
   * Capability checks
   */
  supportsImages(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsImages;
  }

  supportsVideos(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsVideos;
  }

  supportsGifs(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsGifs;
  }

  supportsThreads(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsThreads;
  }

  supportsStories(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsStories;
  }

  supportsReels(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsReels;
  }

  supportsScheduling(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsScheduling;
  }

  supportsCarousel(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsCarousel;
  }

  supportsHashtags(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsHashtags;
  }

  supportsMentions(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsMentions;
  }

  supportsLinks(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsLinks;
  }

  supportsPolls(): boolean {
    return PROVIDER_CAPABILITIES[this._type].supportsPolls;
  }

  /**
   * Provider type checks
   */
  isX(): boolean {
    return this._type === PROVIDERS.X;
  }

  isInstagram(): boolean {
    return this._type === PROVIDERS.INSTAGRAM;
  }

  isFacebook(): boolean {
    return this._type === PROVIDERS.FACEBOOK;
  }

  isYouTube(): boolean {
    return this._type === PROVIDERS.YOUTUBE;
  }

  isTikTok(): boolean {
    return this._type === PROVIDERS.TIKTOK;
  }

  /**
   * Check if content length is valid for this provider
   */
  isValidContentLength(length: number): boolean {
    return length <= PROVIDER_CAPABILITIES[this._type].maxCharacters;
  }

  /**
   * Get maximum character count
   */
  get maxCharacters(): number {
    return PROVIDER_CAPABILITIES[this._type].maxCharacters;
  }

  /**
   * Get maximum image count
   */
  get maxImages(): number {
    return PROVIDER_CAPABILITIES[this._type].maxImages;
  }

  /**
   * Get maximum video duration in seconds
   */
  get maxVideoDurationSeconds(): number {
    return PROVIDER_CAPABILITIES[this._type].maxVideoDurationSeconds;
  }

  /**
   * Equality check
   */
  equals(other: Provider): boolean {
    return this._type === other._type;
  }

  toString(): string {
    return this._type;
  }

  toJSON(): Record<string, unknown> {
    return {
      type: this._type,
      displayName: this.displayName,
      icon: this.icon,
      color: this.color,
      capabilities: this.capabilities,
    };
  }
}
