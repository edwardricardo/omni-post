/**
 * @file GetMediaAssetsQuery.ts
 * @description Query handler for listing media assets with filters and cursor-based pagination.
 *   Delegates directly to the media asset repository (read side).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type MediaAssetRepository,
  type MediaAssetPaginatedResult,
} from "../../domain/repositories/MediaAssetRepository.js";

/**
 * Input DTO for querying media assets.
 */
export interface GetMediaAssetsInput {
  accountId: string;
  projectId?: string;
  folderId?: string | null;
  tagIds?: string[];
  mimeType?: string;
  search?: string;
  limit?: number;
  cursor?: string | null;
}

/**
 * @class GetMediaAssetsQuery
 * @description Fetches media assets with filters and cursor-based pagination.
 *   Reads directly from the repository.
 */
export class GetMediaAssetsQuery
  implements UseCase<GetMediaAssetsInput, MediaAssetPaginatedResult, UseCaseError>
{
  constructor(private readonly mediaAssetRepository: MediaAssetRepository) {}

  /**
   * @method execute
   * @description Lists media assets with the given filters.
   * @param input - Query parameters including accountId and optional filters
   * @returns Result containing a paginated result of media assets
   */
  async execute(
    input: GetMediaAssetsInput
  ): Promise<Result<MediaAssetPaginatedResult, UseCaseError>> {
    if (!input.accountId || input.accountId.trim().length === 0) {
      return err(
        new UseCaseError("Account ID must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const result = await this.mediaAssetRepository.findMany({
      accountId: input.accountId,
      ...(input.projectId !== undefined && { projectId: input.projectId }),
      ...(input.folderId !== undefined && { folderId: input.folderId }),
      ...(input.tagIds !== undefined && { tagIds: input.tagIds }),
      ...(input.mimeType !== undefined && { mimeType: input.mimeType }),
      ...(input.search !== undefined && { search: input.search }),
      ...(input.limit !== undefined && { limit: input.limit }),
      ...(input.cursor !== undefined && { cursor: input.cursor }),
    });

    return ok(result);
  }
}
