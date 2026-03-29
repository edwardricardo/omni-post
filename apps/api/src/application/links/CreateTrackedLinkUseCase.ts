/**
 * @file CreateTrackedLinkUseCase.ts
 * @description Orchestrates tracked link creation: validates input, checks vanity slug
 *   availability, constructs the TrackedLink entity, and persists it through the repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { TrackedLink, ProjectId, type TrackedLinkRepository } from "../../domain/index.js";
import { type CreateTrackedLinkInput, type TrackedLinkOutput } from "./types.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * @class CreateTrackedLinkUseCase
 * @description Creates a new shortened/tracked URL for analytics.
 */
export class CreateTrackedLinkUseCase implements UseCase<
  CreateTrackedLinkInput,
  TrackedLinkOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: TrackedLinkRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates input, creates a TrackedLink entity, and persists it.
   * @param input - Validated creation parameters
   * @returns Result<TrackedLinkOutput> on success, UseCaseError on failure
   */
  async execute(input: CreateTrackedLinkInput): Promise<Result<TrackedLinkOutput, UseCaseError>> {
    // 1. Validate project ID
    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid project ID: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // 2. Check vanity slug availability if provided
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

    // 3. Create the tracked link entity
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

    // 4. Persist via repository (atomically via UoW when available)
    const doWork = async (): Promise<Result<TrackedLinkOutput, UseCaseError>> => {
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
    };

    try {
      if (this.unitOfWork) {
        let result: Result<TrackedLinkOutput, UseCaseError> = ok({
          id: link.id.value,
          projectId: link.projectId.value,
          originalUrl: link.originalUrl,
          shortCode: link.shortCode.value,
          ...(link.vanitySlug && { vanitySlug: link.vanitySlug }),
          clicks: link.clicks,
          isActive: link.isActive,
          createdAt: link.createdAt,
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
          "Failed to save tracked link",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
