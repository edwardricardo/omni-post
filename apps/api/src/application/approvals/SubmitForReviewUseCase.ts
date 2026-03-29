/**
 * @file SubmitForReviewUseCase.ts
 * @description Application use case for submitting a post for content approval review.
 *   Creates a new ApprovalRequestAggregate and persists it.
 *   Supports optional multi-level workflow assignment.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { ApprovalRequestRepository } from "../../domain/repositories/ApprovalRequestRepository.js";
import type { ApprovalWorkflowRepository } from "../../domain/repositories/ApprovalWorkflowRepository.js";
import { ApprovalRequestAggregate } from "../../domain/aggregates/ApprovalRequestAggregate.js";
import type { PostRepository } from "../../domain/repositories/PostRepository.js";
import { PostId } from "../../domain/value-objects/EntityId.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Input DTO for submitting a post for review
 */
export interface SubmitForReviewCommand {
  postId: string;
  submitterId: string;
  accountId?: string;
  comment?: string;
  workflowId?: string;
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
 *   If a workflowId is provided, loads the workflow and assigns multi-level metadata.
 *   If no workflowId but an accountId is given, looks for the account default workflow.
 *   Falls back to single-level (backward-compatible) when no workflow is found.
 */
export class SubmitForReviewUseCase implements UseCase<
  SubmitForReviewCommand,
  SubmitForReviewResult,
  UseCaseError
> {
  constructor(
    private readonly approvalRepo: ApprovalRequestRepository,
    private readonly postRepo: PostRepository,
    private readonly unitOfWork?: UnitOfWork,
    private readonly workflowRepo?: ApprovalWorkflowRepository
  ) {}

  /**
   * @method execute
   * @description Validates the post exists, resolves workflow, creates an
   *   ApprovalRequestAggregate, and persists it.
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

    // Resolve workflow for multi-level support
    let workflowId: string | undefined;
    let totalLevels = 1;

    if (this.workflowRepo) {
      if (command.workflowId) {
        // Explicit workflow requested
        const wfResult = await this.workflowRepo.findById(command.workflowId);
        if (wfResult.ok) {
          const workflow = wfResult.value;
          if (workflow.isActive) {
            workflowId = workflow.id;
            totalLevels = workflow.getLevelCount();
          }
        }
      } else if (command.accountId) {
        // Look for account default workflow
        const defaultWf = await this.workflowRepo.findDefaultByAccountId(command.accountId);
        if (defaultWf && defaultWf.isActive) {
          workflowId = defaultWf.id;
          totalLevels = defaultWf.getLevelCount();
        }
      }
    }

    // Create the approval request aggregate
    const createResult = ApprovalRequestAggregate.create({
      postId: command.postId,
      submitterId: command.submitterId,
      ...(command.comment !== undefined && { comment: command.comment }),
      ...(workflowId !== undefined && { workflowId }),
      currentLevel: 1,
      totalLevels,
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

    // Persist (atomically via UoW when available)
    const doWork = async (): Promise<Result<SubmitForReviewResult, UseCaseError>> => {
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
    };

    try {
      if (this.unitOfWork) {
        let result: Result<SubmitForReviewResult, UseCaseError> = ok({
          requestId: aggregate.id.value,
        });
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
