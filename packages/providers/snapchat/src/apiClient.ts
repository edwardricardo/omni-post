/**
 * @file apiClient.ts
 * @description Snapchat API client for interacting with the Snapchat Ads/Public Profile API.
 *              Uses fetch() with circuit breaker protection for all API calls.
 *              Handles media uploads, story creation, credential validation, and analytics.
 * @layer infrastructure
 */

import {
  createExternalApiCircuitBreaker,
  ANALYTICS_CB_OPTIONS,
  hashCallScope,
} from "@adapters/external-apis";
import client from "prom-client";
import { createLogger } from "@observability/logger";
import type {
  SnapchatCredentials,
  SnapchatOrganizationsResponse,
  SnapchatMediaUploadResponse,
  SnapchatStoryResponse,
  SnapchatStoryAnalytics,
  SnapchatTokenRefreshResponse,
} from "./types.js";
import {
  EMPTY_ANALYTICS,
  extractMediaId,
  parseOrganizationsResponse,
  parseStoryResponse,
  parseAnalyticsResponse,
  parseTokenResponse,
} from "./responseParsers.js";

const logger = createLogger("provider:snapchat:api-client");

// Re-export types for backward compatibility
export type { SnapchatCredentials } from "./types.js";

const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

const SNAPCHAT_API_BASE = "https://adsapi.snapchat.com/v1";
const SNAPCHAT_AUTH_URL = "https://accounts.snapchat.com/login/oauth2/access_token";

/**
 * @class SnapchatApiClient
 * @description Client for the Snapchat Ads API. All methods use circuit breaker
 *              protection and return structured responses. Uses native fetch().
 */
export class SnapchatApiClient {
  private credentials: SnapchatCredentials;

  constructor(credentials: SnapchatCredentials) {
    this.credentials = credentials;
  }

  /**
   * @method validateCredentials
   * @description Validates the current access token by fetching organizations.
   * @returns The organizations associated with the authenticated account.
   */
  async validateCredentials(): Promise<SnapchatOrganizationsResponse> {
    const apiCall = async (): Promise<SnapchatOrganizationsResponse> => {
      const response = await fetch(`${SNAPCHAT_API_BASE}/me/organizations`, {
        method: "GET",
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        const error = new Error(`Snapchat API error: ${response.status} - ${errorBody}`);
        Object.assign(error, { status: response.status });
        throw error;
      }

      const data: unknown = await response.json();
      return parseOrganizationsResponse(data);
    };

    return circuitBreaker.call("snapchat-api", "validate-credentials", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000,
      // PII read (own account organizations): scope cache + STATE per credential.
      cacheKeyDiscriminant: hashCallScope(this.credentials),
    });
  }

  /**
   * @method uploadMedia
   * @description Uploads a media file (image or video) to Snapchat for use in stories.
   *              First fetches the media from the given URL, then uploads to Snapchat.
   * @param mediaUrl - The URL of the media to upload
   * @param mediaType - The MIME type of the media (e.g., "image/jpeg", "video/mp4")
   * @returns Upload response with the assigned media ID
   */
  async uploadMedia(
    mediaUrl: string,
    mediaType: string = "image/jpeg"
  ): Promise<SnapchatMediaUploadResponse> {
    const apiCall = async (): Promise<SnapchatMediaUploadResponse> => {
      const mediaResponse = await fetch(mediaUrl);
      if (!mediaResponse.ok) {
        throw new Error(
          `Failed to fetch media: ${mediaResponse.status} ${mediaResponse.statusText}`
        );
      }

      const mediaBuffer = await mediaResponse.arrayBuffer();
      const resolvedType = mediaResponse.headers.get("content-type") || mediaType;

      const createResponse = await fetch(
        `${SNAPCHAT_API_BASE}/organizations/${this.credentials.organizationId}/media`,
        {
          method: "POST",
          headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            media: [
              {
                name: `omnipost-media-${Date.now()}`,
                type: resolvedType.startsWith("video") ? "VIDEO" : "IMAGE",
              },
            ],
          }),
        }
      );

      if (!createResponse.ok) {
        const errorBody = await createResponse.text().catch(() => "Unknown error");
        const error = new Error(
          `Failed to create media entity: ${createResponse.status} - ${errorBody}`
        );
        Object.assign(error, { status: createResponse.status });
        throw error;
      }

      const createData: unknown = await createResponse.json();
      const mediaId = extractMediaId(createData);

      const uploadResponse = await fetch(`${SNAPCHAT_API_BASE}/media/${mediaId}/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.credentials.accessToken}`,
          "Content-Type": resolvedType,
        },
        body: mediaBuffer,
      });

      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text().catch(() => "Unknown error");
        const error = new Error(
          `Failed to upload media binary: ${uploadResponse.status} - ${errorBody}`
        );
        Object.assign(error, { status: uploadResponse.status });
        throw error;
      }

      return {
        media: {
          id: mediaId,
          type: resolvedType.startsWith("video") ? "VIDEO" : "IMAGE",
          media_status: "PENDING",
          name: `omnipost-media-${Date.now()}`,
        },
      };
    };

    return circuitBreaker.call("snapchat-api", "upload-media", apiCall, [], {
      timeout: 60000,
      errorThresholdPercentage: 70,
      resetTimeout: 90000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 15000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op: uncached; STATE partitions per credential (W-1).
      cacheKeyDiscriminant: hashCallScope(this.credentials),
    });
  }

  /**
   * @method createStory
   * @description Creates a Snapchat story (creative) referencing previously uploaded media.
   * @param mediaId - The ID of the uploaded media to attach to the story
   * @param caption - Optional text caption for the story (max 250 chars)
   * @returns The created story/creative response
   */
  async createStory(mediaId: string, caption?: string): Promise<SnapchatStoryResponse> {
    const apiCall = async (): Promise<SnapchatStoryResponse> => {
      const creativePayload: Record<string, unknown> = {
        name: `omnipost-story-${Date.now()}`,
        type: "SNAP_AD",
        top_snap_media_id: mediaId,
        ...(caption && { headline: caption.substring(0, 250) }),
      };

      const response = await fetch(
        `${SNAPCHAT_API_BASE}/organizations/${this.credentials.organizationId}/creatives`,
        {
          method: "POST",
          headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ creatives: [creativePayload] }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        const error = new Error(`Failed to create story: ${response.status} - ${errorBody}`);
        Object.assign(error, { status: response.status });
        throw error;
      }

      const data: unknown = await response.json();
      return parseStoryResponse(data);
    };

    return circuitBreaker.call("snapchat-api", "create-story", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      // Write op: uncached; STATE partitions per credential (W-1).
      cacheKeyDiscriminant: hashCallScope(this.credentials),
    });
  }

  /**
   * @method getStoryAnalytics
   * @description Fetches analytics metrics for a specific story/creative.
   * @param creativeId - The ID of the creative to get analytics for
   * @returns Analytics data including views, screenshots, swipe-ups, etc.
   */
  async getStoryAnalytics(creativeId: string): Promise<SnapchatStoryAnalytics> {
    const apiCall = async (): Promise<SnapchatStoryAnalytics> => {
      const response = await fetch(
        `${SNAPCHAT_API_BASE}/creatives/${creativeId}/stats` +
          `?granularity=TOTAL&fields=total_views,unique_views,screenshots,swipe_ups,shares`,
        { method: "GET", headers: this.buildHeaders() }
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        throw new Error(`Failed to fetch analytics: ${response.status} - ${errorBody}`);
      }

      const data: unknown = await response.json();
      return parseAnalyticsResponse(data);
    };

    const fallback = async (): Promise<SnapchatStoryAnalytics> => {
      logger.warn("Using fallback response for Snapchat Analytics");
      return EMPTY_ANALYTICS;
    };

    return circuitBreaker.call("snapchat-api", "get-analytics", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...ANALYTICS_CB_OPTIONS,
      // PII analytics for a specific creative: fold the creative id so distinct
      // creatives never share a cached payload; credential kept for tenant scope.
      cacheKeyDiscriminant: hashCallScope(this.credentials, creativeId),
      fallback,
    });
  }

  /**
   * @method refreshAccessToken
   * @description Refreshes the access token using the refresh token.
   * @returns New token data including access_token and refresh_token
   */
  async refreshAccessToken(): Promise<SnapchatTokenRefreshResponse> {
    const apiCall = async (): Promise<SnapchatTokenRefreshResponse> => {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.credentials.refreshToken,
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      });

      const response = await fetch(SNAPCHAT_AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        const error = new Error(`Token refresh failed: ${response.status} - ${errorBody}`);
        Object.assign(error, { status: response.status });
        throw error;
      }

      const data: unknown = await response.json();
      return parseTokenResponse(data);
    };

    return circuitBreaker.call("snapchat-api", "refresh-token", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 2,
      baseDelay: 2000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Do-not-regress: refresh-token stays UNCACHED (secret); the discriminant
      // only partitions STATE per credential (W-1), it does not enable caching.
      cacheKeyDiscriminant: hashCallScope(this.credentials),
    });
  }

  /** Returns the current status of all Snapchat API circuit breakers. */
  getCircuitBreakerStatus(): Record<string, unknown> {
    return circuitBreaker.getAllStatuses();
  }

  /** Returns the Prometheus metrics registry for monitoring. */
  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  /** Clears cached responses for Snapchat API operations. */
  clearCache(): void {
    circuitBreaker.clearCache("snapchat-api");
  }

  /** Forces a circuit breaker to OPEN state (testing/emergency). */
  forceCircuitBreakerOpen(operation: string): boolean {
    return circuitBreaker.forceOpen("snapchat-api", operation);
  }

  /** Forces a circuit breaker to CLOSED state (testing/emergency). */
  forceCircuitBreakerClose(operation: string): boolean {
    return circuitBreaker.forceClose("snapchat-api", operation);
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.credentials.accessToken}`,
      Accept: "application/json",
    };
  }
}
