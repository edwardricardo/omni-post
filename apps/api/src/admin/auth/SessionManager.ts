/**
 * @file SessionManager.ts
 * @description Manages admin session lifecycle including creation, cleanup,
 *              concurrent session enforcement, revocation, and CSRF tokens.
 * @layer infrastructure
 */

import crypto from "crypto";
import { prisma } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import type {
  DeviceFingerprint,
  TokenPair,
  SessionInfo,
  GeographicLocation,
  AuthErrorCode,
  AdminUserProfile,
  SecurityEventType,
} from "./adminAuthTypes";
import { adminAuthConfig } from "./adminAuthConfig";
import { TokenService } from "./TokenService";
import { hashRefreshToken } from "../../auth/refreshTokenHash.js";

export class SessionManager {
  private tokenService: TokenService;

  constructor(tokenService: TokenService) {
    this.tokenService = tokenService;
  }

  /**
   * Create new admin session with device fingerprinting
   */
  async createSession(
    userId: string,
    device: DeviceFingerprint,
    rememberMe: boolean,
    getUserProfile: (userId: string) => Promise<Result<AdminUserProfile, AuthErrorCode>>
  ): Promise<{ sessionId: string; tokens: TokenPair }> {
    const csrfToken = crypto.randomUUID();
    const expirationDays = rememberMe ? 30 : 7;
    const expiresAt = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);

    // Pre-allocate session id so we can mint the refresh token (which embeds
    // the session id) before the row exists. The hash goes into the row at
    // create time — never a placeholder, since the column is `@unique`.
    const sessionId = crypto.randomUUID();
    const refreshToken = this.tokenService.generateRefreshToken(
      userId,
      sessionId,
      rememberMe,
      device.deviceId
    );

    const sessionData: Record<string, unknown> = {
      id: sessionId,
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      csrfToken,
      ipAddress: device.ipAddress,
      userAgent: device.userAgent,
      deviceId: device.deviceId,
      expiresAt,
      isActive: true,
    };

    if (device.deviceName) {
      sessionData.deviceName = device.deviceName;
    }
    if (device.location) {
      sessionData.location = device.location;
    }

    const session = await prisma.adminSession.create({
      data: sessionData as Parameters<typeof prisma.adminSession.create>[0]["data"],
    });

    // Get user for access token
    const user = await getUserProfile(userId);
    if (!user.ok) {
      throw new Error("Failed to get user profile");
    }

    // Read session timeout from SecuritySettings (DB-configurable)
    const securitySettings = await prisma.securitySettings.findFirst({
      select: { sessionTimeoutMinutes: true },
    });
    const sessionTimeoutMinutes = securitySettings?.sessionTimeoutMinutes ?? 15;

    const accessToken = this.tokenService.generateAccessToken(
      user.value,
      device.deviceId,
      sessionTimeoutMinutes
    );

    return {
      sessionId: session.id,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: sessionTimeoutMinutes * 60,
        csrfToken,
      },
    };
  }

  /**
   * Cleanup inactive or expired sessions
   */
  async cleanupExpiredSessions(userId: string): Promise<void> {
    await prisma.adminSession.updateMany({
      where: {
        userId,
        OR: [
          { expiresAt: { lt: new Date() } },
          {
            lastActivityAt: {
              lt: new Date(
                Date.now() - adminAuthConfig.security.sessionInactivityTimeout * 60 * 1000
              ),
            },
          },
        ],
        isActive: true,
      },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokeReason: "SESSION_EXPIRED",
      },
    });
  }

  /**
   * Enforce max concurrent sessions
   */
  async enforceMaxSessions(userId: string, maxSessions: number): Promise<void> {
    const activeSessions = await prisma.adminSession.findMany({
      where: {
        userId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastActivityAt: "desc" },
    });

    if (activeSessions.length >= maxSessions) {
      // Revoke oldest sessions
      const sessionsToRevoke = activeSessions.slice(maxSessions - 1);
      await prisma.adminSession.updateMany({
        where: {
          id: { in: sessionsToRevoke.map((s) => s.id) },
        },
        data: {
          isActive: false,
          revokedAt: new Date(),
          revokeReason: "MAX_SESSIONS_EXCEEDED",
        },
      });
    }
  }

  /**
   * List active sessions for a user
   */
  async listSessions(userId: string): Promise<Result<SessionInfo[], AuthErrorCode>> {
    const sessions = await prisma.adminSession.findMany({
      where: {
        userId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: {
        lastActivityAt: "desc",
      },
      select: {
        id: true,
        deviceName: true,
        deviceId: true,
        ipAddress: true,
        location: true,
        lastActivityAt: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    const sessionInfos: SessionInfo[] = sessions.map((session) => ({
      id: session.id,
      deviceName: session.deviceName,
      deviceId: session.deviceId,
      ipAddress: session.ipAddress,
      location: session.location as GeographicLocation | null,
      lastActivityAt: session.lastActivityAt,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isCurrentSession: false, // Caller should set this based on current session
    }));

    return ok(sessionInfos);
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(
    userId: string,
    sessionId: string,
    reason: string | undefined,
    onSecurityEvent: (event: {
      type: SecurityEventType;
      userId: string;
      details?: Record<string, unknown>;
      success: boolean;
      timestamp: Date;
    }) => Promise<void>
  ): Promise<Result<boolean, AuthErrorCode>> {
    // Verify session belongs to user
    const session = await prisma.adminSession.findFirst({
      where: {
        id: sessionId,
        userId,
      },
    });

    if (!session) {
      return err("INVALID_REQUEST");
    }

    // Revoke session
    await prisma.adminSession.update({
      where: { id: sessionId },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokeReason: reason || "USER_REVOKED",
      },
    });

    // Log security event
    await onSecurityEvent({
      type: "SESSION_REVOKED",
      userId,
      details: { sessionId, reason },
      success: true,
      timestamp: new Date(),
    });

    return ok(true);
  }
}
