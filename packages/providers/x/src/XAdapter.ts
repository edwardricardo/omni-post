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
import { planThread } from "../../../core/threading/src/threadPlanner.js";
import { XApiClient, type XCredentials } from "./apiClient.js";

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
    analytics: false,
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
   * Render canonical post for X/Twitter
   */
  override render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
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
        meta: { estimatedReach: threadPlan.value.estimatedReach },
      });
    } else {
      // Single tweet
      const singleTweet = threadPlan.value.tweets[0];
      if (!singleTweet) {
        return err("THREAD_PLANNING_FAILED");
      }
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
          meta: { sequence: 1, totalTweets: 1 },
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
   * Publish single tweet
   */
  override async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    // Get credentials using base class method
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

      // Post tweet with circuit breaker protection
      const result = await apiClient.postTweet(input.post.body, mediaIds);

      return ok({
        providerPostId: result.data.id,
        url: `https://x.com/i/status/${result.data.id}`,
        publishedAt: new Date(result.data.created_at || new Date().toISOString()),
      });
    } catch (error: unknown) {
      this.logError("publish", error, { channelId: input.channelId });

      // Handle circuit breaker specific error
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
        (error as any).status >= 400 &&
        (error as any).status < 500
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
   * Fetch analytics
   */
  // Future: X Analytics via API v2
  // Implement using GET /2/tweets/:id with tweet.fields=public_metrics,organic_metrics
  // Requires OAuth 2.0 with tweet.read scope and elevated access level.
  // Aggregate impressions, engagements, likes, retweets, replies, profile_clicks
  // from real tweet metrics returned by the X API.
}

// Export singleton instance for backward compatibility
export const xAdapter = new XAdapter();
