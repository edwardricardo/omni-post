/**
 * Application Layer - Create Tracked Link Use Case
 *
 * Part of Sprint 19: Link Tracking Feature
 * Handles creation of new tracked links.
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { TrackedLink, ProjectId, type TrackedLinkRepository } from "../../domain/index.js";
import { type CreateTrackedLinkInput, type TrackedLinkOutput } from "./types.js";

/**
 * Create Tracked Link Use Case
 *
 * Creates a new shortened/tracked URL for analytics.
 */
export class CreateTrackedLinkUseCase
  implements UseCase<CreateTrackedLinkInput, TrackedLinkOutput, UseCaseError>
{
  constructor(private readonly repository: TrackedLinkRepository) {}

  async execute(input: CreateTrackedLinkInput): Promise<Result<TrackedLinkOutput, UseCaseError>> {
    // Validate project ID
    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid project ID: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Check vanity slug availability if provided
    if (input.vanitySlug) {
      const isAvailable = await this.repository.isShortCodeAvailable(input.vanitySlug);
      if (!isAvailable) {
        return err(
          new UseCaseError(
            `Vanity slug "${input.vanitySlug}" is already taken`,
            USE_CASE_ERRORS.CONFLICT
          )
        );
      }
    }

    // Create the tracked link
    const createResult = TrackedLink.create({
      projectId: projectIdResult.value,
      originalUrl: input.originalUrl,
      ...(input.vanitySlug && { vanitySlug: input.vanitySlug }),
    });

    if (!createResult.ok) {
      return err(
        new UseCaseError(
          createResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          createResult.error
        )
      );
    }

    const link = createResult.value;

    // Persist the link
    const saveResult = await this.repository.save(link);
    if (!saveResult.ok) {
      return err(
        new UseCaseError(
          "Failed to save tracked link",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          saveResult.error
        )
      );
    }

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
    });
  }
}
