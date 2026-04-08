/**
 * @file RefreshCustomerTokenUseCase.ts
 * @description Verifies a customer refresh token and issues new access + refresh tokens.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { CustomerUserRepository } from "../../domain/repositories/CustomerUserRepository.js";
import { randomBytes } from "crypto";
import {
  verifyCustomerRefreshToken,
  signCustomerAccessToken,
  signCustomerRefreshToken,
} from "../../auth/customerJwt.js";

/** Error code union */
export type RefreshCustomerTokenError =
  | "INVALID_TOKEN"
  | "USER_NOT_FOUND"
  | "USER_INACTIVE"
  | "INTERNAL_ERROR";

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
  constructor(private readonly customerUserRepo: CustomerUserRepository) {}

  /**
   * @method execute
   * @description Verifies the refresh token and issues new token pair.
   */
  async execute(
    input: RefreshCustomerTokenInput
  ): Promise<Result<RefreshCustomerTokenOutput, RefreshCustomerTokenError>> {
    try {
      // Verify refresh token signature and type
      let payload;
      try {
        payload = verifyCustomerRefreshToken(input.refreshToken);
      } catch {
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
      const accessToken = signCustomerAccessToken({
        sub: user.id,
        accountId: user.accountId,
        role: user.role,
      });
      const refreshToken = signCustomerRefreshToken(user.id, sessionId);

      return ok({ accessToken, refreshToken });
    } catch (_error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }
}
