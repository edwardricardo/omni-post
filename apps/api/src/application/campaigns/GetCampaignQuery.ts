/**
 * @file GetCampaignQuery.ts
 * @description Query handler for fetching a single campaign with post count stats.
 *   Delegates to the campaign query repository's getCampaignWithStats method.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type CampaignQueryRepository,
  type CampaignWithStats,
} from "../../domain/repositories/CampaignQueryRepository.js";

/**
 * Input DTO for getting a single campaign.
 */
export interface GetCampaignInput {
  campaignId: string;
}

/**
 * @class GetCampaignQuery
 * @description Fetches a single campaign with its post count statistics.
 *   Returns null wrapped in Result if the campaign does not exist.
 */
export class GetCampaignQuery
  implements UseCase<GetCampaignInput, CampaignWithStats | null, UseCaseError>
{
  constructor(private readonly campaignQueryRepository: CampaignQueryRepository) {}

  /**
   * @method execute
   * @description Fetches a campaign by ID with stats.
   * @param input - Contains the campaign ID to fetch
   * @returns Result containing CampaignWithStats or null if not found
   */
  async execute(input: GetCampaignInput): Promise<Result<CampaignWithStats | null, UseCaseError>> {
    if (!input.campaignId || input.campaignId.trim().length === 0) {
      return err(
        new UseCaseError("Campaign ID must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const campaign = await this.campaignQueryRepository.getCampaignWithStats(input.campaignId);

    return ok(campaign);
  }
}
