/**
 * X/Twitter Provider Adapter (Class-based)
 *
 * Extends AbstractProviderAdapter with X/Twitter-specific implementation.
 * This replaces the object literal pattern with a cleaner class-based approach.
 */

import {
  AbstractProviderAdapter,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import type { ProviderId, ProviderLimits, PublishInput, PublishReceipt } from "@ports/core";
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
import type { ProviderComment, ProviderReplyResult } from "@ports/core";
import { planThread } from "../../../core/threading/src/threadPlanner.js";
import { XApiClient, type XCredentials, type XPollOptions } from "./apiClient.js";

/**
 * X/Twitter Provider Adapter
 */
export class XAdapter extends AbstractProviderAdapter<XCredentials> {
  readonly id: ProviderId = "x";

  readonly metadata: ProviderMetadata = {
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

  readonly constraints: ProviderConstraints = {};

  readonly limits: ProviderLimits = {
    maxChars: 280,
    allowedMedia: ["image", "video", "gif"],
    aspectRatios: ["16:9", "1:1", "4:5", "9:16"],
    maxPostsPerThread: 25,
    maxMediaPerPost: 4,
    threadingSupported: true,
    rateLimitHints: { burst: 300, perSeconds: 10800 }, // 300 tweets per 3 hours
  };

  readonly capabilities = {
    publish: true,
    schedule: true,
    analytics: true,
    comments: true,
    replies: true,
    threading: true,
    media: true, // Supports media uploads
    images: true, // Supports images
    videos: true, // Supports videos
  };

  protected readonly requiredCredentialFields: (keyof XCredentials)[] = [
    "apiKey",
    "apiSecret",
    "bearerToken",
  ];

  /**
   * Get credentials from environment variables
   */
  protected getCredentialsFromEnvironment(): Result<XCredentials, "AUTH"> {
    const credentials: XCredentials = {
      apiKey: process.env.X_API_KEY || "placeholder",
      apiSecret: process.env.X_API_SECRET || "placeholder",
      accessToken: process.env.X_ACCESS_TOKEN || "placeholder",
      accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET || "placeholder",
      bearerToken: process.env.X_BEARER_TOKEN || "placeholder",
    };

    if (credentials.apiKey === "placeholder" || credentials.bearerToken === "placeholder") {
      return err("AUTH");
    }

    return ok(credentials);
  }

  /**
   * Create X API client
   */
  protected createApiClient(credentials: XCredentials): XApiClient {
    return new XApiClient(credentials);
  }

  /**
   * @method render
   * @description Renders canonical post for X/Twitter.
   *              Detects poll tags (poll:DURATION:question|option1|option2|...)
   *              and quote tweet references.
   */
  override render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    // Detect poll tag
    const pollConfig = this.parsePollTag(canonical.tags);

    // Check if content needs threading
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

    // Return appropriate rendered content
    if (threadPlan.value.needsThreading) {
      return ok({
        type: "thread",
        content: threadPlan.value,
        meta: {
          estimatedReach: threadPlan.value.estimatedReach,
          ...(pollConfig ? { poll: pollConfig } : {}),
        },
      });
    } else {
      // Single tweet
      const singleTweet = threadPlan.value.tweets[0];
      if (!singleTweet) {
        return err("THREAD_PLANNING_FAILED");
      }

      // Detect quote tweet reference from tags
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
  }

  /**
   * Plan thread for X/Twitter
   */
  override planThread(canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return planThread(canonical, "AUTO", {
      ...(this.limits.maxChars && { maxCharsPerTweet: this.limits.maxChars }),
      ...(this.limits.maxPostsPerThread && {
        maxTweetsPerThread: this.limits.maxPostsPerThread,
      }),
      ...(this.limits.maxMediaPerPost && { maxMediaPerTweet: this.limits.maxMediaPerPost }),
    });
  }

  /**
   * @method publish
   * @description Publishes a single tweet. Supports media, polls, and quote tweets.
   */
  override async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    const credentials = await this.getCredentials(input.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);

      // Upload media
      const mediaIds: string[] = [];
      if (input.post.media && input.post.media.length > 0) {
        for (const media of input.post.media) {
          const uploadResult = await apiClient.uploadMedia(media.url);
          mediaIds.push(uploadResult.media_id_string);
        }
      }

      // Extract poll and quote tweet from meta
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
      this.logError("publish", error, { channelId: input.channelId });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Publish thread
   */
  override async publishThread(
    input: ThreadPublishInput
  ): Promise<Result<ThreadReceipt, PublishError>> {
    // Get credentials using base class method
    const credentials = await this.getCredentials(input.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    const publishedTweets: ThreadReceipt["tweets"] = [];
    let parentTweetId: string | null = null;

    try {
      const apiClient = this.createApiClient(credentials.value);

      // Publish each tweet in sequence
      for (const tweetFragment of input.threadPlan.tweets) {
        // Upload media for this tweet
        const mediaIds: string[] = [];
        if (tweetFragment.media && tweetFragment.media.length > 0) {
          for (const media of tweetFragment.media) {
            const uploadResult = await apiClient.uploadMedia(media.url);
            mediaIds.push(uploadResult.media_id_string);
          }
        }

        // Post the tweet with circuit breaker protection
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

        // Set this tweet as parent for the next one
        parentTweetId = result.data.id;

        // Small delay between tweets to respect rate limits
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
      this.logError("publishThread", error, { channelId: input.channelId });

      // If we fail mid-thread, this could be partially published
      if (
        publishedTweets.length > 0 &&
        error instanceof Error &&
        "status" in error &&
        (error as Error & { status: number }).status >= 400 &&
        (error as Error & { status: number }).status < 500
      ) {
        return err("THREAD_INTERRUPTED");
      }

      // Handle circuit breaker specific error
      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Fetch analytics from X API v2 using public_metrics.
   *
   * Maps X metrics to canonical format:
   * - views = impression_count (not available in public_metrics, estimated from engagement)
   * - likes = like_count
   * - shares = retweet_count + quote_count
   * - comments = reply_count
   */
  override async fetchAnalytics(q: {
    channelId: string;
    since?: Date;
    until?: Date;
  }): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const credentials = await this.getCredentials(q.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);

      // Use the user's tweets endpoint to get recent tweets with metrics
      const userResponse = await apiClient.validateCredentials();
      const userId = userResponse.data.id;

      // Fetch user's recent tweets with public metrics via twitter-api-v2
      const tweetsResponse = await apiClient.getTweetAnalytics([userId]);

      // Aggregate metrics across all tweets
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
          views: totalLikes + totalRetweets + totalReplies + totalQuotes, // Estimated engagement
          likes: totalLikes,
          shares: totalRetweets + totalQuotes,
          comments: totalReplies,
        },
        tweetCount: tweetsResponse.data.length,
      });
    } catch (error: unknown) {
      this.logError("fetchAnalytics", error, { channelId: q.channelId });

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
   * @param params - Query parameters including channelCredentials and postExternalId
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
      const apiClient = this.createApiClient(credentials);

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
      this.logError("getComments", error);

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
   * @description Posts a reply to a tweet using the existing postTweet method
   *              with replyToTweetId parameter.
   * @param params - Reply parameters including credentials, tweet ID, and body
   */
  async postReply(params: {
    channelCredentials: unknown;
    inReplyToProviderMessageId: string;
    body: string;
  }): Promise<Result<ProviderReplyResult, "AUTH" | "NETWORK" | "RATE_LIMIT">> {
    try {
      const credentials = params.channelCredentials as XCredentials;
      const apiClient = this.createApiClient(credentials);

      const result = await apiClient.postTweet(params.body, [], params.inReplyToProviderMessageId);

      return ok({
        providerReplyId: result.data.id,
        createdAt: new Date(result.data.created_at || new Date().toISOString()),
      });
    } catch (error: unknown) {
      this.logError("postReply", error);

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

    if (!durationStr || segments.length < 3) return undefined; // question + at least 2 options

    const durationMinutes = parseInt(durationStr, 10);
    if (isNaN(durationMinutes) || durationMinutes < 5 || durationMinutes > 10080) {
      return undefined; // X polls: 5 minutes to 7 days
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

// Export singleton instance for backward compatibility
export const xAdapter = new XAdapter();
