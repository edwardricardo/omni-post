/**
 * @file ListTasksQuery.ts
 * @description Read-side query for listing tasks with optional filters.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, type UseCaseError } from "@core/application/UseCase.js";
import type { TaskRepository, TaskFilters } from "@core/domain/repositories/TaskRepository.js";
import type { TaskStatusValue, TaskPriorityValue, TaskProps } from "@core/domain/entities/Task.js";

/**
 * Input DTO for listing tasks.
 */
export interface ListTasksInput {
  accountId: string;
  projectId?: string;
  assigneeId?: string;
  status?: TaskStatusValue;
  priority?: TaskPriorityValue;
  limit?: number;
  offset?: number;
}

/**
 * DTO representing a task in list results.
 */
export type TaskDTO = TaskProps;

/**
 * @class ListTasksQuery
 * @description Queries the task repository with optional filters and returns DTOs.
 */
export class ListTasksQuery implements UseCase<ListTasksInput, TaskDTO[], UseCaseError> {
  constructor(private readonly taskRepository: TaskRepository) {}

  /**
   * @method execute
   * @description Lists tasks for the given account with optional filters.
   * @param input - Account ID and optional filters
   * @returns Result containing array of TaskDTO
   */
  async execute(input: ListTasksInput): Promise<Result<TaskDTO[], UseCaseError>> {
    const filters: TaskFilters = {
      ...(input.projectId !== undefined && { projectId: input.projectId }),
      ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.limit !== undefined && { limit: Math.min(input.limit, 100) }),
      ...(input.offset !== undefined && { offset: input.offset }),
    };

    const tasks = await this.taskRepository.findByAccountId(input.accountId, filters);
    return ok(tasks.map((t) => t.toJSON()));
  }
}
