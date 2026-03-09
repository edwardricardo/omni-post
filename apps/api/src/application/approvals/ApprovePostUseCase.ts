/**
 * @file ApprovePostUseCase.ts
 * @description Application use case for approving a content approval request.
 *   Loads the aggregate, adds an APPROVED review, and persists the result.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { ApprovalRequestRepository } from "../../domain/repositories/ApprovalRequestRepository.js";
import { ReviewDecision } from "../../domain/value-objects/ReviewDecision.js";

/**
 * Input DTO for approving a post
 */
export interface ApprovePostCommand {
  requestId: string;
  reviewerId: string;
  comment?: string;
}

/**
 * @class ApprovePostUseCase
 * @description Adds an APPROVED review to an existing approval request.
 */
export class ApprovePostUseCase implements UseCase<ApprovePostCommand, void, UseCaseError> {
  constructor(private readonly approvalRepo: ApprovalRequestRepository) {}

  /**
   * @method execute
   * @description Loads the approval request, adds an approved review, and saves.
   * @param command - The approval parameters
   * @returns Result<void> on success
   */
  async execute(command: ApprovePostCommand): Promise<Result<void, UseCaseError>> {
    // Load approval request
    const findResult = await this.approvalRepo.findById(command.requestId);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Approval request not found: ${command.requestId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    const aggregate = findResult.value;

    // Add approved review
    const reviewResult = aggregate.addReview(
      command.reviewerId,
      ReviewDecision.approved(),
      ...(command.comment !== undefined ? [command.comment] : [])
    );

    if (!reviewResult.ok) {
      return err(
        new UseCaseError(
          reviewResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          reviewResult.error
        )
      );
    }

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

    return ok(undefined);
  }
}
