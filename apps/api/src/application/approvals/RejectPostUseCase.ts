/**
 * @file RejectPostUseCase.ts
 * @description Application use case for rejecting a content approval request.
 *   Loads the aggregate, adds a REJECTED review, and persists the result.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { ApprovalRequestRepository } from "../../domain/repositories/ApprovalRequestRepository.js";
import { ReviewDecision } from "../../domain/value-objects/ReviewDecision.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Input DTO for rejecting a post
 */
export interface RejectPostCommand {
  requestId: string;
  reviewerId: string;
  comment?: string;
}

/**
 * @class RejectPostUseCase
 * @description Adds a REJECTED review to an existing approval request.
 */
export class RejectPostUseCase implements UseCase<RejectPostCommand, void, UseCaseError> {
  constructor(
    private readonly approvalRepo: ApprovalRequestRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Loads the approval request, adds a rejected review, and saves.
   * @param command - The rejection parameters
   * @returns Result<void> on success
   */
  async execute(command: RejectPostCommand): Promise<Result<void, UseCaseError>> {
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

    // Add rejected review
    const reviewResult = aggregate.addReview(
      command.reviewerId,
      ReviewDecision.rejected(),
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

    // Persist (atomically via UoW when available)
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
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
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save approval request",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
