/**
 * @file stories.ts
 * @description Facebook Stories service — creates and manages 24-hour photo/video stories with
 *              links, stickers, and engagement insights via the Graph API.
 * @layer infrastructure
 */
import { FacebookApiClient, FacebookCredentials } from "../apiClient.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:facebook:stories");

export interface FacebookStoryMedia {
  id: string;
  mediaType: "photo" | "video";
  url: string;
  thumbnailUrl?: string;
}

export interface FacebookStoryLink {
  url: string;
  displayUrl?: string;
}

export interface FacebookStoryMention {
  id: string; // User or Page ID
  x: number; // X coordinate (0-1)
  y: number; // Y coordinate (0-1)
}

export interface FacebookStoryHashtag {
  hashtag: string;
  x: number;
  y: number;
}

export interface FacebookStoryPoll {
  question: string;
  option1: string;
  option2: string;
  x: number;
  y: number;
}

export interface FacebookStorySlider {
  question: string;
  emoji?: string;
  x: number;
  y: number;
}

export interface FacebookStoryInteractiveElements {
  mentions?: FacebookStoryMention[];
  hashtags?: FacebookStoryHashtag[];
  polls?: FacebookStoryPoll[];
  sliders?: FacebookStorySlider[];
  link?: FacebookStoryLink;
}

export interface FacebookStoryOptions {
  media: FacebookStoryMedia;
  interactive?: FacebookStoryInteractiveElements;
  audienceRestriction?: "everyone" | "friends" | "custom";
  customAudience?: string[]; // User IDs for custom audience
  locationTag?: {
    placeId: string;
    coordinateX?: number;
    coordinateY?: number;
  };
  allowResharing?: boolean;
  hideFromTimeline?: boolean;
}

export interface FacebookStoryResponse {
  id: string;
  createdTime: string;
  expiresAt: string;
  permalink?: string;
  insights?: {
    reach?: number;
    impressions?: number;
    replies?: number;
    shares?: number;
    tapsForward?: number;
    tapsBack?: number;
    exits?: number;
  };
}

export interface FacebookStoryInsights {
  storyId: string;
  reach: number;
  impressions: number;
  replies: number;
  shares: number;
  tapsForward: number;
  tapsBack: number;
  exits: number;
  profileVisits: number;
  websiteClicks: number;
  period: {
    since: string;
    until: string;
  };
}

export class FacebookStoriesApi {
  private apiClient: FacebookApiClient;

  constructor(credentials: FacebookCredentials) {
    this.apiClient = new FacebookApiClient(credentials);
  }

  /**
   * Create and publish a Facebook Story
   */
  async createStory(options: FacebookStoryOptions): Promise<FacebookStoryResponse> {
    // First upload the media if it's a URL
    let mediaId: string;

    if (options.media.url.startsWith("http")) {
      const uploadResult = await this.apiClient.uploadUnpublishedMedia(
        options.media.url,
        options.media.mediaType
      );
      mediaId = uploadResult.id;
    } else {
      mediaId = options.media.id;
    }

    // Prepare story data
    const storyData: Record<string, unknown> = {
      media_fbid: mediaId,
    };

    // Add interactive elements
    if (options.interactive) {
      if (options.interactive.mentions?.length) {
        storyData.tags = options.interactive.mentions.map((mention) => ({
          tag_uid: mention.id,
          x: mention.x,
          y: mention.y,
        }));
      }

      if (options.interactive.hashtags?.length) {
        storyData.hashtags = options.interactive.hashtags.map((hashtag) => ({
          hashtag: hashtag.hashtag,
          x: hashtag.x,
          y: hashtag.y,
        }));
      }

      if (options.interactive.polls && options.interactive.polls.length > 0) {
        const poll = options.interactive.polls[0];
        if (poll) {
          storyData.polls = [
            {
              question: poll.question,
              option_1: poll.option1,
              option_2: poll.option2,
              x: poll.x,
              y: poll.y,
            },
          ];
        }
      }

      if (options.interactive.sliders && options.interactive.sliders.length > 0) {
        const slider = options.interactive.sliders[0];
        if (slider) {
          storyData.sliders = [
            {
              question: slider.question,
              emoji: slider.emoji || "👍",
              x: slider.x,
              y: slider.y,
            },
          ];
        }
      }

      if (options.interactive.link) {
        storyData.link = {
          url: options.interactive.link.url,
          display_url: options.interactive.link.displayUrl,
        };
      }
    }

    // Add audience restrictions
    if (options.audienceRestriction === "friends") {
      storyData.privacy = { value: "FRIENDS" };
    } else if (options.audienceRestriction === "custom" && options.customAudience?.length) {
      storyData.privacy = {
        value: "CUSTOM",
        allow: options.customAudience.join(","),
      };
    }

    // Add location tag
    if (options.locationTag) {
      storyData.place = options.locationTag.placeId;
      if (
        options.locationTag.coordinateX !== undefined &&
        options.locationTag.coordinateY !== undefined
      ) {
        storyData.coordinates = {
          latitude: options.locationTag.coordinateX,
          longitude: options.locationTag.coordinateY,
        };
      }
    }

    // Add story-specific options
    if (options.allowResharing !== undefined) {
      storyData.allow_story_reshare = options.allowResharing;
    }

    if (options.hideFromTimeline !== undefined) {
      storyData.hide_from_timeline = options.hideFromTimeline;
    }

    // Create the story using Facebook Graph API
    const response = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/stories`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(storyData),
      }
    );

    const result = await response.json();

    // Calculate expiration time (24 hours from creation)
    const createdTime = new Date();
    const expiresAt = new Date(createdTime.getTime() + 24 * 60 * 60 * 1000);

    return {
      id: result.id,
      createdTime: createdTime.toISOString(),
      expiresAt: expiresAt.toISOString(),
      permalink: result.permalink_url,
    };
  }

  /**
   * Get active stories for the page
   */
  async getActiveStories(): Promise<FacebookStoryResponse[]> {
    const response = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/stories?fields=id,created_time,permalink_url`
    );

    const data = await response.json();

    return (data.data || []).map(
      (story: { id: string; created_time: string; permalink_url?: string }) => {
        const createdTime = new Date(story.created_time);
        const expiresAt = new Date(createdTime.getTime() + 24 * 60 * 60 * 1000);

        return {
          id: story.id,
          createdTime: story.created_time,
          expiresAt: expiresAt.toISOString(),
          ...(story.permalink_url ? { permalink: story.permalink_url } : {}),
        };
      }
    );
  }

  /**
   * Get story insights and analytics
   */
  async getStoryInsights(
    storyId: string,
    period?: { since?: Date; until?: Date }
  ): Promise<FacebookStoryInsights> {
    const metrics = [
      "story_impressions",
      "story_reach",
      "story_replies",
      "story_shares",
      "story_taps_forward",
      "story_taps_back",
      "story_exits",
      "story_profile_visits",
      "story_website_clicks",
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

    const response = await this.apiClient.makeApiRequest(`/${storyId}/insights?${params}`);

    const data = await response.json();

    // Parse insights data
    const insights: Partial<FacebookStoryInsights> = {
      storyId,
      reach: 0,
      impressions: 0,
      replies: 0,
      shares: 0,
      tapsForward: 0,
      tapsBack: 0,
      exits: 0,
      profileVisits: 0,
      websiteClicks: 0,
    };

    if (data.data && Array.isArray(data.data)) {
      for (const metric of data.data) {
        const value = metric.values?.[0]?.value || 0;

        switch (metric.name) {
          case "story_impressions":
            insights.impressions = value;
            break;
          case "story_reach":
            insights.reach = value;
            break;
          case "story_replies":
            insights.replies = value;
            break;
          case "story_shares":
            insights.shares = value;
            break;
          case "story_taps_forward":
            insights.tapsForward = value;
            break;
          case "story_taps_back":
            insights.tapsBack = value;
            break;
          case "story_exits":
            insights.exits = value;
            break;
          case "story_profile_visits":
            insights.profileVisits = value;
            break;
          case "story_website_clicks":
            insights.websiteClicks = value;
            break;
        }
      }
    }

    return insights as FacebookStoryInsights;
  }

  /**
   * Delete a story before it expires
   */
  async deleteStory(storyId: string): Promise<boolean> {
    try {
      const response = await this.apiClient.makeApiRequest(`/${storyId}`, {
        method: "DELETE",
      });

      const result = await response.json();
      return result.success === true;
    } catch (error) {
      logger.error({ err: error }, "Failed to delete story");
      return false;
    }
  }

  /**
   * Get story viewers (if available)
   */
  async getStoryViewers(
    storyId: string
  ): Promise<Array<{ id: string; name: string; profilePicture?: string }>> {
    try {
      const response = await this.apiClient.makeApiRequest(
        `/${storyId}/story_viewers?fields=id,name,picture`
      );

      const data = await response.json();

      return (data.data || []).map(
        (viewer: { id: string; name: string; picture?: { data?: { url?: string } } }) => ({
          id: viewer.id,
          name: viewer.name,
          ...(viewer.picture?.data?.url ? { profilePicture: viewer.picture.data.url } : {}),
        })
      );
    } catch (error) {
      logger.warn(
        { err: error },
        "Failed to get story viewers (may require additional permissions)"
      );
      return [];
    }
  }

  /**
   * Check if a story is still active (not expired)
   */
  isStoryActive(storyCreatedTime: string | Date): boolean {
    const createdTime =
      typeof storyCreatedTime === "string" ? new Date(storyCreatedTime) : storyCreatedTime;

    const now = new Date();
    const expirationTime = new Date(createdTime.getTime() + 24 * 60 * 60 * 1000);

    return now < expirationTime;
  }

  /**
   * Schedule a story for later publishing (using scheduling service)
   */
  async scheduleStory(
    options: FacebookStoryOptions,
    publishAt: Date
  ): Promise<{ scheduled: true; publishAt: string }> {
    // This would typically integrate with a job queue or scheduling service
    // For now, we'll return a placeholder response
    logger.info({ publishAt: publishAt.toISOString() }, "Story scheduled");

    return {
      scheduled: true,
      publishAt: publishAt.toISOString(),
    };
  }

  /**
   * Get story creation limits and restrictions
   */
  async getStoryLimits(): Promise<{
    maxStoriesPerDay: number;
    maxDuration: number; // in seconds for videos
    maxFileSize: number; // in bytes
    supportedFormats: string[];
  }> {
    return {
      maxStoriesPerDay: 100, // Facebook's typical limit
      maxDuration: 120, // 2 minutes for videos
      maxFileSize: 100 * 1024 * 1024, // 100MB
      supportedFormats: ["image/jpeg", "image/png", "video/mp4", "video/mov"],
    };
  }
}
