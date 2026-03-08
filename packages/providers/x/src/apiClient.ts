import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import client from "prom-client";
import { TwitterApi } from "twitter-api-v2";
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
   * Post a single tweet using twitter-api-v2 library
   */
  async postTweet(
    text: string,
    mediaIds: string[] = [],
    replyToTweetId?: string
  ): Promise<XTweetResponse> {
    const apiCall = async (): Promise<XTweetResponse> => {
      const tweetOptions: any = { text };

      if (mediaIds.length > 0) {
        tweetOptions.media = { media_ids: mediaIds };
      }

      if (replyToTweetId) {
        tweetOptions.reply = { in_reply_to_tweet_id: replyToTweetId };
      }

      const result = await this.twitterApi.v2.tweet(tweetOptions);

      return {
        data: {
          id: result.data.id,
          text: result.data.text,
          ...("author_id" in result.data && { author_id: (result.data as any).author_id }),
          ...("created_at" in result.data && { created_at: (result.data as any).created_at }),
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
      cacheEnabled: false, // Don't cache tweet posts
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
   * Get circuit breaker status for X API operations
   */
  getCircuitBreakerStatus(): Record<string, any> {
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
