/**
 * @file GetApprovalHistoryQuery.ts
 * @description Application query for retrieving the approval history of a post.
 *   Returns DTOs, never domain objects (CQRS read side).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { ApprovalRequestRepository } from "@core/domain/repositories/ApprovalRequestRepository.js";

/**
 * Input DTO for querying approval history
 */
export interface GetApprovalHistoryInput {
  postId: string;
}

/**
 * Review DTO returned in query results
 */
export interface ApprovalReviewDTO {
  id: string;
  reviewerId: string;
  decision: string;
  comment?: string;
  reviewedAt: string;
}

/**
 * Approval request DTO returned in query results
 */
export interface ApprovalRequestDTO {
  id: string;
  postId: string;
  submitterId: string;
  status: string;
  comment?: string;
  reviews: ApprovalReviewDTO[];
  createdAt: string;
  updatedAt: string;
}

/**
 * @class GetApprovalHistoryQuery
 * @description Retrieves all approval requests for a given post as DTOs.
 */
export class GetApprovalHistoryQuery implements UseCase<
  GetApprovalHistoryInput,
  ApprovalRequestDTO[],
  UseCaseError
> {
  constructor(private readonly approvalRepo: ApprovalRequestRepository) {}

  /**
   * @method execute
   * @description Loads all approval requests for a post and maps them to DTOs.
   * @param input - The query parameters
   * @returns Result<ApprovalRequestDTO[]> on success
   */
  async execute(
    input: GetApprovalHistoryInput
  ): Promise<Result<ApprovalRequestDTO[], UseCaseError>> {
    try {
      const aggregates = await this.approvalRepo.findByPostId(input.postId);

      const dtos: ApprovalRequestDTO[] = aggregates.map((agg) => {
        const json = agg.toJSON();
        return {
          id: json.id as string,
          postId: json.postId as string,
          submitterId: json.submitterId as string,
          status: json.status as string,
          ...(json.comment !== undefined && { comment: json.comment as string }),
          reviews: (json.reviews as Array<Record<string, unknown>>).map((r) => ({
            id: r.id as string,
            reviewerId: r.reviewerId as string,
            decision: r.decision as string,
            ...(r.comment !== undefined && { comment: r.comment as string }),
            reviewedAt: r.reviewedAt as string,
          })),
          createdAt: json.createdAt as string,
          updatedAt: json.updatedAt as string,
        };
      });

      return ok(dtos);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          `Failed to retrieve approval history: ${error instanceof Error ? error.message : String(error)}`,
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }
  }
}
