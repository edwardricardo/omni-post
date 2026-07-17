/**
 * @file CreateRecurringPostUseCase.ts
 * @description Application use case for creating a new recurring post schedule.
 *   Validates the cron expression via the domain entity factory and persists.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { RecurringPostRepository } from "@core/domain/repositories/RecurringPostRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { PostRepository } from "@core/domain/repositories/PostRepository.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import { RecurringPost, CronExpression } from "@core/domain/entities/RecurringPost.js";
import { ProjectId, PostId } from "@core/domain/value-objects/EntityId.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for creating a recurring post
 */
export interface CreateRecurringPostCommand {
  projectId: string;
  templatePostId: string;
  name: string;
  cronExpression: string;
  timezone?: string;
  startDate: string;
  endDate?: string;
  maxOccurrences?: number;
  channels: string[];
  contentVariation?: string;
}

/**
 * Output DTO for the create operation
 */
export interface CreateRecurringPostOutput {
  id: string;
  projectId: string;
  templatePostId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  startDate: string;
  endDate?: string;
  maxOccurrences?: number;
  occurrenceCount: number;
  isActive: boolean;
  nextScheduledAt?: string;
  channels: string[];
  contentVariation: string;
  createdAt: string;
}

/**
 * @class CreateRecurringPostUseCase
 * @description Creates a new recurring post schedule. Validates the cron expression
 *   and all invariants through the domain entity factory, then persists via the repository.
 */
export class CreateRecurringPostUseCase implements UseCase<
  CreateRecurringPostCommand,
  CreateRecurringPostOutput,
  UseCaseError
> {
  constructor(
    private readonly recurringPostRepo: RecurringPostRepository,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly postRepository: PostRepository,
    private readonly channelRepository: ChannelRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates and creates a recurring post schedule.
   * @param command - The creation parameters
   * @returns Result containing the persisted recurring post data
   */
  async execute(
    command: CreateRecurringPostCommand
  ): Promise<Result<CreateRecurringPostOutput, UseCaseError>> {
    // Validate cron expression via domain value object
    const cronResult = CronExpression.create(command.cronExpression);
    if (!cronResult.ok) {
      return err(new UseCaseError(cronResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Validate project ID
    const projectIdResult = ProjectId.fromString(command.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(projectIdResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // TRIPLE parent-ownership — resolve/verify all three client-supplied refs
    // BEFORE any persistence, so each resolves to NOT_FOUND (never 403/500) and
    // the catch-all below can never flatten it to INTERNAL_ERROR.
    //
    // (1) Project — resolved through the GUARD-SCOPED repository. A foreign or
    //     nonexistent projectId resolves to NOT_FOUND under the caller's tenant
    //     context. THIS is the guard-scoping leg; it also yields the accountId.
    const projectResult = await this.projectRepository.findById(projectIdResult.value);
    if (!projectResult.ok) {
      return err(new UseCaseError(projectResult.error.message, USE_CASE_ERRORS.NOT_FOUND));
    }
    const accountId = projectResult.value.accountId.toString();

    // (2) Template post — Post is UNENROLLED (not guard-scoped), so its findById
    //     is NOT tenant-filtered. The control is an app-level project-consistency
    //     check against the already-guard-validated projectId: a confirmed-own
    //     project's children are transitively own. A foreign or missing template
    //     → NOT_FOUND, closing the scheduler's template-clone content-exfil.
    const templateResult = await this.postRepository.findById(
      PostId.fromStringUnsafe(command.templatePostId)
    );
    if (
      !templateResult.ok ||
      templateResult.value.projectId.value !== projectIdResult.value.value
    ) {
      return err(
        new UseCaseError(
          `Template post not found: ${command.templatePostId}`,
          USE_CASE_ERRORS.NOT_FOUND
        )
      );
    }

    // (3) Channels — app-level project-consistency check, closing cross-tenant
    //     publish targeting. `findIdsByProjectId` is the decryption-free
    //     ownership lookup (the documented "does channel X belong to project Y?"
    //     method the saga admission path uses); it avoids the credential
    //     decryption that `findById` performs. Any channel not owned by the
    //     guard-validated project → NOT_FOUND.
    const ownedChannelIds = new Set(
      (await this.channelRepository.findIdsByProjectId(projectIdResult.value)).map((c) => c.value)
    );
    for (const channelIdValue of command.channels) {
      if (!ownedChannelIds.has(channelIdValue)) {
        return err(
          new UseCaseError(`Channel not found: ${channelIdValue}`, USE_CASE_ERRORS.NOT_FOUND)
        );
      }
    }

    // Create domain entity (validates all invariants)
    const entityResult = RecurringPost.create({
      accountId,
      projectId: projectIdResult.value,
      templatePostId: command.templatePostId,
      name: command.name,
      cronExpression: cronResult.value,
      ...(command.timezone !== undefined && { timezone: command.timezone }),
      startDate: new Date(command.startDate),
      ...(command.endDate !== undefined && { endDate: new Date(command.endDate) }),
      ...(command.maxOccurrences !== undefined && { maxOccurrences: command.maxOccurrences }),
      channels: command.channels,
      ...(command.contentVariation !== undefined && {
        contentVariation: command.contentVariation as "EXACT" | "ROTATED" | "AI_GENERATED",
      }),
    });

    if (!entityResult.ok) {
      return err(new UseCaseError(entityResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const entity = entityResult.value;
    const json = entity.toJSON();

    // Persist via repository (atomically via UoW when available)
    const doWork = async (): Promise<Result<CreateRecurringPostOutput, UseCaseError>> => {
      const saveResult = await this.recurringPostRepo.save({
        id: json.id as string,
        accountId: entity.accountId,
        projectId: json.projectId as string,
        templatePostId: json.templatePostId as string,
        name: json.name as string,
        cronExpression: json.cronExpression as string,
        timezone: json.timezone as string,
        startDate: entity.startDate,
        ...(entity.endDate !== undefined && { endDate: entity.endDate }),
        ...(entity.maxOccurrences !== undefined && { maxOccurrences: entity.maxOccurrences }),
        occurrenceCount: entity.occurrenceCount,
        isActive: entity.isActive,
        ...(entity.nextScheduledAt !== undefined && { nextScheduledAt: entity.nextScheduledAt }),
        channels: entity.channels,
        contentVariation: json.contentVariation as string,
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
        projectId: saved.projectId,
        templatePostId: saved.templatePostId,
        name: saved.name,
        cronExpression: saved.cronExpression,
        timezone: saved.timezone,
        startDate: saved.startDate.toISOString(),
        ...(saved.endDate !== undefined && { endDate: saved.endDate.toISOString() }),
        ...(saved.maxOccurrences !== undefined && { maxOccurrences: saved.maxOccurrences }),
        occurrenceCount: saved.occurrenceCount,
        isActive: saved.isActive,
        ...(saved.nextScheduledAt !== undefined && {
          nextScheduledAt: saved.nextScheduledAt.toISOString(),
        }),
        channels: saved.channels,
        contentVariation: saved.contentVariation,
        createdAt: saved.createdAt.toISOString(),
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreateRecurringPostOutput, UseCaseError> = err(
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
          "Failed to save recurring post",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
