/**
 * @file types.ts
 * @description TypeScript interfaces for LinkedIn REST API request/response payloads.
 *              Used by both LinkedInApiClient and LinkedInAdapter.
 * @layer infrastructure
 */

// ============================================================
// Credentials
// ============================================================

export interface LinkedInCredentials {
  accessToken: string;
  refreshToken: string;
  personUrn: string;
  organizationUrn?: string;
  [key: string]: string | undefined;
}

// ============================================================
// Post Payloads
// ============================================================

export interface LinkedInPostPayload {
  author: string;
  commentary: string;
  visibility: string;
  distribution: {
    feedDistribution: string;
    targetEntities: never[];
    thirdPartyDistributionChannels: never[];
  };
  lifecycleState: string;
  isReshareDisabledByAuthor: boolean;
  content?: LinkedInMediaContent;
}

export interface LinkedInMediaContent {
  media?: {
    title?: string;
    id: string;
  };
  multiImage?: {
    images: Array<{ id: string; altText?: string }>;
  };
  poll?: LinkedInPollContent;
}

export interface LinkedInPostResponse {
  id: string;
  activity?: string;
}

// ============================================================
// Profile
// ============================================================

export interface LinkedInProfileResponse {
  sub: string;
  name: string;
  email?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

// ============================================================
// Media Upload
// ============================================================

export interface LinkedInImageUploadResponse {
  value: {
    uploadUrlExpiresAt: number;
    uploadUrl: string;
    image: string;
  };
}

export interface LinkedInVideoUploadResponse {
  value: {
    uploadUrlExpiresAt: number;
    uploadInstructions: Array<{
      uploadUrl: string;
      firstByte: number;
      lastByte: number;
    }>;
    video: string;
  };
}

// ============================================================
// Comments / Social Actions
// ============================================================

export interface LinkedInCommentResponse {
  actor: string;
  message: { text: string };
  created: { time: number };
  id: string;
  parentComment?: string;
  object: string;
}

export interface LinkedInCommentsPage {
  elements: LinkedInCommentResponse[];
  paging: {
    start: number;
    count: number;
    total: number;
    links: Array<{ rel: string; href: string }>;
  };
}

// ============================================================
// Analytics
// ============================================================

export interface LinkedInAnalyticsResponse {
  totalShareStatistics: {
    shareCount: number;
    likeCount: number;
    commentCount: number;
    impressionCount: number;
    uniqueImpressionsCount: number;
    clickCount: number;
    engagement: number;
  };
}

// ============================================================
// Document Upload
// ============================================================

export interface LinkedInDocumentUploadResponse {
  value: {
    uploadUrlExpiresAt: number;
    uploadUrl: string;
    document: string;
  };
}

// ============================================================
// Poll
// ============================================================

export type LinkedInPollDuration = "ONE_DAY" | "THREE_DAYS" | "SEVEN_DAYS" | "FOURTEEN_DAYS";

export interface LinkedInPollOption {
  text: string;
}

export interface LinkedInPollContent {
  question: string;
  options: LinkedInPollOption[];
  settings: {
    duration: LinkedInPollDuration;
  };
}

// ============================================================
// Extended Post Payload (with document + poll support)
// ============================================================

export interface LinkedInDocumentContent {
  media: {
    title?: string;
    id: string;
  };
}

export interface LinkedInPollPostContent {
  poll: LinkedInPollContent;
}
