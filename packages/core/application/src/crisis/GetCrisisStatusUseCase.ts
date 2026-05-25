/**
 * @file GetCrisisStatusUseCase.ts
 * @description Retrieves the current crisis mode status and history for a project and returns Result<CrisisStatusOutput>.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { ProjectId } from "@core/domain/index.js";
import {
  type GetCrisisStatusInput,
  type CrisisStatusOutput,
  type CrisisProjectRepository,
} from "./types.js";

/**
 * Get Crisis Status Use Case
 *
 * Retrieves the current crisis mode status and history for a project.
 */
export class GetCrisisStatusUseCase implements UseCase<
  GetCrisisStatusInput,
  CrisisStatusOutput,
  UseCaseError
> {
  constructor(private readonly projectRepository: CrisisProjectRepository) {}

  async execute(input: GetCrisisStatusInput): Promise<Result<CrisisStatusOutput, UseCaseError>> {
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

    // Find the project
    const findResult = await this.projectRepository.findById(projectIdResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Project not found: ${input.projectId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    const project = findResult.value;

    // Return status
    return ok({
      projectId: project.id.value,
      isInCrisisMode: project.isInCrisisMode,
      ...(project.crisisReason && { reason: project.crisisReason }),
      ...(project.crisisStartedAt && { startedAt: project.crisisStartedAt }),
      ...(project.crisisDurationMs !== undefined && { durationMs: project.crisisDurationMs }),
      history: [...project.crisisModeHistory],
    });
  }
}
