/**
 * @file LoginCustomerUseCase.ts
 * @description Authenticates a customer user by email/password, issues JWT tokens.
 *   Handles the multi-account scenario where an email may exist across accounts.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import type { CustomerTokenService } from "@core/domain/repositories/CustomerTokenService.js";
import { randomBytes } from "crypto";

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
    private readonly accountRepo: AccountRepositoryPort,
    private readonly hasher: PasswordHasher,
    private readonly tokenService: CustomerTokenService
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
      const passwordValid = await this.hasher.verify(targetUser.passwordHash, input.password);
      if (!passwordValid) {
        return err("INVALID_CREDENTIALS");
      }

      // Check active
      if (!targetUser.isActive) {
        return err("USER_INACTIVE");
      }

      // Transparent rehash: if the stored hash uses parameters weaker than
      // the current canon (e.g. after a server-side cost bump), upgrade it
      // silently while we still have the plaintext on the stack. Failure
      // here is non-fatal — the user logs in successfully either way. The
      // upgraded hash is persisted via the repository; the in-memory entity
      // keeps its original `passwordHash` field (readonly) since the user
      // is about to be released back to the caller.
      if (this.hasher.needsRehash(targetUser.passwordHash)) {
        const upgraded = await this.hasher.hash(input.password);
        await this.customerUserRepo.updatePasswordHash(targetUser.id, upgraded);
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
      const accessToken = this.tokenService.signAccessToken({
        sub: targetUser.id,
        accountId: targetUser.accountId,
        roleId: targetUser.roleId,
        roleName: targetUser.roleName,
        permissions: [...targetUser.permissions],
      });
      const refreshToken = this.tokenService.signRefreshToken(targetUser.id, sessionId);

      return ok({
        user: { ...targetUser.toJSON() } as Record<string, unknown>,
        account: accountJson,
        accessToken,
        refreshToken,
      });
    } catch (_error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }
}
