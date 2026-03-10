/**
 * @file CreateCampaignUseCase.ts
 * @description Creates a new campaign entity for a project. Validates the project ID,
 *   delegates creation to the Campaign entity factory, and persists via the repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type CampaignRepository } from "../../domain/repositories/CampaignRepository.js";
import { Campaign } from "../../domain/entities/Campaign.js";
import { ProjectId } from "../../domain/value-objects/EntityId.js";
import { type CreateCampaignInput } from "./types.js";

/**
 * Output DTO for a successfully created campaign.
 */
export interface CreateCampaignOutput {
  id: string;
}

/**
 * @class CreateCampaignUseCase
 * @description Orchestrates campaign creation: validates input, constructs the
 *   Campaign entity via its factory method, and persists it through the repository.
 */
export class CreateCampaignUseCase
  implements UseCase<CreateCampaignInput, CreateCampaignOutput, UseCaseError>
{
  constructor(private readonly campaignRepository: CampaignRepository) {}

  /**
   * @method execute
   * @description Creates a new campaign and persists it.
   * @param input - Validated creation parameters
   * @returns Result<CreateCampaignOutput> on success, UseCaseError on failure
   */
  async execute(input: CreateCampaignInput): Promise<Result<CreateCampaignOutput, UseCaseError>> {
    // 1. Validate project ID
    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid projectId: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          projectIdResult.error
        )
      );
    }

    // 2. Create Campaign entity via domain factory
    const campaignResult = Campaign.create({
      projectId: projectIdResult.value,
      name: input.name,
      ...(input.description !== undefined && { description: input.description }),
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.endDate !== undefined && { endDate: input.endDate }),
      ...(input.utmSource !== undefined && { utmSource: input.utmSource }),
      ...(input.utmMedium !== undefined && { utmMedium: input.utmMedium }),
    });

    if (!campaignResult.ok) {
      return err(
        new UseCaseError(
          campaignResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          campaignResult.error
        )
      );
    }

    const campaign = campaignResult.value;

    // 3. Persist via repository
    const saveResult = await this.campaignRepository.save(campaign);
    if (!saveResult.ok) {
      return err(
        new UseCaseError(
          "Failed to save campaign",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          saveResult.error
        )
      );
    }

    return ok({ id: campaign.id.value });
  }
}
