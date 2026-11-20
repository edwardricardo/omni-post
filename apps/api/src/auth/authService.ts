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
   * @description Delegates to {@link AuthServiceCore.registerAdmin}, which states the contract.
   * @param email - Passed through
   * @param password - Passed through
   * @param name - Passed through
   * @param role - Passed through
   * @returns What the delegate returns
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
   * @description Delegates to {@link AuthServiceCore.login}, which states the contract.
   * @param credentials - Passed through
   * @param ipAddress - Passed through
   * @param userAgent - Passed through
   * @param fingerprint - Passed through
   * @returns What the delegate returns
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
   * @description Delegates to {@link AuthServiceSession.refreshTokens}, which states the contract.
   * @param refreshToken - Passed through
   * @param ipAddress - Passed through
   * @param fingerprint - Passed through
   * @returns What the delegate returns
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
   * @description Delegates to {@link AuthServiceSession.verifyAccessToken}, which states the
   *   contract.
   * @param token - Passed through
   * @param fingerprint - Passed through
   * @returns What the delegate returns
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
   * @description Delegates to {@link AuthServiceSession.logout}, which states the contract.
   * @param refreshToken - Passed through
   * @returns What the delegate returns
   */
  async logout(
    refreshToken: string
  ): Promise<Result<void, "SESSION_NOT_FOUND" | "DATABASE_ERROR">> {
    return this.session.logout(refreshToken);
  }

  /**
   * @method revokeAllSessions
   * @description Delegates to {@link AuthServiceSession.revokeAllSessions}, which states the
   *   contract.
   * @param userId - Passed through
   * @returns What the delegate returns
   */
  async revokeAllSessions(userId: string): Promise<Result<number, "DATABASE_ERROR">> {
    return this.session.revokeAllSessions(userId);
  }

  /**
   * @method getUserSessions
   * @description Delegates to {@link AuthServiceSession.getUserSessions}, which states the
   *   contract.
   * @param userId - Passed through
   * @returns What the delegate returns
   */
  async getUserSessions(userId: string): Promise<Result<AdminSession[], "DATABASE_ERROR">> {
    return this.session.getUserSessions(userId);
  }
}
