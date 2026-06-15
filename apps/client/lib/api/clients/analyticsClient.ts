/**
 * @file analyticsClient.ts
 * @description Analytics domain client. Reads metrics for posts, channels,
 *              best-time analysis, content performance, and cross-platform
 *              aggregations.
 * @layer infrastructure
 */

import type { Analytics, ApiResponse, CrossPlatformAnalyticsData } from "../types.js";
import { request } from "./request.js";

export interface PostAnalyticsParams {
  start?: string;
  end?: string;
  providerId?: string;
}

export interface ChannelAnalyticsParams {
  start?: string;
  end?: string;
  metrics?: string[];
}

export interface BestPostingTimesParams {
  providerId?: string;
  timezone?: string;
}

export interface ContentPerformanceParams {
  contentType?: string;
  start?: string;
  end?: string;
}

export interface CrossPlatformAnalyticsParams {
  accountId: string;
  projectId?: string;
  timeRange?: string;
  providers?: string[];
}

/**
 * @class AnalyticsClient
 * @description Client for `/analytics/*` endpoints.
 */
export class AnalyticsClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method getPostAnalytics
   * @description Reads analytics for a specific post.
   * @param postId - Post identifier
   * @param params - Optional date range and provider filter
   */
  async getPostAnalytics(
    postId: string,
    params?: PostAnalyticsParams
  ): Promise<ApiResponse<Analytics[]>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.providerId) searchParams.set("providerId", params.providerId);

    const query = searchParams.toString();
    return request<ApiResponse<Analytics[]>>(
      this.baseUrl,
      `/analytics/posts/${postId}${query ? `?${query}` : ""}`
    );
  }

  /**
   * @method getChannelAnalytics
   * @description Reads analytics for a specific channel.
   * @param channelId - Channel identifier
   * @param params - Optional date range and metrics filter
   */
  async getChannelAnalytics(
    channelId: string,
    params?: ChannelAnalyticsParams
  ): Promise<ApiResponse<Analytics[]>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.metrics) searchParams.set("metrics", params.metrics.join(","));

    const query = searchParams.toString();
    return request<ApiResponse<Analytics[]>>(
      this.baseUrl,
      `/analytics/channels/${channelId}${query ? `?${query}` : ""}`
    );
  }

  /**
   * @method getBestPostingTimes
   * @description Returns best posting time analysis.
   * @param params - Optional provider and timezone filters
   */
  async getBestPostingTimes(params?: BestPostingTimesParams): Promise<ApiResponse<unknown>> {
    const searchParams = new URLSearchParams();
    if (params?.providerId) searchParams.set("providerId", params.providerId);
    if (params?.timezone) searchParams.set("timezone", params.timezone);

    const query = searchParams.toString();
    return request<ApiResponse<unknown>>(
      this.baseUrl,
      `/analytics/posts/best-times${query ? `?${query}` : ""}`
    );
  }

  /**
   * @method getContentPerformance
   * @description Returns content performance breakdown.
   * @param params - Optional content type and date range filters
   */
  async getContentPerformance(params?: ContentPerformanceParams): Promise<ApiResponse<unknown>> {
    const searchParams = new URLSearchParams();
    if (params?.contentType) searchParams.set("contentType", params.contentType);
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);

    const query = searchParams.toString();
    return request<ApiResponse<unknown>>(
      this.baseUrl,
      `/analytics/content/media-performance${query ? `?${query}` : ""}`
    );
  }

  /**
   * @method getCrossPlatformAnalytics
   * @description Returns aggregated analytics across multiple providers.
   * @param params - Account, optional project, time range, and providers filter
   */
  async getCrossPlatformAnalytics(
    params: CrossPlatformAnalyticsParams
  ): Promise<ApiResponse<CrossPlatformAnalyticsData>> {
    const searchParams = new URLSearchParams();
    searchParams.set("accountId", params.accountId);
    if (params.projectId) searchParams.set("projectId", params.projectId);
    if (params.timeRange) searchParams.set("timeRange", params.timeRange);
    if (params.providers) searchParams.set("providers", params.providers.join(","));

    const query = searchParams.toString();
    return request<ApiResponse<CrossPlatformAnalyticsData>>(
      this.baseUrl,
      `/analytics/cross-platform${query ? `?${query}` : ""}`
    );
  }
}
