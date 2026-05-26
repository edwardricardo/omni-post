/**
 * @file TaskRepository.ts
 * @description Port interface for persisting and querying Task entities.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { Task, TaskStatusValue, TaskPriorityValue } from "../entities/Task.js";

/**
 * Filter options for listing tasks.
 */
export interface TaskFilters {
  projectId?: string;
  status?: TaskStatusValue;
  priority?: TaskPriorityValue;
  assigneeId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Repository port for Task aggregate persistence.
 */
export interface TaskRepository {
  /**
   * Find a single task by its unique identifier.
   */
  findById(id: string): Promise<Result<Task, Error>>;

  /**
   * Return all non-deleted tasks for an account, with optional filters.
   * Orders by priority descending, then createdAt descending.
   */
  findByAccountId(accountId: string, filters?: TaskFilters): Promise<Task[]>;

  /**
   * Persist a task (create or update via upsert).
   */
  save(task: Task): Promise<Result<void, Error>>;

  /**
   * Soft-delete a task by setting its deletedAt timestamp.
   */
  softDelete(id: string): Promise<Result<void, Error>>;
}
