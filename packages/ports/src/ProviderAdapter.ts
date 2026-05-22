/**
 * @file ProviderAdapter.ts
 * @description Provider adapter port (interface) defining ProviderId, render, publish, threaded
 *              publish, and analytics contracts used by all social-platform adapters.
 * @layer domain
 */
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
  | "bluesky"
  | "threads";

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
 * Normalized brand-mention fetched from a provider's search API (market-wide
 * keyword search) or resolved from a webhook notification (own-brand mention).
 * The canonical shape every provider normalizes to before the mention lands in
 * the listening corpus.
 */
export interface ProviderMention {
  providerMentionId: string;
  url?: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorProviderId: string;
  body: string;
  lang?: string;
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

/**
 * Provider adapter port. Adapters implement this interface and are stateless
 * w.r.t. credentials — every method that needs credentials receives them
 * explicitly. The application layer resolves credentials per-channel via
 * `CredentialResolver` and passes the resolved credentials into the adapter.
 *
 * Canon: Cockburn hexagonal — adapter is a pure transformation, no global
 * state, no environment reads, no DB access. Composition root wires concrete
 * implementations (XAdapter, TelegramAdapter, etc.) with their dependencies
 * (apiClient, logger).
 */
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
    mentions: boolean;
  };

  /**
   * Validate that the supplied credentials are well-formed and accepted by
   * the provider. Used by `ConnectChannel` use case before persisting a
   * channel; not called from `publish`.
   */
  validateCredentials(credentials: unknown): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">>;

  /**
   * Render a canonical post to provider-specific text/thread structure.
   * Pure transformation, no I/O, no credentials needed.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError>;

  /**
   * Publish a single post. Caller must pass resolved credentials —
   * adapter does NOT fetch credentials internally.
   */
  publish(input: PublishInput, credentials: unknown): Promise<Result<PublishReceipt, PublishError>>;

  // Threading-specific methods
  planThread?(canonical: CanonicalPost): Result<ThreadPlan, ThreadError>;
  publishThread?(
    input: ThreadPublishInput,
    credentials: unknown
  ): Promise<Result<ThreadReceipt, PublishError>>;

  fetchAnalytics?(
    query: { channelId: string; since?: Date; until?: Date },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">>;

  /**
   * Webhook payloads are signed by the provider with a shared HMAC secret
   * stored on `WebhookSubscription`, NOT with the channel's OAuth credentials —
   * so this method takes no `credentials` argument.
   */
  handleWebhook?(payload: unknown): Promise<Result<unknown, "IGNORE" | "PARSE_ERROR">>;

  // Social Inbox methods (already credential-explicit)
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

  /**
   * Search the provider for public posts mentioning the given terms
   * (market-wide brand listening). Pull model: the listening worker drives this
   * on a schedule. Implemented only by providers with a keyword search API
   * (e.g. X recent search, Bluesky searchPosts). `terms` are matched as an OR
   * set; `nextCursor` paginates the result window.
   */
  searchMentions?(params: {
    channelCredentials: unknown;
    terms: string[];
    since?: Date;
    cursor?: string;
    limit?: number;
  }): Promise<
    Result<{ mentions: ProviderMention[]; nextCursor?: string }, "AUTH" | "NETWORK" | "RATE_LIMIT">
  >;

  /**
   * Resolve a single mention by its provider id. Push model: a webhook delivers
   * a mention notification (id only), and the worker calls this to fetch the
   * full object before persisting (fetch-before-process). Implemented by
   * providers that push own-brand mentions via webhook (e.g. Meta Graph
   * Instagram/Facebook).
   */
  fetchMentionById?(params: {
    channelCredentials: unknown;
    providerMentionId: string;
  }): Promise<Result<ProviderMention, "AUTH" | "NETWORK" | "NOT_FOUND">>;
}
