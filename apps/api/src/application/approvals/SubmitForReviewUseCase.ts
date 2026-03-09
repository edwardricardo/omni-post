/**
 * @file SubmitForReviewUseCase.ts
 * @description Application use case for submitting a post for content approval review.
 *   Creates a new ApprovalRequestAggregate and persists it.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { ApprovalRequestRepository } from "../../domain/repositories/ApprovalRequestRepository.js";
import { ApprovalRequestAggregate } from "../../domain/aggregates/ApprovalRequestAggregate.js";
import type { PostRepository } from "../../domain/repositories/PostRepository.js";
import { PostId } from "../../domain/value-objects/EntityId.js";

/**
 * Input DTO for submitting a post for review
 */
export interface SubmitForReviewCommand {
  postId: string;
  submitterId: string;
  comment?: string;
}

/**
 * Output DTO after successful submission
 */
export interface SubmitForReviewResult {
  requestId: string;
}

/**
 * @class SubmitForReviewUseCase
 * @description Creates a new approval request for a post after verifying the post exists.
 */
export class SubmitForReviewUseCase
  implements UseCase<SubmitForReviewCommand, SubmitForReviewResult, UseCaseError>
{
  constructor(
    private readonly approvalRepo: ApprovalRequestRepository,
    private readonly postRepo: PostRepository
  ) {}

  /**
   * @method execute
   * @description Validates the post exists, creates an ApprovalRequestAggregate, and persists it.
   * @param command - The submission parameters
   * @returns Result<SubmitForReviewResult> with the new request ID on success
   */
  async execute(
    command: SubmitForReviewCommand
  ): Promise<Result<SubmitForReviewResult, UseCaseError>> {
    // Verify the post exists
    const postIdResult = PostId.fromString(command.postId);
    if (!postIdResult.ok) {
      return err(new UseCaseError("Invalid post ID format", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const postResult = await this.postRepo.findById(postIdResult.value);
    if (!postResult.ok) {
      return err(
        new UseCaseError(
          `Post not found: ${command.postId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          postResult.error
        )
      );
    }

    // Create the approval request aggregate
    const createResult = ApprovalRequestAggregate.create({
      postId: command.postId,
      submitterId: command.submitterId,
      ...(command.comment !== undefined && { comment: command.comment }),
    });

    if (!createResult.ok) {
      return err(
        new UseCaseError(
          createResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          createResult.error
        )
      );
    }

    const aggregate = createResult.value;

    // Persist
    const saveResult = await this.approvalRepo.save(aggregate);
    if (!saveResult.ok) {
      return err(
        new UseCaseError(
          "Failed to save approval request",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          saveResult.error
        )
      );
    }

    return ok({ requestId: aggregate.id.value });
  }
}
