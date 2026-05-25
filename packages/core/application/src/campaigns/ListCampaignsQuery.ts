/**
 * @file ListCampaignsQuery.ts
 * @description Query handler for listing campaigns by project with optional filters.
 *   Delegates directly to the campaign query repository (read side).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type CampaignQueryRepository,
  type CampaignDto,
} from "@core/domain/repositories/CampaignQueryRepository.js";

/**
 * Input DTO for listing campaigns.
 */
export interface ListCampaignsInput {
  projectId: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * @class ListCampaignsQuery
 * @description Fetches campaigns for a project with optional status filtering
 *   and offset-based pagination. Reads directly from the query repository.
 */
export class ListCampaignsQuery implements UseCase<
  ListCampaignsInput,
  CampaignDto[],
  UseCaseError
> {
  constructor(private readonly campaignQueryRepository: CampaignQueryRepository) {}

  /**
   * @method execute
   * @description Lists campaigns for a project with optional filters.
   * @param input - Query parameters including projectId and optional filters
   * @returns Result containing an array of CampaignDto
   */
  async execute(input: ListCampaignsInput): Promise<Result<CampaignDto[], UseCaseError>> {
    if (!input.projectId || input.projectId.trim().length === 0) {
      return err(
        new UseCaseError("Project ID must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const campaigns = await this.campaignQueryRepository.findByProjectId(input.projectId, {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.limit !== undefined && { limit: input.limit }),
      ...(input.offset !== undefined && { offset: input.offset }),
    });

    return ok(campaigns);
  }
}
