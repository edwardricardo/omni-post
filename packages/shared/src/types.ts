/**
 * @file types.ts
 * @description Core domain types for the platform — canonical posts, rendered content, media,
 *              results, threads, tweets, accounts, subscriptions, and shared value objects.
 * @layer domain
 */
import { z } from "zod";

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

/**
 * The languages a post's content is written in: the ones the product supports end to end, from
 * the composer through the API and the AI prompts to the stored rows. Every layer derives its type,
 * its validation and its options from this list; supporting another language is one entry here,
 * plus prompts that hold for it. The interface language of a portal is a separate list, its routing.
 */
export const CONTENT_LOCALES = ["en", "es"] as const;

/** A content language, one of CONTENT_LOCALES. */
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

/**
 * @function isContentLocale
 * @description The one test of whether a value is a content language, for every value that
 *   arrives untyped: a stored row, a browser draft, a form field.
 * @param value - The value to test.
 * @returns True when the value is one of CONTENT_LOCALES.
 */
export function isContentLocale(value: unknown): value is ContentLocale {
  return CONTENT_LOCALES.some((locale) => locale === value);
}

/** The input schema of a content language: one of CONTENT_LOCALES, every other value refused. */
export const contentLocaleSchema = z.enum(CONTENT_LOCALES);

export type CanonicalPost = {
  id: string;
  projectId: string;
  locale: ContentLocale;
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

/**
 * @function ok
 * @description Wraps a success value in a Result.
 * @param value - The value.
 * @returns The Ok result holding it.
 */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/**
 * @function err
 * @description Wraps a failure in a Result.
 * @param error - The failure.
 * @returns The Err result holding it.
 */
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/**
 * @function isOk
 * @description Narrows a Result to its success arm.
 * @param result - The result to test.
 * @returns True when the result is Ok.
 */
export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok === true;

/**
 * @function isErr
 * @description Narrows a Result to its failure arm.
 * @param result - The result to test.
 * @returns True when the result is Err.
 */
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => result.ok === false;

/**
 * @function unwrap
 * @description Reads the value of a Result that must be Ok.
 * @param result - The result.
 * @returns Its value; an Err throws.
 */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (isOk(result)) return result.value;
  throw new Error("Attempted to unwrap Err result");
};

/**
 * @function unwrapOr
 * @description Reads the value of a Result, or a default when it is Err.
 * @param result - The result.
 * @param defaultValue - The value an Err yields.
 * @returns The Ok value, or the default.
 */
export const unwrapOr = <T, E>(result: Result<T, E>, defaultValue: T): T => {
  if (isOk(result)) return result.value;
  return defaultValue;
};

/**
 * @function mapResult
 * @description Transforms the value of an Ok result and passes an Err through.
 * @param result - The result.
 * @param fn - The transformation of the value.
 * @returns The transformed Ok, or the same Err.
 */
export const mapResult = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> => {
  if (isOk(result)) return ok(fn(result.value));
  return result;
};

/**
 * @function mapErr
 * @description Transforms the failure of an Err result and passes an Ok through.
 * @param result - The result.
 * @param fn - The transformation of the failure.
 * @returns The transformed Err, or the same Ok.
 */
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
  "CONTENT_TOO_LONG" | "INVALID_STRATEGY" | "MEDIA_DISTRIBUTION_FAILED" | "THREAD_PLANNING_FAILED";

export type RenderError = "UNSUPPORTED_MEDIA" | "TEXT_TOO_LONG" | "VALIDATION_ERROR" | ThreadError;

export type PublishError =
  "RATE_LIMIT" | "NETWORK" | "AUTH" | "VALIDATION" | "THREAD_INTERRUPTED" | "PARENT_TWEET_FAILED";

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

/**
 * @function isProviderName
 * @description Runtime type guard: narrows an arbitrary string to a canonical ProviderName.
 * @param value - The string to test.
 * @returns True when the string is one of PROVIDER_NAMES.
 */
export function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

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
