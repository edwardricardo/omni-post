/**
 * @file AccountSessionService.ts
 * @description Manages session and password operations for admin accounts
 *              including password reset, session listing, and bulk revocation.
 * @layer infrastructure
 *
 * @module admin/AccountSessionService
 */

import { ok, err, type Result } from "@shared/types";
import { logger } from "../lib/logger.js";

const adminLogger = logger.child({ module: "admin" });
import { AuditableService } from "../services/AuditableService.js";
import { hashPassword } from "../auth/passwordHashing.js";
import type { AdminUserRepositoryPort } from "../domain/repositories/AdminUserRepository.js";
import type { AuditLogRepository } from "../domain/repositories/AuditLogRepository.js";
import type {
  AdminSessionRepository,
  AdminSessionDto,
} from "../domain/repositories/AdminSessionRepository.js";
import type { ResetPasswordRequest } from "./accountLifecycleTypes.js";

export class AccountSessionService extends AuditableService {
  constructor(
    private readonly userRepo: AdminUserRepositoryPort,
    private readonly sessionRepo: AdminSessionRepository,
    auditLog: AuditLogRepository
  ) {
    super("AccountSessionService", auditLog);
  }

  /**
   * Reset account password (admin action)
   */
  async resetPassword(
    accountId: string,
    data: ResetPasswordRequest,
    resetByUserId?: string
  ): Promise<Result<void, "NOT_FOUND" | "VALIDATION_ERROR" | "DATABASE_ERROR">> {
    try {
      this.validateRequired(
        { accountId, newPassword: data.newPassword },
        "Account ID and password are required"
      );

      if (data.newPassword.length < 8) {
        return err("VALIDATION_ERROR");
      }

      const userResult = await this.userRepo.findById(accountId);

      if (!userResult.ok) {
        return err("NOT_FOUND");
      }

      const user = userResult.value;

      // Hash new password with the canonical Argon2id parameters.
      const passwordHash = await hashPassword(data.newPassword);

      // Update password with audit logging
      await this.executeWithAudit(
        {
          operation: "resetPassword",
          ...(resetByUserId !== undefined && { userId: resetByUserId }),
          accountId,
        },
        {
          action: "RESOURCE_UPDATE",
          category: "SECURITY",
          resourceType: "AdminUser",
          resourceId: accountId,
          severity: "HIGH",
        },
        async () => {
          await this.userRepo.update(accountId, {
            passwordHash,
            passwordResetToken: data.requirePasswordChange ? "CHANGE_REQUIRED" : null,
            passwordResetExpires: data.requirePasswordChange
              ? new Date(Date.now() + 24 * 60 * 60 * 1000)
              : null,
          });
        }
      );

      // Log security event for password reset
      if (resetByUserId) {
        await this.logSecurityEvent(resetByUserId, accountId, {
          action: "RESOURCE_UPDATE",
          severity: "HIGH",
          details: {
            email: user.email,
            action: "PASSWORD_RESET_ADMIN",
            requirePasswordChange: data.requirePasswordChange,
            resetBy: resetByUserId,
          },
        });
      }

      return ok(undefined);
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "Reset password error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get account sessions
   */
  async getAccountSessions(
    accountId: string
  ): Promise<Result<AdminSessionDto[], "NOT_FOUND" | "DATABASE_ERROR">> {
    try {
      this.validateRequired({ accountId }, "Account ID is required");

      const userResult = await this.userRepo.findById(accountId);

      if (!userResult.ok) {
        return err("NOT_FOUND");
      }

      const sessions = await this.sessionRepo.findByUserId(accountId);

      return ok(sessions);
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "Get account sessions error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Revoke all sessions for an account
   */
  async revokeAllSessions(
    accountId: string,
    revokedByUserId?: string
  ): Promise<Result<number, "NOT_FOUND" | "DATABASE_ERROR">> {
    try {
      this.validateRequired({ accountId }, "Account ID is required");

      const userResult = await this.userRepo.findById(accountId);

      if (!userResult.ok) {
        return err("NOT_FOUND");
      }

      const user = userResult.value;

      // Revoke sessions with audit logging
      const count = await this.executeWithAudit(
        {
          operation: "revokeAllSessions",
          ...(revokedByUserId !== undefined && { userId: revokedByUserId }),
          accountId,
        },
        {
          action: "RESOURCE_UPDATE",
          category: "SECURITY",
          resourceType: "AdminSession",
          resourceId: accountId,
          severity: "HIGH",
        },
        async () => {
          return this.sessionRepo.revokeAllForUser(accountId);
        }
      );

      // Log security event for session revocation
      if (revokedByUserId) {
        await this.logSecurityEvent(revokedByUserId, accountId, {
          action: "RESOURCE_UPDATE",
          severity: "HIGH",
          details: {
            email: user.email,
            action: "SESSIONS_REVOKED_ADMIN",
            revokedSessions: count,
            revokedBy: revokedByUserId,
          },
        });
      }

      return ok(count);
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "Revoke sessions error");
      return err("DATABASE_ERROR");
    }
  }
}
