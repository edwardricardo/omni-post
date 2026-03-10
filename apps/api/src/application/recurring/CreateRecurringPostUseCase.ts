/**
 * @file CreateRecurringPostUseCase.ts
 * @description Application use case for creating a new recurring post schedule.
 *   Validates the cron expression via the domain entity factory and persists.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { RecurringPostRepository } from "../../domain/repositories/RecurringPostRepository.js";
import { RecurringPost, CronExpression } from "../../domain/entities/RecurringPost.js";
import { ProjectId } from "../../domain/value-objects/EntityId.js";

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
export class CreateRecurringPostUseCase
  implements UseCase<CreateRecurringPostCommand, CreateRecurringPostOutput, UseCaseError>
{
  constructor(private readonly recurringPostRepo: RecurringPostRepository) {}

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

    // Create domain entity (validates all invariants)
    const entityResult = RecurringPost.create({
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

    // Persist via repository
    const saveResult = await this.recurringPostRepo.save({
      id: json.id as string,
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
        new UseCaseError(saveResult.error.message, USE_CASE_ERRORS.INTERNAL_ERROR, saveResult.error)
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
  }
}
