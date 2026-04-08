/**
 * @file ResetPasswordUseCase.ts
 * @description Validates a password reset token and updates the user's password.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { CustomerUserRepository } from "../../domain/repositories/CustomerUserRepository.js";
import argon2 from "argon2";

/** Error code union */
export type ResetPasswordError =
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

/** Input DTO */
export interface ResetPasswordInput {
  readonly token: string;
  readonly newPassword: string;
}

/**
 * @class ResetPasswordUseCase
 * @description Verifies the reset token, hashes the new password, and persists it.
 */
export class ResetPasswordUseCase {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Resets the password if the token is valid and not expired.
   */
  async execute(
    input: ResetPasswordInput
  ): Promise<Result<{ message: string }, ResetPasswordError>> {
    if (!input.token || !input.newPassword) {
      return err("VALIDATION_ERROR");
    }

    if (input.newPassword.length < 8) {
      return err("VALIDATION_ERROR");
    }

    try {
      // Find user by reset token
      const userResult = await this.customerUserRepo.findByResetToken(input.token);
      if (!userResult.ok) {
        return err("INVALID_TOKEN");
      }

      const user = userResult.value;

      // Check expiry
      if (user.isResetTokenExpired()) {
        return err("TOKEN_EXPIRED");
      }

      // Hash new password
      const newHash = await argon2.hash(input.newPassword, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });

      const doWork = async (): Promise<Result<{ message: string }, ResetPasswordError>> => {
        // Update password hash
        const updateResult = await this.customerUserRepo.updatePasswordHash(user.id, newHash);
        if (!updateResult.ok) {
          return err("INTERNAL_ERROR");
        }

        // Clear reset token
        user.clearResetToken();
        await this.customerUserRepo.save(user);

        return ok({ message: "Password reset successfully" });
      };

      if (this.unitOfWork) {
        let result: Result<{ message: string }, ResetPasswordError> = err("INTERNAL_ERROR");
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (_error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }
}
