/**
 * @file PostRepository.ts
 * @description Repository port for Post aggregate persistence — defines the contract for CRUD, filtering, pagination, and read-model projections.
 * @layer domain
 */

import { type Result } from "@shared/types";
import {
  type Repository,
  type PaginatedResult,
  type PaginationParams,
  type SortParams,
} from "./Repository.js";
import { PostAggregate } from "../aggregates/PostAggregate.js";
import { PostId, ProjectId, AccountId } from "../value-objects/EntityId.js";
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
  tags?: string[];
  /**
   * Include archived posts (those with archivedAt set). Default behaviour
   * filters them out so the standard listing view never shows archived
   * items. Set to `true` only for an explicit "Archive" view.
   */
  includeArchived?: boolean;
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
   * Bulk archive: stamp `archivedAt = now()` on every matching post that is
   * not already soft-deleted. Idempotent — re-archiving an already-archived
   * post is a no-op (the existing timestamp is preserved).
   *
   * @returns count of rows whose archivedAt was set in this call.
   */
  bulkArchive(postIds: PostId[]): Promise<Result<number, Error>>;

  /**
   * Bulk hard-delete: physically remove rows for every postId. Cascades to
   * contents, media, publishLogs, etc. Irreversible — soft-deleted posts
   * are also removed when included in the input set.
   *
   * @returns count of rows actually deleted.
   */
  bulkHardDelete(postIds: PostId[]): Promise<Result<number, Error>>;

  /**
   * Hard-delete a post and all its data (irreversible).
   * Only callable by SUPER_ADMIN. Cascades to contents, media, publishLogs, etc.
   */
  hardDelete(id: PostId): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Filter the input postIds to only those owned by `accountId` (joined via
   * Project). Used by use cases that take a customer-supplied list of postIds
   * to enforce cross-tenant isolation (CWE-639) — pass any input through this
   * filter before bulk-mutating, and the operation can no longer touch posts
   * the caller does not own. Returns an empty array if none match.
   */
  filterIdsByAccount(postIds: PostId[], accountId: AccountId): Promise<PostId[]>;

  /**
   * Resolve the accountId that owns this post (via Project.accountId). Used
   * by single-post mutating use cases to assert caller ownership before
   * proceeding. Returns null if the post does not exist.
   */
  findOwnerAccountId(postId: PostId): Promise<AccountId | null>;
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
   * Get post read model by ID, scoped to the caller's account (CWE-639).
   *
   * `accountId` is the server-derived caller account; ownership is the stored
   * transitive relation `post.project.accountId == accountId`. A post owned by
   * another account (or a nonexistent id) resolves to EntityNotFoundError —
   * indistinguishable, so the gate never reveals a foreign id exists.
   */
  getById(id: PostId, accountId: AccountId): Promise<Result<PostReadModel, EntityNotFoundError>>;

  /**
   * List posts for a project (optimized for listing), scoped to the caller's
   * account (CWE-639).
   *
   * `accountId` is the server-derived caller account; the query only returns
   * posts whose project belongs to it, so a client-supplied `projectId` owned by
   * another account yields an empty page rather than that account's posts.
   *
   * Optional `filter` narrows the result set with the same criteria shape used
   * by the command-side `findWithFilters`. `projectId` from the filter is
   * ignored — the explicit `projectId` parameter is authoritative for scope.
   */
  listByProject(
    projectId: ProjectId,
    accountId: AccountId,
    pagination?: PaginationParams,
    sort?: SortParams<PostSortField>,
    filter?: PostFilterCriteria
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
   * Get a post by ID enriched with thread data (tweets ordered by sequence),
   * scoped to the caller's account (CWE-639). Same NOT_FOUND semantics as
   * {@link getById}: a foreign-account post is indistinguishable from a
   * nonexistent one.
   */
  getByIdWithThread(
    id: PostId,
    accountId: AccountId
  ): Promise<Result<PostReadModelWithThread, EntityNotFoundError>>;

  /**
   * List the caller account's posts across all its projects (CWE-639).
   *
   * `accountId` is the server-derived caller account; the query only returns
   * posts whose project belongs to it, so a customer never receives another
   * account's posts through the unfiltered global list.
   */
  listGlobal(
    accountId: AccountId,
    filter?: GlobalPostFilter,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<PostReadModel>>;
}
