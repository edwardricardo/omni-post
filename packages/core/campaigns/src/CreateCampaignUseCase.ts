/**
 * @file CreateCampaignUseCase.ts
 * @description Creates a new campaign entity for a project. Validates the project ID,
 *   resolves the parent project through the guard-scoped ProjectRepository to
 *   enforce project-ownership (foreign project → NOT_FOUND) and thread the
 *   project's accountId onto the row, then persists via the repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type CampaignRepository } from "@core/domain/repositories/CampaignRepository.js";
import { type ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import { Campaign } from "@core/domain/entities/Campaign.js";
import { ProjectId } from "@core/domain/value-objects/EntityId.js";
import { type CreateCampaignInput } from "./types.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Output DTO for a successfully created campaign.
 */
export interface CreateCampaignOutput {
  id: string;
}

/**
 * @class CreateCampaignUseCase
 * @description Orchestrates campaign creation: validates input, constructs the
 *   Campaign entity via its factory method, and persists it through the repository.
 */
export class CreateCampaignUseCase implements UseCase<
  CreateCampaignInput,
  CreateCampaignOutput,
  UseCaseError
> {
  constructor(
    private readonly campaignRepository: CampaignRepository,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Creates a new campaign and persists it.
   * @param input - Validated creation parameters
   * @returns Result<CreateCampaignOutput> on success, UseCaseError on failure
   */
  async execute(input: CreateCampaignInput): Promise<Result<CreateCampaignOutput, UseCaseError>> {
    // 1. Validate project ID
    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid projectId: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          projectIdResult.error
        )
      );
    }

    // 2. Ownership check: resolve the project through the guard-scoped
    //    repository. A foreign or nonexistent projectId resolves to
    //    EntityNotFoundError under the caller's tenant context. Return
    //    NOT_FOUND BEFORE `persist` so the catch-all below can never flatten it
    //    to INTERNAL_ERROR (anti-enumeration: NOT_FOUND, never 403).
    const projectResult = await this.projectRepository.findById(projectIdResult.value);
    if (!projectResult.ok) {
      return err(new UseCaseError(projectResult.error.message, USE_CASE_ERRORS.NOT_FOUND));
    }

    const accountId = projectResult.value.accountId.toString();

    // 3. Create Campaign entity via domain factory
    const campaignResult = Campaign.create({
      accountId,
      projectId: projectIdResult.value,
      name: input.name,
      ...(input.description !== undefined && { description: input.description }),
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.endDate !== undefined && { endDate: input.endDate }),
      ...(input.utmSource !== undefined && { utmSource: input.utmSource }),
      ...(input.utmMedium !== undefined && { utmMedium: input.utmMedium }),
    });

    if (!campaignResult.ok) {
      return err(
        new UseCaseError(
          campaignResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          campaignResult.error
        )
      );
    }

    const campaign = campaignResult.value;

    // 3. Persist via repository (atomically via UoW when available)
    const persist = async (): Promise<Result<CreateCampaignOutput, UseCaseError>> => {
      const saveResult = await this.campaignRepository.save(campaign);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save campaign",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }
      return ok({ id: campaign.id.value });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreateCampaignOutput, UseCaseError> = ok({ id: campaign.id.value });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await persist();
        });
        return result;
      }
      return await persist();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save campaign",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
