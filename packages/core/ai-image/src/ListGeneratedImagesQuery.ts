/**
 * @file ListGeneratedImagesQuery.ts
 * @description Query use case that retrieves generated images for a project.
 *              Read-only operation — no domain events, no state changes.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type {
  GeneratedImageRepository,
  GeneratedImageData,
} from "@core/domain/repositories/GeneratedImageRepository.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";

/**
 * Input DTO for the ListGeneratedImages query
 */
export interface ListGeneratedImagesInput {
  projectId: string;
  limit?: number;
}

/**
 * @class ListGeneratedImagesQuery
 * @description Retrieves a list of AI-generated images for a given project,
 *              ordered by most recent first.
 */
export class ListGeneratedImagesQuery {
  constructor(private readonly repository: GeneratedImageRepository) {}

  /**
   * @method execute
   * @description Fetches generated images from the repository.
   * @param input - Query parameters with projectId and optional limit
   * @returns Result<GeneratedImageData[]> on success, UseCaseError on failure
   */
  async execute(
    input: ListGeneratedImagesInput
  ): Promise<Result<GeneratedImageData[], UseCaseError>> {
    const { projectId, limit } = input;

    const result = await this.repository.findByProjectId(projectId, limit);
    if (!result.ok) {
      return err(
        new UseCaseError(
          "Failed to retrieve generated images",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          result.error
        )
      );
    }

    return ok(result.value);
  }
}
