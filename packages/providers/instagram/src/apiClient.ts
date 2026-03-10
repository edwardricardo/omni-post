import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import { isOk as _isOk, isErr, unwrap, AppError, type Result as _Result } from "@shared/types";
import client from "prom-client";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:instagram:api-client");

export interface InstagramCredentials {
  accessToken: string;
  userId: string;
  pageId?: string;
  appId?: string;
  appSecret?: string;
  [key: string]: string | undefined;
}

export interface InstagramMediaContainer {
  id: string;
  status: "IN_PROGRESS" | "FINISHED" | "ERROR";
  status_code?: string;
}

export interface InstagramMediaResponse {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
  reach?: number;
  impressions?: number;
}

export interface InstagramUserResponse {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  biography?: string;
  website?: string;
  account_type: "BUSINESS" | "CREATOR" | "PERSONAL";
}

export interface InstagramInsightsResponse {
  data: Array<{
    name: string;
    period: string;
    values: Array<{
      value: number;
      end_time: string;
    }>;
    title: string;
    description: string;
  }>;
}

export interface InstagramCarouselItemData {
  media_type: "IMAGE" | "VIDEO";
  media_url: string;
}

export interface InstagramStoryData {
  media_type: "STORIES";
  media_url: string;
  story_duration?: number; // Duration in seconds for video stories
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class InstagramApiClient {
  private credentials: InstagramCredentials;
  private baseUrl = "https://graph.facebook.com/v23.0"; // Latest stable version - critical upgrade from deprecated v22.0

  constructor(credentials: InstagramCredentials) {
    this.credentials = credentials;
  }

  private getHeaders(includeContentType = true): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.credentials.accessToken}`,
    };

    if (includeContentType) {
      headers["Content-Type"] = "application/json";
    }

    return headers;
  }

  private async makeRequest<T>(
    operation: string,
    url: string,
    options: RequestInit = {},
    fallbackResponse?: T
  ): Promise<T> {
    const apiCall = async (): Promise<T> => {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: { message: errorText } };
        }

        const error = new Error(
          `Instagram API Error: ${response.status} ${response.statusText} - ${
            errorData.error?.message || errorText
          }`
        );
        (error as any).status = response.status;
        (error as any).statusText = response.statusText;
        (error as any).errorData = errorData;
        throw error;
      }

      return response.json() as Promise<T>;
    };

    const fallback = fallbackResponse
      ? async (): Promise<T> => {
          logger.warn({ operation }, "Using fallback response for Instagram API");
          return fallbackResponse;
        }
      : undefined;

    // Select appropriate fallback strategy based on operation type
    let fallbackConfig;
    switch (operation) {
      case "get-insights":
      case "get-user-info":
        fallbackConfig = CommonFallbackStrategies.ANALYTICS_FALLBACK;
        break;
      case "publish-media":
      case "create-container":
        fallbackConfig = CommonFallbackStrategies.SOCIAL_POST_FALLBACK;
        break;
      case "validate-token":
        fallbackConfig = CommonFallbackStrategies.METADATA_FALLBACK;
        break;
      default:
        fallbackConfig = CommonFallbackStrategies.METADATA_FALLBACK;
    }

    return circuitBreaker.call("instagram-api", operation, apiCall, [], {
      timeout: 30000, // 30 seconds for Instagram API calls
      errorThresholdPercentage: 60, // Higher threshold for social media APIs
      resetTimeout: 60000, // 1 minute reset
      maxRetries: 3,
      baseDelay: 2000, // 2 seconds base delay
      maxDelay: 30000, // 30 seconds max delay
      jitterEnabled: true,
      cacheEnabled: operation === "validate-token", // Cache token validation
      cacheTtl: 300000, // 5 minutes cache for token validation
      fallbackEnabled: true,
      fallbackConfig,
      ...(fallback ? { fallback } : {}),
    });
  }

  /**
   * Validate credentials by checking the access token
   */
  async validateCredentials(): Promise<InstagramUserResponse> {
    const url = `${this.baseUrl}/${this.credentials.userId}?fields=id,username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website,account_type&access_token=${this.credentials.accessToken}`;

    return this.makeRequest<InstagramUserResponse>("validate-token", url, {
      method: "GET",
    });
  }

  /**
   * Create a Stories media container
   */
  async createStoriesContainer(
    mediaUrl: string,
    mediaType: "IMAGE" | "VIDEO" = "IMAGE"
  ): Promise<InstagramMediaContainer> {
    const url = `${this.baseUrl}/${this.credentials.userId}/media`;

    const body: any = {
      media_type: "STORIES",
      [mediaType === "VIDEO" ? "video_url" : "image_url"]: mediaUrl,
      access_token: this.credentials.accessToken,
    };

    return this.makeRequest<InstagramMediaContainer>("create-stories-container", url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  }

  /**
   * Create a media container for single image/video post
   */
  async createMediaContainer(
    mediaUrl: string,
    caption?: string,
    mediaType: "IMAGE" | "VIDEO" = "IMAGE"
  ): Promise<InstagramMediaContainer> {
    const url = `${this.baseUrl}/${this.credentials.userId}/media`;

    const body: any = {
      media_type: mediaType,
      media_url: mediaUrl,
      access_token: this.credentials.accessToken,
    };

    if (caption) {
      body.caption = caption;
    }

    return this.makeRequest<InstagramMediaContainer>("create-container", url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  }

  /**
   * Create a Reels media container with enhanced features
   */
  async createReelsContainer(
    videoUrl: string,
    caption?: string,
    shareToFeed: boolean = true,
    enableRemixing: boolean = true
  ): Promise<InstagramMediaContainer> {
    const url = `${this.baseUrl}/${this.credentials.userId}/media`;

    const body: any = {
      media_type: "REELS",
      video_url: videoUrl,
      share_to_feed: shareToFeed, // Share to main feed and Reels tab
      access_token: this.credentials.accessToken,
    };

    if (caption) {
      body.caption = caption;
    }

    // Note: Remixing is controlled by account settings, but we can set the intention
    if (!enableRemixing) {
      // This would be handled at the account level in the Instagram app
      // API doesn't directly control remixing per post
    }

    return this.makeRequest<InstagramMediaContainer>("create-reels-container", url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  }

  /**
   * Create a carousel media container
   */
  async createCarouselContainer(
    items: InstagramCarouselItemData[],
    caption?: string
  ): Promise<InstagramMediaContainer> {
    // First, create individual media containers for each item
    const childContainers: string[] = [];

    for (const item of items) {
      const childContainer = await this.createMediaContainer(
        item.media_url,
        undefined, // No caption on individual items
        item.media_type
      );
      childContainers.push(childContainer.id);
    }

    // Then create the carousel container
    const url = `${this.baseUrl}/${this.credentials.userId}/media`;

    const body: any = {
      media_type: "CAROUSEL",
      children: childContainers.join(","),
      access_token: this.credentials.accessToken,
    };

    if (caption) {
      body.caption = caption;
    }

    return this.makeRequest<InstagramMediaContainer>("create-container", url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  }

  /**
   * Publish a media container
   */
  async publishMedia(containerId: string): Promise<InstagramMediaResponse> {
    const url = `${this.baseUrl}/${this.credentials.userId}/media_publish`;

    const body = {
      creation_id: containerId,
      access_token: this.credentials.accessToken,
    };

    const response = await this.makeRequest<{ id: string }>("publish-media", url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

    // Get the published media details
    return this.getMediaDetails(response.id);
  }

  /**
   * Get media container status
   */
  async getContainerStatus(containerId: string): Promise<InstagramMediaContainer> {
    const url = `${this.baseUrl}/${containerId}?fields=id,status,status_code&access_token=${this.credentials.accessToken}`;

    return this.makeRequest<InstagramMediaContainer>("get-container-status", url, {
      method: "GET",
    });
  }

  /**
   * Get media details
   */
  async getMediaDetails(mediaId: string): Promise<InstagramMediaResponse> {
    const url = `${this.baseUrl}/${mediaId}?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count&access_token=${this.credentials.accessToken}`;

    return this.makeRequest<InstagramMediaResponse>("get-media-details", url, {
      method: "GET",
    });
  }

  /**
   * Get user media
   */
  async getUserMedia(
    limit = 25,
    after?: string
  ): Promise<{
    data: InstagramMediaResponse[];
    paging?: { cursors?: { before?: string; after?: string }; next?: string; previous?: string };
  }> {
    let url = `${this.baseUrl}/${this.credentials.userId}/media?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count&limit=${limit}&access_token=${this.credentials.accessToken}`;

    if (after) {
      url += `&after=${after}`;
    }

    return this.makeRequest<{
      data: InstagramMediaResponse[];
      paging?: { cursors?: { before?: string; after?: string }; next?: string; previous?: string };
    }>("get-user-media", url, {
      method: "GET",
    });
  }

  /**
   * Get media insights
   */
  async getMediaInsights(
    mediaId: string,
    metrics: string[] = ["impressions", "reach", "engagement"]
  ): Promise<InstagramInsightsResponse> {
    const url = `${this.baseUrl}/${mediaId}/insights?metric=${metrics.join(",")}&access_token=${this.credentials.accessToken}`;

    const fallbackResponse: InstagramInsightsResponse = {
      data: metrics.map((metric) => ({
        name: metric,
        period: "lifetime",
        values: [{ value: 0, end_time: new Date().toISOString() }],
        title: metric.charAt(0).toUpperCase() + metric.slice(1),
        description: `${metric} data`,
      })),
    };

    return this.makeRequest<InstagramInsightsResponse>(
      "get-insights",
      url,
      { method: "GET" },
      fallbackResponse
    );
  }

  /**
   * Get user insights
   */
  async getUserInsights(
    metrics: string[] = ["impressions", "reach", "profile_views"],
    period: "day" | "week" | "days_28" = "days_28",
    since?: Date,
    until?: Date
  ): Promise<InstagramInsightsResponse> {
    let url = `${this.baseUrl}/${this.credentials.userId}/insights?metric=${metrics.join(",")}&period=${period}&access_token=${this.credentials.accessToken}`;

    if (since) {
      url += `&since=${Math.floor(since.getTime() / 1000)}`;
    }
    if (until) {
      url += `&until=${Math.floor(until.getTime() / 1000)}`;
    }

    const fallbackResponse: InstagramInsightsResponse = {
      data: metrics.map((metric) => ({
        name: metric,
        period,
        values: [{ value: 0, end_time: new Date().toISOString() }],
        title: metric.charAt(0).toUpperCase() + metric.slice(1),
        description: `${metric} data`,
      })),
    };

    return this.makeRequest<InstagramInsightsResponse>(
      "get-insights",
      url,
      { method: "GET" },
      fallbackResponse
    );
  }

  /**
   * Upload media to S3 storage service (required for Instagram API)
   * Note: Instagram API requires media to be hosted on a publicly accessible URL
   */
  async uploadMediaToHost(mediaBuffer: ArrayBuffer, mediaType: string): Promise<string> {
    const { createS3StorageAdapter } = await import("@adapters/storage-s3");

    if (!process.env.AWS_REGION || !process.env.AWS_S3_BUCKET) {
      throw AppError.configuration(
        "AWS_REGION and AWS_S3_BUCKET environment variables are required"
      );
    }

    const s3Config = {
      region: process.env.AWS_REGION,
      bucket: process.env.AWS_S3_BUCKET,
      ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : {}),
      ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
    };

    const mediaCall = async (): Promise<string> => {
      const storageAdapter = createS3StorageAdapter(s3Config);

      // Generate filename based on media type
      const extension = mediaType.includes("video")
        ? "mp4"
        : mediaType.includes("image")
          ? "jpg"
          : "bin";
      const filename = `instagram-media-${Date.now()}.${extension}`;

      // Generate presigned upload URL
      const signatureResult = await storageAdapter.generateUploadSignature(filename, mediaType);

      if (isErr(signatureResult)) {
        throw AppError.externalService(
          "s3",
          `Failed to generate upload signature: ${signatureResult.error}`
        );
      }

      const signature = unwrap(signatureResult);

      // Upload media to S3 using presigned POST
      const formData = new FormData();

      // Add all required fields from the signature
      Object.entries(signature.fields).forEach(([key, value]) => {
        formData.append(key, value);
      });

      // Add the media file as the last field
      const mediaBlob = new Blob([mediaBuffer], { type: mediaType });
      formData.append("file", mediaBlob);

      const uploadResponse = await fetch(signature.url, {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw AppError.externalService(
          "s3",
          `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
        );
      }

      // Construct the final media URL
      const mediaUrl = `${signature.url}${signature.fields.key}`;
      return mediaUrl;
    };

    return circuitBreaker.call("media-upload", "upload", mediaCall, [], {
      timeout: 120000, // 2 minutes for media upload
      maxRetries: 2,
      baseDelay: 2000,
      maxDelay: 10000,
      jitterEnabled: true,
    });
  }

  /**
   * @method getMediaComments
   * @description Fetches comments on a media object via GET /{media-id}/comments.
   *              Requires instagram_manage_comments scope.
   * @param mediaId - The Instagram media ID
   * @param limit - Max comments per page (default 50)
   * @param after - Cursor for pagination
   */
  async getMediaComments(
    mediaId: string,
    limit: number = 50,
    after?: string
  ): Promise<{
    data: Array<{
      id: string;
      text: string;
      username: string;
      timestamp: string;
      replies?: { data: Array<{ id: string; text: string; username: string; timestamp: string }> };
    }>;
    paging?: { cursors?: { after?: string }; next?: string };
  }> {
    let url =
      `${this.baseUrl}/${mediaId}/comments` +
      `?fields=id,text,username,timestamp,replies{id,text,username,timestamp}` +
      `&limit=${Math.min(limit, 50)}` +
      `&access_token=${this.credentials.accessToken}`;

    if (after) {
      url += `&after=${encodeURIComponent(after)}`;
    }

    return this.makeRequest("get-media-comments", url, { method: "GET" });
  }

  /**
   * @method replyToComment
   * @description Posts a reply to a comment via POST /{comment-id}/replies.
   *              Requires instagram_manage_comments scope.
   * @param commentId - The comment ID to reply to
   * @param message - The reply text
   */
  async replyToComment(commentId: string, message: string): Promise<{ id: string }> {
    const url = `${this.baseUrl}/${commentId}/replies`;

    const body = {
      message,
      access_token: this.credentials.accessToken,
    };

    return this.makeRequest<{ id: string }>("reply-to-comment", url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  }

  /**
   * @method getCircuitBreakerStatus
   * @description Returns the current state of all Instagram API circuit breakers.
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
    circuitBreaker.clearCache("instagram-api");
    circuitBreaker.clearCache("media-upload");
  }

  /**
   * Force circuit breaker state (for testing/emergency)
   */
  forceCircuitBreakerOpen(operation: string): boolean {
    return circuitBreaker.forceOpen("instagram-api", operation);
  }

  forceCircuitBreakerClose(operation: string): boolean {
    return circuitBreaker.forceClose("instagram-api", operation);
  }
}
