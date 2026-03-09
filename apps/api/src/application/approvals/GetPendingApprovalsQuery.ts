/**
 * @file GetPendingApprovalsQuery.ts
 * @description Application query for retrieving pending approval requests for a reviewer.
 *   Returns DTOs, never domain objects (CQRS read side).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { ApprovalRequestRepository } from "../../domain/repositories/ApprovalRequestRepository.js";
import type { ApprovalRequestDTO } from "./GetApprovalHistoryQuery.js";

/**
 * Input DTO for querying pending approvals
 */
export interface GetPendingApprovalsInput {
  reviewerId: string;
}

/**
 * @class GetPendingApprovalsQuery
 * @description Retrieves all pending approval requests awaiting review by a specific member.
 */
export class GetPendingApprovalsQuery
  implements UseCase<GetPendingApprovalsInput, ApprovalRequestDTO[], UseCaseError>
{
  constructor(private readonly approvalRepo: ApprovalRequestRepository) {}

  /**
   * @method execute
   * @description Loads all pending approval requests for the reviewer and maps them to DTOs.
   * @param input - The query parameters
   * @returns Result<ApprovalRequestDTO[]> on success
   */
  async execute(
    input: GetPendingApprovalsInput
  ): Promise<Result<ApprovalRequestDTO[], UseCaseError>> {
    try {
      const aggregates = await this.approvalRepo.findPendingForReviewer(input.reviewerId);

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
          `Failed to retrieve pending approvals: ${error instanceof Error ? error.message : String(error)}`,
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }
  }
}
