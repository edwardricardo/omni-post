/**
 * @file GetCampaignAnalyticsUseCase.ts
 * @description Aggregates analytics across all posts tagged with a campaign.
 *   Fetches post IDs from the campaign query repository, batch-fetches analytics
 *   records, and computes engagement totals.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type CampaignQueryRepository } from "../../domain/repositories/CampaignQueryRepository.js";
import { type AnalyticsReadRepositoryPort } from "../../domain/repositories/AnalyticsReadRepository.js";
import { CampaignId } from "../../domain/value-objects/EntityId.js";
import { type CampaignAnalyticsOutput } from "./types.js";

/**
 * Input DTO for campaign analytics query.
 */
export interface GetCampaignAnalyticsInput {
  campaignId: string;
}

/**
 * @class GetCampaignAnalyticsUseCase
 * @description Computes aggregated analytics for a campaign by fetching all
 *   associated post IDs, batch-loading their analytics records, and computing
 *   engagement metrics via the analytics repository's aggregation method.
 */
export class GetCampaignAnalyticsUseCase
  implements UseCase<GetCampaignAnalyticsInput, CampaignAnalyticsOutput, UseCaseError>
{
  constructor(
    private readonly campaignQueryRepository: CampaignQueryRepository,
    private readonly analyticsReadRepository: AnalyticsReadRepositoryPort
  ) {}

  /**
   * @method execute
   * @description Fetches and aggregates analytics for all posts in a campaign.
   * @param input - Contains the campaign ID to analyze
   * @returns Result<CampaignAnalyticsOutput> with aggregated metrics, or UseCaseError
   */
  async execute(
    input: GetCampaignAnalyticsInput
  ): Promise<Result<CampaignAnalyticsOutput, UseCaseError>> {
    // 1. Validate campaign ID
    const campaignIdResult = CampaignId.fromString(input.campaignId);
    if (!campaignIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid campaignId: ${input.campaignId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          campaignIdResult.error
        )
      );
    }

    // 2. Verify campaign exists
    const campaign = await this.campaignQueryRepository.getCampaignWithStats(input.campaignId);
    if (!campaign) {
      return err(
        new UseCaseError(`Campaign not found: ${input.campaignId}`, USE_CASE_ERRORS.NOT_FOUND)
      );
    }

    // 3. Get all post IDs associated with this campaign
    const postIds = await this.campaignQueryRepository.findPostIdsByCampaignId(input.campaignId);

    // 4. Return empty metrics if no posts are tagged
    if (postIds.length === 0) {
      return ok({
        campaignId: input.campaignId,
        totalPosts: 0,
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalEngagement: 0,
        avgEngagementRate: 0,
      });
    }

    // 5. Batch fetch latest analytics for all posts
    const analyticsRecords = await this.analyticsReadRepository.getLatestForPosts(postIds);

    // 6. Aggregate engagement metrics
    const metrics = this.analyticsReadRepository.aggregateEngagement(analyticsRecords);

    return ok({
      campaignId: input.campaignId,
      totalPosts: postIds.length,
      totalViews: metrics.totalViews,
      totalLikes: metrics.totalLikes,
      totalComments: metrics.totalComments,
      totalShares: metrics.totalShares,
      totalEngagement: metrics.totalEngagement,
      avgEngagementRate: metrics.avgEngagementRate,
    });
  }
}
