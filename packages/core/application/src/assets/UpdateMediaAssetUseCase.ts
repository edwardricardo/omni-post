/**
 * @file UpdateMediaAssetUseCase.ts
 * @description Updates an existing media asset: name, description, and/or folder.
 *   Validates ownership before applying changes.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type MediaAssetRepository } from "@core/domain/repositories/MediaAssetRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for updating a media asset.
 */
export interface UpdateMediaAssetInput {
  id: string;
  accountId: string;
  name?: string;
  description?: string;
  folderId?: string | null;
}

/**
 * Output DTO for an updated media asset.
 */
export interface UpdateMediaAssetOutput {
  id: string;
  name: string;
}

/**
 * @class UpdateMediaAssetUseCase
 * @description Finds a media asset by id+accountId, applies mutations via entity
 *   methods, and persists changes via the repository.
 */
export class UpdateMediaAssetUseCase implements UseCase<
  UpdateMediaAssetInput,
  UpdateMediaAssetOutput,
  UseCaseError
> {
  constructor(
    private readonly mediaAssetRepository: MediaAssetRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Updates the media asset fields and persists.
   * @param input - Fields to update (only provided fields are changed)
   * @returns Result<UpdateMediaAssetOutput> on success, UseCaseError on failure
   */
  async execute(
    input: UpdateMediaAssetInput
  ): Promise<Result<UpdateMediaAssetOutput, UseCaseError>> {
    // 1. Find asset and verify ownership
    const asset = await this.mediaAssetRepository.findById(input.id, input.accountId);

    if (!asset) {
      return err(new UseCaseError(`Media asset not found: ${input.id}`, USE_CASE_ERRORS.NOT_FOUND));
    }

    // 2. Apply mutations via entity methods
    if (input.name !== undefined) {
      const nameResult = asset.updateName(input.name);
      if (!nameResult.ok) {
        return err(
          new UseCaseError(
            nameResult.error.message,
            USE_CASE_ERRORS.VALIDATION_FAILED,
            nameResult.error
          )
        );
      }
    }

    if (input.description !== undefined) {
      asset.updateDescription(input.description);
    }

    if (input.folderId !== undefined) {
      asset.moveTo(input.folderId ?? undefined);
    }

    // 3. Persist via repository (atomically via UoW when available)
    const doWork = async (): Promise<Result<UpdateMediaAssetOutput, UseCaseError>> => {
      const saveResult = await this.mediaAssetRepository.save(asset);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save media asset",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok({
        id: asset.id.value,
        name: asset.name,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<UpdateMediaAssetOutput, UseCaseError> = ok({
          id: asset.id.value,
          name: asset.name,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save media asset",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
