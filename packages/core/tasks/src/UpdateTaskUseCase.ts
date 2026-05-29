/**
 * @file UpdateTaskUseCase.ts
 * @description Updates mutable fields on an existing Task entity.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { TaskRepository } from "@core/domain/repositories/TaskRepository.js";
import type { TaskPriorityValue } from "@core/domain/entities/Task.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for updating a task.
 */
export interface UpdateTaskInput {
  taskId: string;
  accountId: string;
  title?: string;
  description?: string;
  assigneeId?: string;
  dueDate?: Date;
  priority?: TaskPriorityValue;
}

/**
 * @class UpdateTaskUseCase
 * @description Guards that the task belongs to the requesting account,
 *   then delegates to the entity's update method.
 */
export class UpdateTaskUseCase implements UseCase<UpdateTaskInput, void, UseCaseError> {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Loads the task, validates ownership, applies updates, and persists.
   * @param input - Task ID, account ID, and fields to update
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: UpdateTaskInput): Promise<Result<void, UseCaseError>> {
    const findResult = await this.taskRepository.findById(input.taskId);
    if (!findResult.ok) {
      return err(new UseCaseError(findResult.error.message, USE_CASE_ERRORS.NOT_FOUND));
    }

    const task = findResult.value;

    if (task.accountId !== input.accountId) {
      return err(new UseCaseError("Task not found", USE_CASE_ERRORS.NOT_FOUND));
    }

    const updateResult = task.update({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
      ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
      ...(input.priority !== undefined && { priority: input.priority }),
    });

    if (!updateResult.ok) {
      return err(new UseCaseError(updateResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
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
