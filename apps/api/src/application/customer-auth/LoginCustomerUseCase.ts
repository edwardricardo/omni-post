/**
 * @file LoginCustomerUseCase.ts
 * @description Authenticates a customer user by email/password, issues JWT tokens.
 *   Handles the multi-account scenario where an email may exist across accounts.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { CustomerUserRepository } from "../../domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "../../domain/repositories/AccountRepository.js";
import { AccountId } from "../../domain/value-objects/EntityId.js";
import argon2 from "argon2";
import { randomBytes } from "crypto";
import { signCustomerAccessToken, signCustomerRefreshToken } from "../../auth/customerJwt.js";

/** Error code union */
export type LoginCustomerError =
  | "INVALID_CREDENTIALS"
  | "USER_INACTIVE"
  | "MULTIPLE_ACCOUNTS"
  | "INTERNAL_ERROR";

/** Input DTO */
export interface LoginCustomerInput {
  readonly email: string;
  readonly password: string;
  readonly accountSlug?: string;
}

/** Output DTO */
export interface LoginCustomerOutput {
  readonly user: Record<string, unknown>;
  readonly account: Record<string, unknown>;
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * @class LoginCustomerUseCase
 * @description Verifies customer credentials and issues JWT tokens.
 */
export class LoginCustomerUseCase {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly accountRepo: AccountRepositoryPort
  ) {}

  /**
   * @method execute
   * @description Authenticates a customer user and returns access + refresh tokens.
   */
  async execute(
    input: LoginCustomerInput
  ): Promise<Result<LoginCustomerOutput, LoginCustomerError>> {
    try {
      if (!input.email || !input.password) {
        return err("INVALID_CREDENTIALS");
      }

      // Find user(s) by email across accounts
      const users = await this.customerUserRepo.findByEmailAcrossAccounts(input.email);

      if (users.length === 0) {
        return err("INVALID_CREDENTIALS");
      }

      // If multiple accounts and no slug hint, signal MULTIPLE_ACCOUNTS
      if (users.length > 1 && !input.accountSlug) {
        return err("MULTIPLE_ACCOUNTS");
      }

      // Pick the correct user (first match, or the one matching the slug)
      let targetUser = users[0]!;

      if (input.accountSlug && users.length > 1) {
        // Need to resolve slug to accountId
        for (const u of users) {
          const accountIdResult = AccountId.fromString(u.accountId);
          if (!accountIdResult.ok) continue;
          const accountResult = await this.accountRepo.findById(accountIdResult.value);
          if (accountResult.ok && accountResult.value.slug === input.accountSlug) {
            targetUser = u;
            break;
          }
        }
      }

      // Verify password
      const passwordValid = await argon2.verify(targetUser.passwordHash, input.password);
      if (!passwordValid) {
        return err("INVALID_CREDENTIALS");
      }

      // Check active
      if (!targetUser.isActive) {
        return err("USER_INACTIVE");
      }

      // Record login
      targetUser.recordLogin();
      await this.customerUserRepo.save(targetUser);

      // Fetch account for response
      const accountIdResult = AccountId.fromString(targetUser.accountId);
      let accountJson: Record<string, unknown> = { id: targetUser.accountId };
      if (accountIdResult.ok) {
        const accountResult = await this.accountRepo.findById(accountIdResult.value);
        if (accountResult.ok) {
          accountJson = accountResult.value.toJSON();
        }
      }

      // Sign tokens
      const sessionId = randomBytes(16).toString("hex");
      const accessToken = signCustomerAccessToken({
        sub: targetUser.id,
        accountId: targetUser.accountId,
        role: targetUser.role,
      });
      const refreshToken = signCustomerRefreshToken(targetUser.id, sessionId);

      return ok({
        user: { ...targetUser.toJSON() } as Record<string, unknown>,
        account: accountJson,
        accessToken,
        refreshToken,
      });
    } catch (error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }
}
