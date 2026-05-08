/**
 * @file types.ts
 * @description Public types for the campaigns hook module.
 * @layer infrastructure
 */

export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";

export interface CampaignDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  startDate: string | null;
  endDate: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignAnalyticsDto {
  campaignId: string;
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalEngagement: number;
  avgEngagementRate: number;
}

export interface CreateCampaignInput {
  projectId: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  utmSource?: string;
  utmMedium?: string;
}
