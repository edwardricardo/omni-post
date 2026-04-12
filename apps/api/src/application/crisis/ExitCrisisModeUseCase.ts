/**
 * @file ExitCrisisModeUseCase.ts
 * @description Orchestrates deactivation of crisis mode for a project, resuming scheduled posts and dispatching CrisisModeExited events.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { ProjectId, type EventDispatcher } from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import {
  type ExitCrisisModeInput,
  type ExitCrisisModeOutput,
  type CrisisProjectRepository,
} from "./types.js";

/**
 * Exit Crisis Mode Use Case
 *
 * Deactivates crisis mode for a project, allowing scheduled posts to resume.
 */
export class ExitCrisisModeUseCase implements UseCase<
  ExitCrisisModeInput,
  ExitCrisisModeOutput,
  UseCaseError
> {
  constructor(
    private readonly projectRepository: CrisisProjectRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: ExitCrisisModeInput): Promise<Result<ExitCrisisModeOutput, UseCaseError>> {
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

    // Calculate duration before exiting
    const duration = project.crisisDurationMs ?? 0;

    // Exit crisis mode
    const exited = project.exitCrisisMode();
    if (!exited) {
      return err(new UseCaseError("Project is not in crisis mode", USE_CASE_ERRORS.CONFLICT));
    }

    // Save the project and dispatch domain events
    const doWork = async (): Promise<Result<ExitCrisisModeOutput, UseCaseError>> => {
      const saveResult = await this.projectRepository.save(project);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save project",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      const events = project.domainEvents;
      if (events.length > 0) {
        await this.eventDispatcher.dispatchAll([...events]);
        project.clearDomainEvents();
      }

      return ok({
        projectId: project.id.value,
        isInCrisisMode: false,
        duration,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ExitCrisisModeOutput, UseCaseError> = err(
          new UseCaseError("Transaction did not complete", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save project",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
