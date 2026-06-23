/**
 * @file ListPostsGlobalQuery.ts
 * @description CQRS read-side query that lists posts across all projects with optional status filtering and pagination for admin and cross-project views.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, type UseCaseError } from "@core/application/UseCase.js";
import { AccountId } from "@core/domain/index.js";
import type { PostQueryRepository, PostReadModel, PaginatedResult } from "@core/domain/index.js";
import type { PublishStatusValue } from "@core/domain/value-objects/PublishStatus.js";

/**
 * Input DTO for listing posts globally.
 *
 * @property status - Optional publish status filter (e.g. "DRAFT", "SCHEDULED").
 * @property page - Page number (1-based). Defaults to 1.
 * @property limit - Number of items per page (1-100). Defaults to 20.
 * @property callerAccountId - Cross-tenant isolation gate (CWE-639). Post is
 *   transitively tenant-scoped (FK -> Project.accountId); when set, the query
 *   repository adds a `project: { accountId }` joined filter so the listing
 *   returns only the caller's own tenant rows instead of enumerating every
 *   tenant's posts. Omit ONLY for genuine admin/system cross-tenant views.
 */
export interface ListPostsGlobalInput {
  status?: PublishStatusValue;
  page?: number;
  limit?: number;
  callerAccountId?: string;
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
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(Math.max(1, input.limit ?? 20), 100);

    const filter = input.status !== undefined ? { status: input.status } : undefined;

    // Cross-tenant isolation gate (CWE-639): when the caller's accountId is
    // present, pass it so the repository scopes by Project.accountId and the
    // listing never enumerates other tenants' posts. Omitted entirely (not
    // passed as undefined) for admin/system cross-tenant views.
    const result =
      input.callerAccountId !== undefined
        ? await this.postQueryRepository.listGlobal(
            filter,
            { page, limit },
            AccountId.fromStringUnsafe(input.callerAccountId)
          )
        : await this.postQueryRepository.listGlobal(filter, { page, limit });

    return ok(result);
  }
}
