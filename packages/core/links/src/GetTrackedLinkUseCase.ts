/**
 * @file GetTrackedLinkUseCase.ts
 * @description Retrieves a single tracked link by its ID and returns Result<TrackedLinkOutput>.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { TrackedLinkId, type TrackedLinkRepository } from "@core/domain/index.js";
import { type GetLinkInput, type TrackedLinkOutput } from "./types.js";

/**
 * Get Tracked Link Use Case
 *
 * Retrieves a tracked link by its ID.
 */
export class GetTrackedLinkUseCase implements UseCase<
  GetLinkInput,
  TrackedLinkOutput,
  UseCaseError
> {
  constructor(private readonly repository: TrackedLinkRepository) {}

  async execute(input: GetLinkInput): Promise<Result<TrackedLinkOutput, UseCaseError>> {
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

    // Return output DTO
    return ok({
      id: link.id.value,
      projectId: link.projectId.value,
      originalUrl: link.originalUrl,
      shortCode: link.shortCode.value,
      ...(link.vanitySlug && { vanitySlug: link.vanitySlug }),
      clicks: link.clicks,
      isActive: link.isActive,
      createdAt: link.createdAt,
      ...(link.utmSource !== undefined && { utmSource: link.utmSource }),
      ...(link.utmMedium !== undefined && { utmMedium: link.utmMedium }),
      ...(link.utmCampaign !== undefined && { utmCampaign: link.utmCampaign }),
      ...(link.utmContent !== undefined && { utmContent: link.utmContent }),
      ...(link.utmTerm !== undefined && { utmTerm: link.utmTerm }),
      ...(link.campaignId !== undefined && { campaignId: link.campaignId }),
    });
  }
}
