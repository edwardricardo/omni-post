/**
 * @file ListRecurringPostsQuery.ts
 * @description Application query for listing all recurring posts in a project.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { RecurringPostRepository } from "@core/domain/repositories/RecurringPostRepository.js";

/**
 * Input parameters for the query
 */
export interface ListRecurringPostsParams {
  projectId: string;
}

/**
 * Output DTO for a recurring post in the list
 */
export interface RecurringPostListDTO {
  id: string;
  projectId: string;
  templatePostId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  isActive: boolean;
  occurrenceCount: number;
  nextScheduledAt?: string;
  channels: string[];
  contentVariation: string;
  createdAt: string;
}

/**
 * @class ListRecurringPostsQuery
 * @description Lists all recurring post schedules belonging to a project.
 */
export class ListRecurringPostsQuery implements UseCase<
  ListRecurringPostsParams,
  RecurringPostListDTO[],
  UseCaseError
> {
  constructor(private readonly recurringPostRepo: RecurringPostRepository) {}

  /**
   * @method execute
   * @description Fetches all recurring posts for a given project.
   * @param params - Query parameters containing projectId
   * @returns Result containing an array of recurring post DTOs
   */
  async execute(
    params: ListRecurringPostsParams
  ): Promise<Result<RecurringPostListDTO[], UseCaseError>> {
    const findResult = await this.recurringPostRepo.findByProjectId(params.projectId);

    if (!findResult.ok) {
      return err(
        new UseCaseError(findResult.error.message, USE_CASE_ERRORS.INTERNAL_ERROR, findResult.error)
      );
    }

    const dtos: RecurringPostListDTO[] = findResult.value.map((data) => ({
      id: data.id,
      projectId: data.projectId,
      templatePostId: data.templatePostId,
      name: data.name,
      cronExpression: data.cronExpression,
      timezone: data.timezone,
      isActive: data.isActive,
      occurrenceCount: data.occurrenceCount,
      ...(data.nextScheduledAt !== undefined && {
        nextScheduledAt: data.nextScheduledAt.toISOString(),
      }),
      channels: data.channels,
      contentVariation: data.contentVariation,
      createdAt: data.createdAt.toISOString(),
    }));

    return ok(dtos);
  }
}
