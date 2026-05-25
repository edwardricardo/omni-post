/**
 * @file InviteTeamMemberUseCase.ts
 * @description Application use case for inviting a new team member to an
 *   account. Creates a CustomerUser stub with an active inviteToken, resolves
 *   the requested role (default MEMBER) from the CustomerRole catalog, and
 *   persists. The invitee completes the stub on accept.
 * @layer application
 */

import { randomUUID } from "node:crypto";
import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CustomerUserRepository } from "../../domain/repositories/CustomerUserRepository.js";
import type { CustomerRoleRepository } from "../../domain/repositories/CustomerRoleRepository.js";
import { CustomerUser } from "../../domain/entities/CustomerUser.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { TeamInvitationMailer } from "@core/domain/repositories/TeamInvitationMailer.js";
import type { PlatformCredentialService } from "../../security/PlatformCredentialService.js";
import { createLogger } from "../../lib/logger.js";

const inviteLogger = createLogger("team-invite");

/**
 * Input DTO for inviting a team member
 */
export interface InviteTeamMemberInput {
  accountId: string;
  email: string;
  /** Display name; split into firstName + lastName on the first whitespace. */
  name: string;
  /** Role name (OWNER / MANAGER / MEMBER / VIEWER). Defaults to MEMBER. */
  role?: string;
  /** CustomerUser.id of the inviter (used for audit + email From). */
  invitedBy?: string;
}

/**
 * @class InviteTeamMemberUseCase
 * @description Creates a CustomerUser stub (passwordHash="" + active inviteToken)
 *   for the invitee. The invitee sets a real password on acceptance.
 */
export class InviteTeamMemberUseCase implements UseCase<
  InviteTeamMemberInput,
  string,
  UseCaseError
> {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly customerRoleRepo: CustomerRoleRepository,
    private readonly unitOfWork?: UnitOfWork,
    private readonly mailer?: TeamInvitationMailer,
    private readonly credentialService?: PlatformCredentialService
  ) {}

  async execute(input: InviteTeamMemberInput): Promise<Result<string, UseCaseError>> {
    // Duplicate guard: a CustomerUser with this email already exists in the account.
    const existingResult = await this.customerUserRepo.findByEmail(input.email, input.accountId);
    if (existingResult.ok) {
      return err(
        new UseCaseError(
          `Member with email "${input.email}" already exists in this account`,
          USE_CASE_ERRORS.CONFLICT
        )
      );
    }

    // Resolve role snapshot (default MEMBER).
    const roleName = input.role ?? "MEMBER";
    const roleResult = await this.customerRoleRepo.getSnapshotByName(roleName);
    if (!roleResult.ok) {
      return err(
        new UseCaseError(`Role not found: ${roleName}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }
    const role = roleResult.value;

    // Split display name into first + last on first whitespace.
    const trimmedName = input.name.trim();
    const [firstName, ...rest] = trimmedName.split(/\s+/);
    const lastName = rest.join(" ") || "—";

    const inviteToken = randomUUID();
    const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const createResult = CustomerUser.create({
      id: randomUUID(),
      accountId: input.accountId,
      email: input.email,
      passwordHash: "", // stub — set when the invitee accepts the invitation
      firstName: firstName ?? input.email.split("@")[0]!,
      lastName,
      roleId: role.roleId,
      roleName: role.roleName,
      roleLevel: role.roleLevel,
      permissions: role.permissions,
      ...(input.invitedBy !== undefined && { invitedBy: input.invitedBy }),
      inviteToken,
      inviteTokenExpiry,
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

    const doWork = async (): Promise<Result<string, UseCaseError>> => {
      const saveResult = await this.customerUserRepo.save(member);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save team member",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }
      return ok(member.id);
    };

    try {
      let result: Result<string, UseCaseError>;
      if (this.unitOfWork) {
        result = ok(member.id);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
      } else {
        result = await doWork();
      }

      if (result.ok && this.mailer) {
        this.sendInvitationEmail(input, inviteToken, roleName).catch((e) =>
          inviteLogger.warn({ err: e }, "Failed to send invitation email")
        );
      }

      return result;
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save team member",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private async sendInvitationEmail(
    input: InviteTeamMemberInput,
    inviteToken: string,
    roleName: string
  ): Promise<void> {
    if (!this.mailer) return;

    let baseUrl = "https://app.omnipost.io";
    if (this.credentialService) {
      const platformResult = await this.credentialService.getGroup("PLATFORM");
      if (platformResult.ok) {
        baseUrl = platformResult.value.baseUrl || baseUrl;
      }
    }

    await this.mailer.sendTeamInvitation(input.email, {
      inviterName: input.invitedBy ?? "An admin",
      accountName: input.accountId,
      role: roleName,
      acceptUrl: `${baseUrl}/accept-invitation?token=${inviteToken}`,
    });
  }
}
