/**
 * @file EnterCrisisModeUseCase.ts
 * @description Orchestrates activation of crisis mode for a project, pausing scheduled posts and dispatching CrisisModeEntered events.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { ProjectId, type EventDispatcher } from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import {
  type EnterCrisisModeInput,
  type EnterCrisisModeOutput,
  type CrisisProjectRepository,
} from "./types.js";

/**
 * Enter Crisis Mode Use Case
 *
 * Activates crisis mode for a project, which pauses scheduled posts.
 */
export class EnterCrisisModeUseCase implements UseCase<
  EnterCrisisModeInput,
  EnterCrisisModeOutput,
  UseCaseError
> {
  constructor(
    private readonly projectRepository: CrisisProjectRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: EnterCrisisModeInput): Promise<Result<EnterCrisisModeOutput, UseCaseError>> {
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

    // Enter crisis mode
    const entered = project.enterCrisisMode(input.reason);
    if (!entered) {
      return err(new UseCaseError("Project is already in crisis mode", USE_CASE_ERRORS.CONFLICT));
    }

    // crisisStartedAt is guaranteed non-null here — enterCrisisMode() just set it.
    const startedAt = project.crisisStartedAt ?? new Date();

    // Save the project and dispatch domain events
    const doWork = async (): Promise<Result<EnterCrisisModeOutput, UseCaseError>> => {
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
        isInCrisisMode: true,
        reason: input.reason,
        startedAt,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<EnterCrisisModeOutput, UseCaseError> = err(
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
