/**
 * @file RefreshCustomerTokenUseCase.ts
 * @description Verifies a customer refresh token and issues new access + refresh tokens.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { CachePort } from "@ports/core";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { CustomerTokenService } from "@core/domain/repositories/CustomerTokenService.js";
import { randomBytes } from "crypto";
import { CUSTOMER_REVOKED_SESSION_PREFIX } from "./LogoutCustomerUseCase.js";

/** Error code union */
export type RefreshCustomerTokenError =
  "INVALID_TOKEN" | "USER_NOT_FOUND" | "USER_INACTIVE" | "INTERNAL_ERROR";

/** Input DTO */
export interface RefreshCustomerTokenInput {
  readonly refreshToken: string;
}

/** Output DTO */
export interface RefreshCustomerTokenOutput {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * @class RefreshCustomerTokenUseCase
 * @description Validates the refresh token, checks user status, and re-issues tokens.
 */
export class RefreshCustomerTokenUseCase {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly cache: CachePort,
    private readonly tokenService: CustomerTokenService
  ) {}

  /**
   * @method execute
   * @description Verifies the refresh token and issues new token pair.
   */
  async execute(
    input: RefreshCustomerTokenInput
  ): Promise<Result<RefreshCustomerTokenOutput, RefreshCustomerTokenError>> {
    try {
      // Verify refresh token signature and type
      const verifyResult = this.tokenService.verifyRefreshToken(input.refreshToken);
      if (!verifyResult.ok) {
        return err("INVALID_TOKEN");
      }
      const payload = verifyResult.value;

      // Reject if the session was revoked via logout — gates token reissue
      // on the cache-backed blacklist set by `LogoutCustomerUseCase`.
      const revoked = await this.cache.has(CUSTOMER_REVOKED_SESSION_PREFIX + payload.sessionId);
      if (revoked) {
        return err("INVALID_TOKEN");
      }

      // Verify user still exists and is active
      const userResult = await this.customerUserRepo.findById(payload.sub);
      if (!userResult.ok) {
        return err("USER_NOT_FOUND");
      }

      const user = userResult.value;
      if (!user.isActive) {
        return err("USER_INACTIVE");
      }

      // Issue new tokens
      const sessionId = randomBytes(16).toString("hex");
      const accessToken = this.tokenService.signAccessToken({
        sub: user.id,
        accountId: user.accountId,
        roleId: user.roleId,
        roleName: user.roleName,
        permissions: [...user.permissions],
      });
      const refreshToken = this.tokenService.signRefreshToken(user.id, sessionId);

      return ok({ accessToken, refreshToken });
    } catch (_error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }
}
