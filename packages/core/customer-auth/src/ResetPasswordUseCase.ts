/**
 * @file ResetPasswordUseCase.ts
 * @description Claims a password reset token and stores the new password in ONE
 *   conditional write, so the token is consumed by the same statement that changes
 *   the hash.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";

/**
 * Error code union.
 *
 * `TOKEN_EXPIRED` is deliberately absent. Unknown, expired, already-claimed and
 * soft-deleted-owner tokens are all answered with `INVALID_TOKEN`: separating them
 * is a token-validity oracle, and the single-statement claim below cannot tell them
 * apart without a second query issued for no purpose except to build that oracle.
 */
export type ResetPasswordError = "INVALID_TOKEN" | "VALIDATION_ERROR" | "INTERNAL_ERROR";

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
    private readonly hasher: PasswordHasher,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Resets the password by CLAIMING the token: exactly one conditional
   *   write reaches the row, and its own predicate enforces the token, the expiry and
   *   a live owner. Nothing is read first, so there is no read-then-write window, and
   *   nothing is written after, so no whole-entity snapshot can restore the hash the
   *   claim just stored.
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
      // Hash OUTSIDE the transaction: argon2 is deliberately expensive, and holding
      // a database transaction open across it would bound throughput on the hash
      // parameters. A hash computed for a token that turns out to be unusable is
      // simply discarded.
      const newHash = await this.hasher.hash(input.newPassword);

      const doWork = async (): Promise<Result<{ message: string }, ResetPasswordError>> => {
        const claim = await this.customerUserRepo.claimPasswordReset(input.token, newHash);
        if (!claim.ok) {
          // Passed through, never collapsed: `INTERNAL_ERROR` means the write could
          // not be attempted (a context or persistence failure) and MUST stay
          // distinguishable from the token verdict.
          return err(claim.error);
        }

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
