/**
 * @file TagPostWithCampaignUseCase.ts
 * @description Tags a post with a campaign. Verifies the campaign exists before
 *   delegating the association to the repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type CampaignRepository } from "@core/domain/repositories/CampaignRepository.js";
import { CampaignId } from "@core/domain/value-objects/EntityId.js";
import { type CampaignPostInput } from "./types.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * @class TagPostWithCampaignUseCase
 * @description Associates a post with a campaign. Validates both IDs,
 *   verifies the campaign exists, and persists the association.
 */
export class TagPostWithCampaignUseCase implements UseCase<CampaignPostInput, void, UseCaseError> {
  constructor(
    private readonly campaignRepository: CampaignRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Tags a post with the specified campaign.
   * @param input - Contains campaignId and postId to associate
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: CampaignPostInput): Promise<Result<void, UseCaseError>> {
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

    // 2. Validate post ID is non-empty
    if (!input.postId || input.postId.trim().length === 0) {
      return err(new UseCaseError("Post ID must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // 3. Verify campaign exists
    const findResult = await this.campaignRepository.findById(campaignIdResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(findResult.error.message, USE_CASE_ERRORS.NOT_FOUND, findResult.error)
      );
    }

    // 4. Add post association (atomically via UoW when available)
    const persist = async (): Promise<Result<void, UseCaseError>> => {
      const addResult = await this.campaignRepository.addPost(
        campaignIdResult.value,
        input.postId.trim()
      );
      if (!addResult.ok) {
        return err(
          new UseCaseError(
            "Failed to tag post with campaign",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            addResult.error
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
          "Failed to tag post with campaign",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
