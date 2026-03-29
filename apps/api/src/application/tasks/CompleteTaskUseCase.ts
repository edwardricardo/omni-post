/**
 * @file CompleteTaskUseCase.ts
 * @description Marks a task as completed. Only the assignee or creator can complete.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TaskRepository } from "../../domain/repositories/TaskRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Input DTO for completing a task.
 */
export interface CompleteTaskInput {
  taskId: string;
  accountId: string;
  completedById: string;
}

/**
 * @class CompleteTaskUseCase
 * @description Guards that only the assignee or creator can complete,
 *   then delegates to the entity's complete method.
 */
export class CompleteTaskUseCase implements UseCase<CompleteTaskInput, void, UseCaseError> {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Loads the task, validates ownership and permissions, completes, and persists.
   * @param input - Task ID, account ID, and the user completing the task
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: CompleteTaskInput): Promise<Result<void, UseCaseError>> {
    const findResult = await this.taskRepository.findById(input.taskId);
    if (!findResult.ok) {
      return err(new UseCaseError(findResult.error.message, USE_CASE_ERRORS.NOT_FOUND));
    }

    const task = findResult.value;

    if (task.accountId !== input.accountId) {
      return err(new UseCaseError("Task not found", USE_CASE_ERRORS.NOT_FOUND));
    }

    // Only assignee or creator can complete
    const isAssignee = task.assigneeId === input.completedById;
    const isCreator = task.createdById === input.completedById;
    if (!isAssignee && !isCreator) {
      return err(
        new UseCaseError(
          "Only the assignee or creator can complete this task",
          USE_CASE_ERRORS.FORBIDDEN
        )
      );
    }

    const completeResult = task.complete();
    if (!completeResult.ok) {
      return err(new UseCaseError(completeResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const doSave = async (): Promise<Result<void, UseCaseError>> => {
      const saveResult = await this.taskRepository.save(task);
      if (!saveResult.ok) {
        return err(
          new UseCaseError("Failed to save task", USE_CASE_ERRORS.INTERNAL_ERROR, saveResult.error)
        );
      }
      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doSave();
        });
        if (!result.ok) return result;
      } else {
        const result = await doSave();
        if (!result.ok) return result;
      }
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save task",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }

    return ok(undefined);
  }
}
