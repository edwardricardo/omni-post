/**
 * @file RequestPasswordResetUseCase.ts
 * @description Generates a password reset token for a customer user.
 *   Always returns ok to prevent email enumeration attacks.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { CustomerUserRepository } from "../../domain/repositories/CustomerUserRepository.js";
import { randomBytes } from "crypto";

/** Error code union */
export type RequestPasswordResetError = "INTERNAL_ERROR";

/** Input DTO */
export interface RequestPasswordResetInput {
  readonly email: string;
}

/**
 * @class RequestPasswordResetUseCase
 * @description Sets a time-limited reset token on the user (if found).
 *   Always returns ok to prevent email enumeration.
 */
export class RequestPasswordResetUseCase {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Generates a reset token and persists it, or silently succeeds
   *   if the email does not exist (security: no email enumeration).
   */
  async execute(
    input: RequestPasswordResetInput
  ): Promise<Result<{ message: string }, RequestPasswordResetError>> {
    try {
      // Find all users with this email (across accounts)
      const users = await this.customerUserRepo.findByEmailAcrossAccounts(input.email);

      // Silently succeed if email not found
      if (users.length === 0) {
        return ok({ message: "If the email exists, a reset link has been sent" });
      }

      // Generate reset token (valid for 1 hour)
      const resetToken = randomBytes(32).toString("hex");
      const resetExpiry = new Date(Date.now() + 60 * 60 * 1000);

      const doWork = async (): Promise<Result<{ message: string }, RequestPasswordResetError>> => {
        // Set token on all matching users
        for (const user of users) {
          user.setResetToken(resetToken, resetExpiry);
          await this.customerUserRepo.save(user);
        }

        // TODO: Send email with reset link via EmailPort
        return ok({ message: "If the email exists, a reset link has been sent" });
      };

      if (this.unitOfWork) {
        let result: Result<{ message: string }, RequestPasswordResetError> = err("INTERNAL_ERROR");
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }
}
