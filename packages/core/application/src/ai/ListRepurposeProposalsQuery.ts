/**
 * @file ListRepurposeProposalsQuery.ts
 * @description Query that returns an account's repurpose proposals as a
 *              paginated page of flat DTOs. Read-only — no Unit of Work.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  RepurposeProposalQueryRepository,
  RepurposeProposalDto,
} from "@core/domain/repositories/RepurposeProposalQueryRepository.js";

export interface ListRepurposeProposalsInput {
  accountId: string;
  status?: string;
  limit: number;
  offset: number;
}

export interface ListRepurposeProposalsOutput {
  proposals: RepurposeProposalDto[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * @class ListRepurposeProposalsQuery
 * @description Returns one account's repurpose proposals as paginated DTOs.
 */
export class ListRepurposeProposalsQuery implements UseCase<
  ListRepurposeProposalsInput,
  ListRepurposeProposalsOutput,
  UseCaseError
> {
  constructor(private readonly repository: RepurposeProposalQueryRepository) {}

  /**
   * @method execute
   * @description Lists proposals for the given account, optionally filtered
   *   by status, with pagination echoed back for the caller.
   * @param input - accountId, optional status, limit, offset
   * @returns Result with the proposals page or a UseCaseError
   */
  async execute(
    input: ListRepurposeProposalsInput
  ): Promise<Result<ListRepurposeProposalsOutput, UseCaseError>> {
    try {
      const { proposals, total } = await this.repository.findByAccountId(input.accountId, {
        ...(input.status !== undefined && { status: input.status }),
        limit: input.limit,
        offset: input.offset,
      });
      return ok({ proposals, total, limit: input.limit, offset: input.offset });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to list repurpose proposals",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
