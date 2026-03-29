/**
 * @file UntagPostFromCampaignUseCase.ts
 * @description Removes a post's association with a campaign.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type CampaignRepository } from "../../domain/repositories/CampaignRepository.js";
import { CampaignId } from "../../domain/value-objects/EntityId.js";
import { type CampaignPostInput } from "./types.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * @class UntagPostFromCampaignUseCase
 * @description Removes the association between a post and a campaign.
 */
export class UntagPostFromCampaignUseCase implements UseCase<
  CampaignPostInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly campaignRepository: CampaignRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Removes a post from the specified campaign.
   * @param input - Contains campaignId and postId to disassociate
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: CampaignPostInput): Promise<Result<void, UseCaseError>> {
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

    if (!input.postId || input.postId.trim().length === 0) {
      return err(new UseCaseError("Post ID must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Remove post association (atomically via UoW when available)
    const persist = async (): Promise<Result<void, UseCaseError>> => {
      const removeResult = await this.campaignRepository.removePost(
        campaignIdResult.value,
        input.postId.trim()
      );
      if (!removeResult.ok) {
        return err(
          new UseCaseError(
            "Failed to untag post from campaign",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            removeResult.error
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
          "Failed to untag post from campaign",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
