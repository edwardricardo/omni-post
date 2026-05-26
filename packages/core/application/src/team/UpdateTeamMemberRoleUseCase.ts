/**
 * @file UpdateTeamMemberRoleUseCase.ts
 * @description Application use case for changing a team member's role.
 *   Loads both the target member and the changer (CustomerUsers), resolves
 *   the new CustomerRole snapshot, delegates role update to the domain entity
 *   (hierarchy enforcement by level), then persists the change.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { CustomerRoleRepository } from "@core/domain/repositories/CustomerRoleRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for updating a team member's role
 */
export interface UpdateTeamMemberRoleInput {
  memberId: string;
  /** Role name to assign (e.g. "MANAGER", "MEMBER", "VIEWER"). */
  newRoleName: string;
  changerMemberId: string;
}

/**
 * @class UpdateTeamMemberRoleUseCase
 * @description Changes a team member's role after validating hierarchy constraints.
 *   The changer must outrank both the target's current role and the new role.
 */
export class UpdateTeamMemberRoleUseCase implements UseCase<
  UpdateTeamMemberRoleInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly customerRoleRepo: CustomerRoleRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: UpdateTeamMemberRoleInput): Promise<Result<void, UseCaseError>> {
    if (!input.memberId || input.memberId.trim().length === 0) {
      return err(
        new UseCaseError(`Invalid member ID: ${input.memberId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }
    if (!input.changerMemberId || input.changerMemberId.trim().length === 0) {
      return err(
        new UseCaseError(
          `Invalid changer ID: ${input.changerMemberId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const memberResult = await this.customerUserRepo.findById(input.memberId);
    if (!memberResult.ok) {
      return err(
        new UseCaseError(`Team member not found: ${input.memberId}`, USE_CASE_ERRORS.NOT_FOUND)
      );
    }
    const member = memberResult.value;

    const changerResult = await this.customerUserRepo.findById(input.changerMemberId);
    if (!changerResult.ok) {
      return err(
        new UseCaseError(
          `Changer member not found: ${input.changerMemberId}`,
          USE_CASE_ERRORS.NOT_FOUND
        )
      );
    }
    const changer = changerResult.value;

    const newRoleResult = await this.customerRoleRepo.getSnapshotByName(input.newRoleName);
    if (!newRoleResult.ok) {
      return err(
        new UseCaseError(`Role not found: ${input.newRoleName}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }
    const newRole = newRoleResult.value;

    const updateResult = member.updateRole(
      newRole.roleId,
      newRole.roleName,
      newRole.roleLevel,
      newRole.permissions,
      changer.roleLevel
    );

    if (!updateResult.ok) {
      return err(new UseCaseError(updateResult.error.message, USE_CASE_ERRORS.FORBIDDEN));
    }

    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const saveResult = await this.customerUserRepo.save(member);
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
          "Failed to save updated member",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
