/**
 * @file types.ts
 * @description Input/Output DTOs for Campaign application use cases.
 *   Defines the contract types for creating, updating, and analyzing campaigns.
 * @layer application
 */

/**
 * Input DTO for creating a new campaign.
 */
export interface CreateCampaignInput {
  projectId: string;
  name: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  utmSource?: string;
  utmMedium?: string;
}

/**
 * Input DTO for updating an existing campaign.
 */
export interface UpdateCampaignInput {
  campaignId: string;
  name?: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  utmSource?: string;
  utmMedium?: string;
}

/**
 * Input DTO for tagging/untagging a post with a campaign.
 */
export interface CampaignPostInput {
  campaignId: string;
  postId: string;
}

/**
 * Output DTO for aggregated campaign analytics.
 */
export interface CampaignAnalyticsOutput {
  campaignId: string;
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalEngagement: number;
  avgEngagementRate: number;
}
