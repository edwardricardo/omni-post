/**
 * @file ArchiveCampaignUseCase.ts
 * @description Archives a campaign by transitioning its status to ARCHIVED.
 *   Loads the aggregate, delegates the state transition to the entity, and persists.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type CampaignRepository } from "../../domain/repositories/CampaignRepository.js";
import { CampaignId } from "../../domain/value-objects/EntityId.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Input DTO for archiving a campaign.
 */
export interface ArchiveCampaignInput {
  campaignId: string;
}

/**
 * @class ArchiveCampaignUseCase
 * @description Transitions a campaign to ARCHIVED status through the entity's
 *   state machine and persists the change.
 */
export class ArchiveCampaignUseCase implements UseCase<ArchiveCampaignInput, void, UseCaseError> {
  constructor(
    private readonly campaignRepository: CampaignRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Archives a campaign by ID.
   * @param input - Contains the campaign ID to archive
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: ArchiveCampaignInput): Promise<Result<void, UseCaseError>> {
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

    const findResult = await this.campaignRepository.findById(campaignIdResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(findResult.error.message, USE_CASE_ERRORS.NOT_FOUND, findResult.error)
      );
    }

    const campaign = findResult.value;

    const archiveResult = campaign.archive();
    if (!archiveResult.ok) {
      return err(
        new UseCaseError(
          archiveResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          archiveResult.error
        )
      );
    }

    // Persist (atomically via UoW when available)
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
