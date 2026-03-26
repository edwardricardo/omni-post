/**
 * @file DeleteMediaAssetUseCase.ts
 * @description Soft-deletes a media asset after verifying account ownership.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type MediaAssetRepository } from "../../domain/repositories/MediaAssetRepository.js";

/**
 * Input DTO for deleting a media asset.
 */
export interface DeleteMediaAssetInput {
  id: string;
  accountId: string;
}

/**
 * @class DeleteMediaAssetUseCase
 * @description Validates asset existence and ownership, then delegates
 *   soft-delete to the repository.
 */
export class DeleteMediaAssetUseCase implements UseCase<DeleteMediaAssetInput, void, UseCaseError> {
  constructor(private readonly mediaAssetRepository: MediaAssetRepository) {}

  /**
   * @method execute
   * @description Soft-deletes the media asset.
   * @param input - Asset ID and account ID for ownership verification
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: DeleteMediaAssetInput): Promise<Result<void, UseCaseError>> {
    const asset = await this.mediaAssetRepository.findById(input.id, input.accountId);

    if (!asset) {
      return err(new UseCaseError(`Media asset not found: ${input.id}`, USE_CASE_ERRORS.NOT_FOUND));
    }

    const deleteResult = await this.mediaAssetRepository.softDelete(input.id, input.accountId);
    if (!deleteResult.ok) {
      return err(
        new UseCaseError(
          "Failed to delete media asset",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          deleteResult.error
        )
      );
    }

    return ok(undefined);
  }
}
