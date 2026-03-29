import type {
  CanonicalPost,
  Media,
  Result,
  RenderedPost,
  ThreadPlan,
  ThreadPublishInput,
  ThreadReceipt,
  RenderedContent,
  RenderError,
  PublishError,
  ThreadError,
  ProviderId,
} from "@shared/types";

// Re-export ProviderId for backward compatibility
export type { ProviderId };

export type ProviderAuthType = "oauth" | "api_key" | "username_password";

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
  liveStreaming?: boolean;
  directMessages?: boolean;
}

export interface ProviderLimits {
  maxChars: number;
  maxHashtags?: number;
  maxMediaPerPost: number;
  maxPostsPerThread?: number;
  allowedMedia: Array<Media["type"]>;
  aspectRatios?: Array<"1:1" | "4:5" | "9:16" | "16:9" | "3:2" | "4:3">;
  maxVideoDuration?: number; // seconds
  maxImageSize?: number; // bytes
  maxVideoSize?: number; // bytes
  rateLimitHints?: { burst: number; perSeconds: number };
  threadingSupported?: boolean;
  schedulingAdvance?: { min: number; max: number }; // minutes
}

export interface ProviderConstraints {
  requiresApproval?: boolean;
  restrictedContent?: string[];
  geographicRestrictions?: string[];
  businessAccountRequired?: boolean;
  verificationRequired?: boolean;
}

export interface ProviderMetadata {
  id: ProviderId;
  name: string;
  displayName: string;
  description: string;
  icon: string;
  color: string;
  website: string;
  authType: ProviderAuthType;
  requiredScopes?: string[];
  status: "active" | "beta" | "coming_soon" | "maintenance" | "deprecated";
}

export interface ConnectionConfig {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  apiSecret?: string;
  accountId?: string;
  accountName?: string;
  profileImage?: string;
  connectedAt: Date;
  expiresAt?: Date;
}

export interface ContentValidationResult {
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    severity: "error" | "warning" | "info";
  }>;
  suggestions: Array<{
    type: "truncate" | "split" | "optimize" | "format";
    message: string;
    action?: string;
  }>;
  adaptations: Array<{
    providerId: ProviderId;
    requiredChanges: string[];
    preview?: string;
  }>;
}

export interface SchedulingSlot {
  datetime: Date;
  timezone: string;
  optimal?: boolean;
  reason?: string;
}

export interface PublishStatus {
  status: "pending" | "publishing" | "published" | "failed" | "cancelled";
  progress?: number;
  message?: string;
  publishedUrl?: string;
  publishedAt?: Date;
  error?: string;
}

export interface AnalyticsMetrics {
  engagement: {
    likes: number;
    comments: number;
    shares: number;
    saves?: number;
    reactions?: Record<string, number>;
  };
  reach: {
    impressions: number;
    reach: number;
    uniqueViews?: number;
  };
  demographics?: {
    ageGroups: Record<string, number>;
    genders: Record<string, number>;
    locations: Record<string, number>;
  };
  performance: {
    ctr?: number; // click-through rate
    engagementRate: number;
    virality?: number;
  };
}

export interface ProviderPreview {
  providerId: ProviderId;
  content: {
    text: string;
    truncated?: boolean;
    media?: Array<{
      type: Media["type"];
      url: string;
      optimized?: boolean;
    }>;
  };
  constraints: {
    charactersUsed: number;
    charactersRemaining: number;
    mediaCount: number;
    mediaLimit: number;
  };
  warnings: string[];
  threading?: {
    threadCount: number;
    posts: string[];
  };
}

// Enhanced Provider Adapter Interface (Consolidated)
// This is now the single source of truth for all provider adapters
export interface ProviderAdapter {
  // Basic adapter properties
  readonly id: ProviderId;
  readonly metadata: ProviderMetadata;
  readonly capabilities: ProviderCapabilities;
  readonly limits: ProviderLimits;
  readonly constraints: ProviderConstraints;

  // Authentication & Connection Management
  validateCredentials(
    config: ConnectionConfig
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED" | "SCOPE_INSUFFICIENT">>;
  refreshToken?(config: ConnectionConfig): Promise<Result<ConnectionConfig, "REFRESH_FAILED">>;
  getAccountInfo(config: ConnectionConfig): Promise<
    Result<
      {
        id: string;
        name: string;
        username?: string;
        profileImage?: string;
        verified?: boolean;
        followers?: number;
      },
      "AUTH" | "NETWORK"
    >
  >;

  // Content Validation & Adaptation
  validateContent(
    canonical: CanonicalPost,
    config?: ConnectionConfig
  ): Promise<ContentValidationResult>;
  adaptContent(
    canonical: CanonicalPost,
    targetProvider: ProviderId
  ): Promise<Result<CanonicalPost, "ADAPTATION_FAILED">>;
  generatePreview(canonical: CanonicalPost, config?: ConnectionConfig): Promise<ProviderPreview>;

  // Content Operations
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError>;
  publish(input: {
    channelId: string;
    post: RenderedContent;
    dedupeKey: string;
    config: ConnectionConfig;
  }): Promise<
    Result<
      {
        providerPostId: string;
        url?: string;
        publishedAt: Date;
        status: PublishStatus;
      },
      PublishError
    >
  >;

  // Scheduling
  schedule?(input: {
    channelId: string;
    post: RenderedContent;
    scheduledAt: Date;
    timezone: string;
    config: ConnectionConfig;
  }): Promise<
    Result<
      {
        scheduleId: string;
        scheduledFor: Date;
      },
      "SCHEDULE_FAILED" | "INVALID_TIME" | "AUTH"
    >
  >;

  getOptimalTimes?(config: ConnectionConfig): Promise<Result<SchedulingSlot[], "AUTH" | "NETWORK">>;
  cancelScheduled?(
    scheduleId: string,
    config: ConnectionConfig
  ): Promise<Result<void, "NOT_FOUND" | "AUTH">>;

  // Threading Support
  planThread?(canonical: CanonicalPost): Result<ThreadPlan, ThreadError>;
  publishThread?(
    input: ThreadPublishInput & { config: ConnectionConfig }
  ): Promise<Result<ThreadReceipt, PublishError>>;

  // Analytics & Insights
  fetchAnalytics?(query: {
    channelId: string;
    postIds?: string[];
    since?: Date;
    until?: Date;
    metrics?: string[];
    config: ConnectionConfig;
  }): Promise<Result<AnalyticsMetrics[], "AUTH" | "NETWORK" | "QUOTA_EXCEEDED">>;

  getInsights?(query: {
    channelId: string;
    timeframe: "day" | "week" | "month" | "year";
    config: ConnectionConfig;
  }): Promise<
    Result<
      {
        bestTimes: SchedulingSlot[];
        topContent: Array<{
          postId: string;
          metrics: AnalyticsMetrics;
        }>;
        audienceGrowth: Array<{
          date: Date;
          followers: number;
          engagement: number;
        }>;
      },
      "AUTH" | "NETWORK"
    >
  >;

  // Real-time Features
  getPublishStatus?(
    postId: string,
    config: ConnectionConfig
  ): Promise<Result<PublishStatus, "NOT_FOUND" | "AUTH">>;
  subscribeToUpdates?(callback: (update: PublishStatus) => void): void;
  unsubscribeFromUpdates?(): void;

  // Media Optimization
  optimizeMedia?(
    media: Media,
    targetSpecs: {
      maxSize?: number;
      aspectRatio?: string;
      format?: string;
    }
  ): Promise<Result<Media, "OPTIMIZATION_FAILED">>;

  // Webhook Support
  handleWebhook?(payload: unknown): Promise<
    Result<
      {
        type: "post_published" | "engagement_update" | "error" | "other";
        data: unknown;
      },
      "IGNORE" | "PARSE_ERROR"
    >
  >;

  // Health Check
  healthCheck(config?: ConnectionConfig): Promise<
    Result<
      {
        healthy: boolean;
        latency?: number;
        quotaRemaining?: number;
        nextReset?: Date;
        warnings?: string[];
      },
      "HEALTH_CHECK_FAILED"
    >
  >;
}

// Legacy basic adapter interface (DEPRECATED - kept for reference only)
// All new code should use the main ProviderAdapter interface above
export interface LegacyProviderAdapter {
  readonly id: ProviderId;
  readonly limits: ProviderLimits;
  capabilities: {
    publish: boolean;
    schedule: boolean;
    analytics: boolean;
    comments: boolean;
    replies: boolean;
    threading: boolean;
  };
  validateCredentials(creds: unknown): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">>;
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError>;
  publish(input: {
    channelId: string;
    post: RenderedContent;
    dedupeKey: string;
  }): Promise<Result<{ providerPostId: string; url?: string; publishedAt: Date }, PublishError>>;
}

// Type guards and utilities
export function isFullProviderAdapter(adapter: unknown): adapter is ProviderAdapter {
  return (
    typeof adapter === "object" &&
    adapter !== null &&
    "metadata" in adapter &&
    "validateContent" in adapter &&
    "constraints" in adapter
  );
}

export function upgradeAdapter(adapter: LegacyProviderAdapter): ProviderAdapter {
  // Upgrade legacy adapter to universal adapter with default implementations
  return {
    ...adapter,
    metadata: {
      id: adapter.id,
      name: adapter.id,
      displayName: adapter.id.toUpperCase(),
      description: `${adapter.id} social media provider`,
      icon: `/providers/${adapter.id}-icon.svg`,
      color: "#000000",
      website: `https://${adapter.id}.com`,
      authType: "oauth" as ProviderAuthType,
      status: "active" as const,
    },
    constraints: {},

    // Default implementations for enhanced methods
    async validateContent(canonical: CanonicalPost): Promise<ContentValidationResult> {
      const renderResult = adapter.render(canonical);
      if (!renderResult.ok) {
        return {
          valid: false,
          errors: [{ field: "content", message: renderResult.error, severity: "error" }],
          suggestions: [],
          adaptations: [],
        };
      }
      return {
        valid: true,
        errors: [],
        suggestions: [],
        adaptations: [],
      };
    },

    async adaptContent(
      canonical: CanonicalPost
    ): Promise<Result<CanonicalPost, "ADAPTATION_FAILED">> {
      return { ok: true, value: canonical };
    },

    async generatePreview(canonical: CanonicalPost): Promise<ProviderPreview> {
      const renderResult = adapter.render(canonical);

      // Extract text from render result using proper type narrowing
      let previewText = "";
      if (renderResult.ok) {
        if (renderResult.value.type === "single") {
          previewText = (renderResult.value.content as RenderedPost).text || "";
        } else {
          const threadContent = renderResult.value.content as ThreadPlan;
          previewText = threadContent.tweets[0]?.text || "";
        }
      }

      return {
        providerId: adapter.id,
        content: {
          text: previewText,
          ...(canonical.media
            ? {
                media: canonical.media.map((m) => ({
                  type: m.type,
                  url: m.url,
                  optimized: false,
                })),
              }
            : {}),
        },
        constraints: {
          charactersUsed: previewText.length,
          charactersRemaining: adapter.limits.maxChars
            ? adapter.limits.maxChars - previewText.length
            : 0,
          mediaCount: canonical.media?.length || 0,
          mediaLimit: adapter.limits.maxMediaPerPost || 4,
        },
        warnings: [],
      };
    },

    async getAccountInfo(): Promise<
      Result<
        {
          id: string;
          name: string;
          username?: string;
          profileImage?: string;
          verified?: boolean;
          followers?: number;
        },
        "AUTH" | "NETWORK"
      >
    > {
      return { ok: false, error: "AUTH" };
    },

    async healthCheck(): Promise<
      Result<{ healthy: boolean; latency?: number }, "HEALTH_CHECK_FAILED">
    > {
      return { ok: true, value: { healthy: true } };
    },
  } as unknown as ProviderAdapter;
}
