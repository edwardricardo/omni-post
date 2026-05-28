/**
 * @file TagMediaAssetUseCase.ts
 * @description Replaces the tags on a media asset. Verifies asset ownership and
 *   that all provided tag IDs belong to the same account.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type MediaAssetRepository } from "@core/domain/repositories/MediaAssetRepository.js";
import { type AssetTagRepository } from "@core/domain/repositories/AssetTagRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for tagging a media asset.
 */
export interface TagMediaAssetInput {
  assetId: string;
  accountId: string;
  tagIds: string[];
}

/**
 * @class TagMediaAssetUseCase
 * @description Validates asset ownership, verifies all tags belong to the account,
 *   and replaces the asset's tag associations via the repository.
 */
export class TagMediaAssetUseCase implements UseCase<TagMediaAssetInput, void, UseCaseError> {
  constructor(
    private readonly mediaAssetRepository: MediaAssetRepository,
    private readonly assetTagRepository: AssetTagRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Sets the tags on a media asset.
   * @param input - Asset ID, account ID, and tag IDs to assign
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: TagMediaAssetInput): Promise<Result<void, UseCaseError>> {
    // 1. Verify asset existence and ownership
    const asset = await this.mediaAssetRepository.findById(input.assetId, input.accountId);

    if (!asset) {
      return err(
        new UseCaseError(`Media asset not found: ${input.assetId}`, USE_CASE_ERRORS.NOT_FOUND)
      );
    }

    // 2. Validate all tag IDs belong to the account
    if (input.tagIds.length > 0) {
      const foundTags = await this.assetTagRepository.findByIds(input.tagIds, input.accountId);
      const foundIds = new Set(foundTags.map((t) => t.id));
      const invalidIds = input.tagIds.filter((id) => !foundIds.has(id));

      if (invalidIds.length > 0) {
        return err(
          new UseCaseError(
            `Tags not found or not owned by account: ${invalidIds.join(", ")}`,
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }
    }

    // 3. Update tags (atomically via UoW when available)
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const updateResult = await this.mediaAssetRepository.updateTags(input.assetId, input.tagIds);
      if (!updateResult.ok) {
        return err(
          new UseCaseError(
            "Failed to update asset tags",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            updateResult.error
          )
        );
      }

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to update asset tags",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
