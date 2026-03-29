/**
 * @file CreateTaskUseCase.ts
 * @description Creates a new Task entity and persists it via the repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TaskRepository } from "../../domain/repositories/TaskRepository.js";
import { Task, type TaskPriorityValue } from "../../domain/entities/Task.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { NotifyMentionedUsersService } from "../mentions/NotifyMentionedUsersService.js";
import { MENTION_CONTEXT } from "../mentions/NotifyMentionedUsersService.js";

/**
 * Input DTO for creating a task.
 */
export interface CreateTaskInput {
  accountId: string;
  projectId?: string;
  title: string;
  description?: string;
  assigneeId?: string;
  createdById: string;
  createdByName?: string;
  dueDate?: Date;
  priority?: TaskPriorityValue;
  postId?: string;
}

/**
 * Output DTO for created task.
 */
export interface CreateTaskOutput {
  id: string;
}

/**
 * @class CreateTaskUseCase
 * @description Orchestrates task creation: validates input, constructs entity,
 *   persists via repository within a Unit of Work transaction.
 */
export class CreateTaskUseCase implements UseCase<CreateTaskInput, CreateTaskOutput, UseCaseError> {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly unitOfWork?: UnitOfWork,
    private readonly mentionNotifier?: NotifyMentionedUsersService
  ) {}

  /**
   * @method execute
   * @description Creates a new task entity and persists it transactionally.
   * @param input - Validated creation parameters
   * @returns Result<CreateTaskOutput> on success, UseCaseError on failure
   */
  async execute(input: CreateTaskInput): Promise<Result<CreateTaskOutput, UseCaseError>> {
    const createResult = Task.create({
      accountId: input.accountId,
      title: input.title,
      createdById: input.createdById,
      ...(input.projectId !== undefined && { projectId: input.projectId }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
      ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.postId !== undefined && { postId: input.postId }),
    });

    if (!createResult.ok) {
      return err(new UseCaseError(createResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const task = createResult.value;

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

    // After successful persistence, notify mentioned users in description
    if (this.mentionNotifier && input.description) {
      void this.mentionNotifier.notify({
        text: input.description,
        accountId: input.accountId,
        mentionedById: input.createdById,
        mentionedByName: input.createdByName ?? "A team member",
        context: MENTION_CONTEXT.TASK,
        contextId: task.id,
      });
    }

    return ok({ id: task.id });
  }
}
