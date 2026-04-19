/**
 * @file InviteTeamMemberUseCase.ts
 * @description Application use case for inviting a new team member to an account.
 *   Validates that the member does not already exist, creates the entity, and persists it.
 * @layer application
 */

import { randomUUID } from "node:crypto";
import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TeamMemberRepository } from "../../domain/repositories/TeamMemberRepository.js";
import { TeamMemberEntity } from "../../domain/entities/TeamMember.js";
import type { TeamRoleValue } from "../../domain/value-objects/TeamRole.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { EmailPort } from "../../domain/repositories/EmailPort.js";
import type { PlatformCredentialService } from "../../security/PlatformCredentialService.js";
import { teamInvitationEmail } from "../notifications/emailTemplates.js";
import { createLogger } from "../../lib/logger.js";

const inviteLogger = createLogger("team-invite");

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
export class InviteTeamMemberUseCase implements UseCase<
  InviteTeamMemberInput,
  string,
  UseCaseError
> {
  constructor(
    private readonly repository: TeamMemberRepository,
    private readonly unitOfWork?: UnitOfWork,
    private readonly emailPort?: EmailPort,
    private readonly credentialService?: PlatformCredentialService
  ) {}

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

    // Generate invitation token (expires in 7 days)
    const inviteToken = randomUUID();
    const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    member.setInviteToken(inviteToken, inviteTokenExpiry);

    // Persist (atomically via UoW when available)
    const doWork = async (): Promise<Result<string, UseCaseError>> => {
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
    };

    try {
      let result: Result<string, UseCaseError>;
      if (this.unitOfWork) {
        result = ok(member.id.value);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
      } else {
        result = await doWork();
      }

      // Send invitation email after successful persist (fire-and-forget)
      if (result.ok && this.emailPort) {
        this.sendInvitationEmail(input, inviteToken).catch((e) =>
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
    inviteToken: string
  ): Promise<void> {
    if (!this.emailPort) return;

    let baseUrl = "https://app.omnipost.io";
    if (this.credentialService) {
      const platformResult = await this.credentialService.getGroup("PLATFORM");
      if (platformResult.ok) {
        baseUrl = platformResult.value.baseUrl || baseUrl;
      }
    }

    const content = await teamInvitationEmail({
      inviterName: input.invitedBy ?? "An admin",
      accountName: input.accountId,
      role: input.role ?? "MEMBER",
      acceptUrl: `${baseUrl}/accept-invitation?token=${inviteToken}`,
    });

    await this.emailPort.send({
      to: [input.email],
      subject: content.subject,
      body: `You've been invited to join a team on OmniPost. Visit ${baseUrl}/accept-invitation?token=${inviteToken}`,
      html: content.html,
    });
  }
}
