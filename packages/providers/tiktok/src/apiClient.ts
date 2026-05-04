/**
 * @file apiClient.ts
 * @description TikTok main API client orchestrating marketing, research, content analytics,
 *              auth, video processing, and hashtag helpers with circuit breaker protection.
 * @layer infrastructure
 */
import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import { ProviderError } from "@providers/shared";
import * as client from "prom-client";
import axios from "axios";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:tiktok:api-client");
import FormData from "form-data";
import type { TikTokMarketingApiClient } from "./marketingApiClient.js";
import type { TikTokResearchApiClient } from "./researchApiClient.js";
import type { TikTokContentAnalyticsClient } from "./contentAnalyticsClient.js";
import type { TikTokAuthService } from "./authService.js";
import type { TikTokVideoProcessor } from "./videoProcessor.js";
import type { TikTokHashtagManager } from "./hashtagManager.js";

// Re-export shared types so existing consumers can continue importing from here
export type {
  TikTokCredentials,
  TikTokVideoUploadRequest,
  TikTokUploadResponse,
  TikTokUserInfoResponse,
  TikTokVideoListResponse,
} from "./tiktokTypes.js";

import type {
  TikTokCredentials,
  TikTokVideoUploadRequest,
  TikTokUploadResponse,
  TikTokUserInfoResponse,
  TikTokVideoListResponse,
} from "./tiktokTypes.js";

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

const TIKTOK_BASE_URL = "https://open.tiktokapis.com/v2";

export class TikTokApiClient {
  private credentials: TikTokCredentials;
  private marketingClient?: TikTokMarketingApiClient;
  private researchClient?: TikTokResearchApiClient;
  private analyticsClient?: TikTokContentAnalyticsClient;
  private authService?: TikTokAuthService;
  private videoProcessor?: TikTokVideoProcessor;
  private hashtagManager?: TikTokHashtagManager;

  constructor(credentials: TikTokCredentials) {
    this.credentials = credentials;
  }

  /**
   * Get marketing API client instance
   */
  getMarketingClient(): TikTokMarketingApiClient {
    if (!this.marketingClient) {
      const { TikTokMarketingApiClient } = require("./marketingApiClient.js");
      this.marketingClient = new TikTokMarketingApiClient({
        ...this.credentials,
        advertiserAccountId: process.env.TIKTOK_ADVERTISER_ID || "",
      });
    }
    return this.marketingClient!;
  }

  /**
   * Get research API client instance
   */
  getResearchClient(): TikTokResearchApiClient {
    if (!this.researchClient) {
      const { TikTokResearchApiClient } = require("./researchApiClient.js");
      this.researchClient = new TikTokResearchApiClient({
        ...this.credentials,
      });
    }
    return this.researchClient!;
  }

  /**
   * Get content analytics client instance
   */
  getAnalyticsClient(): TikTokContentAnalyticsClient {
    if (!this.analyticsClient) {
      const { TikTokContentAnalyticsClient } = require("./contentAnalyticsClient.js");
      this.analyticsClient = new TikTokContentAnalyticsClient({
        ...this.credentials,
      });
    }
    return this.analyticsClient!;
  }

  /**
   * Get auth service instance
   */
  getAuthService(): TikTokAuthService {
    if (!this.authService) {
      const { TikTokAuthService } = require("./authService.js");
      this.authService = new TikTokAuthService({
        clientKey: this.credentials.clientKey,
        clientSecret: this.credentials.clientSecret,
        redirectUri: process.env.TIKTOK_REDIRECT_URI || "",
        scopes: ["user.info.basic", "video.upload", "video.publish"],
      });
    }
    return this.authService!;
  }

  /**
   * Get video processor instance
   */
  getVideoProcessor(): TikTokVideoProcessor {
    if (!this.videoProcessor) {
      const { TikTokVideoProcessor } = require("./videoProcessor.js");
      this.videoProcessor = new TikTokVideoProcessor();
    }
    return this.videoProcessor!;
  }

  /**
   * Get hashtag manager instance
   */
  getHashtagManager(): TikTokHashtagManager {
    if (!this.hashtagManager) {
      const { TikTokHashtagManager } = require("./hashtagManager.js");
      this.hashtagManager = new TikTokHashtagManager(this.getResearchClient());
    }
    return this.hashtagManager!;
  }

  // Future: getSoundManager()
  // TikTok Sound API endpoints are not available in the public API.
  // Requires: TikTok Sound API access.

  /**
   * Validate credentials by fetching user info
   */
  async validateCredentials(): Promise<TikTokUserInfoResponse> {
    const apiCall = async (): Promise<TikTokUserInfoResponse> => {
      const response = await axios.post(
        `${TIKTOK_BASE_URL}/user/info/`,
        {
          open_id: this.credentials.openId,
          fields: [
            "open_id",
            "union_id",
            "avatar_url",
            "display_name",
            "follower_count",
            "following_count",
            "likes_count",
            "video_count",
            "profile_deep_link",
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${this.credentials.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data.error?.code) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      const user = response.data.data.user;

      return {
        openId: user.open_id,
        unionId: user.union_id,
        avatarUrl: user.avatar_url,
        displayName: user.display_name,
        followerCount: user.follower_count || 0,
        followingCount: user.following_count || 0,
        likesCount: user.likes_count || 0,
        videoCount: user.video_count || 0,
        profileDeepLink: user.profile_deep_link,
      };
    };

    return circuitBreaker.call("tiktok-api", "validate-credentials", apiCall, [], {
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
   * Upload video to TikTok using Content Posting API
   */
  async uploadVideo(request: TikTokVideoUploadRequest): Promise<TikTokUploadResponse> {
    const apiCall = async (): Promise<TikTokUploadResponse> => {
      // Step 1: Initialize video upload
      const initResponse = await axios.post(
        `${TIKTOK_BASE_URL}/post/publish/video/init/`,
        {
          post_info: {
            title: request.description.substring(0, 150), // TikTok title limit
            privacy_level: request.privacy.toUpperCase(),
            disable_duet: request.disableDuet || false,
            disable_comment: request.disableComment || false,
            disable_stitch: request.disableStitch || false,
            video_cover_timestamp_ms: 1000,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: 0, // Will be set when we get the actual file
            chunk_size: 10485760, // 10MB chunks
            total_chunk_count: 1,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.credentials.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (initResponse.data.error?.code) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok init error: ${initResponse.data.error.code} - ${initResponse.data.error.message}`
        );
      }

      const publishId = initResponse.data.data.publish_id;
      const uploadUrl = initResponse.data.data.upload_url;

      // Step 2: Fetch the video file
      const videoResponse = await axios.get(request.videoUrl, {
        responseType: "stream",
        timeout: 60000, // 60 seconds for video download
      });

      if (videoResponse.status !== 200) {
        throw ProviderError.externalService(
          "tiktok",
          `Failed to fetch video: ${videoResponse.status} ${videoResponse.statusText}`
        );
      }

      // Step 3: Upload video to TikTok's CDN
      const formData = new FormData();
      formData.append("video", videoResponse.data);

      const uploadResponse = await axios.put(uploadUrl, formData, {
        headers: {
          ...formData.getHeaders(),
          "Content-Type": "video/mp4",
        },
        timeout: 300000, // 5 minutes for video upload
      });

      if (uploadResponse.status !== 200) {
        throw ProviderError.externalService(
          "tiktok",
          `Video upload failed: ${uploadResponse.status}`
        );
      }

      // Step 4: Confirm upload and publish
      const publishResponse = await axios.post(
        `${TIKTOK_BASE_URL}/post/publish/`,
        {
          post_id: publishId,
        },
        {
          headers: {
            Authorization: `Bearer ${this.credentials.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (publishResponse.data.error?.code) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok publish error: ${publishResponse.data.error.code} - ${publishResponse.data.error.message}`
        );
      }

      return {
        shareId: publishResponse.data.data.share_id,
        shareUrl: publishResponse.data.data.share_url,
        uniqueId: publishResponse.data.data.unique_id,
      };
    };

    return circuitBreaker.call("tiktok-api", "upload-video", apiCall, [], {
      timeout: 360000, // 6 minutes for complete video upload process
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 5000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false, // Don't cache video uploads
      fallbackEnabled: false, // Video uploads shouldn't fallback
    });
  }

  /**
   * Get user info (serves as basic analytics)
   */
  async getUserInfo(): Promise<TikTokUserInfoResponse> {
    return this.validateCredentials(); // Reuse the same endpoint
  }

  /**
   * Get user videos list
   */
  async getUserVideos(cursor = 0, maxCount = 20): Promise<TikTokVideoListResponse> {
    const apiCall = async (): Promise<TikTokVideoListResponse> => {
      const response = await axios.post(
        `${TIKTOK_BASE_URL}/video/list/`,
        {
          open_id: this.credentials.openId,
          cursor,
          max_count: Math.min(maxCount, 20), // TikTok max is 20 per request
          fields: [
            "id",
            "title",
            "video_description",
            "duration",
            "cover_image_url",
            "share_url",
            "create_time",
            "like_count",
            "comment_count",
            "share_count",
            "view_count",
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${this.credentials.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data.error?.code) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok video list error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      const data = response.data.data;

      return {
        videos:
          data.videos?.map((video: Record<string, unknown>) => ({
            id: video.id,
            title: video.title || video.video_description || "",
            videoUrl: video.embed_link || "",
            coverImageUrl: video.cover_image_url,
            shareUrl: video.share_url,
            createTime: video.create_time,
            likeCount: video.like_count || 0,
            commentCount: video.comment_count || 0,
            shareCount: video.share_count || 0,
            viewCount: video.view_count || 0,
          })) || [],
        cursor: data.cursor || 0,
        hasMore: data.has_more || false,
      };
    };

    const fallbackResponse: TikTokVideoListResponse = {
      videos: [],
      cursor: 0,
      hasMore: false,
    };

    const fallback = async (): Promise<TikTokVideoListResponse> => {
      logger.warn("Using fallback response for TikTok Video List");
      return fallbackResponse;
    };

    return circuitBreaker.call("tiktok-api", "get-user-videos", apiCall, [], {
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
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
      fallback,
    });
  }

  /**
   * Get circuit breaker status for TikTok API operations
   */
  /**
   * @method publishPhotoPost
   * @description Creates a photo post (carousel) on TikTok using the Content Posting API.
   *              Supports up to 35 images per post.
   * @param params - Photo post configuration (description, imageUrls, privacy)
   */
  async publishPhotoPost(params: {
    description: string;
    imageUrls: string[];
    privacy: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
    disableComment?: boolean;
  }): Promise<TikTokUploadResponse> {
    const apiCall = async (): Promise<TikTokUploadResponse> => {
      const response = await axios.post(
        `${TIKTOK_BASE_URL}/post/publish/content/init/`,
        {
          post_info: {
            title: params.description.substring(0, 150),
            description: params.description,
            privacy_level: params.privacy,
            disable_comment: params.disableComment || false,
          },
          source_info: {
            source: "PULL_FROM_URL",
            photo_cover_index: 0,
            photo_images: params.imageUrls,
          },
          media_type: "PHOTO",
        },
        {
          headers: {
            Authorization: `Bearer ${this.credentials.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data.error?.code) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok photo post error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      return {
        shareId: response.data.data.publish_id,
        shareUrl: "",
        uniqueId: response.data.data.publish_id,
      };
    };

    return circuitBreaker.call("tiktok-api", "publish-photo-post", apiCall, [], {
      timeout: 60000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
    });
  }

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
    circuitBreaker.clearCache("tiktok-api");
  }

  /**
   * Force circuit breaker state (for testing/emergency)
   */
  forceCircuitBreakerOpen(operation: string): boolean {
    return circuitBreaker.forceOpen("tiktok-api", operation);
  }

  forceCircuitBreakerClose(operation: string): boolean {
    return circuitBreaker.forceClose("tiktok-api", operation);
  }

  /**
   * Refresh access token (if using OAuth flow)
   */
  async refreshToken(): Promise<string> {
    const response = await axios.post("https://open.tiktokapis.com/v2/oauth/token/", {
      client_key: this.credentials.clientKey,
      client_secret: this.credentials.clientSecret,
      grant_type: "refresh_token",
      refresh_token: this.credentials.accessToken, // In TikTok, the access token acts as refresh token
    });

    if (response.data.error?.code) {
      throw ProviderError.unauthorized(
        "tiktok",
        `TikTok token refresh error: ${response.data.error.code} - ${response.data.error.message}`
      );
    }

    const newAccessToken = response.data.data.access_token;
    this.credentials.accessToken = newAccessToken;
    return newAccessToken;
  }
}
