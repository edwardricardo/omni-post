/**
 * @file ProcessRecurrenceUseCase.ts
 * @description Application use case for processing due recurring post schedules.
 *   Finds all active recurring posts whose nextScheduledAt is in the past,
 *   records an occurrence on each, and re-persists the updated state.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { RecurringPostRepository } from "@core/domain/repositories/RecurringPostRepository.js";
import { RecurringPost, CronExpression } from "@core/domain/entities/RecurringPost.js";
import { RecurringPostId, ProjectId } from "@core/domain/value-objects/EntityId.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

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
  /**
   * The recurrence's scheduled time for this occurrence (the entity's
   * pre-recordOccurrence `nextScheduledAt`). The caller uses this as the
   * `scheduledAt` for the resulting Post — preserves "Monday 9am" intent
   * even if the scheduler tick fires a few seconds late.
   */
  dueAt: Date;
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
export class ProcessRecurrenceUseCase implements UseCase<
  ProcessRecurrenceCommand,
  ProcessRecurrenceOutput,
  UseCaseError
> {
  constructor(
    private readonly recurringPostRepo: RecurringPostRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

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

    // Process all due recurrences (atomically via UoW when available)
    const doWork = async (): Promise<Result<ProcessRecurrenceOutput, UseCaseError>> => {
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

        // Capture the pre-record nextScheduledAt — this is the canonical
        // "intended publish time" of the occurrence we're about to fire.
        // Falls back to `asOf` when the entity has no nextScheduledAt yet
        // (first occurrence of a brand-new recurrence).
        const dueAt = entity.nextScheduledAt ?? asOf;

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
          dueAt,
        });
      }

      return ok({
        processed,
        totalProcessed: processed.length,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ProcessRecurrenceOutput, UseCaseError> = ok({
          processed: [],
          totalProcessed: 0,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to process recurrences",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
