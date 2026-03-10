/**
 * @file UpdateRecurringPostUseCase.ts
 * @description Application use case for updating an existing recurring post schedule.
 *   Loads the entity from persistence, applies domain-level updates, and re-persists.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { RecurringPostRepository } from "../../domain/repositories/RecurringPostRepository.js";
import { RecurringPost, CronExpression } from "../../domain/entities/RecurringPost.js";
import { RecurringPostId, ProjectId } from "../../domain/value-objects/EntityId.js";

/**
 * Input DTO for updating a recurring post
 */
export interface UpdateRecurringPostCommand {
  id: string;
  name?: string;
  cronExpression?: string;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  maxOccurrences?: number;
  channels?: string[];
  contentVariation?: string;
}

/**
 * Output DTO for the update operation
 */
export interface UpdateRecurringPostOutput {
  id: string;
  name: string;
  cronExpression: string;
  timezone: string;
  isActive: boolean;
  occurrenceCount: number;
  channels: string[];
  contentVariation: string;
  updatedAt: string;
}

/**
 * @class UpdateRecurringPostUseCase
 * @description Updates mutable fields of an existing recurring post schedule.
 *   Reconstitutes the domain entity, applies updates through domain methods,
 *   and re-persists the result.
 */
export class UpdateRecurringPostUseCase
  implements UseCase<UpdateRecurringPostCommand, UpdateRecurringPostOutput, UseCaseError>
{
  constructor(private readonly recurringPostRepo: RecurringPostRepository) {}

  /**
   * @method execute
   * @description Loads, updates, and re-persists a recurring post.
   * @param command - The fields to update
   * @returns Result containing the updated recurring post data
   */
  async execute(
    command: UpdateRecurringPostCommand
  ): Promise<Result<UpdateRecurringPostOutput, UseCaseError>> {
    // Load existing entity
    const findResult = await this.recurringPostRepo.findById(command.id);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Recurring post not found: ${command.id}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    const data = findResult.value;

    // Reconstitute domain entity
    const entity = RecurringPost.fromPersistence({
      id: RecurringPostId.fromStringUnsafe(data.id),
      projectId: ProjectId.fromStringUnsafe(data.projectId),
      templatePostId: data.templatePostId,
      name: data.name,
      cronExpression: CronExpression.fromStringUnsafe(data.cronExpression),
      timezone: data.timezone,
      startDate: data.startDate,
      ...(data.endDate !== undefined && { endDate: data.endDate }),
      ...(data.maxOccurrences !== undefined && { maxOccurrences: data.maxOccurrences }),
      occurrenceCount: data.occurrenceCount,
      isActive: data.isActive,
      ...(data.lastScheduledAt !== undefined && { lastScheduledAt: data.lastScheduledAt }),
      ...(data.nextScheduledAt !== undefined && { nextScheduledAt: data.nextScheduledAt }),
      channels: data.channels,
      contentVariation: data.contentVariation as "EXACT" | "ROTATED" | "AI_GENERATED",
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });

    // Parse cron expression if provided
    let cronExpr: CronExpression | undefined;
    if (command.cronExpression !== undefined) {
      const cronResult = CronExpression.create(command.cronExpression);
      if (!cronResult.ok) {
        return err(new UseCaseError(cronResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
      }
      cronExpr = cronResult.value;
    }

    // Apply updates through domain method
    const updateResult = entity.updateDetails({
      ...(command.name !== undefined && { name: command.name }),
      ...(cronExpr !== undefined && { cronExpression: cronExpr }),
      ...(command.timezone !== undefined && { timezone: command.timezone }),
      ...(command.startDate !== undefined && { startDate: new Date(command.startDate) }),
      ...(command.endDate !== undefined && { endDate: new Date(command.endDate) }),
      ...(command.maxOccurrences !== undefined && { maxOccurrences: command.maxOccurrences }),
      ...(command.channels !== undefined && { channels: command.channels }),
      ...(command.contentVariation !== undefined && {
        contentVariation: command.contentVariation,
      }),
    });

    if (!updateResult.ok) {
      return err(new UseCaseError(updateResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Re-persist
    const saveResult = await this.recurringPostRepo.save({
      id: entity.id.value,
      projectId: entity.projectId.value,
      templatePostId: entity.templatePostId,
      name: entity.name,
      cronExpression: entity.cronExpression.value,
      timezone: entity.timezone,
      startDate: entity.startDate,
      ...(entity.endDate !== undefined && { endDate: entity.endDate }),
      ...(entity.maxOccurrences !== undefined && { maxOccurrences: entity.maxOccurrences }),
      occurrenceCount: entity.occurrenceCount,
      isActive: entity.isActive,
      ...(entity.lastScheduledAt !== undefined && { lastScheduledAt: entity.lastScheduledAt }),
      ...(entity.nextScheduledAt !== undefined && { nextScheduledAt: entity.nextScheduledAt }),
      channels: entity.channels,
      contentVariation: entity.contentVariation,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });

    if (!saveResult.ok) {
      return err(
        new UseCaseError(saveResult.error.message, USE_CASE_ERRORS.INTERNAL_ERROR, saveResult.error)
      );
    }

    const saved = saveResult.value;
    return ok({
      id: saved.id,
      name: saved.name,
      cronExpression: saved.cronExpression,
      timezone: saved.timezone,
      isActive: saved.isActive,
      occurrenceCount: saved.occurrenceCount,
      channels: saved.channels,
      contentVariation: saved.contentVariation,
      updatedAt: saved.updatedAt.toISOString(),
    });
  }
}
