/**
 * @file ListPostsGlobalQuery.ts
 * @description CQRS read-side query that lists posts across all projects with optional status filtering and pagination for admin and cross-project views.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  AccountId,
  type PostQueryRepository,
  type PostReadModel,
  type PaginatedResult,
} from "@core/domain/index.js";
import type { PublishStatusValue } from "@core/domain/value-objects/PublishStatus.js";

/**
 * Input DTO for listing posts globally.
 *
 * @property callerAccountId - Server-derived caller account (from
 *   `request.customerUser.accountId`, never client input). REQUIRED — the
 *   unfiltered list is scoped to it so a customer only ever sees their own
 *   posts across their projects, never another account's (CWE-639, Option A).
 * @property status - Optional publish status filter (e.g. "DRAFT", "SCHEDULED").
 * @property page - Page number (1-based). Defaults to 1.
 * @property limit - Number of items per page (1-100). Defaults to 20.
 */
export interface ListPostsGlobalInput {
  callerAccountId: string;
  status?: PublishStatusValue;
  page?: number;
  limit?: number;
}

/**
 * Output DTO for a paginated global post list.
 * Extends PaginatedResult with PostReadModel items.
 */
export type ListPostsGlobalOutput = PaginatedResult<PostReadModel>;

/**
 * List Posts Global Query
 *
 * Returns a paginated list of posts across all projects. Supports optional
 * filtering by status. Uses the PostQueryRepository.listGlobal() method
 * for efficient cross-project reads.
 *
 * @param postQueryRepository - Read-optimized query repository port.
 *
 * @returns Paginated list of PostReadModel items on success.
 *
 * @example
 * const query = new ListPostsGlobalQuery(postQueryRepository);
 * const result = await query.execute({
 *   status: "SCHEDULED",
 *   page: 1,
 *   limit: 20,
 * });
 * if (result.ok) {
 *   console.log(result.value.total); // total matching posts
 * }
 */
export class ListPostsGlobalQuery implements UseCase<
  ListPostsGlobalInput,
  ListPostsGlobalOutput,
  UseCaseError
> {
  constructor(private readonly postQueryRepository: PostQueryRepository) {}

  async execute(input: ListPostsGlobalInput): Promise<Result<ListPostsGlobalOutput, UseCaseError>> {
    // Validate the server-derived caller account (CWE-639 read scope).
    const accountIdResult = AccountId.fromString(input.callerAccountId);
    if (!accountIdResult.ok) {
      return err(new UseCaseError("Invalid caller account", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(Math.max(1, input.limit ?? 20), 100);

    const filter = input.status !== undefined ? { status: input.status } : undefined;

    // Scope the unfiltered global list to the caller account so a customer only
    // ever receives their own posts across their projects (Option A).
    const result = await this.postQueryRepository.listGlobal(accountIdResult.value, filter, {
      page,
      limit,
    });

    return ok(result);
  }
}
