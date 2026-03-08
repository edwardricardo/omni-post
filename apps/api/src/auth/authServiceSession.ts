/**
 * Auth Service - Session Management
 *
 * Token refresh, access token verification, logout,
 * session revocation, and session listing.
 *
 * @module auth/authServiceSession
 */

import jwt from "jsonwebtoken";
import { createHash } from "crypto";
import { ok, err, type Result } from "@shared/types";
import { prisma } from "@infra/prisma";
import type { AdminSession } from "@infra/prisma";
import type { AdminUserDto } from "../domain/repositories/ReadModelDtos.js";
import type {
  TokenPayload,
  AuthTokens,
  AuthenticatedUser,
  SessionFingerprint,
} from "./authTypes.js";

import {
  isTokenBlacklisted,
  blacklistToken,
  getStoredFingerprint,
  removeSessionFingerprint,
  deleteActiveSessionsKey,
} from "./redisSessionHelpers.js";
import { hashFingerprint } from "./deviceFingerprint.js";
import type { AuthServiceCore } from "./authServiceCore.js";
import { authLogger } from "../lib/logger.js";

/**
 * Session management operations: refresh, verify, logout, revoke
 */
export class AuthServiceSession {
  constructor(private core: AuthServiceCore) {}

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens(
    refreshToken: string,
    ipAddress?: string,
    fingerprint?: SessionFingerprint
  ): Promise<
    Result<
      AuthTokens,
      "INVALID_TOKEN" | "TOKEN_BLACKLISTED" | "SESSION_EXPIRED" | "USER_INACTIVE" | "DATABASE_ERROR"
    >
  > {
    try {
      if (this.core.hasRedis) {
        const isBlacklisted = await isTokenBlacklisted(refreshToken);
        if (isBlacklisted) {
          await this.core.writeAuditLogPublic({
            action: "SESSION_CREATED",
            category: "SECURITY",
            severity: "HIGH",
            details: {
              tokenHash: createHash("sha256").update(refreshToken).digest("hex").substring(0, 16),
              ...(fingerprint && { fingerprint: hashFingerprint(fingerprint) }),
              reason: "BLACKLISTED_TOKEN_USED",
            },
            ...(fingerprint?.ipAddress && { ipAddress: fingerprint.ipAddress }),
            ...(ipAddress && !fingerprint?.ipAddress && { ipAddress }),
            ...(fingerprint?.userAgent && { userAgent: fingerprint.userAgent }),
          });
          return err("TOKEN_BLACKLISTED");
        }
      }

      const jwtOptions: jwt.VerifyOptions = {};
      if (this.core.hasRedis) {
        jwtOptions.issuer = this.core.issuer;
        jwtOptions.audience = this.core.audience;
      }
      const decoded = jwt.verify(refreshToken, this.core.refreshSecret, jwtOptions) as TokenPayload;

      const session = await prisma.adminSession.findUnique({
        where: { refreshToken },
        include: { user: true },
      });

      if (!session || !session.isActive || session.expiresAt < new Date()) {
        return err("SESSION_EXPIRED");
      }

      if (!session.user.isActive) return err("USER_INACTIVE");

      if (this.core.hasRedis && fingerprint) {
        const storedFp = await getStoredFingerprint(session.id);
        const currentFingerprintHash = hashFingerprint(fingerprint);

        if (storedFp && storedFp !== currentFingerprintHash) {
          await this.core.logSecurityEventPublic(decoded.userId, decoded.userId, {
            action: "SESSION_CREATED",
            severity: "HIGH",
            details: {
              expectedFingerprint: storedFp,
              providedFingerprint: currentFingerprintHash,
              sessionId: session.id,
              reason: "FINGERPRINT_MISMATCH",
            },
            ipAddress: fingerprint.ipAddress,
            userAgent: fingerprint.userAgent,
          });
          return err("SESSION_EXPIRED");
        }
      }

      if (this.core.hasRedis && decoded.exp) {
        await blacklistToken(refreshToken, decoded.exp);
      }

      const sessionFingerprint = fingerprint || {
        userAgent: session.userAgent || "",
        ipAddress: session.ipAddress || "",
      };

      const newTokens = await this.core.generateTokens(
        decoded.userId,
        decoded.email,
        decoded.role,
        session.id,
        sessionFingerprint,
        (decoded.tokenVersion || 0) + 1
      );

      await prisma.adminSession.update({
        where: { id: session.id },
        data: { refreshToken: newTokens.refreshToken, expiresAt: newTokens.expiresAt },
      });

      await this.core.logUserActionPublic(decoded.userId, {
        action: "SESSION_CREATED",
        category: "AUTHENTICATION",
        severity: "LOW",
        details: {
          email: decoded.email,
          sessionId: session.id,
          ...(this.core.hasRedis && {
            oldTokenVersion: decoded.tokenVersion || 1,
            newTokenVersion: newTokens.tokenVersion || 1,
            ...(fingerprint && { fingerprint: hashFingerprint(fingerprint) }),
          }),
        },
        ...(fingerprint?.ipAddress && { ipAddress: fingerprint.ipAddress }),
        ...(ipAddress && !fingerprint?.ipAddress && { ipAddress }),
        ...(fingerprint?.userAgent && { userAgent: fingerprint.userAgent }),
      });

      return ok(newTokens);
    } catch (error: unknown) {
      if (error instanceof jwt.JsonWebTokenError) {
        return err("INVALID_TOKEN");
      }
      authLogger.error({ err: error }, "Token refresh error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Verify access token and return user info
   */
  async verifyAccessToken(
    token: string,
    fingerprint?: SessionFingerprint
  ): Promise<
    Result<
      AuthenticatedUser,
      "INVALID_TOKEN" | "TOKEN_BLACKLISTED" | "SESSION_EXPIRED" | "USER_INACTIVE"
    >
  > {
    try {
      if (this.core.hasRedis) {
        const isBlacklisted = await isTokenBlacklisted(token);
        if (isBlacklisted) return err("TOKEN_BLACKLISTED");
      }

      const jwtOptions: jwt.VerifyOptions = {};
      if (this.core.hasRedis) {
        jwtOptions.issuer = this.core.issuer;
        jwtOptions.audience = this.core.audience;
      }
      const decoded = jwt.verify(token, this.core.jwtSecret, jwtOptions) as TokenPayload;

      const session = await prisma.adminSession.findUnique({
        where: { id: decoded.sessionId },
        include: { user: true },
      });
      if (!session || !session.isActive || session.expiresAt < new Date()) {
        return err("SESSION_EXPIRED");
      }
      if (!session.user.isActive) return err("USER_INACTIVE");

      if (this.core.hasRedis && fingerprint && decoded.deviceFingerprint) {
        const currentFingerprint = hashFingerprint(fingerprint);
        if (decoded.deviceFingerprint !== currentFingerprint) {
          return err("SESSION_EXPIRED");
        }
      }

      return ok(this.core.mapUserToAuthenticatedUser(session.user as unknown as AdminUserDto));
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        return err("INVALID_TOKEN");
      }
      throw error;
    }
  }

  /**
   * Logout user by revoking session
   */
  async logout(
    refreshToken: string
  ): Promise<Result<void, "SESSION_NOT_FOUND" | "DATABASE_ERROR">> {
    try {
      const session = await prisma.adminSession.findUnique({
        where: { refreshToken },
      });

      if (!session) return err("SESSION_NOT_FOUND");

      if (this.core.hasRedis) {
        const decoded = jwt.decode(refreshToken) as TokenPayload;
        if (decoded?.exp) {
          await blacklistToken(refreshToken, decoded.exp);
        }
      }

      await prisma.adminSession.update({
        where: { id: session.id },
        data: {
          isActive: false,
          revokedAt: new Date(),
        },
      });

      if (this.core.hasRedis) {
        await removeSessionFingerprint(session.id);
      }

      await this.core.logUserActionPublic(session.userId, {
        action: "USER_LOGOUT",
        category: "AUTHENTICATION",
        severity: "INFO",
        details: {
          sessionId: session.id,
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Logout error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllSessions(userId: string): Promise<Result<number, "DATABASE_ERROR">> {
    try {
      const result = await prisma.adminSession.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false, revokedAt: new Date() },
      });

      if (this.core.hasRedis) {
        await deleteActiveSessionsKey(userId);
      }

      await this.core.logSecurityEventPublic(userId, userId, {
        action: "SESSION_CREATED",
        severity: "HIGH",
        details: {
          revokedSessions: result.count,
          reason: "BULK_REVOCATION",
        },
      });

      return ok(result.count);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Revoke sessions error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get active sessions for a user
   */
  async getUserSessions(userId: string): Promise<Result<AdminSession[], "DATABASE_ERROR">> {
    try {
      const sessions = await prisma.adminSession.findMany({
        where: {
          userId,
          isActive: true,
          expiresAt: { gte: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      return ok(sessions);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Get sessions error");
      return err("DATABASE_ERROR");
    }
  }
}
