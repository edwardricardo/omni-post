/**
 * @file apiClient.ts
 * @description Facebook Graph API client with circuit-breaker resilience,
 * rate limiting, token management, and media upload support.
 * Type definitions live in apiClientTypes.ts.
 * @layer infrastructure
 */

/// <reference path="./facebook-sdk.d.ts" />
import { createExternalApiCircuitBreaker, ANALYTICS_CB_OPTIONS } from "@adapters/external-apis";
import { AppError } from "@shared/types";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:facebook:api-client");
import client from "prom-client";

// Re-export all types so existing importers continue to work
export type {
  FacebookCredentials,
  FacebookError,
  FacebookRateLimitInfo,
  FacebookUser,
  FacebookPageRole,
  FacebookPageCategory,
  FacebookPageLocation,
  FacebookPageHours,
  FacebookPageInfo,
  FacebookBusinessAccount,
  FacebookPagePostResponse,
  FacebookMediaUploadResponse,
  FacebookPageInsightsResponse,
  FacebookPageResponse,
} from "./apiClientTypes.js";

import type {
  FacebookCredentials,
  FacebookError,
  FacebookRateLimitInfo,
  FacebookPageInfo,
  FacebookBusinessAccount,
  FacebookPagePostResponse,
  FacebookMediaUploadResponse,
  FacebookPageInsightsResponse,
  FacebookPageResponse,
} from "./apiClientTypes.js";

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class FacebookApiClient {
  readonly credentials: FacebookCredentials;
  private baseUrl = "https://graph.facebook.com/v23.0";
  private rateLimitInfo: FacebookRateLimitInfo | null = null;
  private lastRequestTime = 0;
  private requestCount = 0;
  private readonly maxRequestsPerHour = 200;

  constructor(credentials: FacebookCredentials) {
    this.credentials = credentials;
  }

  private updateRateLimitInfo(headers: Headers): void {
    const usage = headers.get("x-app-usage");
    if (usage) {
      try {
        const usageData = JSON.parse(usage);
        this.rateLimitInfo = {
          callCount: usageData.call_count || 0,
          totalTime: usageData.total_time || 0,
          totalCpuTime: usageData.total_cputime || 0,
          type: "application",
        };
      } catch (error) {
        logger.warn({ err: error }, "Failed to parse rate limit headers");
      }
    }
  }

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (this.requestCount >= this.maxRequestsPerHour) {
      const resetTime = this.lastRequestTime + 60 * 60 * 1000;
      if (now < resetTime) {
        const waitTime = resetTime - now;
        logger.warn({ waitTimeMs: waitTime }, "Rate limit reached, waiting before next request");
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        this.requestCount = 0;
      }
    }

    if (timeSinceLastRequest < 100) {
      await new Promise((resolve) => setTimeout(resolve, 100 - timeSinceLastRequest));
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  async makeApiRequest(
    endpoint: string,
    options: RequestInit = {},
    usePageToken = true
  ): Promise<Response> {
    await this.checkRateLimit();

    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (usePageToken && !url.searchParams.has("access_token")) {
      url.searchParams.set("access_token", this.credentials.accessToken);
    }

    const response = await fetch(url.toString(), {
      ...options,
      headers: {
        "User-Agent": "SaaS-Prototype-Facebook-Client/1.0",
        ...options.headers,
      },
    });

    this.updateRateLimitInfo(response.headers);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: {
          message: `HTTP ${response.status}: ${response.statusText}`,
          type: "OAuthException",
          code: response.status,
        },
      }));

      const fbError: FacebookError = errorData.error || errorData;

      if (fbError.code === 190 || fbError.code === 102) {
        throw AppError.unauthorized(
          `Facebook Auth Error: ${fbError.message} (Code: ${fbError.code})`
        );
      }
      if (fbError.code === 4 || fbError.code === 17 || fbError.code === 341) {
        throw AppError.tooManyRequests(
          `Facebook Rate Limit Error: ${fbError.message} (Code: ${fbError.code})`
        );
      }
      if (fbError.code === 100) {
        throw AppError.badRequest(
          `Facebook Invalid Parameter Error: ${fbError.message} (Code: ${fbError.code})`
        );
      }

      throw AppError.externalService(
        "facebook",
        `Facebook API Error: ${fbError.message} (Code: ${fbError.code}, Type: ${fbError.type})`
      );
    }

    return response;
  }

  getRateLimitStatus(): FacebookRateLimitInfo | null {
    return this.rateLimitInfo;
  }

  async getPageInfo(fields?: string[]): Promise<FacebookPageInfo> {
    const defaultFields = [
      "id",
      "name",
      "username",
      "about",
      "category",
      "category_list",
      "phone",
      "website",
      "location",
      "hours",
      "fan_count",
      "followers_count",
      "link",
      "picture{url,width,height}",
      "cover",
      "is_verified",
      "verification_status",
      "roles",
    ];
    const requestFields = fields || defaultFields;
    const response = await this.makeApiRequest(
      `/${this.credentials.pageId}?fields=${requestFields.join(",")}`
    );
    return response.json();
  }

  async getBusinessAccount(): Promise<FacebookBusinessAccount> {
    const response = await this.makeApiRequest(
      `/${this.credentials.pageId}?fields=id,name,verification_status,timezone_id,currency`
    );
    return response.json();
  }

  async validateLongLivedToken(): Promise<{
    isValid: boolean;
    expiresAt?: Date;
    scopes?: string[];
    appId?: string;
  }> {
    try {
      const response = await this.makeApiRequest(
        `/debug_token?input_token=${this.credentials.accessToken}`,
        {},
        false
      );
      const data = await response.json();
      const tokenInfo = data.data;
      return {
        isValid: tokenInfo.is_valid || false,
        ...(tokenInfo.expires_at ? { expiresAt: new Date(tokenInfo.expires_at * 1000) } : {}),
        ...(tokenInfo.scopes ? { scopes: tokenInfo.scopes } : {}),
        ...(tokenInfo.app_id ? { appId: tokenInfo.app_id } : {}),
      };
    } catch (error) {
      logger.warn({ err: error }, "Token validation failed");
      return { isValid: false };
    }
  }

  async exchangeForLongLivedToken(shortLivedToken: string): Promise<{
    accessToken: string;
    tokenType: string;
    expiresIn?: number;
  }> {
    const url = new URL(`${this.baseUrl}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", this.credentials.appId);
    url.searchParams.set("client_secret", this.credentials.appSecret);
    url.searchParams.set("fb_exchange_token", shortLivedToken);

    const response = await fetch(url.toString());
    if (!response.ok)
      throw AppError.externalService(
        "facebook",
        `Failed to exchange token: ${response.statusText}`
      );
    return response.json();
  }

  async getAppAccessToken(): Promise<string> {
    const url = new URL(`${this.baseUrl}/oauth/access_token`);
    url.searchParams.set("client_id", this.credentials.appId);
    url.searchParams.set("client_secret", this.credentials.appSecret);
    url.searchParams.set("grant_type", "client_credentials");

    const response = await fetch(url.toString());
    if (!response.ok)
      throw AppError.externalService(
        "facebook",
        `Failed to get app access token: ${response.statusText}`
      );
    const data = await response.json();
    return data.access_token;
  }

  async validateCredentials(): Promise<FacebookPageResponse> {
    const apiCall = async (): Promise<FacebookPageResponse> => {
      const response = await this.makeApiRequest(
        `/${this.credentials.pageId}?fields=id,name,username,access_token`
      );
      const data = await response.json();

      const tokenValidation = await this.validateLongLivedToken();
      if (!tokenValidation.isValid)
        throw AppError.unauthorized("Access token is invalid or expired");

      return {
        id: data.id,
        name: data.name,
        username: data.username,
        access_token: data.access_token,
      };
    };

    return circuitBreaker.call("facebook-api", "validate-credentials", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000,
    });
  }

  async uploadMedia(
    mediaUrl: string,
    mediaType: "photo" | "video" = "photo",
    options: {
      published?: boolean;
      caption?: string;
      allowSpherePhoto?: boolean;
      scheduledPublishTime?: number;
    } = {}
  ): Promise<FacebookMediaUploadResponse> {
    const apiCall = async (): Promise<FacebookMediaUploadResponse> => {
      const mediaResponse = await fetch(mediaUrl);
      if (!mediaResponse.ok) {
        throw AppError.externalService(
          "facebook",
          `Failed to fetch media: ${mediaResponse.status} ${mediaResponse.statusText}`
        );
      }

      const mediaBuffer = await mediaResponse.arrayBuffer();
      const contentType = mediaResponse.headers.get("content-type") || "image/jpeg";
      const endpoint = mediaType === "video" ? "videos" : "photos";

      const formData = new FormData();
      formData.append("source", new Blob([mediaBuffer], { type: contentType }));
      formData.append("access_token", this.credentials.accessToken);

      if (options.published !== undefined)
        formData.append("published", options.published.toString());
      if (options.caption) formData.append("caption", options.caption);
      if (options.allowSpherePhoto !== undefined)
        formData.append("allow_spherical_photo", options.allowSpherePhoto.toString());
      if (options.scheduledPublishTime)
        formData.append("scheduled_publish_time", options.scheduledPublishTime.toString());

      const response = await fetch(`${this.baseUrl}/${this.credentials.pageId}/${endpoint}`, {
        method: "POST",
        body: formData,
      });

      this.updateRateLimitInfo(response.headers);

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: { message: "Unknown error" } }));
        throw AppError.externalService(
          "facebook",
          `Facebook media upload error: ${response.status} - ${errorData.error?.message || response.statusText}`
        );
      }

      const data = await response.json();
      return {
        id: data.id,
        media_key: `facebook_${data.id}`,
        size: mediaBuffer.byteLength,
        post_id: data.post_id,
      };
    };

    return circuitBreaker.call("facebook-api", "upload-media", apiCall, [], {
      timeout: mediaType === "video" ? 300000 : 60000,
      errorThresholdPercentage: 70,
      resetTimeout: 90000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 15000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
    });
  }

  async uploadUnpublishedMedia(
    mediaUrl: string,
    mediaType: "photo" | "video" = "photo"
  ): Promise<{ id: string; media_key: string }> {
    const result = await this.uploadMedia(mediaUrl, mediaType, { published: false });
    return { id: result.id, media_key: result.media_key };
  }

  async batchUploadMedia(
    mediaUrls: Array<{ url: string; type: "photo" | "video"; caption?: string }>
  ): Promise<Array<{ id: string; media_key: string; url: string }>> {
    const results = [];
    for (const media of mediaUrls) {
      try {
        const result = await this.uploadUnpublishedMedia(media.url, media.type);
        results.push({ ...result, url: media.url });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error({ err: error, url: media.url }, "Failed to upload media");
        throw error;
      }
    }
    return results;
  }

  async postToPage(message: string, mediaIds: string[] = []): Promise<FacebookPagePostResponse> {
    const apiCall = async (): Promise<FacebookPagePostResponse> => {
      const postData: Record<string, string> = {
        message,
        access_token: this.credentials.accessToken,
      };
      if (mediaIds.length > 0) {
        postData.attached_media = JSON.stringify(mediaIds.map((id) => ({ media_fbid: id })));
      }

      const response = await fetch(
        `https://graph.facebook.com/v23.0/${this.credentials.pageId}/feed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(postData),
        }
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: { message: "Unknown error" } }));
        throw AppError.externalService(
          "facebook",
          `Facebook post error: ${response.status} - ${errorData.error?.message || response.statusText}`
        );
      }

      const data = await response.json();
      const postDetailsResponse = await fetch(
        `https://graph.facebook.com/v23.0/${data.id}?fields=id,created_time,message,permalink_url&access_token=${this.credentials.accessToken}`,
        { method: "GET" }
      );

      let postDetails: Record<string, string | undefined> = { id: data.id };
      if (postDetailsResponse.ok) postDetails = await postDetailsResponse.json();

      return {
        id: postDetails.id || data.id || "",
        ...(postDetails.created_time && { created_time: postDetails.created_time }),
        ...(postDetails.message && { message: postDetails.message }),
        ...(postDetails.permalink_url && { permalink_url: postDetails.permalink_url }),
      };
    };

    return circuitBreaker.call("facebook-api", "post-to-page", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
    });
  }

  async getPageInsights(since?: Date, until?: Date): Promise<FacebookPageInsightsResponse> {
    const apiCall = async (): Promise<FacebookPageInsightsResponse> => {
      const params = new URLSearchParams({
        metric: "page_impressions,page_engaged_users,page_fans,page_post_engagements",
        access_token: this.credentials.accessToken,
      });
      if (since && until) {
        params.append("since", Math.floor(since.getTime() / 1000).toString());
        params.append("until", Math.floor(until.getTime() / 1000).toString());
      }

      const response = await fetch(
        `https://graph.facebook.com/v23.0/${this.credentials.pageId}/insights?${params}`,
        { method: "GET", headers: { "Content-Type": "application/json" } }
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: { message: "Unknown error" } }));
        throw AppError.externalService(
          "facebook",
          `Facebook insights error: ${response.status} - ${errorData.error?.message || response.statusText}`
        );
      }

      const data = await response.json();
      const insights: FacebookPageInsightsResponse = {
        impressions: 0,
        engagements: 0,
        likes: 0,
        shares: 0,
        comments: 0,
        clicks: 0,
      };

      if (data.data && Array.isArray(data.data)) {
        for (const metric of data.data) {
          const values = metric.values || [];
          const latestValue = values.length > 0 ? values[values.length - 1] : null;
          if (latestValue && latestValue.value !== undefined) {
            switch (metric.name) {
              case "page_impressions":
                insights.impressions = latestValue.value;
                break;
              case "page_engaged_users":
                insights.engagements = latestValue.value;
                break;
              case "page_fans":
                insights.likes = latestValue.value;
                break;
              case "page_post_engagements":
                insights.shares = latestValue.value;
                break;
            }
          }
        }
      }
      return insights;
    };

    const fallbackResponse: FacebookPageInsightsResponse = {
      impressions: 0,
      engagements: 0,
      likes: 0,
      shares: 0,
      comments: 0,
      clicks: 0,
    };
    const fallback = async (): Promise<FacebookPageInsightsResponse> => {
      logger.warn("Using fallback response for Facebook Analytics");
      return fallbackResponse;
    };

    return circuitBreaker.call("facebook-api", "get-page-insights", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...ANALYTICS_CB_OPTIONS,
      fallback,
    });
  }

  /**
   * @method getPostComments
   * @description Fetches comments on a post via GET /{post-id}/comments.
   *              Supports cursor-based pagination and 2-level threading.
   * @param postId - The Facebook post ID
   * @param limit - Max comments per page (default 25)
   * @param after - Cursor for pagination
   */
  async getPostComments(
    postId: string,
    limit: number = 25,
    after?: string
  ): Promise<{
    data: Array<{
      id: string;
      message: string;
      from: { id: string; name: string };
      created_time: string;
      parent?: { id: string };
    }>;
    paging?: { cursors?: { after?: string }; next?: string };
  }> {
    let url =
      `/${postId}/comments?fields=id,message,from,created_time,parent` +
      `&limit=${Math.min(limit, 100)}` +
      `&order=reverse_chronological`;

    if (after) {
      url += `&after=${encodeURIComponent(after)}`;
    }

    const response = await this.makeApiRequest(url);
    return response.json();
  }

  /**
   * @method getMentionById
   * @description Fetches a single object (post or comment) the page was tagged in
   *              via GET /{object-id}. Used by the brand-listening webhook path to
   *              fetch the full mention object before persisting.
   * @param objectId - The Facebook post or comment ID from the mention webhook
   */
  async getMentionById(objectId: string): Promise<{
    id: string;
    message?: string;
    story?: string;
    from?: { id: string; name: string };
    created_time?: string;
    permalink_url?: string;
  }> {
    const url = `/${objectId}?fields=id,message,story,from,created_time,permalink_url`;
    const response = await this.makeApiRequest(url);
    return response.json();
  }

  /**
   * @method replyToComment
   * @description Posts a reply to a comment via POST /{comment-id}/comments.
   * @param commentId - The comment ID to reply to
   * @param message - The reply text
   */
  async replyToComment(commentId: string, message: string): Promise<{ id: string }> {
    const response = await this.makeApiRequest(`/${commentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message,
        access_token: this.credentials.accessToken,
      }).toString(),
    });
    return response.json();
  }

  /**
   * @method postWithLink
   * @description Creates a post with an OG link preview on the page feed.
   * @param message - Post text
   * @param link - URL for OG preview
   */
  async postWithLink(message: string, link: string): Promise<{ id: string }> {
    const response = await this.makeApiRequest(`/${this.credentials.pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message,
        link,
        access_token: this.credentials.accessToken,
      }).toString(),
    });
    return response.json();
  }

  /**
   * @method postScheduled
   * @description Creates a scheduled post on the page feed.
   *              Scheduled time must be between 10 minutes and 6 months from now.
   * @param message - Post text
   * @param scheduledPublishTime - Unix timestamp for when to publish
   * @param mediaIds - Optional array of unpublished media IDs to attach
   */
  async postScheduled(
    message: string,
    scheduledPublishTime: number,
    mediaIds: string[] = []
  ): Promise<{ id: string }> {
    const postData: Record<string, string> = {
      message,
      published: "false",
      scheduled_publish_time: scheduledPublishTime.toString(),
      access_token: this.credentials.accessToken,
    };

    if (mediaIds.length > 0) {
      postData.attached_media = JSON.stringify(mediaIds.map((id) => ({ media_fbid: id })));
    }

    const response = await this.makeApiRequest(`/${this.credentials.pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(postData).toString(),
    });
    return response.json();
  }

  getCircuitBreakerStatus(): Record<string, unknown> {
    return circuitBreaker.getAllStatuses();
  }

  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  clearCache(): void {
    circuitBreaker.clearCache("facebook-api");
  }

  forceCircuitBreakerOpen(operation: string): boolean {
    return circuitBreaker.forceOpen("facebook-api", operation);
  }

  forceCircuitBreakerClose(operation: string): boolean {
    return circuitBreaker.forceClose("facebook-api", operation);
  }
}
