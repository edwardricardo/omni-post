/**
 * @file ProcessRecurrenceUseCase.ts
 * @description Application use case for processing due recurring post schedules.
 *   Finds all active recurring posts whose nextScheduledAt is in the past,
 *   records an occurrence on each, and re-persists the updated state.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { RecurringPostRepository } from "../../domain/repositories/RecurringPostRepository.js";
import { RecurringPost, CronExpression } from "../../domain/entities/RecurringPost.js";
import { RecurringPostId, ProjectId } from "../../domain/value-objects/EntityId.js";

/**
 * Input DTO for processing recurrences
 */
export interface ProcessRecurrenceCommand {
  /** The reference time (defaults to now if not provided) */
  asOf?: string;
}

/**
 * Output DTO for a single processed recurrence
 */
export interface ProcessedRecurrence {
  recurringPostId: string;
  templatePostId: string;
  projectId: string;
  channels: string[];
  contentVariation: string;
  newOccurrenceCount: number;
  deactivated: boolean;
}

/**
 * Output DTO for the process operation
 */
export interface ProcessRecurrenceOutput {
  processed: ProcessedRecurrence[];
  totalProcessed: number;
}

/**
 * @class ProcessRecurrenceUseCase
 * @description Processes all due recurring post schedules: finds active posts
 *   where nextScheduledAt <= now, records an occurrence on each via the domain
 *   entity, and re-persists the updated state. Returns info needed to create
 *   actual posts from templates (delegated to the caller or a worker).
 */
export class ProcessRecurrenceUseCase
  implements UseCase<ProcessRecurrenceCommand, ProcessRecurrenceOutput, UseCaseError>
{
  constructor(private readonly recurringPostRepo: RecurringPostRepository) {}

  /**
   * @method execute
   * @description Finds and processes all due recurring post schedules.
   * @param command - Optional reference time
   * @returns Result containing info about processed recurrences
   */
  async execute(
    command: ProcessRecurrenceCommand
  ): Promise<Result<ProcessRecurrenceOutput, UseCaseError>> {
    const asOf = command.asOf ? new Date(command.asOf) : new Date();

    // Find all active recurring posts that are due
    const findResult = await this.recurringPostRepo.findActiveByNextScheduled(asOf);
    if (!findResult.ok) {
      return err(
        new UseCaseError(findResult.error.message, USE_CASE_ERRORS.INTERNAL_ERROR, findResult.error)
      );
    }

    const dueRecurrences = findResult.value;
    const processed: ProcessedRecurrence[] = [];

    for (const data of dueRecurrences) {
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

      // Record the occurrence through the domain entity
      entity.recordOccurrence();

      // Re-persist the updated entity
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
        ...(entity.lastScheduledAt !== undefined && {
          lastScheduledAt: entity.lastScheduledAt,
        }),
        ...(entity.nextScheduledAt !== undefined && {
          nextScheduledAt: entity.nextScheduledAt,
        }),
        channels: entity.channels,
        contentVariation: entity.contentVariation,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      });

      if (!saveResult.ok) {
        // Log but continue processing others
        continue;
      }

      processed.push({
        recurringPostId: entity.id.value,
        templatePostId: entity.templatePostId,
        projectId: entity.projectId.value,
        channels: entity.channels,
        contentVariation: entity.contentVariation,
        newOccurrenceCount: entity.occurrenceCount,
        deactivated: !entity.isActive,
      });
    }

    return ok({
      processed,
      totalProcessed: processed.length,
    });
  }
}
