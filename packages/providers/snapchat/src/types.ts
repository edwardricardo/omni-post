/**
 * @file types.ts
 * @description Type definitions for the Snapchat provider adapter.
 *              Includes credential interfaces, API response types,
 *              and analytics data structures.
 * @layer infrastructure
 */

/**
 * @interface SnapchatCredentials
 * @description OAuth 2.0 credentials required to authenticate with the Snapchat Ads API.
 */
export interface SnapchatCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  organizationId: string;
  [key: string]: string | undefined;
}

/**
 * @interface SnapchatOrganization
 * @description Represents a Snapchat organization entity from the /me/organizations endpoint.
 */
export interface SnapchatOrganization {
  id: string;
  name: string;
  address_line_1?: string;
  currency?: string;
  timezone?: string;
}

/**
 * @interface SnapchatOrganizationsResponse
 * @description Response from the GET /v1/me/organizations endpoint.
 */
export interface SnapchatOrganizationsResponse {
  organizations: SnapchatOrganization[];
}

/**
 * @interface SnapchatMediaUploadResponse
 * @description Response from media creation and upload endpoints.
 */
export interface SnapchatMediaUploadResponse {
  media: {
    id: string;
    type: string;
    media_status: string;
    name: string;
  };
}

/**
 * @interface SnapchatStoryResponse
 * @description Response from the creative creation endpoint (story publishing).
 */
export interface SnapchatStoryResponse {
  creative: {
    id: string;
    name: string;
    type: string;
    created_at: string;
    updated_at: string;
    top_snap_media_id: string;
  };
}

/**
 * @interface SnapchatStoryAnalytics
 * @description Analytics metrics for a Snapchat story/creative.
 */
export interface SnapchatStoryAnalytics {
  total_views: number;
  unique_views: number;
  screenshots: number;
  swipe_ups: number;
  shares: number;
  avg_view_time_seconds: number;
}

/**
 * @interface SnapchatTokenRefreshResponse
 * @description Response from the OAuth token refresh endpoint.
 */
export interface SnapchatTokenRefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}
