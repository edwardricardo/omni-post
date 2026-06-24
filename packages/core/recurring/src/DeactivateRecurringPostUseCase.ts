/**
 * @file DeactivateRecurringPostUseCase.ts
 * @description Application use case for deactivating a recurring post schedule.
 *   Sets the recurring post to inactive so no further occurrences are created.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type CommandUseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { RecurringPostRepository } from "@core/domain/repositories/RecurringPostRepository.js";
import { RecurringPost, CronExpression } from "@core/domain/entities/RecurringPost.js";
import { RecurringPostId, ProjectId } from "@core/domain/value-objects/EntityId.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for deactivating a recurring post.
 *
 * `callerAccountId` is the cross-tenant ownership gate (CWE-639). RecurringPost
 * is transitively tenant-scoped (FK -> Project.accountId), so the Prisma
 * `$extends` guard cannot auto-inject; when set, the use case resolves the
 * schedule's owner via `findOwnerAccountId` and rejects a foreign caller with
 * NOT_FOUND (anti-enumeration — same shape as a missing schedule). Optional for
 * backward compat with admin/internal callers that bypass the check.
 */
export interface DeactivateRecurringPostCommand {
  id: string;
  callerAccountId?: string;
}

/**
 * @class DeactivateRecurringPostUseCase
 * @description Deactivates a recurring post schedule. Loads the entity,
 *   calls the domain deactivation method, and re-persists.
 */
export class DeactivateRecurringPostUseCase implements CommandUseCase<
  DeactivateRecurringPostCommand,
  UseCaseError
> {
  constructor(
    private readonly recurringPostRepo: RecurringPostRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Deactivates a recurring post by its ID.
   * @param command - Contains the recurring post ID
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(command: DeactivateRecurringPostCommand): Promise<Result<void, UseCaseError>> {
    // Cross-tenant ownership gate (CWE-639). Resolve the owner via
    // Project.accountId before loading. A caller asking to deactivate a schedule
    // they do not own gets NOT_FOUND, not FORBIDDEN (no enumeration).
    if (command.callerAccountId !== undefined) {
      const ownerAccountId = await this.recurringPostRepo.findOwnerAccountId(command.id);
      if (!ownerAccountId || ownerAccountId.value !== command.callerAccountId) {
        return err(
          new UseCaseError(`Recurring post not found: ${command.id}`, USE_CASE_ERRORS.NOT_FOUND)
        );
      }
    }

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

    // Domain deactivation
    entity.deactivate();

    // Re-persist (atomically via UoW when available)
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
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
          new UseCaseError(
            saveResult.error.message,
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to deactivate recurring post",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
