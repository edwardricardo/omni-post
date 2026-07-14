/**
 * @file UpdateRecurringPostUseCase.ts
 * @description Application use case for updating an existing recurring post schedule.
 *   Loads the entity from persistence, applies domain-level updates, and re-persists.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { RecurringPostRepository } from "@core/domain/repositories/RecurringPostRepository.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import { RecurringPost, CronExpression } from "@core/domain/entities/RecurringPost.js";
import { RecurringPostId, ProjectId } from "@core/domain/value-objects/EntityId.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

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
export class UpdateRecurringPostUseCase implements UseCase<
  UpdateRecurringPostCommand,
  UpdateRecurringPostOutput,
  UseCaseError
> {
  constructor(
    private readonly recurringPostRepo: RecurringPostRepository,
    private readonly channelRepository: ChannelRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

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
      accountId: data.accountId,
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

    // Channel-repoint consistency: if the caller repoints the recurrence to a
    // new channel set, every new channel MUST belong to the recurrence's OWN
    // project (the recurrence itself was already guard-validated by the enrolled
    // `findById` above). Channel is UNENROLLED, so its findById is not
    // tenant-filtered — this app-level project-consistency check closes the
    // cross-tenant publish-targeting escalation on the PATCH path. A foreign or
    // missing channel → NOT_FOUND before any persistence.
    if (command.channels !== undefined) {
      const ownedChannelIds = new Set(
        (await this.channelRepository.findIdsByProjectId(entity.projectId)).map((c) => c.value)
      );
      for (const channelIdValue of command.channels) {
        if (!ownedChannelIds.has(channelIdValue)) {
          return err(
            new UseCaseError(`Channel not found: ${channelIdValue}`, USE_CASE_ERRORS.NOT_FOUND)
          );
        }
      }
    }

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

    // Re-persist (atomically via UoW when available)
    const doWork = async (): Promise<Result<UpdateRecurringPostOutput, UseCaseError>> => {
      const saveResult = await this.recurringPostRepo.save({
        id: entity.id.value,
        accountId: entity.accountId,
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
          new UseCaseError(
            saveResult.error.message,
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
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
    };

    try {
      if (this.unitOfWork) {
        let result: Result<UpdateRecurringPostOutput, UseCaseError> = err(
          new UseCaseError("Transaction not completed", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to update recurring post",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
