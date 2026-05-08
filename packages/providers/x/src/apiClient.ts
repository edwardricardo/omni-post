/**
 * @file apiClient.ts
 * @description X/Twitter API client wrapping twitter-api-v2 with circuit breaker protection,
 *              fallback strategies, and metric instrumentation for tweets and media uploads.
 * @layer infrastructure
 */
import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import client from "prom-client";
import { TwitterApi, type SendTweetV2Params, type TweetV2 } from "twitter-api-v2";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:x:api-client");

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  bearerToken: string;
  [key: string]: string | undefined;
}

export interface XTweetResponse {
  data: {
    id: string;
    text: string;
    author_id?: string;
    created_at?: string;
  };
}

export interface XUploadResponse {
  media_id_string: string;
  media_id: number;
  size: number;
  media_key: string;
}

export interface XUserResponse {
  data: {
    id: string;
    name: string;
    username: string;
  };
}

export interface XAnalyticsResponse {
  data: Array<{
    id: string;
    public_metrics: {
      retweet_count: number;
      like_count: number;
      reply_count: number;
      quote_count: number;
    };
  }>;
}

export interface XSearchReplyResult {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  in_reply_to_user_id?: string;
  conversation_id?: string;
}

export interface XSearchRepliesResponse {
  data: XSearchReplyResult[];
  meta?: {
    next_token?: string;
    result_count: number;
  };
}

export interface XPollOptions {
  options: string[];
  durationMinutes: number;
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class XApiClient {
  private credentials: XCredentials;
  private twitterApi: TwitterApi;

  constructor(credentials: XCredentials) {
    this.credentials = credentials;

    // Initialize Twitter API v2 client with OAuth 2.0 Bearer token
    this.twitterApi = new TwitterApi(credentials.bearerToken);
  }

  /**
   * Validate credentials by calling the /2/users/me endpoint using twitter-api-v2
   */
  async validateCredentials(): Promise<XUserResponse> {
    const apiCall = async (): Promise<XUserResponse> => {
      const user = await this.twitterApi.v2.me();
      return {
        data: {
          id: user.data.id,
          name: user.data.name,
          username: user.data.username,
        },
      };
    };

    return circuitBreaker.call("x-api", "validate-credentials", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000, // 5 minutes cache
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  /**
   * @method postTweet
   * @description Posts a single tweet using twitter-api-v2 library.
   *              Supports media attachments, replies, polls, and quote tweets.
   * @param text - The tweet text
   * @param mediaIds - Optional array of uploaded media IDs
   * @param replyToTweetId - Optional tweet ID to reply to
   * @param poll - Optional poll configuration (2-4 options, duration in minutes)
   * @param quoteTweetId - Optional tweet ID to quote
   */
  async postTweet(
    text: string,
    mediaIds: string[] = [],
    replyToTweetId?: string,
    poll?: XPollOptions,
    quoteTweetId?: string
  ): Promise<XTweetResponse> {
    const apiCall = async (): Promise<XTweetResponse> => {
      const tweetOptions: SendTweetV2Params = { text };

      if (mediaIds.length > 0) {
        tweetOptions.media = {
          media_ids: mediaIds as
            | [string]
            | [string, string]
            | [string, string, string]
            | [string, string, string, string],
        };
      }

      if (replyToTweetId) {
        tweetOptions.reply = { in_reply_to_tweet_id: replyToTweetId };
      }

      if (poll) {
        tweetOptions.poll = {
          options: poll.options,
          duration_minutes: poll.durationMinutes,
        };
      }

      if (quoteTweetId) {
        tweetOptions.quote_tweet_id = quoteTweetId;
      }

      const result = await this.twitterApi.v2.tweet(tweetOptions);
      const tweetData = result.data as TweetV2;

      return {
        data: {
          id: tweetData.id,
          text: tweetData.text,
          ...(tweetData.author_id ? { author_id: tweetData.author_id } : {}),
          ...(tweetData.created_at ? { created_at: tweetData.created_at } : {}),
        },
      };
    };

    return circuitBreaker.call("x-api", "post-tweet", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.SOCIAL_POST_FALLBACK,
    });
  }

  /**
   * Upload media file using modern X API v2 media upload
   */
  async uploadMedia(mediaUrl: string): Promise<XUploadResponse> {
    const apiCall = async (): Promise<XUploadResponse> => {
      // First, fetch the media from the URL
      const mediaResponse = await fetch(mediaUrl);
      if (!mediaResponse.ok) {
        throw new Error(
          `Failed to fetch media: ${mediaResponse.status} ${mediaResponse.statusText}`
        );
      }

      const mediaBuffer = await mediaResponse.arrayBuffer();
      const mediaType = mediaResponse.headers.get("content-type") || "image/jpeg";

      // Upload using twitter-api-v2 library (automatically handles v2 endpoints)
      const mediaId = await this.twitterApi.v1.uploadMedia(Buffer.from(mediaBuffer), {
        mimeType: mediaType,
      });

      return {
        media_id_string: mediaId,
        media_id: parseInt(mediaId, 10),
        size: mediaBuffer.byteLength,
        media_key: `7_${mediaId}`, // Standard format for v2
      };
    };

    return circuitBreaker.call("x-api", "upload-media", apiCall, [], {
      timeout: 60000, // 60 seconds for media upload
      errorThresholdPercentage: 70,
      resetTimeout: 90000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 15000,
      jitterEnabled: true,
      cacheEnabled: false, // Don't cache media uploads
      fallbackEnabled: false, // Media uploads shouldn't fallback
    });
  }

  /**
   * Get tweet analytics using twitter-api-v2 library
   */
  async getTweetAnalytics(tweetIds: string[]): Promise<XAnalyticsResponse> {
    const apiCall = async (): Promise<XAnalyticsResponse> => {
      const tweets = await this.twitterApi.v2.tweets(tweetIds, {
        "tweet.fields": ["public_metrics", "created_at"],
      });

      return {
        data: tweets.data.map((tweet) => ({
          id: tweet.id,
          public_metrics: {
            retweet_count: tweet.public_metrics?.retweet_count || 0,
            like_count: tweet.public_metrics?.like_count || 0,
            reply_count: tweet.public_metrics?.reply_count || 0,
            quote_count: tweet.public_metrics?.quote_count || 0,
          },
        })),
      };
    };

    const fallbackResponse: XAnalyticsResponse = {
      data: tweetIds.map((id) => ({
        id,
        public_metrics: {
          retweet_count: 0,
          like_count: 0,
          reply_count: 0,
          quote_count: 0,
        },
      })),
    };

    const fallback = async (): Promise<XAnalyticsResponse> => {
      logger.warn("Using fallback response for X Analytics");
      return fallbackResponse;
    };

    return circuitBreaker.call("x-api", "get-analytics", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000, // 5 minutes cache for analytics
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
      fallback,
    });
  }

  /**
   * Delete a tweet using twitter-api-v2 library
   */
  async deleteTweet(tweetId: string): Promise<{ data: { deleted: boolean } }> {
    const apiCall = async (): Promise<{ data: { deleted: boolean } }> => {
      const result = await this.twitterApi.v2.deleteTweet(tweetId);
      return {
        data: {
          deleted: result.data.deleted,
        },
      };
    };

    return circuitBreaker.call("x-api", "delete-tweet", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false, // Don't cache delete operations
      fallbackEnabled: false, // Delete operations shouldn't fallback
    });
  }

  /**
   * @method searchReplies
   * @description Searches for replies to a tweet using conversation_id.
   *              Uses GET /2/tweets/search/recent with query `conversation_id:{tweetId}`.
   *              Requires Basic tier ($100/mo) or higher.
   * @param tweetId - The tweet ID to find replies for
   * @param maxResults - Maximum number of results (10-100, default 20)
   * @param nextToken - Pagination token from a previous response
   */
  async searchReplies(
    tweetId: string,
    maxResults: number = 20,
    nextToken?: string
  ): Promise<XSearchRepliesResponse> {
    const apiCall = async (): Promise<XSearchRepliesResponse> => {
      const query = `conversation_id:${tweetId}`;
      const searchResult = await this.twitterApi.v2.search(query, {
        max_results: Math.min(Math.max(maxResults, 10), 100),
        "tweet.fields": ["author_id", "created_at", "in_reply_to_user_id", "conversation_id"],
        ...(nextToken ? { next_token: nextToken } : {}),
      });

      const tweets: XSearchReplyResult[] = (searchResult.data.data || []).map((tweet: TweetV2) => ({
        id: tweet.id,
        text: tweet.text,
        ...(tweet.author_id ? { author_id: tweet.author_id } : {}),
        ...(tweet.created_at ? { created_at: tweet.created_at } : {}),
        ...(tweet.in_reply_to_user_id ? { in_reply_to_user_id: tweet.in_reply_to_user_id } : {}),
        ...(tweet.conversation_id ? { conversation_id: tweet.conversation_id } : {}),
      }));

      return {
        data: tweets,
        ...(searchResult.data.meta
          ? {
              meta: {
                result_count: searchResult.data.meta.result_count,
                ...(searchResult.data.meta.next_token
                  ? { next_token: searchResult.data.meta.next_token }
                  : {}),
              },
            }
          : {}),
      };
    };

    return circuitBreaker.call("x-api", "search-replies", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 60000,
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  /**
   * @method getCircuitBreakerStatus
   * @description Returns the current state of all X API circuit breakers.
   */
  getCircuitBreakerStatus(): Record<string, unknown> {
    return circuitBreaker.getAllStatuses();
  }

  /**
   * Get API metrics registry for monitoring
   */
  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  /**
   * Clear API cache
   */
  clearCache(): void {
    circuitBreaker.clearCache("x-api");
    circuitBreaker.clearCache("media-fetch");
  }

  /**
   * Force circuit breaker state (for testing/emergency)
   */
  forceCircuitBreakerOpen(operation: string): boolean {
    return circuitBreaker.forceOpen("x-api", operation);
  }

  forceCircuitBreakerClose(operation: string): boolean {
    return circuitBreaker.forceClose("x-api", operation);
  }
}
