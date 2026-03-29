import { FacebookApiClient, FacebookCredentials } from "../apiClient.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:facebook:reels");

export interface FacebookReelOptions {
  videoUrl: string;
  description?: string;
  coverImageUrl?: string;
  audienceRestriction?: "public" | "friends" | "only_me";
  allowComments?: boolean;
  allowSharing?: boolean;
  allowRemixing?: boolean;
  locationTag?: {
    placeId: string;
    placeName?: string;
  };
  hashtags?: string[];
  mentions?: Array<{
    userId: string;
    username: string;
  }>;
  musicTrack?: {
    trackId: string;
    startTime?: number; // in seconds
    duration?: number; // in seconds
  };
  effects?: Array<{
    effectId: string;
    effectName: string;
  }>;
  scheduledPublishTime?: Date;
  crossPostToInstagram?: boolean;
}

export interface FacebookReelResponse {
  id: string;
  permalink: string;
  createdTime: string;
  description?: string;
  videoId: string;
  thumbnailUrl?: string;
  status: "processing" | "ready" | "error";
  duration?: number;
  insights?: {
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    reach?: number;
    impressions?: number;
    saves?: number;
    profileVisits?: number;
  };
}

export interface FacebookReelInsights {
  reelId: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reach: number;
  impressions: number;
  profileVisits: number;
  averageWatchTime: number;
  completionRate: number;
  clicksToProfile: number;
  clicksToWebsite: number;
  period: {
    since: string;
    until: string;
  };
  demographics?: {
    ageGroups: Record<string, number>;
    genders: Record<string, number>;
    countries: Record<string, number>;
    cities: Record<string, number>;
  };
}

export interface FacebookReelVideoMetrics {
  reelId: string;
  totalPlayTime: number;
  averagePlayTime: number;
  replays: number;
  watchTimeBreakdown: {
    "0-3s": number;
    "3-10s": number;
    "10-15s": number;
    "15-30s": number;
    "30s+": number;
  };
  dropoffPoints: Array<{
    timestamp: number;
    percentage: number;
  }>;
}

export interface FacebookReelTrending {
  hashtags: Array<{
    hashtag: string;
    usage: number;
    trend: "rising" | "stable" | "falling";
  }>;
  audioTracks: Array<{
    trackId: string;
    trackName: string;
    artist: string;
    usage: number;
  }>;
  effects: Array<{
    effectId: string;
    effectName: string;
    usage: number;
  }>;
}

export class FacebookReelsApi {
  private apiClient: FacebookApiClient;

  constructor(credentials: FacebookCredentials) {
    this.apiClient = new FacebookApiClient(credentials);
  }

  /**
   * Create and publish a Facebook Reel
   */
  async createReel(options: FacebookReelOptions): Promise<FacebookReelResponse> {
    // First upload the video
    const videoUpload = await this.uploadReelVideo(options.videoUrl, options.description);

    // Upload cover image if provided
    let coverImageId: string | undefined;
    if (options.coverImageUrl) {
      const coverUpload = await this.apiClient.uploadUnpublishedMedia(
        options.coverImageUrl,
        "photo"
      );
      coverImageId = coverUpload.id;
    }

    // Prepare reel data
    const reelData: Record<string, unknown> = {
      video_id: videoUpload.id,
      description: this.buildDescription(options),
    };

    // Add cover image
    if (coverImageId) {
      reelData.thumb = coverImageId;
    }

    // Add privacy settings
    if (options.audienceRestriction) {
      reelData.privacy = this.mapAudienceRestriction(options.audienceRestriction);
    }

    // Add interaction settings
    if (options.allowComments !== undefined) {
      reelData.allow_comments = options.allowComments;
    }
    if (options.allowSharing !== undefined) {
      reelData.allow_sharing = options.allowSharing;
    }
    if (options.allowRemixing !== undefined) {
      reelData.allow_remix = options.allowRemixing;
    }

    // Add location tag
    if (options.locationTag) {
      reelData.place = options.locationTag.placeId;
    }

    // Add music track
    if (options.musicTrack) {
      reelData.audio_story_wave_animation_handle = options.musicTrack.trackId;
      if (options.musicTrack.startTime !== undefined) {
        reelData.audio_start_time_ms = options.musicTrack.startTime * 1000;
      }
      if (options.musicTrack.duration !== undefined) {
        reelData.audio_duration_ms = options.musicTrack.duration * 1000;
      }
    }

    // Add effects
    if (options.effects?.length) {
      reelData.composer_effects = options.effects.map((effect) => effect.effectId);
    }

    // Add scheduled publish time
    if (options.scheduledPublishTime) {
      reelData.scheduled_publish_time = Math.floor(options.scheduledPublishTime.getTime() / 1000);
      reelData.published = false;
    }

    // Create the reel
    const response = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/video_reels`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reelData),
      }
    );

    const result = await response.json();

    // Cross-post to Instagram if requested
    if (options.crossPostToInstagram && this.apiClient.credentials.instagramBusinessAccountId) {
      await this.crossPostToInstagram(result.id, options);
    }

    return {
      id: result.id,
      permalink: result.permalink_url || `https://www.facebook.com/reel/${result.id}`,
      createdTime: new Date().toISOString(),
      ...(options.description && { description: options.description }),
      videoId: videoUpload.id,
      status: "processing" as const,
    };
  }

  /**
   * Upload video specifically for Reels with optimization
   */
  private async uploadReelVideo(
    videoUrl: string,
    description?: string
  ): Promise<{ id: string; uploadSessionId?: string }> {
    // For large videos, use resumable upload
    const videoResponse = await fetch(videoUrl);
    const videoSize = parseInt(videoResponse.headers.get("content-length") || "0");

    if (videoSize > 50 * 1024 * 1024) {
      // 50MB threshold for resumable upload
      return this.uploadLargeVideo(videoUrl, description);
    }

    // Standard upload for smaller videos
    const uploadResult = await this.apiClient.uploadMedia(videoUrl, "video", {
      published: false,
      ...(description && { caption: description }),
    });

    return {
      id: uploadResult.id,
    };
  }

  /**
   * Upload large video using resumable upload
   */
  private async uploadLargeVideo(
    videoUrl: string,
    description?: string
  ): Promise<{ id: string; uploadSessionId: string }> {
    // Step 1: Initialize upload session
    const initResponse = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/videos`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          upload_phase: "start",
          file_size: await this.getFileSize(videoUrl),
          description: description,
        }),
      }
    );

    const initResult = await initResponse.json();
    const uploadSessionId = initResult.upload_session_id;

    // Step 2: Upload video chunks
    const videoResponse = await fetch(videoUrl);
    const videoBuffer = await videoResponse.arrayBuffer();
    const chunkSize = 4 * 1024 * 1024; // 4MB chunks
    let offset = 0;

    while (offset < videoBuffer.byteLength) {
      const chunk = videoBuffer.slice(offset, offset + chunkSize);

      const formData = new FormData();
      formData.append("upload_phase", "transfer");
      formData.append("upload_session_id", uploadSessionId);
      formData.append("start_offset", offset.toString());
      formData.append("video_file_chunk", new Blob([chunk]));

      await this.apiClient.makeApiRequest(`/${this.apiClient.credentials.pageId}/videos`, {
        method: "POST",
        body: formData,
      });

      offset += chunkSize;
    }

    // Step 3: Finalize upload
    const finalizeResponse = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/videos`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          upload_phase: "finish",
          upload_session_id: uploadSessionId,
        }),
      }
    );

    const finalResult = await finalizeResponse.json();

    return {
      id: finalResult.id,
      uploadSessionId,
    };
  }

  /**
   * Get file size from URL
   */
  private async getFileSize(url: string): Promise<number> {
    const response = await fetch(url, { method: "HEAD" });
    return parseInt(response.headers.get("content-length") || "0");
  }

  /**
   * Build description with hashtags and mentions
   */
  private buildDescription(options: FacebookReelOptions): string {
    let description = options.description || "";

    // Add hashtags
    if (options.hashtags?.length) {
      const hashtagString = options.hashtags
        .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
        .join(" ");
      description += description ? ` ${hashtagString}` : hashtagString;
    }

    // Add mentions
    if (options.mentions?.length) {
      const mentionString = options.mentions.map((mention) => `@${mention.username}`).join(" ");
      description += description ? ` ${mentionString}` : mentionString;
    }

    return description;
  }

  /**
   * Map audience restriction to Facebook privacy format
   */
  private mapAudienceRestriction(restriction: string): Record<string, string> {
    switch (restriction) {
      case "public":
        return { value: "EVERYONE" };
      case "friends":
        return { value: "ALL_FRIENDS" };
      case "only_me":
        return { value: "SELF" };
      default:
        return { value: "EVERYONE" };
    }
  }

  /**
   * Cross-post reel to Instagram
   */
  private async crossPostToInstagram(reelId: string, options: FacebookReelOptions): Promise<void> {
    try {
      await this.apiClient.makeApiRequest(
        `/${this.apiClient.credentials.instagramBusinessAccountId}/media`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            media_type: "REELS",
            video_url: `https://www.facebook.com/reel/${reelId}`,
            caption: this.buildDescription(options),
          }),
        }
      );
    } catch (error) {
      logger.warn({ err: error }, "Failed to cross-post to Instagram");
    }
  }

  /**
   * Get reel details and status
   */
  async getReelDetails(reelId: string): Promise<FacebookReelResponse> {
    const response = await this.apiClient.makeApiRequest(
      `/${reelId}?fields=id,permalink_url,created_time,description,status,length,thumbnails`
    );

    const data = await response.json();

    return {
      id: data.id,
      permalink: data.permalink_url,
      createdTime: data.created_time,
      description: data.description,
      videoId: data.id,
      thumbnailUrl: data.thumbnails?.data?.[0]?.uri,
      status: data.status === "ready" ? "ready" : "processing",
      duration: data.length,
    };
  }

  /**
   * Get reel insights and analytics
   */
  async getReelInsights(
    reelId: string,
    period?: { since?: Date; until?: Date }
  ): Promise<FacebookReelInsights> {
    const metrics = [
      "video_views",
      "video_views_unique",
      "video_views_10s",
      "video_avg_time_watched",
      "video_complete_views_30s",
      "post_reactions_like_total",
      "post_comments",
      "post_shares",
      "reach",
      "impressions",
      "saves",
      "profile_views",
    ];

    const params = new URLSearchParams({
      metric: metrics.join(","),
      period: "lifetime",
    });

    if (period?.since) {
      params.append("since", Math.floor(period.since.getTime() / 1000).toString());
    }
    if (period?.until) {
      params.append("until", Math.floor(period.until.getTime() / 1000).toString());
    }

    const response = await this.apiClient.makeApiRequest(`/${reelId}/insights?${params}`);

    const data = await response.json();

    // Parse insights data
    const insights: Partial<FacebookReelInsights> = {
      reelId,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      reach: 0,
      impressions: 0,
      profileVisits: 0,
      averageWatchTime: 0,
      completionRate: 0,
    };

    if (data.data && Array.isArray(data.data)) {
      for (const metric of data.data) {
        const value = metric.values?.[0]?.value || 0;

        switch (metric.name) {
          case "video_views":
            insights.views = value;
            break;
          case "video_avg_time_watched":
            insights.averageWatchTime = value;
            break;
          case "video_complete_views_30s":
            insights.completionRate = insights.views ? (value / insights.views) * 100 : 0;
            break;
          case "post_reactions_like_total":
            insights.likes = value;
            break;
          case "post_comments":
            insights.comments = value;
            break;
          case "post_shares":
            insights.shares = value;
            break;
          case "reach":
            insights.reach = value;
            break;
          case "impressions":
            insights.impressions = value;
            break;
          case "saves":
            insights.saves = value;
            break;
          case "profile_views":
            insights.profileVisits = value;
            break;
        }
      }
    }

    return insights as FacebookReelInsights;
  }

  /**
   * Get video-specific metrics for reel
   */
  async getReelVideoMetrics(reelId: string): Promise<FacebookReelVideoMetrics> {
    const metrics = [
      "video_view_time",
      "video_view_time_avg",
      "video_repeat_views",
      "video_view_time_by_age_bucket_and_gender",
      "video_view_time_by_country_id",
    ];

    const response = await this.apiClient.makeApiRequest(
      `/${reelId}/video_insights?metric=${metrics.join(",")}`
    );

    const data = await response.json();

    const metrics_data: Partial<FacebookReelVideoMetrics> = {
      reelId,
      totalPlayTime: 0,
      averagePlayTime: 0,
      replays: 0,
      watchTimeBreakdown: {
        "0-3s": 0,
        "3-10s": 0,
        "10-15s": 0,
        "15-30s": 0,
        "30s+": 0,
      },
      dropoffPoints: [],
    };

    // Process video metrics data
    if (data.data && Array.isArray(data.data)) {
      for (const metric of data.data) {
        const value = metric.values?.[0]?.value || 0;

        switch (metric.name) {
          case "video_view_time":
            metrics_data.totalPlayTime = value;
            break;
          case "video_view_time_avg":
            metrics_data.averagePlayTime = value;
            break;
          case "video_repeat_views":
            metrics_data.replays = value;
            break;
        }
      }
    }

    return metrics_data as FacebookReelVideoMetrics;
  }

  /**
   * Get trending hashtags and audio for reels
   */
  async getTrendingContent(): Promise<FacebookReelTrending> {
    // Future: Facebook Graph API does not yet provide a public trending Reels endpoint.
    // Re-evaluate when Meta exposes trend data via the Content Publishing API.
    return {
      hashtags: [],
      audioTracks: [],
      effects: [],
    };
  }

  /**
   * Delete a reel
   */
  async deleteReel(reelId: string): Promise<boolean> {
    try {
      const response = await this.apiClient.makeApiRequest(`/${reelId}`, {
        method: "DELETE",
      });

      const result = await response.json();
      return result.success === true;
    } catch (error) {
      logger.error({ err: error }, "Failed to delete reel");
      return false;
    }
  }

  /**
   * Get reel comments
   */
  async getReelComments(
    reelId: string,
    limit = 25
  ): Promise<
    Array<{
      id: string;
      message: string;
      from: { id: string; name: string };
      createdTime: string;
      likeCount: number;
      replyCount: number;
    }>
  > {
    const response = await this.apiClient.makeApiRequest(
      `/${reelId}/comments?fields=id,message,from,created_time,like_count,comment_count&limit=${limit}`
    );

    const data = await response.json();

    return (data.data || []).map(
      (comment: {
        id: string;
        message: string;
        from: unknown;
        created_time: string;
        like_count?: number;
        comment_count?: number;
      }) => ({
        id: comment.id,
        message: comment.message,
        from: comment.from,
        createdTime: comment.created_time,
        likeCount: comment.like_count || 0,
        replyCount: comment.comment_count || 0,
      })
    );
  }

  /**
   * Update reel settings (privacy, comments, etc.)
   */
  async updateReelSettings(
    reelId: string,
    settings: {
      privacy?: "public" | "friends" | "only_me";
      allowComments?: boolean;
      allowSharing?: boolean;
    }
  ): Promise<boolean> {
    try {
      const updateData: Record<string, unknown> = {};

      if (settings.privacy) {
        updateData.privacy = this.mapAudienceRestriction(settings.privacy);
      }

      if (settings.allowComments !== undefined) {
        updateData.allow_comments = settings.allowComments;
      }

      if (settings.allowSharing !== undefined) {
        updateData.allow_sharing = settings.allowSharing;
      }

      const response = await this.apiClient.makeApiRequest(`/${reelId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      });

      const result = await response.json();
      return result.success === true;
    } catch (error) {
      logger.error({ err: error }, "Failed to update reel settings");
      return false;
    }
  }
}
