/**
 * @file CampaignQueryRepository.ts
 * @description Query repository port for Campaign read operations.
 * @layer domain
 */

/**
 * DTO for Campaign query results
 */
export interface CampaignDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  utmSource: string | null;
  utmMedium: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * DTO for Campaign with post count
 */
export interface CampaignWithStats extends CampaignDto {
  postCount: number;
}

/**
 * Options for listing campaigns
 */
export interface ListCampaignsOptions {
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * @interface CampaignQueryRepository
 * @description Port for Campaign read operations (query side).
 */
export interface CampaignQueryRepository {
  /**
   * @method findByProjectId
   * @description List campaigns for a project with optional filters.
   */
  findByProjectId(projectId: string, options?: ListCampaignsOptions): Promise<CampaignDto[]>;

  /**
   * @method findPostIdsByCampaignId
   * @description Get all post IDs tagged with a campaign.
   */
  findPostIdsByCampaignId(campaignId: string): Promise<string[]>;

  /**
   * @method getCampaignWithStats
   * @description Get a single campaign with post count.
   */
  getCampaignWithStats(campaignId: string): Promise<CampaignWithStats | null>;
}
