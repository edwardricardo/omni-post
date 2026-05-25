/**
 * @file UpdateCampaignUseCase.ts
 * @description Updates an existing campaign's details (name, description, dates, UTM params).
 *   Loads the aggregate, delegates mutation to the entity method, and persists the change.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type CampaignRepository } from "@core/domain/repositories/CampaignRepository.js";
import { CampaignId } from "@core/domain/value-objects/EntityId.js";
import { type UpdateCampaignInput } from "./types.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * @class UpdateCampaignUseCase
 * @description Loads a campaign by ID, applies detail updates through the entity
 *   method, and persists the updated aggregate.
 */
export class UpdateCampaignUseCase implements UseCase<UpdateCampaignInput, void, UseCaseError> {
  constructor(
    private readonly campaignRepository: CampaignRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Updates campaign details and persists changes.
   * @param input - The campaign ID and fields to update
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: UpdateCampaignInput): Promise<Result<void, UseCaseError>> {
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

    // 2. Load campaign aggregate
    const findResult = await this.campaignRepository.findById(campaignIdResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(findResult.error.message, USE_CASE_ERRORS.NOT_FOUND, findResult.error)
      );
    }

    const campaign = findResult.value;

    // 3. Apply updates through entity method
    const updateResult = campaign.updateDetails({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.endDate !== undefined && { endDate: input.endDate }),
      ...(input.utmSource !== undefined && { utmSource: input.utmSource }),
      ...(input.utmMedium !== undefined && { utmMedium: input.utmMedium }),
    });

    if (!updateResult.ok) {
      return err(
        new UseCaseError(
          updateResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          updateResult.error
        )
      );
    }

    // 4. Persist (atomically via UoW when available)
    const persist = async (): Promise<Result<void, UseCaseError>> => {
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
      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await persist();
        });
        return result;
      }
      return await persist();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save campaign",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
