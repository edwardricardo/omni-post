/**
 * @file LogoutCustomerUseCase.ts
 * @description Revokes a customer session by adding its `sessionId` (extracted
 *   from the refresh token JWT) to the Redis-backed revocation cache. Future
 *   refresh attempts for the same `sessionId` are rejected by
 *   `RefreshCustomerTokenUseCase`. Access tokens (15-min TTL) remain valid
 *   until natural expiry — short lifetime is the design contract.
 *
 *   Without this, logout was a no-op (returned success without revoking
 *   anything), leaving the refresh token usable for 7 days post-"logout"
 *   if leaked. Ref: F.7 Auth audit, finding #3.
 * @layer application
 */

import jwt from "jsonwebtoken";

import { type Result, ok, err } from "@shared/types";
import type { CachePort } from "@ports/core";

/** Error code union */
export type LogoutCustomerError = "INTERNAL_ERROR";

/** Input DTO */
export interface LogoutCustomerInput {
  /**
   * Refresh token JWT from the active session. Decoded (without verifying)
   * so even expired tokens can be revoked — the `sessionId` claim is the
   * stable identifier we store in the cache.
   */
  readonly refreshToken: string | null;
}

/**
 * Cache key prefix for revoked customer sessions. Paired by
 * `RefreshCustomerTokenUseCase` to gate token reissue.
 */
export const CUSTOMER_REVOKED_SESSION_PREFIX = "customer-session-revoked:";

/**
 * TTL for the revocation entry. Must outlive the longest possible refresh
 * token (`signCustomerRefreshToken` issues `7d`). After this TTL the JWT is
 * naturally expired anyway, so dropping the entry costs nothing.
 */
const REVOKED_TTL_SECONDS = 7 * 24 * 60 * 60;

interface DecodedRefreshPayload {
  sessionId?: unknown;
}

/**
 * @class LogoutCustomerUseCase
 * @description Revokes the active session via cache-backed blacklist.
 */
export class LogoutCustomerUseCase {
  constructor(private readonly cache: CachePort) {}

  /**
   * @method execute
   * @description Decodes the refresh token, extracts the `sessionId`, and
   *   marks it revoked in the cache. Idempotent — re-revoking is a no-op.
   *   Missing/invalid token → success (the user is logged out anyway from
   *   the frontend's perspective; nothing to revoke).
   */
  async execute(
    input: LogoutCustomerInput
  ): Promise<Result<{ message: string }, LogoutCustomerError>> {
    try {
      if (!input.refreshToken) {
        return ok({ message: "Logged out successfully" });
      }

      // Decode WITHOUT verifying — we want to revoke even malformed/expired
      // tokens so a logout request always closes the session deterministically.
      const decoded = jwt.decode(input.refreshToken) as DecodedRefreshPayload | null;
      if (!decoded || typeof decoded.sessionId !== "string" || decoded.sessionId.length === 0) {
        return ok({ message: "Logged out successfully" });
      }

      await this.cache.set(CUSTOMER_REVOKED_SESSION_PREFIX + decoded.sessionId, true, {
        ttlSeconds: REVOKED_TTL_SECONDS,
        tags: ["customer-revoked-session"],
      });

      return ok({ message: "Logged out successfully" });
    } catch (_error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }
}
