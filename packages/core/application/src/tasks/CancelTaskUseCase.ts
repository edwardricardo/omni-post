/**
 * @file CancelTaskUseCase.ts
 * @description Marks a task as cancelled. Only the creator can cancel.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TaskRepository } from "@core/domain/repositories/TaskRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for cancelling a task.
 */
export interface CancelTaskInput {
  taskId: string;
  accountId: string;
  cancelledById: string;
}

/**
 * @class CancelTaskUseCase
 * @description Guards that only the creator can cancel,
 *   then delegates to the entity's cancel method.
 */
export class CancelTaskUseCase implements UseCase<CancelTaskInput, void, UseCaseError> {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Loads the task, validates ownership and permissions, cancels, and persists.
   * @param input - Task ID, account ID, and the user cancelling the task
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: CancelTaskInput): Promise<Result<void, UseCaseError>> {
    const findResult = await this.taskRepository.findById(input.taskId);
    if (!findResult.ok) {
      return err(new UseCaseError(findResult.error.message, USE_CASE_ERRORS.NOT_FOUND));
    }

    const task = findResult.value;

    if (task.accountId !== input.accountId) {
      return err(new UseCaseError("Task not found", USE_CASE_ERRORS.NOT_FOUND));
    }

    // Only creator can cancel
    if (task.createdById !== input.cancelledById) {
      return err(
        new UseCaseError("Only the creator can cancel this task", USE_CASE_ERRORS.FORBIDDEN)
      );
    }

    const cancelResult = task.cancel();
    if (!cancelResult.ok) {
      return err(new UseCaseError(cancelResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
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
