/**
 * Application Layer - List Posts Global Query
 *
 * CQRS read-side query that lists posts across all projects with optional
 * status filtering. Used by admin dashboards and cross-project views where
 * no project scope is specified.
 *
 * Part of P2-ARCH-1: Migrate postRoutes Prisma direct calls to use cases.
 *
 * @module application/posts/ListPostsGlobalQuery
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, type UseCaseError } from "../UseCase.js";
import type { PostQueryRepository, PostReadModel, PaginatedResult } from "../../domain/index.js";
import type { PublishStatusValue } from "../../domain/value-objects/PublishStatus.js";

/**
 * Input DTO for listing posts globally.
 *
 * @property status - Optional publish status filter (e.g. "DRAFT", "SCHEDULED").
 * @property page - Page number (1-based). Defaults to 1.
 * @property limit - Number of items per page (1-100). Defaults to 20.
 */
export interface ListPostsGlobalInput {
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
export class ListPostsGlobalQuery
  implements UseCase<ListPostsGlobalInput, ListPostsGlobalOutput, UseCaseError>
{
  constructor(private readonly postQueryRepository: PostQueryRepository) {}

  async execute(input: ListPostsGlobalInput): Promise<Result<ListPostsGlobalOutput, UseCaseError>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(Math.max(1, input.limit ?? 20), 100);

    const filter = input.status !== undefined ? { status: input.status } : undefined;

    const result = await this.postQueryRepository.listGlobal(filter, { page, limit });

    return ok(result);
  }
}
