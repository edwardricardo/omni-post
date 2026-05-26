/**
 * @file FirstCommentRepository.ts
 * @description Port interface for FirstComment persistence.
 *   Defines the contract for storing and retrieving the first comment
 *   that should be auto-published after a post goes live.
 * @layer domain
 */
import type { Result } from "@shared/types";
import type { DomainError } from "../errors/index.js";

/**
 * @interface FirstCommentData
 * @description Plain data transfer object representing a first comment.
 *   Used across layer boundaries (no domain aggregate needed for this simple entity).
 */
export interface FirstCommentData {
  id: string;
  postId: string;
  body: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  providerCommentId?: string;
  error?: string;
}

/**
 * @interface FirstCommentRepository
 * @description Repository port for FirstComment aggregate persistence.
 *   Returns domain-level data, never raw Prisma types.
 */
export interface FirstCommentRepository {
  /**
   * @method save
   * @description Persists a first comment (create or update via upsert on postId).
   * @param comment - The first comment data to persist
   * @returns Result containing the persisted data on success
   */
  save(comment: FirstCommentData): Promise<Result<FirstCommentData, DomainError>>;

  /**
   * @method findByPostId
   * @description Finds the first comment associated with a given post.
   * @param postId - The post ID to look up
   * @returns Result containing the data or null if none exists
   */
  findByPostId(postId: string): Promise<Result<FirstCommentData | null, DomainError>>;

  /**
   * @method delete
   * @description Removes the first comment for a given post.
   * @param postId - The post ID whose first comment should be deleted
   * @returns Result<void> on success
   */
  delete(postId: string): Promise<Result<void, DomainError>>;

  /**
   * @method updateStatus
   * @description Updates the publishing status of a first comment.
   * @param postId - The post ID whose first comment status to update
   * @param status - The new status value (e.g. "PUBLISHED", "FAILED")
   * @param result - Optional result data from the publish attempt
   * @returns Result<void> on success
   */
  updateStatus(
    postId: string,
    status: string,
    result?: { providerCommentId?: string; error?: string }
  ): Promise<Result<void, DomainError>>;
}
