/**
 * @file ApprovalRequestRepository.ts
 * @description Port interface for ApprovalRequest aggregate persistence.
 *   Defines the contract that infrastructure adapters must fulfill
 *   for the content approval workflow.
 * @layer domain
 */
import type { Result } from "@shared/types";
import type { ApprovalRequestAggregate } from "../aggregates/ApprovalRequestAggregate.js";
import type { DomainError, EntityNotFoundError } from "../errors/index.js";

/**
 * @interface ApprovalRequestRepository
 * @description Command + query repository port for ApprovalRequest aggregate persistence.
 *   Returns domain objects, never raw Prisma types.
 */
export interface ApprovalRequestRepository {
  /**
   * @method findById
   * @description Finds an approval request by its unique identifier.
   * @param id - The approval request ID string
   * @returns Result containing the aggregate on success, EntityNotFoundError if not found
   */
  findById(id: string): Promise<Result<ApprovalRequestAggregate, EntityNotFoundError>>;

  /**
   * @method findByPostId
   * @description Retrieves all approval requests for a given post.
   * @param postId - The post ID to search by
   * @returns Array of matching ApprovalRequestAggregate instances
   */
  findByPostId(postId: string): Promise<ApprovalRequestAggregate[]>;

  /**
   * @method findPendingForReviewer
   * @description Retrieves all pending approval requests where the given member
   *   is eligible to review (i.e., has not yet submitted a review).
   * @param reviewerId - The reviewer's member ID
   * @returns Array of pending ApprovalRequestAggregate instances
   */
  findPendingForReviewer(reviewerId: string): Promise<ApprovalRequestAggregate[]>;

  /**
   * @method save
   * @description Persists an approval request aggregate (create or update).
   * @param request - The ApprovalRequestAggregate to save
   * @returns Result<void> on success, DomainError on failure
   */
  save(request: ApprovalRequestAggregate): Promise<Result<void, DomainError>>;
}
