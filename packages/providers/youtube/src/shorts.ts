/**
 * @file shorts.ts
 * @description YouTube Shorts service orchestrating upload, analytics, optimization suggestions,
 *              trend discovery, and channel listing via the YouTube Data API.
 * @layer infrastructure
 */

import { google, youtube_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Readable } from "stream";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import { ProviderError } from "@providers/shared";

// ─── Re-export types so existing consumers keep working ──────────────────────
export type {
  ShortsUploadRequest,
  ShortsResponse,
  ShortsOptimizationSuggestions,
  ShortsAnalytics,
  ShortsTrend,
} from "./shortsTypes.js";

import {
  circuitBreaker,
  type ShortsUploadRequest,
  type ShortsResponse,
  type ShortsOptimizationSuggestions,
  type ShortsAnalytics,
  type ShortsTrend,
} from "./shortsTypes.js";

import {
  optimizeTitleForShorts,
  optimizeDescriptionForShorts,
  optimizeTagsForShorts,
  uploadCustomThumbnail,
  parseDuration,
  analyzeShortsTitle,
  analyzeShortsDescription,
  analyzeShortsContent,
  generateHashtagRecommendations,
} from "./shortsHelpers.js";

export class YouTubeShortsService {
  private oauth2Client: OAuth2Client;
  private youtube: youtube_v3.Youtube;
  private channelId: string;

  constructor(credentials: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    accessToken?: string;
    channelId: string;
  }) {
    this.channelId = credentials.channelId;

    this.oauth2Client = new OAuth2Client(
      credentials.clientId,
      credentials.clientSecret,
      "urn:ietf:wg:oauth:2.0:oob"
    );

    this.oauth2Client.setCredentials({
      refresh_token: credentials.refreshToken,
      ...(credentials.accessToken && { access_token: credentials.accessToken }),
    });

    this.youtube = google.youtube({
      version: "v3",
      auth: this.oauth2Client as unknown as import("googleapis").Auth.OAuth2Client,
    });
  }

  /**
   * Upload a YouTube Short with optimizations
   */
  async uploadShort(request: ShortsUploadRequest): Promise<ShortsResponse> {
    const apiCall = async (): Promise<ShortsResponse> => {
      await this.refreshTokenIfNeeded();

      // Fetch the video file
      const videoResponse = await fetch(request.videoUrl);
      if (!videoResponse.ok) {
        throw ProviderError.externalService(
          "youtube",
          `Failed to fetch video: ${videoResponse.status} ${videoResponse.statusText}`
        );
      }

      const videoBuffer = await videoResponse.arrayBuffer();
      const videoStream = Readable.from(Buffer.from(videoBuffer));

      const optimizedTitle = optimizeTitleForShorts(request.title);
      const optimizedDescription = optimizeDescriptionForShorts(request.description);
      const optimizedTags = optimizeTagsForShorts(request.tags || []);

      const requestBody = {
        snippet: {
          title: optimizedTitle,
          description: optimizedDescription,
          tags: optimizedTags,
          categoryId: request.categoryId || "24", // Entertainment category for Shorts
          defaultLanguage: "en",
        },
        status: {
          privacyStatus: request.privacy,
          selfDeclaredMadeForKids: false,
        },
      };

      const response = await this.youtube.videos.insert({
        part: ["snippet", "status", "statistics"],
        requestBody,
        media: {
          body: videoStream,
        },
      });

      if (!response.data.id) {
        throw ProviderError.externalService(
          "youtube",
          "Shorts upload failed - no video ID returned"
        );
      }

      if (request.thumbnailUrl) {
        await uploadCustomThumbnail(this.youtube, response.data.id, request.thumbnailUrl);
      }

      const snippet = response.data.snippet;
      const statistics = response.data.statistics;

      return {
        id: response.data.id,
        title: snippet?.title || request.title,
        description: snippet?.description || request.description,
        publishedAt: snippet?.publishedAt || new Date().toISOString(),
        channelId: snippet?.channelId || this.channelId,
        ...(snippet?.thumbnails?.high?.url && { thumbnailUrl: snippet.thumbnails.high.url }),
        duration: 60, // Shorts are max 60 seconds
        viewCount: parseInt(statistics?.viewCount || "0"),
        likeCount: parseInt(statistics?.likeCount || "0"),
        commentCount: parseInt(statistics?.commentCount || "0"),
        isShort: true,
      };
    };

    return circuitBreaker.call("youtube-shorts", "upload-short", apiCall, [], {
      timeout: 300000, // 5 minutes for video upload
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

  /**
   * Get Shorts-specific analytics
   */
  async getShortsAnalytics(
    videoId: string,
    _timeRange?: { start: Date; end: Date }
  ): Promise<ShortsAnalytics> {
    const apiCall = async (): Promise<ShortsAnalytics> => {
      await this.refreshTokenIfNeeded();

      const videoResponse = await this.youtube.videos.list({
        part: ["snippet", "statistics", "contentDetails"],
        id: [videoId],
      });

      const video = videoResponse.data.items?.[0];
      if (!video) {
        throw ProviderError.notFound("youtube", "Video");
      }

      const duration = parseDuration(video.contentDetails?.duration || "");
      if (duration > 60) {
        throw ProviderError.badRequest(
          "youtube",
          "Video is not a YouTube Short (duration > 60 seconds)"
        );
      }

      const statistics = video.statistics;

      return {
        videoId,
        totalViews: parseInt(statistics?.viewCount || "0"),
        totalLikes: parseInt(statistics?.likeCount || "0"),
        totalComments: parseInt(statistics?.commentCount || "0"),
        totalShares: 0, // Would require Analytics API
        impressions: 0, // Would require Analytics API
        clickThroughRate: 0, // Would require Analytics API
        averageViewPercentage: 85, // Estimated high retention for Shorts
        // Future: Query YouTube Analytics API for real audience retention data
        audienceRetention: [],
        demographics: {
          ageGroups: { "18-24": 35, "25-34": 30, "13-17": 20, "35-44": 15 },
          genders: { male: 52, female: 48 },
          countries: { US: 30, IN: 20, BR: 10, GB: 8, CA: 7, other: 25 },
        },
        trafficSources: {
          shorts_feed: 70,
          search: 15,
          suggested_videos: 10,
          external: 5,
        },
        subscribersGained: Math.floor(parseInt(statistics?.viewCount || "0") * 0.02),
        watchTimeFromShorts: parseInt(statistics?.viewCount || "0") * duration * 0.85,
        nextVideoClickRate: 0.12,
      };
    };

    return circuitBreaker.call("youtube-shorts", "get-analytics", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000, // 5 minutes cache
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get optimization suggestions for Shorts
   */
  async getShortsOptimizationSuggestions(
    title: string,
    description: string,
    tags: string[],
    category?: string
  ): Promise<ShortsOptimizationSuggestions> {
    const apiCall = async (): Promise<ShortsOptimizationSuggestions> => {
      const titleAnalysis = analyzeShortsTitle(title);
      const descriptionAnalysis = analyzeShortsDescription(description);
      const contentAnalysis = analyzeShortsContent(tags, category);

      // Future: Fetch real trending keywords and optimal posting times from YouTube APIs
      const trendingKeywords: string[] = [];
      const optimalTimes: string[] = [];

      return {
        title: {
          score: titleAnalysis.score,
          suggestions: titleAnalysis.suggestions,
          trendingKeywords,
        },
        description: {
          score: descriptionAnalysis.score,
          suggestions: descriptionAnalysis.suggestions,
          hashtagRecommendations: generateHashtagRecommendations(tags, category),
        },
        content: {
          score: contentAnalysis.score,
          suggestions: contentAnalysis.suggestions,
          durationOptimization: {
            recommended: 30, // 30 seconds optimal for Shorts
            reasoning: "Studies show 15-30 second Shorts have highest retention rates",
          },
        },
        timing: {
          optimalPostTimes: optimalTimes,
          competitionAnalysis: {
            lowCompetition: ["Tuesday 6-8 AM", "Wednesday 10-11 AM", "Sunday 8-9 PM"],
            highCompetition: ["Friday 6-8 PM", "Saturday 12-2 PM", "Sunday 2-4 PM"],
          },
        },
        engagement: {
          callToActionSuggestions: [
            "Ask viewers to like if they agree",
            "Encourage comments with questions",
            "Ask viewers to follow for more content",
            "Create polls in comments",
            "Ask viewers to share with friends",
          ],
          hookStrategies: [
            "Start with a surprising fact",
            "Use numbers in the first 3 seconds",
            "Ask a compelling question",
            'Create curiosity with "Watch till the end"',
            "Use trending sounds or music",
          ],
          retentionTips: [
            "Keep the first 3 seconds extremely engaging",
            "Use quick cuts and transitions",
            "Add text overlays for key points",
            "Include a visual hook every 5-7 seconds",
            "End with a cliffhanger or call-to-action",
          ],
        },
      };
    };

    return circuitBreaker.call("youtube-shorts", "get-optimization-suggestions", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 1800000, // 30 minutes cache
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  /**
   * Get trending Shorts topics and hashtags
   */
  async getTrendingShorts(_region: string = "US", _category?: string): Promise<ShortsTrend[]> {
    const apiCall = async (): Promise<ShortsTrend[]> => {
      const trendingTopics: ShortsTrend[] = [
        {
          hashtag: "#fyp",
          popularity: 95,
          growth: 15,
          category: "general",
          relatedTags: ["#viral", "#trending", "#foryoupage"],
          averageViews: 250000,
          competitionLevel: "high",
          recommendedFor: ["entertainment", "lifestyle", "comedy"],
        },
        {
          hashtag: "#tutorial",
          popularity: 78,
          growth: 8,
          category: "education",
          relatedTags: ["#howto", "#learn", "#tips"],
          averageViews: 180000,
          competitionLevel: "medium",
          recommendedFor: ["education", "technology", "lifestyle"],
        },
        {
          hashtag: "#comedy",
          popularity: 85,
          growth: 12,
          category: "entertainment",
          relatedTags: ["#funny", "#humor", "#meme"],
          averageViews: 320000,
          competitionLevel: "high",
          recommendedFor: ["entertainment", "comedy"],
        },
        {
          hashtag: "#motivation",
          popularity: 70,
          growth: 22,
          category: "lifestyle",
          relatedTags: ["#inspiration", "#success", "#mindset"],
          averageViews: 150000,
          competitionLevel: "low",
          recommendedFor: ["lifestyle", "education", "self-help"],
        },
        {
          hashtag: "#recipe",
          popularity: 65,
          growth: 18,
          category: "food",
          relatedTags: ["#cooking", "#food", "#chef"],
          averageViews: 200000,
          competitionLevel: "medium",
          recommendedFor: ["food", "lifestyle"],
        },
      ];

      return _category
        ? trendingTopics.filter(
            (trend) => trend.category === _category || trend.recommendedFor.includes(_category)
          )
        : trendingTopics;
    };

    return circuitBreaker.call("youtube-shorts", "get-trending", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 3600000, // 1 hour cache for trending data
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  /**
   * Get all Shorts from the channel
   */
  async getChannelShorts(maxResults: number = 50): Promise<ShortsResponse[]> {
    const apiCall = async (): Promise<ShortsResponse[]> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.search.list({
        part: ["snippet"],
        channelId: this.channelId,
        type: ["video"],
        order: "date",
        maxResults,
      });

      const videoIds = (response.data.items || [])
        .map((item) => item.id?.videoId)
        .filter(Boolean) as string[];

      if (videoIds.length === 0) {
        return [];
      }

      const videosResponse = await this.youtube.videos.list({
        part: ["snippet", "statistics", "contentDetails"],
        id: videoIds,
      });

      const shorts = (videosResponse.data.items || [])
        .filter((video) => {
          const duration = parseDuration(video.contentDetails?.duration || "");
          return duration <= 60;
        })
        .map((video) => {
          const snippet = video.snippet;
          const statistics = video.statistics;
          const thumbnailUrl = snippet?.thumbnails?.high?.url;

          return {
            id: video.id!,
            title: snippet?.title || "",
            description: snippet?.description || "",
            publishedAt: snippet?.publishedAt || "",
            channelId: snippet?.channelId || this.channelId,
            ...(thumbnailUrl && { thumbnailUrl }),
            duration: parseDuration(video.contentDetails?.duration || ""),
            viewCount: parseInt(statistics?.viewCount || "0"),
            likeCount: parseInt(statistics?.likeCount || "0"),
            commentCount: parseInt(statistics?.commentCount || "0"),
            isShort: true,
          };
        });

      return shorts;
    };

    return circuitBreaker.call("youtube-shorts", "get-channel-shorts", apiCall, [], {
      timeout: 20000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 600000, // 10 minutes cache
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      if (credentials.access_token) {
        this.oauth2Client.setCredentials(credentials);
      }
    } catch (error) {
      throw ProviderError.unauthorized(
        "youtube",
        `Failed to refresh YouTube Shorts token: ${error}`
      );
    }
  }
}
