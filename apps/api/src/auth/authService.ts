/**
 * @file authService.ts
 * @description Unified authentication service facade composing AuthServiceCore and
 *              AuthServiceSession into the original AuthService public API.
 * @layer infrastructure
 */

import type { Result } from "@shared/types";
import type { AdminSession, PrismaClient } from "@infra/prisma";
import type { AdminRoleKind } from "@core/domain/repositories/ReadModelDtos.js";
import type { MfaService } from "./mfaService.js";
import type { AdminUserRepositoryPort } from "@core/domain/repositories/AdminUserRepository.js";
import type { AuditLogRepository } from "@core/domain/repositories/AuditLogRepository.js";
import type { RoleRepository } from "@core/domain/repositories/RoleRepository.js";
import type { AdminSessionRepository } from "@core/domain/repositories/AdminSessionRepository.js";
import { AuthServiceCore } from "./authServiceCore.js";
import { AuthServiceSession } from "./authServiceSession.js";
import type {
  AuthenticatedUser,
  AuthTokens,
  LoginCredentials,
  SessionFingerprint,
} from "./authTypes.js";

// Re-export from extracted modules for backward compatibility
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
    auditLog: AuditLogRepository
  ) {
    this.core = new AuthServiceCore(userRepo, mfaSvc, roleRepo, sessionRepo, auditLog);
    this.session = new AuthServiceSession(prisma, this.core);
  }

  async registerAdmin(
    email: string,
    password: string,
    name: string,
    role: AdminRoleKind = "ADMIN"
  ): Promise<Result<AuthenticatedUser, "EMAIL_EXISTS" | "VALIDATION_ERROR" | "DATABASE_ERROR">> {
    return this.core.registerAdmin(email, password, name, role);
  }

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
    return this.core.login(credentials, ipAddress, userAgent, fingerprint);
  }

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

  async logout(
    refreshToken: string
  ): Promise<Result<void, "SESSION_NOT_FOUND" | "DATABASE_ERROR">> {
    return this.session.logout(refreshToken);
  }

  async revokeAllSessions(userId: string): Promise<Result<number, "DATABASE_ERROR">> {
    return this.session.revokeAllSessions(userId);
  }

  async getUserSessions(userId: string): Promise<Result<AdminSession[], "DATABASE_ERROR">> {
    return this.session.getUserSessions(userId);
  }
}
