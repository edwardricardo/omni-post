/**
 * @file RemoveTeamMemberUseCase.ts
 * @description Application use case for deactivating a team member.
 *   Loads the CustomerUser, calls deactivate(), and persists the updated entity.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CustomerUserRepository } from "../../domain/repositories/CustomerUserRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Input DTO for removing (deactivating) a team member
 */
export interface RemoveTeamMemberInput {
  memberId: string;
  changerMemberId: string;
}

/**
 * @class RemoveTeamMemberUseCase
 * @description Deactivates a team member (CustomerUser) after verifying they
 *   can be removed (the domain entity refuses to deactivate OWNERs).
 */
export class RemoveTeamMemberUseCase implements UseCase<RemoveTeamMemberInput, void, UseCaseError> {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Loads the member, deactivates through the domain entity, and persists.
   */
  async execute(input: RemoveTeamMemberInput): Promise<Result<void, UseCaseError>> {
    if (!input.memberId || input.memberId.trim().length === 0) {
      return err(
        new UseCaseError(`Invalid member ID: ${input.memberId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const memberResult = await this.customerUserRepo.findById(input.memberId);
    if (!memberResult.ok) {
      return err(
        new UseCaseError(`Team member not found: ${input.memberId}`, USE_CASE_ERRORS.NOT_FOUND)
      );
    }

    const deactivateResult = memberResult.value.deactivate();
    if (!deactivateResult.ok) {
      return err(new UseCaseError(deactivateResult.error.message, USE_CASE_ERRORS.FORBIDDEN));
    }

    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const saveResult = await this.customerUserRepo.save(memberResult.value);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save deactivated member",
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
          "Failed to save deactivated member",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
