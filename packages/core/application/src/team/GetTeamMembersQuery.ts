/**
 * @file GetTeamMembersQuery.ts
 * @description Application query handler for listing the team members of an
 *   account. Returns DTOs (not domain objects) following the CQRS read pattern.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, UseCaseError } from "../UseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";

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
  firstName: string;
  lastName: string;
  fullName: string;
  roleId: string;
  roleName: string;
  roleLevel: number;
  isActive: boolean;
  isEmailVerified: boolean;
  isPendingInvitation: boolean;
  joinedAt: Date;
}

/**
 * @class GetTeamMembersQuery
 * @description Retrieves all team members (CustomerUsers) for an account,
 *   mapped to read-side DTOs.
 */
export class GetTeamMembersQuery implements UseCase<
  GetTeamMembersInput,
  TeamMemberDTO[],
  UseCaseError
> {
  constructor(private readonly customerUserRepo: CustomerUserRepository) {}

  /**
   * @method execute
   * @description Loads all customer users for the given account and maps to DTOs.
   * @param input - Query parameters including accountId
   * @returns Result<TeamMemberDTO[]> on success
   */
  async execute(input: GetTeamMembersInput): Promise<Result<TeamMemberDTO[], UseCaseError>> {
    const users = await this.customerUserRepo.findByAccountId(input.accountId);

    const dtos: TeamMemberDTO[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      fullName: u.fullName,
      roleId: u.roleId,
      roleName: u.roleName,
      roleLevel: u.roleLevel,
      isActive: u.isActive,
      isEmailVerified: u.isEmailVerified,
      isPendingInvitation: u.isPendingInvitation,
      joinedAt: u.joinedAt,
    }));

    return ok(dtos);
  }
}
