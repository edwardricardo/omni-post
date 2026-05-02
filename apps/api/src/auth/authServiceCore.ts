/**
 * @file authServiceCore.ts
 * @description Core authentication logic: user registration, login with MFA support,
 *              and shared utilities. Enhanced security features activate when Redis is available.
 * @layer infrastructure
 */

import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { randomBytes } from "crypto";
import { ok, err, type Result } from "@shared/types";
import { prisma } from "@infra/prisma";
import { env } from "../config/env.js";
import type { AdminRoleKind } from "../domain/repositories/ReadModelDtos.js";
import type { AdminUserDto } from "../domain/repositories/ReadModelDtos.js";
import { AuditableService } from "../services/AuditableService";
import type { MfaService } from "./mfaService.js";
import type { AdminUserRepositoryPort } from "../domain/repositories/AdminUserRepository.js";
import type {
  TokenPayload,
  LoginCredentials,
  AuthTokens,
  AuthenticatedUser,
  SessionFingerprint,
} from "./authTypes.js";

import {
  getRedisInstance,
  recordLoginAttempt,
  getActiveSessionCount,
  storeSessionFingerprint,
  trackActiveSession,
} from "./redisSessionHelpers.js";
import {
  hashFingerprint,
  generateDeviceId,
  generateBrowserFingerprint,
} from "./deviceFingerprint.js";
import { authLogger } from "../lib/logger.js";

/**
 * Core authentication operations: register, login, and shared helpers
 */
export class AuthServiceCore extends AuditableService {
  readonly jwtSecret: string;
  readonly refreshSecret: string;
  readonly accessTokenTtl = 15 * 60;
  readonly refreshTokenTtl = 7 * 24 * 60 * 60;
  readonly maxConcurrentSessions = 5;
  readonly issuer = "omni-post-api";
  readonly audience = "omni-post-clients";

  constructor(
    readonly userRepo: AdminUserRepositoryPort,
    readonly mfaSvc: MfaService
  ) {
    super("AuthService");
    this.jwtSecret = env.JWT_ACCESS_SECRET;
    this.refreshSecret = env.JWT_REFRESH_SECRET;

    authLogger.info(
      { enhancedFeatures: this.hasRedis },
      "Unified Authentication Service initialized"
    );
  }

  get hasRedis(): boolean {
    return !!getRedisInstance();
  }

  /**
   * Register a new admin user
   */
  async registerAdmin(
    email: string,
    password: string,
    name: string,
    role: AdminRoleKind = "ADMIN"
  ): Promise<Result<AuthenticatedUser, "EMAIL_EXISTS" | "VALIDATION_ERROR" | "DATABASE_ERROR">> {
    try {
      if (!email || !password || !name) return err("VALIDATION_ERROR");
      if (password.length < 8) return err("VALIDATION_ERROR");

      const existingUserResult = await this.userRepo.findByEmail(email);
      if (existingUserResult.ok) return err("EMAIL_EXISTS");

      const passwordHash = await this.hashPassword(password);
      // Resolve roleId from role name
      const roleRecord = await prisma.role.findUnique({ where: { name: role } });
      if (!roleRecord) return err("VALIDATION_ERROR");

      const user = await prisma.adminUser.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          name,
          roleId: roleRecord.id,
          emailVerified: true,
        },
      });

      await this.logResourceAction(user.id, {
        accountId: user.id,
        action: "RESOURCE_CREATE",
        category: "ACCOUNT",
        resourceType: "User",
        resourceId: user.id,
        severity: "MEDIUM",
        details: {
          email: user.email,
          name: user.name,
          role: roleRecord.name,
        },
      });

      // Map Prisma result to AdminUserDto shape (role as string name)
      const userDto = { ...user, role: roleRecord.name } as unknown as AdminUserDto;
      return ok(this.mapUserToAuthenticatedUser(userDto));
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Registration error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Authenticate user and create session
   */
  async login(
    credentials: LoginCredentials,
    ipAddress?: string,
    userAgent?: string,
    fingerprint?: SessionFingerprint
  ): Promise<
    Result<
      { user: AuthenticatedUser; tokens: AuthTokens } | { mfaRequired: true; userId: string },
      | "INVALID_CREDENTIALS"
      | "USER_INACTIVE"
      | "MFA_REQUIRED"
      | "INVALID_MFA_TOKEN"
      | "TOO_MANY_SESSIONS"
      | "DATABASE_ERROR"
    >
  > {
    try {
      const sessionFingerprint: SessionFingerprint = fingerprint || {
        userAgent: userAgent || "",
        ipAddress: ipAddress || "",
        deviceId: generateDeviceId(userAgent || "", ipAddress || ""),
        browserFingerprint: generateBrowserFingerprint(userAgent || ""),
      };

      if (this.hasRedis) {
        await recordLoginAttempt({
          email: credentials.email,
          ipAddress: sessionFingerprint.ipAddress,
          userAgent: sessionFingerprint.userAgent,
          timestamp: new Date(),
          success: false,
        });
      }

      const userResult = await this.userRepo.findByEmail(credentials.email);
      if (!userResult.ok) {
        await this.writeAuditLog({
          action: "USER_LOGIN",
          category: "AUTHENTICATION",
          severity: "HIGH",
          details: {
            email: credentials.email,
            reason: "USER_NOT_FOUND",
            ...(this.hasRedis && { fingerprint: hashFingerprint(sessionFingerprint) }),
          },
          ipAddress: sessionFingerprint.ipAddress,
          userAgent: sessionFingerprint.userAgent,
        });
        return err("INVALID_CREDENTIALS");
      }

      const user = userResult.value;
      const isPasswordValid = await this.verifyPassword(credentials.password, user.passwordHash);
      if (!isPasswordValid) {
        await this.logUserAction(user.id, {
          action: "USER_LOGIN",
          category: "AUTHENTICATION",
          severity: "HIGH",
          details: {
            email: user.email,
            reason: "INVALID_PASSWORD",
            ...(this.hasRedis && { fingerprint: hashFingerprint(sessionFingerprint) }),
          },
          ipAddress: sessionFingerprint.ipAddress,
          userAgent: sessionFingerprint.userAgent,
        });
        return err("INVALID_CREDENTIALS");
      }

      const activeCheck = this.userRepo.validateActive(user);
      if (!activeCheck.ok) {
        await this.logUserAction(user.id, {
          action: "USER_LOGIN",
          category: "AUTHENTICATION",
          severity: "HIGH",
          details: {
            email: user.email,
            reason: "USER_INACTIVE",
            ...(this.hasRedis && { fingerprint: hashFingerprint(sessionFingerprint) }),
          },
          ipAddress: sessionFingerprint.ipAddress,
          userAgent: sessionFingerprint.userAgent,
        });
        return err("USER_INACTIVE");
      }

      if (this.hasRedis) {
        const activeSessions = await getActiveSessionCount(user.id);
        if (activeSessions >= this.maxConcurrentSessions) {
          await this.logSecurityEvent(user.id, user.id, {
            action: "SESSION_CREATED",
            severity: "HIGH",
            details: {
              email: user.email,
              activeSessions,
              limit: this.maxConcurrentSessions,
              fingerprint: hashFingerprint(sessionFingerprint),
              reason: "TOO_MANY_SESSIONS",
            },
            ipAddress: sessionFingerprint.ipAddress,
            userAgent: sessionFingerprint.userAgent,
          });
          return err("TOO_MANY_SESSIONS");
        }
      }

      if (user.mfaEnabled) {
        if (!credentials.mfaToken) {
          return ok({ mfaRequired: true as const, userId: user.id });
        }

        const mfaResult = await this.mfaSvc.verifyMfaToken(user.id, credentials.mfaToken);
        if (!mfaResult.ok) {
          await this.logSecurityEvent(user.id, user.id, {
            action: "USER_LOGIN",
            severity: "HIGH",
            details: {
              email: user.email,
              reason: "INVALID_MFA_TOKEN",
              ...(this.hasRedis && { fingerprint: hashFingerprint(sessionFingerprint) }),
            },
            ipAddress: sessionFingerprint.ipAddress,
            userAgent: sessionFingerprint.userAgent,
          });
          return err("INVALID_MFA_TOKEN");
        }

        if (mfaResult.value.usedBackupCode) {
          await this.logSecurityEvent(user.id, user.id, {
            action: "USER_LOGIN",
            severity: "MEDIUM",
            details: {
              email: user.email,
              warning: "Backup code used for login",
              ...(this.hasRedis && { fingerprint: hashFingerprint(sessionFingerprint) }),
            },
            ipAddress: sessionFingerprint.ipAddress,
            userAgent: sessionFingerprint.userAgent,
          });
        }
      }

      const tokens = await this.createSession(user, sessionFingerprint);

      if (this.hasRedis) {
        await recordLoginAttempt({
          email: credentials.email,
          ipAddress: sessionFingerprint.ipAddress,
          userAgent: sessionFingerprint.userAgent,
          timestamp: new Date(),
          success: true,
        });
      }

      await prisma.adminUser.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      await this.logUserAction(user.id, {
        action: "USER_LOGIN",
        category: "AUTHENTICATION",
        severity: "INFO",
        details: {
          email: user.email,
          sessionId: tokens.sessionId || tokens.refreshToken.substring(0, 8) + "...",
          ...(this.hasRedis && {
            deviceFingerprint: hashFingerprint(sessionFingerprint),
            tokenVersion: tokens.tokenVersion || 1,
          }),
        },
        ipAddress: sessionFingerprint.ipAddress,
        userAgent: sessionFingerprint.userAgent,
      });

      return ok({
        user: this.mapUserToAuthenticatedUser(user),
        tokens,
      });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Login error");
      return err("DATABASE_ERROR");
    }
  }

  // ---------------------------------------------------------------------------
  // Audit Proxies (expose protected AuditableService methods for session module)
  // ---------------------------------------------------------------------------

  /** @internal Exposed for AuthServiceSession */
  async writeAuditLogPublic(
    ...args: Parameters<typeof this.writeAuditLog>
  ): ReturnType<typeof this.writeAuditLog> {
    return this.writeAuditLog(...args);
  }

  /** @internal Exposed for AuthServiceSession */
  async logUserActionPublic(
    ...args: Parameters<typeof this.logUserAction>
  ): ReturnType<typeof this.logUserAction> {
    return this.logUserAction(...args);
  }

  /** @internal Exposed for AuthServiceSession */
  async logSecurityEventPublic(
    ...args: Parameters<typeof this.logSecurityEvent>
  ): ReturnType<typeof this.logSecurityEvent> {
    return this.logSecurityEvent(...args);
  }

  // ---------------------------------------------------------------------------
  // Shared Utilities
  // ---------------------------------------------------------------------------

  async createSession(user: AdminUserDto, fingerprint: SessionFingerprint): Promise<AuthTokens> {
    const tempToken = randomBytes(32).toString("hex");
    const session = await prisma.adminSession.create({
      data: {
        userId: user.id,
        refreshToken: tempToken,
        ipAddress: fingerprint.ipAddress || "",
        userAgent: fingerprint.userAgent || "",
        expiresAt: new Date(Date.now() + this.refreshTokenTtl * 1000),
      },
    });

    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      session.id,
      fingerprint,
      1
    );

    await prisma.adminSession.update({
      where: { id: session.id },
      data: { refreshToken: tokens.refreshToken },
    });

    if (this.hasRedis) {
      await storeSessionFingerprint(session.id, hashFingerprint(fingerprint), this.refreshTokenTtl);
      await trackActiveSession(user.id, session.id, this.refreshTokenTtl);
    }

    return tokens;
  }

  async generateTokens(
    userId: string,
    email: string,
    role: AdminRoleKind,
    sessionId: string,
    fingerprint: SessionFingerprint,
    tokenVersion: number
  ): Promise<AuthTokens> {
    const payload: TokenPayload = {
      userId,
      email,
      role,
      sessionId,
    };

    if (this.hasRedis) {
      payload.deviceFingerprint = hashFingerprint(fingerprint);
      payload.tokenVersion = tokenVersion;
    }

    const jwtOptions: jwt.SignOptions = {
      expiresIn: this.accessTokenTtl,
    };

    if (this.hasRedis) {
      jwtOptions.issuer = this.issuer;
      jwtOptions.audience = this.audience;
    }

    const accessToken = jwt.sign(payload, this.jwtSecret, jwtOptions);

    const refreshToken = jwt.sign(payload, this.refreshSecret, {
      expiresIn: this.refreshTokenTtl,
      ...(this.hasRedis && {
        issuer: this.issuer,
        audience: this.audience,
      }),
    });

    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + this.refreshTokenTtl * 1000),
      sessionId,
      ...(this.hasRedis && { tokenVersion }),
    };
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  mapUserToAuthenticatedUser(user: AdminUserDto): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt,
      mfaEnabled: user.mfaEnabled,
    };
  }
}
