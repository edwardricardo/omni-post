/**
 * @file apiClient.ts
 * @description YouTube Data API client with circuit-breaker resilience,
 * OAuth2 token management, video upload/search/update, and channel analytics.
 * Type definitions live in apiClientTypes.ts.
 */

import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import { ProviderError } from "@providers/shared";
import client from "prom-client";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:youtube:api-client");
import { google, youtube_v3, youtubeAnalytics_v2 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Readable } from "stream";
import { YouTubeAnalyticsService } from "./analytics";
import { YouTubeLiveStreamingService } from "./liveStreaming";
import { YouTubeCommunityService } from "./communityFeatures";
import { YouTubeShortsService } from "./shorts";
import { YouTubePlaylistManager } from "./playlistManager";

// Re-export all types so existing importers continue to work
export type {
  YouTubeCredentials,
  YouTubeUploadResponse,
  YouTubeVideoUploadRequest,
  YouTubeChannelResponse,
  YouTubeAnalyticsResponse,
  YouTubeVideoMetadata,
  YouTubeContentDetails,
} from "./apiClientTypes.js";

import type {
  YouTubeCredentials,
  YouTubeUploadResponse,
  YouTubeVideoUploadRequest,
  YouTubeChannelResponse,
  YouTubeAnalyticsResponse,
  YouTubeContentDetails,
} from "./apiClientTypes.js";

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class YouTubeApiClient {
  readonly credentials: YouTubeCredentials;
  private oauth2Client: OAuth2Client;
  private youtube: youtube_v3.Youtube;
  private youtubeAnalytics: youtubeAnalytics_v2.Youtubeanalytics;

  // Enhanced services
  public readonly analytics: YouTubeAnalyticsService;
  public readonly liveStreaming: YouTubeLiveStreamingService;
  public readonly community: YouTubeCommunityService;
  public readonly shorts: YouTubeShortsService;
  public readonly playlists: YouTubePlaylistManager;

  constructor(credentials: YouTubeCredentials) {
    this.credentials = credentials;

    this.oauth2Client = new OAuth2Client(
      credentials.clientId,
      credentials.clientSecret,
      "urn:ietf:wg:oauth:2.0:oob"
    );

    this.oauth2Client.setCredentials({
      refresh_token: credentials.refreshToken,
      ...(credentials.accessToken && { access_token: credentials.accessToken }),
    });

    this.youtube = (google as any).youtube({ version: "v3", auth: this.oauth2Client });

    this.youtubeAnalytics = (google as any).youtubeAnalytics({
      version: "v2",
      auth: this.oauth2Client,
    });

    this.analytics = new YouTubeAnalyticsService(credentials);
    this.liveStreaming = new YouTubeLiveStreamingService(credentials);
    this.community = new YouTubeCommunityService(credentials);
    this.shorts = new YouTubeShortsService(credentials);
    this.playlists = new YouTubePlaylistManager(credentials);
  }

  async validateCredentials(): Promise<YouTubeChannelResponse> {
    const apiCall = async (): Promise<YouTubeChannelResponse> => {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      if (credentials.access_token) {
        this.oauth2Client.setCredentials(credentials);
        this.credentials.accessToken = credentials.access_token;
      }

      const response = await this.youtube.channels.list({
        part: ["snippet", "statistics"],
        id: [this.credentials.channelId],
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw ProviderError.notFound("youtube", "Channel");
      }

      const channel = response.data.items[0];
      if (!channel) throw ProviderError.notFound("youtube", "Channel data");

      return {
        id: channel.id || this.credentials.channelId,
        title: channel.snippet?.title || "Unknown Channel",
        description: channel.snippet?.description || "",
        subscriberCount: parseInt(channel.statistics?.subscriberCount || "0", 10),
        videoCount: parseInt(channel.statistics?.videoCount || "0", 10),
        viewCount: parseInt(channel.statistics?.viewCount || "0", 10),
      };
    };

    return circuitBreaker.call("youtube-api", "validate-credentials", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000,
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  async uploadVideo(request: YouTubeVideoUploadRequest): Promise<YouTubeUploadResponse> {
    const apiCall = async (): Promise<YouTubeUploadResponse> => {
      await this.refreshTokenIfNeeded();

      const videoResponse = await fetch(request.videoUrl);
      if (!videoResponse.ok) {
        throw ProviderError.externalService(
          "youtube",
          `Failed to fetch video: ${videoResponse.status} ${videoResponse.statusText}`
        );
      }

      const videoBuffer = await videoResponse.arrayBuffer();
      const videoStream = Readable.from(Buffer.from(videoBuffer));

      const response = (await (this.youtube as any).videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: request.title,
            description: request.description,
            tags: request.tags,
            categoryId: request.categoryId || "22",
            defaultLanguage: "en",
          },
          status: { privacyStatus: request.privacy, selfDeclaredMadeForKids: false },
        },
        media: { body: videoStream },
      })) as unknown as { data: youtube_v3.Schema$Video };

      if (!response.data)
        throw ProviderError.externalService("youtube", "Video upload failed - no response data");
      if (!response.data.id)
        throw ProviderError.externalService(
          "youtube",
          "Video upload failed - no video ID returned"
        );

      const snippet = response.data.snippet;
      return {
        id: response.data.id,
        title: snippet?.title || request.title,
        description: snippet?.description || request.description,
        publishedAt: snippet?.publishedAt || new Date().toISOString(),
        channelId: snippet?.channelId || this.credentials.channelId,
        ...(snippet?.thumbnails?.default?.url && { thumbnailUrl: snippet.thumbnails.default.url }),
      };
    };

    return circuitBreaker.call("youtube-api", "upload-video", apiCall, [], {
      timeout: 300000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 5000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
    });
  }

  async getChannelAnalytics(_since?: Date, _until?: Date): Promise<YouTubeAnalyticsResponse> {
    const apiCall = async (): Promise<YouTubeAnalyticsResponse> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.channels.list({
        part: ["statistics"],
        id: [this.credentials.channelId],
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw ProviderError.notFound("youtube", "Channel (analytics)");
      }

      const channelItem = response.data.items[0];
      if (!channelItem) throw ProviderError.notFound("youtube", "Channel data (analytics)");

      const statistics = channelItem.statistics;
      return {
        views: parseInt(statistics?.viewCount || "0", 10),
        likes: 0,
        comments: parseInt(statistics?.commentCount || "0", 10),
        shares: 0,
        subscribersGained: 0,
        subscribersLost: 0,
        watchTime: 0,
      };
    };

    const fallback = async (): Promise<YouTubeAnalyticsResponse> => {
      logger.warn("Using fallback response for YouTube Analytics");
      return {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        subscribersGained: 0,
        subscribersLost: 0,
        watchTime: 0,
      };
    };

    return circuitBreaker.call("youtube-api", "get-channel-analytics", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000,
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
      fallback,
    });
  }

  async deleteVideo(videoId: string): Promise<{ success: boolean }> {
    const apiCall = async (): Promise<{ success: boolean }> => {
      await this.refreshTokenIfNeeded();
      await this.youtube.videos.delete({ id: videoId });
      return { success: true };
    };

    return circuitBreaker.call("youtube-api", "delete-video", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
    });
  }

  async getVideoDetails(videoId: string): Promise<{
    snippet: youtube_v3.Schema$VideoSnippet | null | undefined;
    statistics: youtube_v3.Schema$VideoStatistics | null | undefined;
    contentDetails: YouTubeContentDetails;
    status: youtube_v3.Schema$VideoStatus | null | undefined;
  }> {
    const apiCall = async () => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.videos.list({
        part: ["snippet", "statistics", "contentDetails", "status"],
        id: [videoId],
      });

      if (!response.data.items || response.data.items.length === 0)
        throw ProviderError.notFound("youtube", "Video");
      const video = response.data.items[0];
      if (!video) throw ProviderError.notFound("youtube", "Video data");

      return {
        snippet: video.snippet,
        statistics: video.statistics,
        contentDetails: video.contentDetails as YouTubeContentDetails,
        status: video.status,
      };
    };

    return circuitBreaker.call("youtube-api", "get-video-details", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000,
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  async searchVideos(
    query: string,
    options?: {
      maxResults?: number;
      order?: "date" | "rating" | "relevance" | "title" | "viewCount";
      publishedAfter?: Date;
      publishedBefore?: Date;
      channelId?: string;
      type?: "channel" | "playlist" | "video";
    }
  ): Promise<
    Array<{
      videoId: string;
      title: string;
      description: string;
      publishedAt: string;
      channelId: string;
      channelTitle: string;
      thumbnailUrl?: string;
    }>
  > {
    const apiCall = async () => {
      await this.refreshTokenIfNeeded();

      const response = (await (this.youtube as any).search.list({
        part: ["snippet"],
        q: query,
        type: [options?.type || "video"],
        order: options?.order || "relevance",
        maxResults: options?.maxResults || 25,
        channelId: options?.channelId,
        publishedAfter: options?.publishedAfter?.toISOString(),
        publishedBefore: options?.publishedBefore?.toISOString(),
      })) as unknown as { data: youtube_v3.Schema$SearchListResponse };

      if (!response.data)
        throw ProviderError.externalService("youtube", "Search failed - no response data");

      return (response.data.items || []).map((item: youtube_v3.Schema$SearchResult) => ({
        videoId: item.id?.videoId || "",
        title: item.snippet?.title || "",
        description: item.snippet?.description || "",
        publishedAt: item.snippet?.publishedAt || "",
        channelId: item.snippet?.channelId || "",
        channelTitle: item.snippet?.channelTitle || "",
        ...(item.snippet?.thumbnails?.high?.url && {
          thumbnailUrl: item.snippet.thumbnails.high.url,
        }),
      }));
    };

    return circuitBreaker.call("youtube-api", "search-videos", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 600000,
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  async updateVideo(
    videoId: string,
    updates: {
      title?: string;
      description?: string;
      tags?: string[];
      categoryId?: string;
      privacy?: "public" | "private" | "unlisted";
    }
  ): Promise<YouTubeUploadResponse> {
    const apiCall = async (): Promise<YouTubeUploadResponse> => {
      await this.refreshTokenIfNeeded();

      const currentVideo = await this.youtube.videos.list({
        part: ["snippet", "status"],
        id: [videoId],
      });
      if (!currentVideo.data.items || currentVideo.data.items.length === 0)
        throw ProviderError.notFound("youtube", "Video");

      const current = currentVideo.data.items[0];
      if (!current) throw ProviderError.notFound("youtube", "Video data");
      if (!current.snippet || !current.status)
        throw ProviderError.notFound("youtube", "Video snippet or status");

      const response = (await (this.youtube as any).videos.update({
        part: ["snippet", "status"],
        requestBody: {
          id: videoId,
          snippet: {
            title: updates.title || current.snippet.title,
            description: updates.description || current.snippet.description,
            tags: updates.tags || current.snippet.tags,
            categoryId: updates.categoryId || current.snippet.categoryId,
            channelId: this.credentials.channelId,
          },
          status: {
            privacyStatus: updates.privacy || current.status.privacyStatus,
            selfDeclaredMadeForKids: current.status.selfDeclaredMadeForKids,
          },
        },
      })) as unknown as { data: youtube_v3.Schema$Video };

      if (!response.data)
        throw ProviderError.externalService("youtube", "Video update failed - no response data");
      if (!response.data.id)
        throw ProviderError.externalService("youtube", "Video update failed - no video ID");

      const snippet = response.data.snippet;
      return {
        id: response.data.id,
        title: snippet?.title || updates.title || "",
        description: snippet?.description || updates.description || "",
        publishedAt: snippet?.publishedAt || "",
        channelId: snippet?.channelId || this.credentials.channelId,
        ...(snippet?.thumbnails?.default?.url && { thumbnailUrl: snippet.thumbnails.default.url }),
      };
    };

    return circuitBreaker.call("youtube-api", "update-video", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
    });
  }

  async uploadThumbnail(videoId: string, thumbnailUrl: string): Promise<boolean> {
    const apiCall = async (): Promise<boolean> => {
      await this.refreshTokenIfNeeded();

      const thumbnailResponse = await fetch(thumbnailUrl);
      if (!thumbnailResponse.ok)
        throw ProviderError.externalService(
          "youtube",
          `Failed to fetch thumbnail: ${thumbnailResponse.status}`
        );

      const thumbnailBuffer = await thumbnailResponse.arrayBuffer();
      const thumbnailStream = Readable.from(Buffer.from(thumbnailBuffer));

      await this.youtube.thumbnails.set({ videoId, media: { body: thumbnailStream } });
      return true;
    };

    return circuitBreaker.call("youtube-api", "upload-thumbnail", apiCall, [], {
      timeout: 60000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
    });
  }

  async getChannelStats(): Promise<{
    subscriberCount: number;
    videoCount: number;
    viewCount: number;
    customUrl?: string;
    country?: string;
    uploads: string;
  }> {
    const apiCall = async () => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.channels.list({
        part: ["snippet", "statistics", "contentDetails"],
        id: [this.credentials.channelId],
      });

      if (!response.data.items || response.data.items.length === 0)
        throw ProviderError.notFound("youtube", "Channel");
      const channel = response.data.items[0];
      if (!channel) throw ProviderError.notFound("youtube", "Channel data");
      if (!channel.statistics || !channel.snippet || !channel.contentDetails) {
        throw ProviderError.notFound("youtube", "Channel statistics, snippet, or content details");
      }

      return {
        subscriberCount: parseInt(channel.statistics.subscriberCount || "0"),
        videoCount: parseInt(channel.statistics.videoCount || "0"),
        viewCount: parseInt(channel.statistics.viewCount || "0"),
        ...(channel.snippet.customUrl && { customUrl: channel.snippet.customUrl }),
        ...(channel.snippet.country && { country: channel.snippet.country }),
        uploads: channel.contentDetails.relatedPlaylists?.uploads || "",
      };
    };

    return circuitBreaker.call("youtube-api", "get-channel-stats", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000,
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  async refreshToken(): Promise<string> {
    const { credentials } = await this.oauth2Client.refreshAccessToken();
    if (credentials.access_token) {
      this.oauth2Client.setCredentials(credentials);
      this.credentials.accessToken = credentials.access_token;
      return credentials.access_token;
    }
    throw ProviderError.unauthorized("youtube", "Failed to refresh YouTube access token");
  }

  /**
   * @method getVideoComments
   * @description Fetches comment threads for a video via commentThreads.list.
   *              Uses 1 quota unit per call.
   * @param videoId - The YouTube video ID
   * @param maxResults - Max results per page (default 20, max 100)
   * @param pageToken - Pagination token from a previous response
   */
  async getVideoComments(
    videoId: string,
    maxResults: number = 20,
    pageToken?: string
  ): Promise<{
    items: Array<{
      id: string;
      snippet: {
        topLevelComment: {
          id: string;
          snippet: {
            textDisplay: string;
            authorDisplayName: string;
            authorChannelId?: { value: string };
            authorProfileImageUrl?: string;
            publishedAt: string;
          };
        };
        totalReplyCount: number;
      };
    }>;
    nextPageToken?: string;
  }> {
    const apiCall = async () => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.commentThreads.list({
        part: ["snippet"],
        videoId,
        maxResults: Math.min(maxResults, 100),
        order: "time",
        ...(pageToken ? { pageToken } : {}),
      });

      return {
        items: (response.data.items || []).map((item) => ({
          id: item.id || "",
          snippet: {
            topLevelComment: {
              id: item.snippet?.topLevelComment?.id || "",
              snippet: {
                textDisplay: item.snippet?.topLevelComment?.snippet?.textDisplay || "",
                authorDisplayName: item.snippet?.topLevelComment?.snippet?.authorDisplayName || "",
                ...(item.snippet?.topLevelComment?.snippet?.authorChannelId
                  ? {
                      authorChannelId: item.snippet.topLevelComment.snippet.authorChannelId as {
                        value: string;
                      },
                    }
                  : {}),
                ...(item.snippet?.topLevelComment?.snippet?.authorProfileImageUrl
                  ? {
                      authorProfileImageUrl:
                        item.snippet.topLevelComment.snippet.authorProfileImageUrl,
                    }
                  : {}),
                publishedAt: item.snippet?.topLevelComment?.snippet?.publishedAt || "",
              },
            },
            totalReplyCount: item.snippet?.totalReplyCount || 0,
          },
        })),
        ...(response.data.nextPageToken ? { nextPageToken: response.data.nextPageToken } : {}),
      };
    };

    return circuitBreaker.call("youtube-api", "get-video-comments", apiCall, [], {
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
   * @method postComment
   * @description Posts a comment on a video or replies to an existing comment.
   *              Uses 50 quota units per call.
   * @param videoId - The YouTube video ID
   * @param text - Comment text
   * @param parentId - Optional parent comment ID for threaded replies
   */
  async postComment(
    videoId: string,
    text: string,
    parentId?: string
  ): Promise<{ id: string; publishedAt: string }> {
    const apiCall = async () => {
      await this.refreshTokenIfNeeded();

      if (parentId) {
        // Reply to existing comment
        const response = await this.youtube.comments.insert({
          part: ["snippet"],
          requestBody: {
            snippet: {
              parentId,
              textOriginal: text,
            },
          },
        });

        return {
          id: response.data.id || "",
          publishedAt: response.data.snippet?.publishedAt || new Date().toISOString(),
        };
      }

      // New top-level comment
      const response = await this.youtube.commentThreads.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            videoId,
            topLevelComment: {
              snippet: {
                textOriginal: text,
              },
            },
          },
        },
      });

      return {
        id: response.data.id || "",
        publishedAt:
          response.data.snippet?.topLevelComment?.snippet?.publishedAt || new Date().toISOString(),
      };
    };

    return circuitBreaker.call("youtube-api", "post-comment", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 2,
      baseDelay: 2000,
      maxDelay: 15000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
    });
  }

  getCircuitBreakerStatus(): Record<string, unknown> {
    return circuitBreaker.getAllStatuses();
  }

  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  clearCache(): void {
    circuitBreaker.clearCache("youtube-api");
  }

  forceCircuitBreakerOpen(operation: string): boolean {
    return circuitBreaker.forceOpen("youtube-api", operation);
  }

  forceCircuitBreakerClose(operation: string): boolean {
    return circuitBreaker.forceClose("youtube-api", operation);
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      if (credentials.access_token) {
        this.oauth2Client.setCredentials(credentials);
        this.credentials.accessToken = credentials.access_token;
      }
    } catch (error) {
      throw ProviderError.unauthorized("youtube", `Failed to refresh YouTube token: ${error}`);
    }
  }
}
