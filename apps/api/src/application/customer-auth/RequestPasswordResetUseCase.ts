/**
 * @file RequestPasswordResetUseCase.ts
 * @description Generates a password reset token for a customer user and sends
 *   the reset email via EmailPort. Always returns ok to prevent email enumeration.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { CustomerUserRepository } from "../../domain/repositories/CustomerUserRepository.js";
import type { EmailPort } from "../../domain/repositories/EmailPort.js";
import { randomBytes } from "crypto";

/** Error code union */
export type RequestPasswordResetError = "INTERNAL_ERROR";

/** Input DTO */
export interface RequestPasswordResetInput {
  readonly email: string;
  readonly resetBaseUrl?: string;
}

/**
 * @class RequestPasswordResetUseCase
 * @description Sets a time-limited reset token on the user (if found)
 *   and sends a password reset email. Always returns ok to prevent
 *   email enumeration.
 */
export class RequestPasswordResetUseCase {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly emailPort?: EmailPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Generates a reset token, persists it, and sends the reset email.
   *   Silently succeeds if the email does not exist (security: no email enumeration).
   */
  async execute(
    input: RequestPasswordResetInput
  ): Promise<Result<{ message: string }, RequestPasswordResetError>> {
    const responseMessage = "If the email exists, a reset link has been sent";

    try {
      const users = await this.customerUserRepo.findByEmailAcrossAccounts(input.email);

      if (users.length === 0) {
        return ok({ message: responseMessage });
      }

      const resetToken = randomBytes(32).toString("hex");
      const resetExpiry = new Date(Date.now() + 60 * 60 * 1000);

      const doWork = async (): Promise<Result<{ message: string }, RequestPasswordResetError>> => {
        for (const user of users) {
          user.setResetToken(resetToken, resetExpiry);
          await this.customerUserRepo.save(user);
        }
        return ok({ message: responseMessage });
      };

      if (this.unitOfWork) {
        let result: Result<{ message: string }, RequestPasswordResetError> = err("INTERNAL_ERROR");
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        if (!result.ok) return result;
      } else {
        const result = await doWork();
        if (!result.ok) return result;
      }

      // Send email OUTSIDE the transaction (external API call)
      if (this.emailPort) {
        const baseUrl = input.resetBaseUrl || process.env.CLIENT_URL || "http://localhost:3200";
        const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

        await this.emailPort.send({
          to: [input.email],
          subject: "OmniPost — Password Reset Request",
          body: `You requested a password reset. Click the link below to reset your password:\n\n${resetLink}\n\nThis link expires in 1 hour. If you did not request this, please ignore this email.`,
          html: `<p>You requested a password reset.</p><p><a href="${resetLink}">Reset your password</a></p><p>This link expires in 1 hour. If you did not request this, please ignore this email.</p>`,
        });
      }

      return ok({ message: responseMessage });
    } catch (error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }
}
