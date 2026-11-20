/**
 * @file authService.ts
 * @description Unified authentication service facade composing AuthServiceCore and
 *              AuthServiceSession into the original AuthService public API.
 * @layer infrastructure
 */

import type { Result } from "@shared/types";
import type { AdminSession, PrismaClient } from "@infra/prisma";
import type { AdminRoleKind } from "@core/domain/repositories/ReadModelDtos.js";
import type { MfaService } from "../admin/auth/MfaService.js";
import type { AdminUserRepositoryPort } from "@core/domain/repositories/AdminUserRepository.js";
import type { AuditLogRepository } from "@core/domain/repositories/AuditLogRepository.js";
import type { RoleRepository } from "@core/domain/repositories/RoleRepository.js";
import type { AdminSessionRepository } from "@core/domain/repositories/AdminSessionRepository.js";
import type { ApiMetrics } from "../metrics/apiMetrics.js";
import { AuthServiceCore } from "./authServiceCore.js";
import { AuthServiceSession } from "./authServiceSession.js";
import type {
  AuthenticatedUser,
  AuthTokens,
  LoginCredentials,
  SessionFingerprint,
} from "./authTypes.js";

// Re-export helpers from extracted modules.
export { setRedisInstance } from "./redisSessionHelpers.js";

// ---------------------------------------------------------------------------
// Core interfaces — re-exported from authTypes.ts to maintain public API
// ---------------------------------------------------------------------------

export type {
  TokenPayload,
  LoginCredentials,
  AuthTokens,
  AuthenticatedUser,
  SessionFingerprint,
} from "./authTypes.js";

// ---------------------------------------------------------------------------
// Facade Class
// ---------------------------------------------------------------------------

export class AuthService {
  private core: AuthServiceCore;
  private session: AuthServiceSession;

  constructor(
    prisma: PrismaClient,
    userRepo: AdminUserRepositoryPort,
    mfaSvc: MfaService,
    roleRepo: RoleRepository,
    sessionRepo: AdminSessionRepository,
    auditLog: AuditLogRepository,
    // Optional, exactly as on MfaService: it carries the security-threat counter a
    // refused rotation increments, and leaving it optional keeps every existing
    // caller and unit harness constructing the facade unchanged.
    metrics?: ApiMetrics
  ) {
    this.core = new AuthServiceCore(userRepo, mfaSvc, roleRepo, sessionRepo, auditLog);
    this.session = new AuthServiceSession(prisma, this.core, metrics);
  }

  /**
   * @method registerAdmin
   * @description Creates an administrator with a verified e-mail under the named role, and
   *   records the creation in the audit log.
   * @param email - The administrator's e-mail, stored normalized
   * @param password - The password, at least 8 characters, stored as a hash
   * @param name - The administrator's display name
   * @param role - The name of the role the administrator gets
   * @returns The administrator; otherwise `VALIDATION_ERROR`, `EMAIL_EXISTS` or `DATABASE_ERROR`
   */
  async registerAdmin(
    email: string,
    password: string,
    name: string,
    role: AdminRoleKind = "ADMIN"
  ): Promise<Result<AuthenticatedUser, "EMAIL_EXISTS" | "VALIDATION_ERROR" | "DATABASE_ERROR">> {
    return this.core.registerAdmin(email, password, name, role);
  }

  /**
   * @method login
   * @description Signs an administrator in with the e-mail, the password and, when the
   *   administrator has a second factor, its code; an administrator whose password must be
   *   changed is refused once every check has passed, with no session opened.
   * @param credentials - The e-mail, the password and the second factor's code when there is one
   * @param ipAddress - The caller's address, used when no fingerprint is given
   * @param userAgent - The caller's agent, used when no fingerprint is given
   * @param fingerprint - The caller's device, which the session is bound to
   * @returns The administrator and the session's tokens, or the second factor's challenge;
   *   otherwise the code of the refusal
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
    return this.core.login(credentials, ipAddress, userAgent, fingerprint);
  }

  /**
   * @method refreshTokens
   * @description Rotates the presented refresh token: at most one caller receives a new pair
   *   for it.
   * @param refreshToken - The refresh token presented
   * @param ipAddress - The caller's address, used when no fingerprint is given
   * @param fingerprint - The caller's device, checked against the session's when Redis is
   *   available
   * @returns The new tokens; otherwise the code of the refusal
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
    return this.session.refreshTokens(refreshToken, ipAddress, fingerprint);
  }

  /**
   * @method verifyAccessToken
   * @description Verifies an access token and returns the administrator it was issued to, while
   *   the session is active and unexpired and the administrator is active; when Redis is
   *   available, a blacklisted token is refused and the device fingerprint is compared.
   * @param token - The bearer access token
   * @param fingerprint - The caller's device, compared with the token's when Redis is available
   * @returns The administrator; otherwise `INVALID_TOKEN`, `TOKEN_BLACKLISTED`, `SESSION_EXPIRED`
   *   or `USER_INACTIVE`
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
    return this.session.verifyAccessToken(token, fingerprint);
  }

  /**
   * @method logout
   * @description Ends the session the refresh token belongs to and records the sign-out; when
   *   Redis is available the token is blacklisted too.
   * @param refreshToken - The session's refresh token
   * @returns `ok` once the session is ended; otherwise `SESSION_NOT_FOUND` or `DATABASE_ERROR`
   */
  async logout(
    refreshToken: string
  ): Promise<Result<void, "SESSION_NOT_FOUND" | "DATABASE_ERROR">> {
    return this.session.logout(refreshToken);
  }

  /**
   * @method revokeAllSessions
   * @description Ends every active session of the administrator and records the revocation.
   * @param userId - The administrator
   * @returns How many sessions were ended; otherwise `DATABASE_ERROR`
   */
  async revokeAllSessions(userId: string): Promise<Result<number, "DATABASE_ERROR">> {
    return this.session.revokeAllSessions(userId);
  }

  /**
   * @method getUserSessions
   * @description Lists the administrator's active, unexpired sessions, newest first.
   * @param userId - The administrator
   * @returns The sessions; otherwise `DATABASE_ERROR`
   */
  async getUserSessions(userId: string): Promise<Result<AdminSession[], "DATABASE_ERROR">> {
    return this.session.getUserSessions(userId);
  }
}
