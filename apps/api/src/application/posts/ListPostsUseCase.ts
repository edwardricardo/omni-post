/**
 * Application Layer - List Posts Use Case
 *
 * Part of Sprint 8: DDD Architecture Implementation
 * Migrated to CQRS read side (PostQueryRepository) in H10/P2-3.
 * Handles listing posts with pagination using the read-optimised query repo.
 *
 * NOTE: Status filtering is intentionally omitted — PostQueryRepository.listByProject()
 * is the base method and status-filtered queries can be added via a future
 * listByProjectWithFilters() extension when a route requires it.
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { ProjectId, type PostQueryRepository, type PostSortField } from "../../domain/index.js";
import { type PostDTO } from "./GetPostUseCase.js";

/**
 * Input DTO for listing posts
 */
export interface ListPostsInput {
  projectId: string;
  page?: number;
  limit?: number;
  sortBy?: PostSortField;
  sortDirection?: "asc" | "desc";
}

/**
 * Output DTO for paginated post list
 */
export interface ListPostsOutput {
  items: PostDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * List Posts Use Case
 *
 * Lists posts for a project with optional pagination and sorting.
 * Uses PostQueryRepository (CQRS read side) for optimised flat queries.
 *
 * @example
 * const useCase = new ListPostsUseCase(postQueryRepository);
 * const result = await useCase.execute({
 *   projectId: 'project-123',
 *   page: 1,
 *   limit: 20
 * });
 */
export class ListPostsUseCase implements UseCase<ListPostsInput, ListPostsOutput, UseCaseError> {
  constructor(private readonly postQueryRepository: PostQueryRepository) {}

  async execute(input: ListPostsInput): Promise<Result<ListPostsOutput, UseCaseError>> {
    // Validate project ID
    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid project ID: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Build pagination
    const pagination = {
      page: input.page ?? 1,
      limit: Math.min(input.limit ?? 20, 100),
    };

    // Build sort
    const sort = input.sortBy
      ? {
          field: input.sortBy,
          direction: input.sortDirection ?? ("desc" as const),
        }
      : undefined;

    // Query the read model directly — no aggregate loading or manual DTO mapping
    const result = await this.postQueryRepository.listByProject(
      projectIdResult.value,
      pagination,
      sort
    );

    return ok(result);
  }
}
