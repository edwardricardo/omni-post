import type {
  CanonicalPost,
  Media,
  Result,
  ThreadPlan,
  ThreadPublishInput,
  ThreadReceipt,
  RenderedContent,
  RenderedPost,
  RenderError,
  PublishError,
  ThreadError,
} from "@shared/types";

export type ProviderId =
  | "x"
  | "instagram"
  | "facebook"
  | "youtube"
  | "tiktok"
  | "snapchat"
  | "telegram"
  | "pinterest"
  | "linkedin"
  | "bluesky";

export type ProviderLimits = {
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
};

// Re-export RenderedPost for backward compatibility
export type { RenderedPost };

export type PublishInput = { channelId: string; post: RenderedPost; dedupeKey: string };
export type PublishReceipt = { providerPostId: string; url?: string; publishedAt: Date };

/**
 * Normalized comment fetched from a provider's API.
 */
export interface ProviderComment {
  providerMessageId: string;
  providerParentId?: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorProviderId: string;
  body: string;
  mediaUrls?: string[];
  createdAt: Date;
}

/**
 * Result of posting a reply through the provider API.
 */
export interface ProviderReplyResult {
  providerReplyId: string;
  createdAt: Date;
}

export interface ProviderAdapter {
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
  publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>>;

  // Threading-specific methods
  planThread?(canonical: CanonicalPost): Result<ThreadPlan, ThreadError>;
  publishThread?(input: ThreadPublishInput): Promise<Result<ThreadReceipt, PublishError>>;

  fetchAnalytics?(q: {
    channelId: string;
    since?: Date;
    until?: Date;
  }): Promise<Result<unknown, "AUTH" | "NETWORK">>;
  handleWebhook?(payload: unknown): Promise<Result<unknown, "IGNORE" | "PARSE_ERROR">>;

  // Social Inbox methods (Phase 2)
  getComments?(params: {
    channelCredentials: unknown;
    postExternalId?: string;
    since?: Date;
    cursor?: string;
    limit?: number;
  }): Promise<Result<{ comments: ProviderComment[]; nextCursor?: string }, "AUTH" | "NETWORK">>;

  postReply?(params: {
    channelCredentials: unknown;
    inReplyToProviderMessageId: string;
    body: string;
  }): Promise<Result<ProviderReplyResult, "AUTH" | "NETWORK" | "RATE_LIMIT">>;
}
