/**
 * @file apiClientTypes.ts
 * @description Type definitions for the YouTube Data API client.
 * Consumed by apiClient.ts and any module that needs YouTube API types.
 * @layer infrastructure
 */

export interface YouTubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  channelId: string;
  [key: string]: string | undefined;
}

export interface YouTubeUploadResponse {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  thumbnailUrl?: string;
}

export interface YouTubeVideoUploadRequest {
  title: string;
  description: string;
  videoUrl: string;
  privacy: "public" | "private" | "unlisted";
  tags?: string[];
  categoryId?: string;
}

export interface YouTubeChannelResponse {
  id: string;
  title: string;
  description: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
}

export interface YouTubeAnalyticsResponse {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  subscribersGained: number;
  subscribersLost: number;
  watchTime: number;
}

export interface YouTubeVideoMetadata {
  duration: number;
  resolution: string;
  fps: number;
  codec: string;
  bitrate: number;
  fileSize: number;
  aspectRatio: string;
}

export interface YouTubeContentDetails {
  duration: string;
  dimension: string;
  definition: string;
  caption: string;
  licensedContent: boolean;
  regionRestriction?: {
    allowed?: string[];
    blocked?: string[];
  };
}
