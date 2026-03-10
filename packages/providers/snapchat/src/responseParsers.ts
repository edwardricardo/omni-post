/**
 * @file responseParsers.ts
 * @description Pure functions for parsing Snapchat API responses.
 *              Handles type-safe extraction and validation of data from
 *              the Snapchat Ads API JSON responses.
 * @layer infrastructure
 */

import type {
  SnapchatOrganization,
  SnapchatOrganizationsResponse,
  SnapchatStoryResponse,
  SnapchatStoryAnalytics,
  SnapchatTokenRefreshResponse,
} from "./types.js";

/** Default empty analytics used as fallback when parsing fails. */
export const EMPTY_ANALYTICS: SnapchatStoryAnalytics = {
  total_views: 0,
  unique_views: 0,
  screenshots: 0,
  swipe_ups: 0,
  shares: 0,
  avg_view_time_seconds: 0,
};

/**
 * @function extractMediaId
 * @description Extracts the media ID from the nested Snapchat media creation response.
 *              Response shape: { media: [{ media: { id: "..." } }] }
 * @param data - Raw API response
 * @returns The extracted media ID string
 */
export function extractMediaId(data: unknown): string {
  if (data && typeof data === "object" && "media" in data) {
    const mediaArray = (data as Record<string, unknown>).media;
    if (Array.isArray(mediaArray) && mediaArray.length > 0) {
      const firstMedia = mediaArray[0] as Record<string, unknown> | undefined;
      if (firstMedia && typeof firstMedia === "object" && "media" in firstMedia) {
        const innerMedia = firstMedia.media;
        if (innerMedia && typeof innerMedia === "object" && "id" in innerMedia) {
          return String((innerMedia as Record<string, unknown>).id);
        }
      }
    }
  }
  throw new Error("Failed to extract media ID from Snapchat API response");
}

/**
 * @function parseOrganizationsResponse
 * @description Parses the /me/organizations API response into typed organizations.
 * @param data - Raw API response
 * @returns Typed organizations response
 */
export function parseOrganizationsResponse(data: unknown): SnapchatOrganizationsResponse {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid organizations response from Snapchat API");
  }

  const responseObj = data as Record<string, unknown>;
  const orgArray = responseObj.organizations;

  if (!Array.isArray(orgArray)) {
    return { organizations: [] };
  }

  const organizations: SnapchatOrganization[] = orgArray.map((orgWrapper: unknown) => {
    const wrapper = orgWrapper as Record<string, unknown>;
    const org = (wrapper.organization || wrapper) as Record<string, unknown>;
    const result: SnapchatOrganization = {
      id: String(org.id || ""),
      name: String(org.name || ""),
    };
    if (org.address_line_1) {
      result.address_line_1 = String(org.address_line_1);
    }
    if (org.currency) {
      result.currency = String(org.currency);
    }
    if (org.timezone) {
      result.timezone = String(org.timezone);
    }
    return result;
  });

  return { organizations };
}

/**
 * @function parseStoryResponse
 * @description Parses the creative creation API response into a typed story response.
 * @param data - Raw API response
 * @returns Typed story/creative response
 */
export function parseStoryResponse(data: unknown): SnapchatStoryResponse {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid story response from Snapchat API");
  }

  const responseObj = data as Record<string, unknown>;
  const creatives = responseObj.creatives;

  if (!Array.isArray(creatives) || creatives.length === 0) {
    throw new Error("No creative returned in Snapchat API response");
  }

  const creativeWrapper = creatives[0] as Record<string, unknown>;
  const creative = (creativeWrapper?.creative || creativeWrapper) as Record<string, unknown>;

  return {
    creative: {
      id: String(creative.id || ""),
      name: String(creative.name || ""),
      type: String(creative.type || ""),
      created_at: String(creative.created_at || new Date().toISOString()),
      updated_at: String(creative.updated_at || new Date().toISOString()),
      top_snap_media_id: String(creative.top_snap_media_id || ""),
    },
  };
}

/**
 * @function parseAnalyticsResponse
 * @description Parses the creative stats API response into typed analytics.
 * @param data - Raw API response
 * @returns Typed analytics data, or empty analytics if parsing fails
 */
export function parseAnalyticsResponse(data: unknown): SnapchatStoryAnalytics {
  if (!data || typeof data !== "object") {
    return EMPTY_ANALYTICS;
  }

  const responseObj = data as Record<string, unknown>;
  const stats = responseObj.total_stats || responseObj;
  const statsObj = (typeof stats === "object" && stats !== null ? stats : {}) as Record<
    string,
    unknown
  >;

  return {
    total_views: Number(statsObj.total_views || 0),
    unique_views: Number(statsObj.unique_views || 0),
    screenshots: Number(statsObj.screenshots || 0),
    swipe_ups: Number(statsObj.swipe_ups || 0),
    shares: Number(statsObj.shares || 0),
    avg_view_time_seconds: Number(statsObj.avg_view_time_seconds || 0),
  };
}

/**
 * @function parseTokenResponse
 * @description Parses the OAuth token refresh response into typed token data.
 * @param data - Raw API response
 * @returns Typed token refresh response
 */
export function parseTokenResponse(data: unknown): SnapchatTokenRefreshResponse {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid token refresh response from Snapchat API");
  }

  const tokenObj = data as Record<string, unknown>;

  return {
    access_token: String(tokenObj.access_token || ""),
    token_type: String(tokenObj.token_type || "bearer"),
    expires_in: Number(tokenObj.expires_in || 3600),
    refresh_token: String(tokenObj.refresh_token || ""),
    scope: String(tokenObj.scope || ""),
  };
}
