/**
 * @file GetLinkStatsUseCase.ts
 * @description Retrieves click statistics and analytics for a tracked link by its ID and returns Result<LinkStatsOutput>.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { TrackedLinkId, type TrackedLinkRepository } from "@core/domain/index.js";
import { type GetLinkInput, type LinkStatsOutput } from "./types.js";

/**
 * Get Link Stats Use Case
 *
 * Retrieves analytics/statistics for a tracked link.
 */
export class GetLinkStatsUseCase implements UseCase<GetLinkInput, LinkStatsOutput, UseCaseError> {
  constructor(private readonly repository: TrackedLinkRepository) {}

  async execute(input: GetLinkInput): Promise<Result<LinkStatsOutput, UseCaseError>> {
    // Validate link ID
    const linkIdResult = TrackedLinkId.fromString(input.linkId);
    if (!linkIdResult.ok) {
      return err(
        new UseCaseError(`Invalid link ID: ${input.linkId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // Find the link
    const findResult = await this.repository.findById(linkIdResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Tracked link not found: ${input.linkId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    const link = findResult.value;

    // Get click statistics
    const stats = await this.repository.getClickStats(linkIdResult.value);

    // Return combined output
    return ok({
      linkId: link.id.value,
      originalUrl: link.originalUrl,
      shortCode: link.shortCode.value,
      totalClicks: stats.totalClicks,
      clicksByCountry: stats.clicksByCountry,
      ...(stats.clicksByDay && { clicksByDay: stats.clicksByDay }),
      ...(stats.uniqueClicks !== undefined && { uniqueClicks: stats.uniqueClicks }),
    });
  }
}
