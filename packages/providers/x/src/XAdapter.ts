/**
 * @file XAdapter.ts
 * @description X/Twitter provider adapter. Implements the ProviderAdapter port
 *   from @ports/core directly (no inheritance). Stateless w.r.t. credentials —
 *   credentials are passed per-call by the application layer. Supports tweet
 *   publishing, threading, media upload, polls, quote tweets, replies, and
 *   public-metrics analytics via twitter-api-v2.
 * @layer infrastructure
 */

import type {
  ProviderAdapter,
  ProviderId,
  ProviderLimits,
  PublishInput,
  PublishReceipt,
  ProviderComment,
  ProviderReplyResult,
} from "@ports/core";
import type {
  CanonicalPost,
  RenderedContent,
  ThreadPlan,
  ThreadPublishInput,
  ThreadReceipt,
  Result,
  RenderError,
  PublishError,
  ThreadError,
} from "@shared/types";
import { ok, err, type Err } from "@shared/types";
import {
  validateCredentialStructure,
  mapErrorToPublishError,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import pino, { type Logger } from "pino";
import { planThread } from "../../../core/threading/src/threadPlanner.js";
import { XApiClient, type XCredentials, type XPollOptions } from "./apiClient.js";

const REQUIRED_FIELDS: (keyof XCredentials)[] = ["apiKey", "apiSecret", "bearerToken"];

const X_LIMITS: ProviderLimits = {
  maxChars: 280,
  allowedMedia: ["image", "video", "gif"],
  aspectRatios: ["16:9", "1:1", "4:5", "9:16"],
  maxPostsPerThread: 25,
  maxMediaPerPost: 4,
  threadingSupported: true,
  rateLimitHints: { burst: 300, perSeconds: 10800 },
};

const X_METADATA: ProviderMetadata = {
  id: "x",
  name: "x",
  displayName: "X (Twitter)",
  description: "Post tweets and threads to X (formerly Twitter)",
  icon: "/providers/x-icon.svg",
  color: "#000000",
  website: "https://x.com",
  authType: "oauth",
  requiredScopes: ["tweet.read", "tweet.write", "users.read"],
  status: "active",
};

const X_CAPABILITIES = {
  publish: true,
  schedule: true,
  analytics: true,
  comments: true,
  replies: true,
  threading: true,
  media: true,
  images: true,
  videos: true,
};

/**
 * Factory for creating XApiClient instances. Injected so tests can supply a
 * fake. Defaults to constructing a real `XApiClient`.
 */
export type XApiClientFactory = (credentials: XCredentials) => XApiClient;

const defaultClientFactory: XApiClientFactory = (credentials) => new XApiClient(credentials);

export interface XAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
  /** Factory that constructs an XApiClient given credentials. Default: real client. */
  apiClientFactory?: XApiClientFactory;
}

/**
 * @class XAdapter
 * @description Provider adapter for publishing tweets, threads, media, polls,
 *   quote tweets, and replies to X (formerly Twitter) via twitter-api-v2.
 */
export class XAdapter implements ProviderAdapter {
  readonly id: ProviderId = "x";
  readonly limits: ProviderLimits = X_LIMITS;
  readonly capabilities = X_CAPABILITIES;
  readonly metadata: ProviderMetadata = X_METADATA;
  readonly constraints: ProviderConstraints = {};

  private readonly logger: Logger;
  private readonly apiClientFactory: XApiClientFactory;

  constructor(deps: XAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "x-adapter", level: "info" });
    this.apiClientFactory = deps.apiClientFactory ?? defaultClientFactory;
  }

  /**
   * @method render
   * @description Renders canonical post for X/Twitter. Detects poll tags
   *   (poll:DURATION:question|option1|option2|...) and quote tweet references.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    const pollConfig = this.parsePollTag(canonical.tags);

    const threadPlan = planThread(canonical, "AUTO", {
      ...(this.limits.maxChars && { maxCharsPerTweet: this.limits.maxChars }),
      ...(this.limits.maxPostsPerThread && {
        maxTweetsPerThread: this.limits.maxPostsPerThread,
      }),
      ...(this.limits.maxMediaPerPost && { maxMediaPerTweet: this.limits.maxMediaPerPost }),
    });

    if (!threadPlan.ok) {
      return err((threadPlan as Err<ThreadError>).error);
    }

    if (threadPlan.value.needsThreading) {
      return ok({
        type: "thread",
        content: threadPlan.value,
        meta: {
          estimatedReach: threadPlan.value.estimatedReach,
          ...(pollConfig ? { poll: pollConfig } : {}),
        },
      });
    }

    const singleTweet = threadPlan.value.tweets[0];
    if (!singleTweet) {
      return err("THREAD_PLANNING_FAILED");
    }

    const quoteTweetId = this.parseQuoteTweetTag(canonical.tags);

    return ok({
      type: "single",
      content: {
        body: singleTweet.text,
        ...(canonical.media &&
          canonical.media.length > 0 && {
            media: canonical.media.map((m) => ({
              url: m.url,
              type: m.type,
              ...(m.alt && { alt: m.alt }),
            })),
          }),
        meta: {
          sequence: 1,
          totalTweets: 1,
          ...(pollConfig ? { poll: pollConfig } : {}),
          ...(quoteTweetId ? { quoteTweetId } : {}),
        },
      },
      meta: {},
    });
  }

  /**
   * @method planThread
   * @description Plans a thread structure for the canonical post given the
   *   provider's char/post limits.
   */
  planThread(canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return planThread(canonical, "AUTO", {
      ...(this.limits.maxChars && { maxCharsPerTweet: this.limits.maxChars }),
      ...(this.limits.maxPostsPerThread && {
        maxTweetsPerThread: this.limits.maxPostsPerThread,
      }),
      ...(this.limits.maxMediaPerPost && { maxMediaPerTweet: this.limits.maxMediaPerPost }),
    });
  }

  /**
   * @method validateCredentials
   * @description Verifies credential structure and that the API accepts them
   *   via the v2/users/me endpoint.
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<XCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH_INVALID");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);
      await apiClient.validateCredentials();
      return ok(undefined);
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "validateCredentials",
        error: error instanceof Error ? error.message : String(error),
      });

      if (
        error instanceof Error &&
        "status" in error &&
        (error as Record<string, unknown>).status === 401
      ) {
        return err("AUTH_EXPIRED");
      }

      return err("AUTH_INVALID");
    }
  }

  /**
   * @method publish
   * @description Publishes a single tweet. Supports media, polls, and quote
   *   tweets via the meta payload.
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<XCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);

      const mediaIds: string[] = [];
      if (input.post.media && input.post.media.length > 0) {
        for (const media of input.post.media) {
          const uploadResult = await apiClient.uploadMedia(media.url);
          mediaIds.push(uploadResult.media_id_string);
        }
      }

      const meta = (input.post.meta || {}) as Record<string, unknown>;
      const pollConfig = meta.poll as XPollOptions | undefined;
      const quoteTweetId = typeof meta.quoteTweetId === "string" ? meta.quoteTweetId : undefined;

      const result = await apiClient.postTweet(
        input.post.body,
        mediaIds,
        undefined,
        pollConfig,
        quoteTweetId
      );

      return ok({
        providerPostId: result.data.id,
        url: `https://x.com/i/status/${result.data.id}`,
        publishedAt: new Date(result.data.created_at || new Date().toISOString()),
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "publish",
        channelId: input.channelId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * @method publishThread
   * @description Publishes a multi-tweet thread by chaining each tweet as a
   *   reply to the previous one.
   */
  async publishThread(
    input: ThreadPublishInput,
    credentials: unknown
  ): Promise<Result<ThreadReceipt, PublishError>> {
    const validation = validateCredentialStructure<XCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    const publishedTweets: ThreadReceipt["tweets"] = [];
    let parentTweetId: string | null = null;

    try {
      const apiClient = this.apiClientFactory(validation.value);

      for (const tweetFragment of input.threadPlan.tweets) {
        const mediaIds: string[] = [];
        if (tweetFragment.media && tweetFragment.media.length > 0) {
          for (const media of tweetFragment.media) {
            const uploadResult = await apiClient.uploadMedia(media.url);
            mediaIds.push(uploadResult.media_id_string);
          }
        }

        const result = await apiClient.postTweet(
          tweetFragment.text,
          mediaIds,
          parentTweetId || undefined
        );

        publishedTweets.push({
          sequence: tweetFragment.sequence,
          providerTweetId: result.data.id,
          url: `https://x.com/i/status/${result.data.id}`,
          publishedAt: new Date(result.data.created_at || new Date().toISOString()),
        });

        parentTweetId = result.data.id;

        if (tweetFragment.sequence < input.threadPlan.tweets.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      return ok({
        threadId: input.dedupeKey,
        tweets: publishedTweets,
        totalTweets: publishedTweets.length,
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "publishThread",
        channelId: input.channelId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (
        publishedTweets.length > 0 &&
        error instanceof Error &&
        "status" in error &&
        (error as Error & { status: number }).status >= 400 &&
        (error as Error & { status: number }).status < 500
      ) {
        return err("THREAD_INTERRUPTED");
      }

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * @method fetchAnalytics
   * @description Fetches analytics from X API v2 using public_metrics and maps
   *   them to canonical engagement counters.
   */
  async fetchAnalytics(
    q: { channelId: string; since?: Date; until?: Date },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<XCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);

      const userResponse = await apiClient.validateCredentials();
      const userId = userResponse.data.id;

      const tweetsResponse = await apiClient.getTweetAnalytics([userId]);

      let totalLikes = 0;
      let totalRetweets = 0;
      let totalReplies = 0;
      let totalQuotes = 0;

      for (const tweet of tweetsResponse.data) {
        totalLikes += tweet.public_metrics.like_count;
        totalRetweets += tweet.public_metrics.retweet_count;
        totalReplies += tweet.public_metrics.reply_count;
        totalQuotes += tweet.public_metrics.quote_count;
      }

      return ok({
        channelId: q.channelId,
        ...(q.since && { since: q.since }),
        ...(q.until && { until: q.until }),
        metrics: {
          views: totalLikes + totalRetweets + totalReplies + totalQuotes,
          likes: totalLikes,
          shares: totalRetweets + totalQuotes,
          comments: totalReplies,
        },
        tweetCount: tweetsResponse.data.length,
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "fetchAnalytics",
        channelId: q.channelId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      if (
        error instanceof Error &&
        (error.message?.includes("401") || error.message?.includes("403"))
      ) {
        return err("AUTH");
      }

      return err("NETWORK");
    }
  }

  // ----------------------------------------------------------
  // Social Inbox: getComments & postReply
  // ----------------------------------------------------------

  /**
   * @method getComments
   * @description Fetches replies to a tweet via conversation_id search.
   *              Requires X API Basic tier ($100/mo) or higher.
   */
  async getComments(params: {
    channelCredentials: unknown;
    postExternalId?: string;
    since?: Date;
    cursor?: string;
    limit?: number;
  }): Promise<Result<{ comments: ProviderComment[]; nextCursor?: string }, "AUTH" | "NETWORK">> {
    if (!params.postExternalId) {
      return ok({ comments: [] });
    }

    try {
      const credentials = params.channelCredentials as XCredentials;
      const apiClient = this.apiClientFactory(credentials);

      const result = await apiClient.searchReplies(
        params.postExternalId,
        params.limit || 20,
        params.cursor
      );

      const comments: ProviderComment[] = result.data.map((tweet) => ({
        providerMessageId: tweet.id,
        authorName: tweet.author_id || "unknown",
        authorProviderId: tweet.author_id || "unknown",
        body: tweet.text,
        createdAt: tweet.created_at ? new Date(tweet.created_at) : new Date(),
        ...(tweet.in_reply_to_user_id ? { providerParentId: tweet.in_reply_to_user_id } : {}),
      }));

      return ok({
        comments,
        ...(result.meta?.next_token ? { nextCursor: result.meta.next_token } : {}),
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "getComments",
        error: error instanceof Error ? error.message : String(error),
      });

      if (
        error instanceof Error &&
        (error.message?.includes("401") || error.message?.includes("403"))
      ) {
        return err("AUTH");
      }

      return err("NETWORK");
    }
  }

  /**
   * @method postReply
   * @description Posts a reply to a tweet via postTweet with replyToTweetId.
   */
  async postReply(params: {
    channelCredentials: unknown;
    inReplyToProviderMessageId: string;
    body: string;
  }): Promise<Result<ProviderReplyResult, "AUTH" | "NETWORK" | "RATE_LIMIT">> {
    try {
      const credentials = params.channelCredentials as XCredentials;
      const apiClient = this.apiClientFactory(credentials);

      const result = await apiClient.postTweet(params.body, [], params.inReplyToProviderMessageId);

      return ok({
        providerReplyId: result.data.id,
        createdAt: new Date(result.data.created_at || new Date().toISOString()),
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "postReply",
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message?.includes("429")) {
        return err("RATE_LIMIT");
      }

      if (
        error instanceof Error &&
        (error.message?.includes("401") || error.message?.includes("403"))
      ) {
        return err("AUTH");
      }

      return err("NETWORK");
    }
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  /**
   * @method parsePollTag
   * @description Parses poll configuration from canonical post tags.
   *              Format: "poll:DURATION_MINUTES:question|option1|option2|..."
   */
  private parsePollTag(tags?: string[]): XPollOptions | undefined {
    if (!tags) return undefined;

    const pollTag = tags.find((t) => t.startsWith("poll:"));
    if (!pollTag) return undefined;

    const parts = pollTag.split(":");
    if (parts.length < 3) return undefined;

    const durationStr = parts[1];
    const questionAndOptions = parts.slice(2).join(":");
    const segments = questionAndOptions.split("|");

    if (!durationStr || segments.length < 3) return undefined;

    const durationMinutes = parseInt(durationStr, 10);
    if (isNaN(durationMinutes) || durationMinutes < 5 || durationMinutes > 10080) {
      return undefined;
    }

    const options = segments.slice(1).filter((o) => o.trim().length > 0);
    if (options.length < 2 || options.length > 4) return undefined;

    return { options, durationMinutes };
  }

  /**
   * @method parseQuoteTweetTag
   * @description Extracts quote tweet ID from canonical post tags.
   *              Format: "quote:TWEET_ID"
   */
  private parseQuoteTweetTag(tags?: string[]): string | undefined {
    if (!tags) return undefined;

    const quoteTag = tags.find((t) => t.startsWith("quote:"));
    if (!quoteTag) return undefined;

    const tweetId = quoteTag.slice("quote:".length);
    return tweetId.length > 0 ? tweetId : undefined;
  }
}

/**
 * @function createXAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger, optional apiClient factory for tests).
 */
export function createXAdapter(deps: XAdapterDeps = {}): XAdapter {
  return new XAdapter(deps);
}
