/**
 * @file apiClientTypes.ts
 * @description Type definitions for the Facebook Graph API client.
 * Consumed by apiClient.ts and any module that needs Facebook API types.
 */

export interface FacebookCredentials {
  accessToken: string;
  pageId: string;
  appId: string;
  appSecret: string;
  longLivedToken?: string;
  instagramBusinessAccountId?: string;
  adAccountId?: string;
  [key: string]: string | undefined;
}

export interface FacebookError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export interface FacebookRateLimitInfo {
  callCount: number;
  totalTime: number;
  totalCpuTime: number;
  type: "application" | "page";
  resetTime?: number;
}

export interface FacebookUser {
  id: string;
  name: string;
  email?: string;
  picture?: {
    data: {
      url: string;
      width: number;
      height: number;
    };
  };
}

export interface FacebookPageRole {
  role: string;
  user: FacebookUser;
}

export interface FacebookPageCategory {
  id: string;
  name: string;
}

export interface FacebookPageLocation {
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  state?: string;
  street?: string;
  zip?: string;
}

export interface FacebookPageHours {
  [key: string]: string;
}

export interface FacebookPageInfo {
  id: string;
  name: string;
  username?: string;
  about?: string;
  category?: string;
  category_list?: FacebookPageCategory[];
  phone?: string;
  website?: string;
  location?: FacebookPageLocation;
  hours?: FacebookPageHours;
  fan_count?: number;
  followers_count?: number;
  link?: string;
  picture?: {
    data: {
      url: string;
      width: number;
      height: number;
    };
  };
  cover?: {
    id: string;
    source: string;
    offset_x: number;
    offset_y: number;
  };
  is_verified?: boolean;
  verification_status?: string;
  roles?: FacebookPageRole[];
}

export interface FacebookBusinessAccount {
  id: string;
  name: string;
  verification_status?: string;
  timezone_id?: string;
  currency?: string;
}

export interface FacebookPagePostResponse {
  id: string;
  created_time?: string;
  message?: string;
  permalink_url?: string;
}

export interface FacebookMediaUploadResponse {
  id: string;
  media_key: string;
  size: number;
  post_id?: string;
  url?: string;
  thumbnail_url?: string;
}

export interface FacebookPageInsightsResponse {
  impressions: number;
  engagements: number;
  likes: number;
  shares: number;
  comments: number;
  clicks: number;
}

export interface FacebookPageResponse {
  id: string;
  name: string;
  username?: string;
  access_token?: string;
}
