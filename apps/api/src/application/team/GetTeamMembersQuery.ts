/**
 * @file GetTeamMembersQuery.ts
 * @description Application query handler for listing team members of an account.
 *   Returns DTOs (not domain objects) following the CQRS read-side pattern.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TeamMemberRepository } from "../../domain/repositories/TeamMemberRepository.js";

/**
 * Input DTO for querying team members
 */
export interface GetTeamMembersInput {
  accountId: string;
}

/**
 * Output DTO for team member data (CQRS read model)
 */
export interface TeamMemberDTO {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  joinedAt: Date;
}

/**
 * @class GetTeamMembersQuery
 * @description Retrieves all team members for an account, mapped to read-side DTOs.
 */
export class GetTeamMembersQuery
  implements UseCase<GetTeamMembersInput, TeamMemberDTO[], UseCaseError>
{
  constructor(private readonly repository: TeamMemberRepository) {}

  /**
   * @method execute
   * @description Loads all team members for the given account and maps to DTOs.
   * @param input - Query parameters including accountId
   * @returns Result<TeamMemberDTO[]> on success
   */
  async execute(input: GetTeamMembersInput): Promise<Result<TeamMemberDTO[], UseCaseError>> {
    const result = await this.repository.findByAccount(input.accountId);

    if (!result.ok) {
      return err(
        new UseCaseError(
          "Failed to fetch team members",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          result.error
        )
      );
    }

    const dtos: TeamMemberDTO[] = result.value.map((member) => ({
      id: member.id.value,
      email: member.email,
      name: member.name,
      role: member.role.value,
      isActive: member.isActive,
      joinedAt: member.joinedAt,
    }));

    return ok(dtos);
  }
}
