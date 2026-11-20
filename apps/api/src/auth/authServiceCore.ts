/**
 * @file authServiceCore.ts
 * @description Core authentication logic: user registration, login with MFA support,
 *              and shared utilities. Enhanced security features activate when Redis is available.
 * @layer infrastructure
 */

import jwt from "jsonwebtoken";
import { randomBytes, randomUUID } from "crypto";
import { hashRefreshToken } from "./refreshTokenHash.js";
import { hashPassword, verifyPassword, needsRehash } from "./passwordHashing.js";
import { ok, err, type Result } from "@shared/types";
import { env } from "../config/env.js";
import type { AdminRoleKind } from "@core/domain/repositories/ReadModelDtos.js";
import type { AdminUserDto } from "@core/domain/repositories/ReadModelDtos.js";
import { AuditableService, auditActor } from "../services/AuditableService.js";
import type { MfaService } from "../admin/auth/MfaService.js";
import { MFA_SUBJECT_TYPE } from "@ports/core";
import type { AdminUserRepositoryPort } from "@core/domain/repositories/AdminUserRepository.js";
import type { AuditLogRepository } from "@core/domain/repositories/AuditLogRepository.js";
import type { RoleRepository } from "@core/domain/repositories/RoleRepository.js";
import type { AdminSessionRepository } from "@core/domain/repositories/AdminSessionRepository.js";
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
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";

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
    readonly mfaSvc: MfaService,
    readonly roleRepo: RoleRepository,
    readonly sessionRepo: AdminSessionRepository,
    auditLog: AuditLogRepository
  ) {
    super("AuthService", auditLog);
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
   * @method registerAdmin
   * @description Creates an administrator with a verified e-mail under the named role, and
   *   records the creation in the audit log.
   * @param email - The administrator's e-mail, stored normalized
   * @param password - The password, at least 8 characters, stored as a hash
   * @param name - The administrator's display name
   * @param role - The name of the role the administrator gets
   * @returns The administrator; otherwise `VALIDATION_ERROR` for a missing field, a short
   *   password or an unknown role, `EMAIL_EXISTS`, or `DATABASE_ERROR`
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
      const roleRecord = await this.roleRepo.findByName(role);
      if (!roleRecord) return err("VALIDATION_ERROR");

      const user = await this.userRepo.create({
        email: normalizeEmail(email),
        passwordHash,
        name,
        roleId: roleRecord.id,
        emailVerified: true,
      });

      await this.logResourceAction(auditActor.admin(user.id), {
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

      return ok(this.mapUserToAuthenticatedUser(user));
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Registration error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method login
   * @description Signs an administrator in with the e-mail, the password and, when the
   *   administrator has a second factor, its code. It verifies the password (upgrading a hash
   *   stored under weaker parameters), the active state, the session count when Redis is
   *   available and the second factor, then opens a session, writes `lastLoginAt` and records
   *   the sign-in. A missing code is answered with the second factor's challenge.
   *
   *   An administrator whose password must be changed is refused once every check has passed and
   *   before the session is opened: no session, no `lastLoginAt` and no record of a sign-in. The
   *   refusal comes after the second factor, so a caller who holds the password but not the
   *   second factor learns nothing of the mark, and the code that verified is spent.
   * @param credentials - The e-mail, the password and the second factor's code when there is one
   * @param ipAddress - The caller's address, used when no fingerprint is given
   * @param userAgent - The caller's agent, used when no fingerprint is given
   * @param fingerprint - The caller's device, which the session is bound to
   * @returns The administrator and the session's tokens, or the second factor's challenge;
   *   otherwise `INVALID_CREDENTIALS`, `USER_INACTIVE`, `TOO_MANY_SESSIONS`, `INVALID_MFA_TOKEN`,
   *   `PASSWORD_CHANGE_REQUIRED` or `DATABASE_ERROR`
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
      | "PASSWORD_CHANGE_REQUIRED"
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

      const userResult = await this.userRepo.findCredentialsByEmail(credentials.email);
      if (!userResult.ok) {
        await this.writeAuditLog({
          action: "USER_LOGIN",
          category: "AUTHENTICATION",
          severity: "HIGH",
          // No verified user (login attempt for a non-existent account) — a
          // SYSTEM actor keeps both FKs null, preserving the prior behavior.
          actor: auditActor.system(),
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

      // Transparent rehash on successful login: if the stored hash uses
      // parameters weaker than the current canon, upgrade it silently. The
      // plaintext is still on the stack at this point, so the upgrade has
      // no extra cost beyond a second `argon2.hash` call. Failure is
      // non-fatal — login proceeds either way.
      if (isPasswordValid && needsRehash(user.passwordHash)) {
        try {
          const upgraded = await hashPassword(credentials.password);
          await this.userRepo.update(user.id, { passwordHash: upgraded });
        } catch {
          // Swallow — login should not fail on rehash failure.
        }
      }

      if (!isPasswordValid) {
        await this.logUserAction(auditActor.admin(user.id), {
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
        await this.logUserAction(auditActor.admin(user.id), {
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
          await this.logSecurityEvent(auditActor.admin(user.id), user.id, {
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

        const mfaResult = await this.mfaSvc.verifyMfaToken(
          { type: MFA_SUBJECT_TYPE.ADMIN, id: user.id },
          credentials.mfaToken
        );
        if (!mfaResult.ok) {
          await this.logSecurityEvent(auditActor.admin(user.id), user.id, {
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
          await this.logSecurityEvent(auditActor.admin(user.id), user.id, {
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

      // The password must be changed first: refused only now, so the mark stays hidden from a
      // caller without the second factor, and before the session, so nothing of a sign-in lands.
      if (user.mustChangePassword) {
        return err("PASSWORD_CHANGE_REQUIRED");
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

      await this.userRepo.update(user.id, { lastLoginAt: new Date() });

      await this.logUserAction(auditActor.admin(user.id), {
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

  /**
   * @internal
   * @method writeAuditLogPublic
   * @description Writes an audit row for the session module, which cannot reach the protected
   *   writer this class inherits.
   * @param args - The arguments of the inherited writer
   * @returns What the inherited writer returns
   */
  async writeAuditLogPublic(
    ...args: Parameters<typeof this.writeAuditLog>
  ): ReturnType<typeof this.writeAuditLog> {
    return this.writeAuditLog(...args);
  }

  /**
   * @internal
   * @method logUserActionPublic
   * @description Records an administrator's action for the session module, which cannot reach
   *   the protected recorder this class inherits.
   * @param args - The arguments of the inherited recorder
   * @returns What the inherited recorder returns
   */
  async logUserActionPublic(
    ...args: Parameters<typeof this.logUserAction>
  ): ReturnType<typeof this.logUserAction> {
    return this.logUserAction(...args);
  }

  /**
   * @internal
   * @method logSecurityEventPublic
   * @description Records a security event for the session module, which cannot reach the
   *   protected recorder this class inherits.
   * @param args - The arguments of the inherited recorder
   * @returns What the inherited recorder returns
   */
  async logSecurityEventPublic(
    ...args: Parameters<typeof this.logSecurityEvent>
  ): ReturnType<typeof this.logSecurityEvent> {
    return this.logSecurityEvent(...args);
  }

  // ---------------------------------------------------------------------------
  // Shared Utilities
  // ---------------------------------------------------------------------------

  /**
   * @method createSession
   * @description Opens a session for the administrator: stores it with the hash of its refresh
   *   token, issues the token pair and, when Redis is available, stores the device fingerprint
   *   and counts the session as active.
   * @param user - The administrator the session belongs to
   * @param fingerprint - The caller's device, whose address and agent the session carries
   * @returns The two tokens, the refresh token's expiry and the session's id
   */
  async createSession(user: AdminUserDto, fingerprint: SessionFingerprint): Promise<AuthTokens> {
    const tempToken = randomBytes(32).toString("hex");
    const session = await this.sessionRepo.create({
      userId: user.id,
      refreshTokenHash: hashRefreshToken(tempToken),
      ipAddress: fingerprint.ipAddress || "",
      userAgent: fingerprint.userAgent || "",
      expiresAt: new Date(Date.now() + this.refreshTokenTtl * 1000),
    });

    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      session.id,
      fingerprint,
      1
    );

    await this.sessionRepo.updateRefreshTokenHash(
      session.id,
      hashRefreshToken(tokens.refreshToken)
    );

    if (this.hasRedis) {
      await storeSessionFingerprint(session.id, hashFingerprint(fingerprint), this.refreshTokenTtl);
      await trackActiveSession(user.id, session.id, this.refreshTokenTtl);
    }

    return tokens;
  }

  /**
   * @method generateTokens
   * @description Signs an access token and a refresh token for a session. The refresh token
   *   carries an id of its own, so no two mints are equal; when Redis is available both tokens
   *   carry the device fingerprint, the token version, the issuer and the audience.
   * @param userId - The administrator
   * @param email - The administrator's e-mail
   * @param role - The administrator's role
   * @param sessionId - The session the tokens belong to
   * @param fingerprint - The device the tokens are bound to when Redis is available
   * @param tokenVersion - The version the tokens carry when Redis is available
   * @returns The two tokens, the refresh token's expiry, the session's id and, when Redis is
   *   available, the token version
   */
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

    // The refresh token only: rotation consumes it by a write, so every mint must differ.
    // Without a per-mint `jti` two mints of one payload inside one second are byte-identical
    // (whole-second iat/exp), and a rotation that re-mints the presented token becomes a
    // compare-and-swap that swaps a hash for itself — the replay goes undetected. Unique
    // regardless of Redis, which is the deployment shape where nothing else makes a mint
    // unique. The access token is left as is: nothing consumes it by a write.
    const refreshToken = jwt.sign(payload, this.refreshSecret, {
      expiresIn: this.refreshTokenTtl,
      jwtid: randomUUID(),
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

  /**
   * @method hashPassword
   * @description Hashes a password with the canonical password-hashing helper.
   * @param password - The password
   * @returns The encoded hash
   */
  async hashPassword(password: string): Promise<string> {
    return hashPassword(password);
  }

  /**
   * @method verifyPassword
   * @description Checks a password against a stored hash.
   * @param password - The password presented
   * @param hash - The stored hash
   * @returns Whether the password matches the hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return verifyPassword(hash, password);
  }

  /**
   * @method mapUserToAuthenticatedUser
   * @description Projects an administrator onto the identity a signed-in caller receives, with no
   *   credential material.
   * @param user - The stored administrator
   * @returns The id, e-mail, name, role, active and verified states, last sign-in and whether a
   *   second factor is enabled
   */
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
