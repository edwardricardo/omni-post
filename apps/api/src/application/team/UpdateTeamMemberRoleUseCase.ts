/**
 * @file UpdateTeamMemberRoleUseCase.ts
 * @description Application use case for changing a team member's role.
 *   Loads both the target member and the changer, delegates role update to the
 *   domain entity, then persists the change.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TeamMemberRepository } from "../../domain/repositories/TeamMemberRepository.js";
import { TeamMemberId } from "../../domain/value-objects/TeamMemberId.js";
import { TeamRole } from "../../domain/value-objects/TeamRole.js";

/**
 * Input DTO for updating a team member's role
 */
export interface UpdateTeamMemberRoleInput {
  memberId: string;
  newRole: string;
  changerMemberId: string;
}

/**
 * @class UpdateTeamMemberRoleUseCase
 * @description Changes a team member's role after validating hierarchy constraints.
 */
export class UpdateTeamMemberRoleUseCase
  implements UseCase<UpdateTeamMemberRoleInput, void, UseCaseError>
{
  constructor(private readonly repository: TeamMemberRepository) {}

  /**
   * @method execute
   * @description Loads both members, applies role change through the domain entity,
   *   and persists the updated member.
   * @param input - The role update parameters
   * @returns Result<void> on success
   */
  async execute(input: UpdateTeamMemberRoleInput): Promise<Result<void, UseCaseError>> {
    // Validate member ID
    const memberIdResult = TeamMemberId.fromString(input.memberId);
    if (!memberIdResult.ok) {
      return err(
        new UseCaseError(`Invalid member ID: ${input.memberId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // Validate changer ID
    const changerIdResult = TeamMemberId.fromString(input.changerMemberId);
    if (!changerIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid changer ID: ${input.changerMemberId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Validate new role
    const newRoleResult = TeamRole.fromString(input.newRole);
    if (!newRoleResult.ok) {
      return err(new UseCaseError(newRoleResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Load target member
    const memberResult = await this.repository.findById(memberIdResult.value);
    if (!memberResult.ok) {
      return err(
        new UseCaseError(`Team member not found: ${input.memberId}`, USE_CASE_ERRORS.NOT_FOUND)
      );
    }

    // Load changer member
    const changerResult = await this.repository.findById(changerIdResult.value);
    if (!changerResult.ok) {
      return err(
        new UseCaseError(
          `Changer member not found: ${input.changerMemberId}`,
          USE_CASE_ERRORS.NOT_FOUND
        )
      );
    }

    // Delegate role change to domain entity
    const updateResult = memberResult.value.updateRole(
      newRoleResult.value,
      changerResult.value.role
    );

    if (!updateResult.ok) {
      return err(new UseCaseError(updateResult.error.message, USE_CASE_ERRORS.FORBIDDEN));
    }

    // Persist
    const saveResult = await this.repository.save(memberResult.value);
    if (!saveResult.ok) {
      return err(
        new UseCaseError(
          "Failed to save updated member",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          saveResult.error
        )
      );
    }

    return ok(undefined);
  }
}
