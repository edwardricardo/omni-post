/**
 * Domain Layer - Post Repository Interface
 *
 * Part of Sprint 5: DDD Architecture Implementation
 * Defines the contract for Post aggregate persistence.
 */

import { type Result } from "@shared/types";
import {
  type Repository,
  type PaginatedResult,
  type PaginationParams,
  type SortParams,
} from "./Repository.js";
import { PostAggregate } from "../aggregates/PostAggregate.js";
import { PostId, ProjectId } from "../value-objects/EntityId.js";
import { type PublishStatusValue } from "../value-objects/PublishStatus.js";
import { EntityNotFoundError } from "../errors/index.js";

/**
 * Post filter criteria
 */
export interface PostFilterCriteria {
  projectId?: ProjectId;
  status?: PublishStatusValue | PublishStatusValue[];
  scheduledBefore?: Date;
  scheduledAfter?: Date;
  createdBefore?: Date;
  createdAfter?: Date;
  hasMedia?: boolean;
  searchText?: string;
}

/**
 * Post sortable fields
 */
export type PostSortField = "createdAt" | "updatedAt" | "scheduledAt" | "publishedAt" | "status";

/**
 * Post Repository Interface
 *
 * This is a PORT in the hexagonal architecture - it defines what the domain
 * needs from persistence without specifying how it's implemented.
 */
export interface PostRepository extends Repository<PostAggregate, PostId> {
  /**
   * Find all posts for a project
   */
  findByProjectId(
    projectId: ProjectId,
    pagination?: PaginationParams,
    sort?: SortParams<PostSortField>
  ): Promise<PaginatedResult<PostAggregate>>;

  /**
   * Find posts by status
   */
  findByStatus(
    status: PublishStatusValue | PublishStatusValue[],
    pagination?: PaginationParams
  ): Promise<PaginatedResult<PostAggregate>>;

  /**
   * Find posts ready for publishing (scheduled time has passed)
   */
  findReadyForPublishing(limit?: number): Promise<PostAggregate[]>;

  /**
   * Find posts with filters
   */
  findWithFilters(
    filters: PostFilterCriteria,
    pagination?: PaginationParams,
    sort?: SortParams<PostSortField>
  ): Promise<PaginatedResult<PostAggregate>>;

  /**
   * Count posts by project
   */
  countByProjectId(projectId: ProjectId): Promise<number>;

  /**
   * Count posts by status
   */
  countByStatus(projectId: ProjectId, status: PublishStatusValue): Promise<number>;

  /**
   * Get post statistics for a project
   */
  getProjectStats(projectId: ProjectId): Promise<{
    total: number;
    drafts: number;
    scheduled: number;
    published: number;
    failed: number;
  }>;

  /**
   * Bulk update status for multiple posts
   */
  bulkUpdateStatus(postIds: PostId[], status: PublishStatusValue): Promise<Result<void, Error>>;

  /**
   * Hard-delete a post and all its data (irreversible).
   * Only callable by SUPER_ADMIN. Cascades to contents, media, publishLogs, etc.
   */
  hardDelete(id: PostId): Promise<Result<void, EntityNotFoundError>>;
}

/**
 * Post read model for query operations (CQRS)
 */
export interface PostReadModel {
  id: string;
  projectId: string;
  title?: string;
  summary?: string;
  body: string;
  status: PublishStatusValue;
  locale: string;
  tags: string[];
  mediaCount: number;
  scheduledAt?: Date;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Thread read model for query operations (CQRS).
 * Represents a post's thread data with ordered tweets.
 */
export interface ThreadReadModel {
  id: string;
  postId: string;
  strategy: string;
  createdAt: Date;
  updatedAt: Date;
  tweets: TweetReadModel[];
}

/**
 * Single tweet within a thread read model.
 */
export interface TweetReadModel {
  id: string;
  threadId: string;
  sequenceNumber: number;
  content: string;
  media: unknown;
  tweetId: string | null;
  parentTweetId: string | null;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Post read model enriched with thread data.
 * Used when the caller needs thread/tweet information alongside the post.
 */
export interface PostReadModelWithThread extends PostReadModel {
  thread?: ThreadReadModel;
}

/**
 * Global post filter criteria for queries without a project scope.
 */
export interface GlobalPostFilter {
  status?: PublishStatusValue;
}

/**
 * Post Query Repository - Read-optimized queries (CQRS pattern)
 */
export interface PostQueryRepository {
  /**
   * Get post read model by ID
   */
  getById(id: PostId): Promise<Result<PostReadModel, EntityNotFoundError>>;

  /**
   * List posts for a project (optimized for listing)
   */
  listByProject(
    projectId: ProjectId,
    pagination?: PaginationParams,
    sort?: SortParams<PostSortField>
  ): Promise<PaginatedResult<PostReadModel>>;

  /**
   * Search posts by text
   */
  search(
    projectId: ProjectId,
    searchText: string,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<PostReadModel>>;

  /**
   * Get upcoming scheduled posts
   */
  getUpcoming(projectId: ProjectId, limit?: number): Promise<PostReadModel[]>;

  /**
   * Get recently published posts
   */
  getRecentlyPublished(projectId: ProjectId, limit?: number): Promise<PostReadModel[]>;

  /**
   * Get a post by ID enriched with thread data (tweets ordered by sequence).
   * Returns the same PostReadModel plus an optional thread property.
   */
  getByIdWithThread(id: PostId): Promise<Result<PostReadModelWithThread, EntityNotFoundError>>;

  /**
   * List posts globally (across all projects) with optional status filter.
   * Used by admin dashboards and cross-project views.
   */
  listGlobal(
    filter?: GlobalPostFilter,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<PostReadModel>>;
}
