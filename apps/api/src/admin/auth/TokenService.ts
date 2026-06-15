/**
 * @file TokenService.ts
 * @description Handles JWT token generation and verification for admin authentication
 *              including access tokens, refresh tokens, and expiration handling.
 * @layer infrastructure
 */

import jwt from "jsonwebtoken";
import { ok, err, type Result } from "@shared/types";
import type {
  AdminUserProfile,
  AccessTokenPayload,
  RefreshTokenPayload,
  AuthErrorCode,
} from "./adminAuthTypes.js";
import { adminAuthConfig } from "./adminAuthConfig.js";

export class TokenService {
  /**
   * Generate access token (short-lived, 15 minutes)
   */
  generateAccessToken(
    user: AdminUserProfile,
    deviceId?: string,
    sessionTimeoutMinutes?: number
  ): string {
    const expirySeconds = (sessionTimeoutMinutes ?? 15) * 60;
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      type: "access",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expirySeconds,
      ...(deviceId && { deviceId }),
    };

    return jwt.sign(payload, adminAuthConfig.jwt.accessTokenSecret, {
      issuer: adminAuthConfig.jwt.issuer,
      audience: adminAuthConfig.jwt.audience,
    });
  }

  /**
   * Generate refresh token (long-lived, 7-30 days)
   */
  generateRefreshToken(
    userId: string,
    sessionId: string,
    rememberMe: boolean,
    deviceId?: string
  ): string {
    const expirationDays = rememberMe ? 30 : 7;
    const payload: RefreshTokenPayload = {
      sub: userId,
      sessionId,
      type: "refresh",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expirationDays * 24 * 60 * 60,
      ...(deviceId && { deviceId }),
    };

    return jwt.sign(payload, adminAuthConfig.jwt.refreshTokenSecret, {
      issuer: adminAuthConfig.jwt.issuer,
      audience: adminAuthConfig.jwt.audience,
    });
  }

  /**
   * Verify and decode access token
   */
  verifyAccessToken(token: string): Result<AccessTokenPayload, AuthErrorCode> {
    try {
      const decoded = jwt.verify(token, adminAuthConfig.jwt.accessTokenSecret, {
        issuer: adminAuthConfig.jwt.issuer,
        audience: adminAuthConfig.jwt.audience,
      }) as AccessTokenPayload;

      if (decoded.type !== "access") {
        return err("INVALID_TOKEN");
      }

      return ok(decoded);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return err("TOKEN_EXPIRED");
      }
      return err("INVALID_TOKEN");
    }
  }

  /**
   * Verify and decode refresh token
   */
  verifyRefreshToken(token: string): Result<RefreshTokenPayload, AuthErrorCode> {
    try {
      const decoded = jwt.verify(token, adminAuthConfig.jwt.refreshTokenSecret, {
        issuer: adminAuthConfig.jwt.issuer,
        audience: adminAuthConfig.jwt.audience,
      }) as RefreshTokenPayload;

      if (decoded.type !== "refresh") {
        return err("INVALID_TOKEN");
      }

      return ok(decoded);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return err("TOKEN_EXPIRED");
      }
      return err("INVALID_TOKEN");
    }
  }
}
