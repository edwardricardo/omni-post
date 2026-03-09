/**
 * @file InviteTeamMemberUseCase.ts
 * @description Application use case for inviting a new team member to an account.
 *   Validates that the member does not already exist, creates the entity, and persists it.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TeamMemberRepository } from "../../domain/repositories/TeamMemberRepository.js";
import { TeamMemberEntity } from "../../domain/entities/TeamMember.js";
import type { TeamRoleValue } from "../../domain/value-objects/TeamRole.js";

/**
 * Input DTO for inviting a team member
 */
export interface InviteTeamMemberInput {
  accountId: string;
  email: string;
  name: string;
  role?: TeamRoleValue;
  invitedBy?: string;
}

/**
 * @class InviteTeamMemberUseCase
 * @description Creates a new team member within an account after checking for duplicates.
 */
export class InviteTeamMemberUseCase
  implements UseCase<InviteTeamMemberInput, string, UseCaseError>
{
  constructor(private readonly repository: TeamMemberRepository) {}

  /**
   * @method execute
   * @description Invites a new team member to the account.
   * @param input - The invitation parameters
   * @returns Result<string> with the new member's ID on success
   */
  async execute(input: InviteTeamMemberInput): Promise<Result<string, UseCaseError>> {
    // Check if member already exists in account
    const existingResult = await this.repository.findByAccountAndEmail(
      input.accountId,
      input.email
    );

    if (existingResult.ok) {
      return err(
        new UseCaseError(
          `Member with email "${input.email}" already exists in this account`,
          USE_CASE_ERRORS.CONFLICT
        )
      );
    }

    // Create domain entity
    const createResult = TeamMemberEntity.create({
      accountId: input.accountId,
      email: input.email,
      name: input.name,
      ...(input.role !== undefined && { role: input.role }),
      ...(input.invitedBy !== undefined && { invitedBy: input.invitedBy }),
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

    const member = createResult.value;

    // Persist
    const saveResult = await this.repository.save(member);
    if (!saveResult.ok) {
      return err(
        new UseCaseError(
          "Failed to save team member",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          saveResult.error
        )
      );
    }

    return ok(member.id.value);
  }
}
