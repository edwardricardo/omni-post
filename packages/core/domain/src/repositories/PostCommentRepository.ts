/**
 * @file PostCommentRepository.ts
 * @description Port interface for PostComment aggregate persistence.
 *   Defines the contract that infrastructure adapters must fulfill for
 *   comment storage, retrieval, and cursor-based pagination.
 * @layer domain
 */
import type { Result } from "@shared/types";
import type { PostCommentAggregate } from "../aggregates/PostCommentAggregate.js";
import type { EntityNotFoundError } from "../errors/index.js";

/**
 * @interface PostCommentFindOptions
 * @description Options for paginated comment queries on a specific post.
 */
export interface PostCommentFindOptions {
  cursor?: string;
  limit: number;
  parentOnly?: boolean;
}

/**
 * @interface PostCommentPaginatedResult
 * @description Paginated result for comment queries with cursor-based pagination.
 */
export interface PostCommentPaginatedResult {
  items: PostCommentAggregate[];
  nextCursor?: string;
}

/**
 * @interface PostCommentRepository
 * @description Command + query repository port for PostComment aggregate persistence.
 *   Returns domain objects, never raw Prisma types.
 */
export interface PostCommentRepository {
  /**
   * @method findById
   * @description Finds a comment by its unique identifier.
   * @param id - The comment ID string
   * @returns Result containing the aggregate on success, EntityNotFoundError if not found
   */
  findById(id: string): Promise<Result<PostCommentAggregate, EntityNotFoundError>>;

  /**
   * @method findByPost
   * @description Retrieves comments for a post with cursor-based pagination.
   *   When parentOnly is true, only top-level comments (no parentId) are returned.
   * @param postId - The post ID to find comments for
   * @param options - Pagination and filter options
   * @returns Paginated result with comments and optional next cursor
   */
  findByPost(postId: string, options: PostCommentFindOptions): Promise<PostCommentPaginatedResult>;

  /**
   * @method findReplies
   * @description Retrieves all direct replies to a given comment.
   * @param parentId - The parent comment ID
   * @returns Array of reply comment aggregates
   */
  findReplies(parentId: string): Promise<PostCommentAggregate[]>;

  /**
   * @method save
   * @description Persists a comment aggregate (create or update).
   * @param comment - The PostCommentAggregate to save
   */
  save(comment: PostCommentAggregate): Promise<void>;

  /**
   * @method softDelete
   * @description Marks a comment as soft-deleted by setting deletedAt.
   * @param id - The comment ID string
   * @returns Result<void> on success, EntityNotFoundError if not found
   */
  softDelete(id: string): Promise<Result<void, EntityNotFoundError>>;

  /**
   * @method countByPost
   * @description Counts non-deleted comments for a given post.
   * @param postId - The post ID
   * @returns The count of active (non-deleted) comments
   */
  countByPost(postId: string): Promise<number>;
}
