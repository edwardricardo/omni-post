/**
 * @file tiktokTypes.ts
 * @description Shared type definitions for TikTok provider API clients.
 * Extracted from apiClient.ts to break circular dependency cycles between
 * apiClient.ts and the specialist clients (authService, contentAnalyticsClient,
 * marketingApiClient, researchApiClient) that extend TikTokCredentials.
 * @layer infrastructure
 */

export interface TikTokCredentials {
  clientKey: string;
  clientSecret: string;
  accessToken: string;
  openId: string;
  [key: string]: string | undefined;
}

export interface TikTokVideoUploadRequest {
  description: string;
  videoUrl: string;
  privacy: "public" | "private";
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
}

export interface TikTokUploadResponse {
  shareId: string;
  shareUrl?: string;
  uniqueId?: string;
}

export interface TikTokUserInfoResponse {
  openId: string;
  unionId: string;
  avatarUrl: string;
  displayName: string;
  followerCount: number;
  followingCount: number;
  likesCount: number;
  videoCount: number;
  profileDeepLink: string;
}

export interface TikTokVideoListResponse {
  videos: Array<{
    id: string;
    title: string;
    videoUrl: string;
    coverImageUrl: string;
    shareUrl: string;
    createTime: number;
    likeCount: number;
    commentCount: number;
    shareCount: number;
    viewCount: number;
  }>;
  cursor: number;
  hasMore: boolean;
}
