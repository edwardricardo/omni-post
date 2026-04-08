/**
 * Unified RenderedPost type - Single source of truth
 * Used by ProviderAdapter.render() and RenderedContent
 */
export type RenderedPost = {
  body: string;
  text?: string;
  media?: Array<{ url: string; type: "image" | "video" | "gif"; alt?: string }>;
  meta?: Record<string, unknown>;
  links?: Array<{ url: string; title?: string }>;
  metadata?: Record<string, unknown>;
  // Platform-specific fields that may be present
  [key: string]: unknown;
};

export type MediaType = "image" | "video" | "gif";

export type Media = {
  id: string;
  type: MediaType;
  url: string;
  w?: number;
  h?: number;
  durationMs?: number;
  alt?: string;
};

/** @deprecated Legacy tier type — use AccountSubscription.status instead. */
export type SubscriptionTier = "BASIC" | "PRO" | "ENTERPRISE";

export type Account = {
  id: string;
  email: string;
  name: string;
  maxProjects: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateAccountInput = {
  email: string;
  name: string;
  maxProjects?: number;
};

export type UpdateAccountInput = {
  name?: string;
  maxProjects?: number;
};

export type CanonicalPost = {
  id: string;
  projectId: string;
  locale: "es" | "en";
  title?: string;
  summary?: string;
  body: string;
  tags?: string[];
  media?: Media[];
  scheduledAt?: Date;
  authorId?: string;
  campaignId?: string;
};

export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

// Result utility functions for proper type handling
export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok === true;

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => result.ok === false;

export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (isOk(result)) return result.value;
  throw new Error("Attempted to unwrap Err result");
};

export const unwrapOr = <T, E>(result: Result<T, E>, defaultValue: T): T => {
  if (isOk(result)) return result.value;
  return defaultValue;
};

export const mapResult = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> => {
  if (isOk(result)) return ok(fn(result.value));
  return result;
};

export const mapErr = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> => {
  if (isErr(result)) return err(fn(result.error));
  return result;
};

// Threading support types
export type ThreadStrategy = "AUTO" | "MANUAL" | "SINGLE";
export type TweetStatus = "PENDING" | "PUBLISHING" | "PUBLISHED" | "FAILED";

export type TweetFragment = {
  sequence: number;
  text: string;
  media?: Media[];
  estimatedChars: number;
  threadIndicator?: string; // "1/5", "2/5", etc
};

export type ThreadPlan = {
  strategy: ThreadStrategy;
  tweets: TweetFragment[];
  totalChars: number;
  estimatedReach: number;
  needsThreading: boolean;
};

export type Tweet = {
  id: string;
  threadId: string;
  sequenceNumber: number;
  content: string;
  media?: Media[];
  tweetId?: string; // X's tweet ID after publishing
  parentTweetId?: string; // X's parent tweet ID for threading
  status: TweetStatus;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type Thread = {
  id: string;
  postId: string;
  strategy: ThreadStrategy;
  tweets: Tweet[];
  createdAt: Date;
  updatedAt: Date;
};

// Extended RenderedPost for threads
export type RenderedContent = {
  type: "single" | "thread";
  content: RenderedPost | ThreadPlan;
  meta?: Record<string, unknown>;
};

// Thread publishing types
export type ThreadPublishInput = {
  channelId: string;
  threadPlan: ThreadPlan;
  dedupeKey: string;
};

export type ThreadReceipt = {
  threadId: string;
  tweets: Array<{
    sequence: number;
    providerTweetId: string;
    url?: string;
    publishedAt: Date;
  }>;
  totalTweets: number;
};

// Error types for threading
export type ThreadError =
  | "CONTENT_TOO_LONG"
  | "INVALID_STRATEGY"
  | "MEDIA_DISTRIBUTION_FAILED"
  | "THREAD_PLANNING_FAILED";

export type RenderError = "UNSUPPORTED_MEDIA" | "TEXT_TOO_LONG" | "VALIDATION_ERROR" | ThreadError;

export type PublishError =
  | "RATE_LIMIT"
  | "NETWORK"
  | "AUTH"
  | "VALIDATION"
  | "THREAD_INTERRUPTED"
  | "PARENT_TWEET_FAILED";

// Provider and analytics types used across the platform

/** Provider names matching the Prisma Provider enum */
export type ProviderName =
  | "X"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "YOUTUBE"
  | "TIKTOK"
  | "SNAPCHAT"
  | "TELEGRAM"
  | "PINTEREST"
  | "LINKEDIN"
  | "BLUESKY"
  | "THREADS";

/** All provider names as a runtime array */
export const PROVIDER_NAMES: ProviderName[] = [
  "X",
  "INSTAGRAM",
  "FACEBOOK",
  "YOUTUBE",
  "TIKTOK",
  "LINKEDIN",
  "PINTEREST",
  "SNAPCHAT",
  "TELEGRAM",
  "BLUESKY",
  "THREADS",
];

/** Admin user roles — now DB-driven via the Role table */
export type AdminRole = string;

/** Subscription status matching the Prisma SubscriptionStatus enum */
export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "GRANDFATHERED";

/** Billing cycle matching the Prisma BillingCycle enum */
export type BillingCycle = "MONTHLY" | "YEARLY";

/** Plan type derived from AccountSubscription shape */
export type PlanType = "custom" | "bundle" | "none";

/** Domain-level analytics record for cross-platform analysis */
export interface DomainAnalytics {
  id: string;
  postId: string | null;
  channelId: string;
  provider: ProviderName;
  capturedAt: Date;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

/** Webhook event types matching the Prisma WebhookEventType enum */
export type WebhookEventType =
  | "POST_PUBLISHED"
  | "POST_UPDATED"
  | "POST_DELETED"
  | "POST_ENGAGEMENT_UPDATE"
  | "STORY_PUBLISHED"
  | "STORY_EXPIRED"
  | "REEL_PUBLISHED"
  | "LIKE_RECEIVED"
  | "COMMENT_RECEIVED"
  | "SHARE_RECEIVED"
  | "MENTION_RECEIVED"
  | "ACCOUNT_CONNECTED"
  | "ACCOUNT_DISCONNECTED"
  | "PERMISSION_CHANGED"
  | "RATE_LIMIT_REACHED"
  | "QUOTA_EXCEEDED"
  | "API_ERROR"
  | "VIDEO_PROCESSED"
  | "VIDEO_MONETIZED"
  | "LIVE_STREAM_STARTED"
  | "LIVE_STREAM_ENDED"
  | "MILESTONE_REACHED"
  | "VIRAL_CONTENT_DETECTED";
