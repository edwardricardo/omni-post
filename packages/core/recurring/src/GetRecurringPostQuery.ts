/**
 * @file GetRecurringPostQuery.ts
 * @description Application query for retrieving a single recurring post by ID.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, UseCaseError } from "@core/application/UseCase.js";
import type { RecurringPostRepository } from "@core/domain/repositories/RecurringPostRepository.js";

/**
 * Input parameters for the query.
 *
 * `callerAccountId` is the cross-tenant ownership gate (CWE-639). RecurringPost
 * is transitively tenant-scoped (FK -> Project.accountId), so the Prisma
 * `$extends` guard cannot auto-inject; when set, the query resolves the
 * schedule's owner via `findOwnerAccountId` and returns `null` (same shape as a
 * missing schedule, anti-enumeration) for a foreign caller. Optional for
 * backward compat with admin/internal callers that bypass the check.
 */
export interface GetRecurringPostParams {
  id: string;
  callerAccountId?: string;
}

/**
 * Output DTO for a single recurring post
 */
export interface RecurringPostDetailDTO {
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
  lastScheduledAt?: string;
  nextScheduledAt?: string;
  channels: string[];
  contentVariation: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * @class GetRecurringPostQuery
 * @description Retrieves a single recurring post by its ID, returning a detailed DTO.
 */
export class GetRecurringPostQuery implements UseCase<
  GetRecurringPostParams,
  RecurringPostDetailDTO | null,
  UseCaseError
> {
  constructor(private readonly recurringPostRepo: RecurringPostRepository) {}

  /**
   * @method execute
   * @description Fetches a recurring post by ID.
   * @param params - Query parameters containing the recurring post ID
   * @returns Result containing the DTO or null if not found
   */
  async execute(
    params: GetRecurringPostParams
  ): Promise<Result<RecurringPostDetailDTO | null, UseCaseError>> {
    // Cross-tenant ownership gate (CWE-639). Resolve the owner via
    // Project.accountId before reading. A caller asking for a schedule they do
    // not own gets `null` — same shape as a missing schedule (no enumeration).
    if (params.callerAccountId !== undefined) {
      const ownerAccountId = await this.recurringPostRepo.findOwnerAccountId(params.id);
      if (!ownerAccountId || ownerAccountId.value !== params.callerAccountId) {
        return ok(null);
      }
    }

    const findResult = await this.recurringPostRepo.findById(params.id);

    if (!findResult.ok) {
      // Repository returns EntityNotFoundError when not found
      return ok(null);
    }

    const data = findResult.value;

    return ok({
      id: data.id,
      projectId: data.projectId,
      templatePostId: data.templatePostId,
      name: data.name,
      cronExpression: data.cronExpression,
      timezone: data.timezone,
      startDate: data.startDate.toISOString(),
      ...(data.endDate !== undefined && { endDate: data.endDate.toISOString() }),
      ...(data.maxOccurrences !== undefined && { maxOccurrences: data.maxOccurrences }),
      occurrenceCount: data.occurrenceCount,
      isActive: data.isActive,
      ...(data.lastScheduledAt !== undefined && {
        lastScheduledAt: data.lastScheduledAt.toISOString(),
      }),
      ...(data.nextScheduledAt !== undefined && {
        nextScheduledAt: data.nextScheduledAt.toISOString(),
      }),
      channels: data.channels,
      contentVariation: data.contentVariation,
      createdAt: data.createdAt.toISOString(),
      updatedAt: data.updatedAt.toISOString(),
    });
  }
}
