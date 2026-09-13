/**
 * @file authServiceSession.ts
 * @description Session management: token refresh, access token verification, logout,
 *              session revocation, and session listing.
 * @layer infrastructure
 */

import jwt from "jsonwebtoken";
import { createHash } from "crypto";
import { ok, err, type Result } from "@shared/types";
import type { AdminSession, PrismaClient } from "@infra/prisma";
import type { AdminUserDto } from "@core/domain/repositories/ReadModelDtos.js";
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
import { hashRefreshToken } from "./refreshTokenHash.js";
import type { AuthServiceCore } from "./authServiceCore.js";
import { auditActor } from "../services/AuditableService.js";
import { authLogger } from "../lib/logger.js";

/**
 * Session management operations: refresh, verify, logout, revoke
 */
export class AuthServiceSession {
  constructor(
    private readonly prisma: PrismaClient,
    private core: AuthServiceCore
  ) {}

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
            actor: auditActor.system(),
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

      const session = await this.prisma.adminSession.findUnique({
        where: { refreshTokenHash: hashRefreshToken(refreshToken) },
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
          await this.core.logSecurityEventPublic(auditActor.admin(decoded.userId), decoded.userId, {
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

      // Compare-and-swap on the hash being replaced: the rotation names the credential it
      // consumes, so the database — not this process — decides who gets to consume it.
      // `AdminSession.refreshTokenHash` is `@unique` (infra/prisma/schema.prisma), so the
      // index caps the match at one row and `count === 1` IS the whole verdict here. The
      // admin password-reset claim deliberately gates on `count > 0` instead: its token
      // column carries no unique index and the row key does the capping there, so copying
      // either gate onto the other site would be wrong in one of the two places.
      //
      // A count of 0 means the presented token was rotated — or its session revoked —
      // between the read above and this write: a replay in flight. The pair minted a few
      // lines up is then never returned and reaches no row.
      //
      // Two costs of refusing here, both accepted and named rather than engineered around:
      // a benign double refresh from two browser tabs leaves the losing tab to log in
      // again, and a detected replay is refused WITHOUT revoking the rest of the session
      // family, so where the loser was the legitimate holder the other pair stays live
      // until it expires. Acting on the detection is a follow-up of its own, and pairs
      // with the customer refresh flow, which has no server-side rotation at all
      // (SMELL-113).
      const { count } = await this.prisma.adminSession.updateMany({
        where: {
          id: session.id,
          refreshTokenHash: hashRefreshToken(refreshToken),
          isActive: true,
        },
        data: {
          refreshTokenHash: hashRefreshToken(newTokens.refreshToken),
          expiresAt: newTokens.expiresAt,
        },
      });

      if (count !== 1) {
        await this.core.writeAuditLogPublic({
          action: "SESSION_CREATED",
          category: "SECURITY",
          severity: "HIGH",
          actor: auditActor.system(),
          details: {
            tokenHash: createHash("sha256").update(refreshToken).digest("hex").substring(0, 16),
            ...(fingerprint && { fingerprint: hashFingerprint(fingerprint) }),
            reason: "ROTATED_TOKEN_REPLAYED",
          },
          ...(fingerprint?.ipAddress && { ipAddress: fingerprint.ipAddress }),
          ...(ipAddress && !fingerprint?.ipAddress && { ipAddress }),
          ...(fingerprint?.userAgent && { userAgent: fingerprint.userAgent }),
        });
        return err("TOKEN_BLACKLISTED");
      }

      // Blacklist only what the claim actually rotated. The row is the source of truth and
      // Redis is defence in depth, so an attempt that lost the claim — or threw on the way
      // to it — never kills a token that is still live for whoever holds it. Writing it
      // first would also mask the race: the winner's entry lands before the loser's write,
      // and a later probe cannot then tell whether the row or the cache did the refusing.
      // Caller-visible half: a throw inside this call after the claim has committed returns
      // DATABASE_ERROR while the rotation persisted — the same shape the audit write below
      // has always had.
      if (this.core.hasRedis && decoded.exp) {
        await blacklistToken(refreshToken, decoded.exp);
      }

      await this.core.logUserActionPublic(auditActor.admin(decoded.userId), {
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

      const session = await this.prisma.adminSession.findUnique({
        where: { id: decoded.sessionId },
        include: { user: { include: { role: true } } },
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

      const userDto = {
        ...session.user,
        role: session.user.role.name,
      } as unknown as AdminUserDto;
      return ok(this.core.mapUserToAuthenticatedUser(userDto));
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
      const session = await this.prisma.adminSession.findUnique({
        where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      });

      if (!session) return err("SESSION_NOT_FOUND");

      if (this.core.hasRedis) {
        const decoded = jwt.decode(refreshToken) as TokenPayload;
        if (decoded?.exp) {
          await blacklistToken(refreshToken, decoded.exp);
        }
      }

      await this.prisma.adminSession.update({
        where: { id: session.id },
        data: {
          isActive: false,
          revokedAt: new Date(),
        },
      });

      if (this.core.hasRedis) {
        await removeSessionFingerprint(session.id);
      }

      await this.core.logUserActionPublic(auditActor.admin(session.userId), {
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
      const result = await this.prisma.adminSession.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false, revokedAt: new Date() },
      });

      if (this.core.hasRedis) {
        await deleteActiveSessionsKey(userId);
      }

      await this.core.logSecurityEventPublic(auditActor.admin(userId), userId, {
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
      const sessions = await this.prisma.adminSession.findMany({
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
