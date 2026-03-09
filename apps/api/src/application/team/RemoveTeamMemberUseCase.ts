/**
 * @file RemoveTeamMemberUseCase.ts
 * @description Application use case for deactivating a team member.
 *   Loads the member, calls deactivate(), and persists the updated entity.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TeamMemberRepository } from "../../domain/repositories/TeamMemberRepository.js";
import { TeamMemberId } from "../../domain/value-objects/TeamMemberId.js";

/**
 * Input DTO for removing (deactivating) a team member
 */
export interface RemoveTeamMemberInput {
  memberId: string;
  changerMemberId: string;
}

/**
 * @class RemoveTeamMemberUseCase
 * @description Deactivates a team member after verifying they can be removed.
 */
export class RemoveTeamMemberUseCase implements UseCase<RemoveTeamMemberInput, void, UseCaseError> {
  constructor(private readonly repository: TeamMemberRepository) {}

  /**
   * @method execute
   * @description Loads the member, deactivates through the domain entity, and persists.
   * @param input - The removal parameters including member and changer IDs
   * @returns Result<void> on success
   */
  async execute(input: RemoveTeamMemberInput): Promise<Result<void, UseCaseError>> {
    // Validate member ID
    const memberIdResult = TeamMemberId.fromString(input.memberId);
    if (!memberIdResult.ok) {
      return err(
        new UseCaseError(`Invalid member ID: ${input.memberId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // Load member
    const memberResult = await this.repository.findById(memberIdResult.value);
    if (!memberResult.ok) {
      return err(
        new UseCaseError(`Team member not found: ${input.memberId}`, USE_CASE_ERRORS.NOT_FOUND)
      );
    }

    // Deactivate through domain entity
    const deactivateResult = memberResult.value.deactivate();
    if (!deactivateResult.ok) {
      return err(new UseCaseError(deactivateResult.error.message, USE_CASE_ERRORS.FORBIDDEN));
    }

    // Persist
    const saveResult = await this.repository.save(memberResult.value);
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
  }
}
