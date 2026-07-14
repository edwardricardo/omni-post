/**
 * @file CreateTrackedLinkUseCase.ts
 * @description Orchestrates tracked link creation: validates input, checks vanity slug
 *   availability, constructs the TrackedLink entity, and persists it through the repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { TrackedLink, ProjectId, type TrackedLinkRepository } from "@core/domain/index.js";
import { type ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import { type CreateTrackedLinkInput, type TrackedLinkOutput } from "./types.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

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
    private readonly projectRepository: ProjectRepositoryPort,
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

    // 2. Ownership check: resolve the project through the guard-scoped
    //    repository. A foreign or nonexistent projectId resolves to NOT_FOUND
    //    under the caller's tenant context. Return NOT_FOUND BEFORE the slug
    //    probe / persist so the catch-all can never flatten it to
    //    INTERNAL_ERROR (anti-enumeration: NOT_FOUND, never 403).
    const projectResult = await this.projectRepository.findById(projectIdResult.value);
    if (!projectResult.ok) {
      return err(new UseCaseError(projectResult.error.message, USE_CASE_ERRORS.NOT_FOUND));
    }
    const accountId = projectResult.value.accountId.toString();

    // 3. Check vanity slug availability if provided
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

    // 4. Create the tracked link entity (accountId threaded from the project)
    const createResult = TrackedLink.create({
      accountId,
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

    // 5. Persist via repository (atomically via UoW when available)
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
