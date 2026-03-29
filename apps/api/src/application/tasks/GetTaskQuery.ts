/**
 * @file GetTaskQuery.ts
 * @description Read-side query for retrieving a single task by ID.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TaskRepository } from "../../domain/repositories/TaskRepository.js";
import type { TaskProps } from "../../domain/entities/Task.js";

/**
 * Input DTO for getting a single task.
 */
export interface GetTaskInput {
  taskId: string;
  accountId: string;
}

/**
 * DTO representing a task.
 */
export type TaskDTO = TaskProps;

/**
 * @class GetTaskQuery
 * @description Retrieves a single task by ID, guarding account ownership.
 */
export class GetTaskQuery implements UseCase<GetTaskInput, TaskDTO, UseCaseError> {
  constructor(private readonly taskRepository: TaskRepository) {}

  /**
   * @method execute
   * @description Finds a task by ID and validates it belongs to the requesting account.
   * @param input - Task ID and account ID
   * @returns Result containing TaskDTO on success, UseCaseError on failure
   */
  async execute(input: GetTaskInput): Promise<Result<TaskDTO, UseCaseError>> {
    const findResult = await this.taskRepository.findById(input.taskId);
    if (!findResult.ok) {
      return err(new UseCaseError(findResult.error.message, USE_CASE_ERRORS.NOT_FOUND));
    }

    const task = findResult.value;
    if (task.accountId !== input.accountId) {
      return err(new UseCaseError("Task not found", USE_CASE_ERRORS.NOT_FOUND));
    }

    return ok(task.toJSON());
  }
}
