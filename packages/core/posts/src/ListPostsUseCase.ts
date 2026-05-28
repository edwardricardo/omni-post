/**
 * @file ListPostsUseCase.ts
 * @description CQRS read-side query that lists posts for a specific project with pagination and sorting via PostQueryRepository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  ProjectId,
  type PostFilterCriteria,
  type PostQueryRepository,
  type PostSortField,
} from "@core/domain/index.js";
import type { PublishStatusValue } from "@core/domain/value-objects/PublishStatus.js";
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
  /** Single value or array; both become a multi-status filter at the repo level. */
  status?: PublishStatusValue | PublishStatusValue[];
  /** ISO 8601 datetime strings. */
  createdFrom?: string;
  createdTo?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  /** Substring search across PostContent.title + PostContent.body. */
  searchText?: string;
  /** Tag filter — `hasSome` semantics (any tag matches). */
  tags?: string[];
  /** When `true`, only posts with at least one media attachment. */
  hasMedia?: boolean;
  /** When `true`, the standard `archivedAt: null` filter is dropped. */
  includeArchived?: boolean;
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

    // Build filter — only populate when at least one criterion is set so the
    // repository can short-circuit to the no-filter path for plain listings.
    const filter = buildFilter(input);

    // Query the read model directly — no aggregate loading or manual DTO mapping
    const result = await this.postQueryRepository.listByProject(
      projectIdResult.value,
      pagination,
      sort,
      filter
    );

    return ok(result);
  }
}

/**
 * Translate an ISO datetime string from the input DTO to a Date. Returns
 * undefined when the input is missing, empty, or unparseable — the repo
 * treats undefined bounds as "no constraint" so silent invalid dates simply
 * loosen the filter rather than fail the request.
 */
function parseIsoDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Convert ListPostsInput's flat filter fields into a PostFilterCriteria, or
 * return undefined when no filter dimension is set so the repository skips
 * the where-clause builder entirely.
 */
function buildFilter(input: ListPostsInput): PostFilterCriteria | undefined {
  const createdAfter = parseIsoDate(input.createdFrom);
  const createdBefore = parseIsoDate(input.createdTo);
  const scheduledAfter = parseIsoDate(input.scheduledFrom);
  const scheduledBefore = parseIsoDate(input.scheduledTo);

  const hasAnyDimension =
    input.status !== undefined ||
    createdAfter !== undefined ||
    createdBefore !== undefined ||
    scheduledAfter !== undefined ||
    scheduledBefore !== undefined ||
    input.searchText !== undefined ||
    (input.tags && input.tags.length > 0) ||
    input.hasMedia !== undefined ||
    input.includeArchived === true;

  if (!hasAnyDimension) return undefined;

  return {
    ...(input.status !== undefined && { status: input.status }),
    ...(createdAfter !== undefined && { createdAfter }),
    ...(createdBefore !== undefined && { createdBefore }),
    ...(scheduledAfter !== undefined && { scheduledAfter }),
    ...(scheduledBefore !== undefined && { scheduledBefore }),
    ...(input.searchText !== undefined && { searchText: input.searchText }),
    ...(input.tags !== undefined && input.tags.length > 0 && { tags: input.tags }),
    ...(input.hasMedia !== undefined && { hasMedia: input.hasMedia }),
    ...(input.includeArchived === true && { includeArchived: true }),
  };
}
