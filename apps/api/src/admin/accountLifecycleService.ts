/**
 * @file accountLifecycleService.ts
 * @description Manages admin account lifecycle operations (create, update, suspend, delete)
 *              with comprehensive audit logging and standardized error handling.
 * @layer infrastructure
 * - Account state change logging with logAccountAction()
 * - Compliance event logging for data deletion/suspension
 * - Transaction-safe operations for data integrity
 *
 * Query methods (listAccounts, getAccountStats) live in
 * accountLifecycleQueryService.ts.
 * Session/password methods (resetPassword, getAccountSessions,
 * revokeAllSessions) live in AccountSessionService.ts.
 */

import { ok, err, type Result } from "@shared/types";
import { logger } from "../lib/logger.js";

const adminLogger = logger.child({ module: "admin" });
import type { AdminUserDto } from "@core/domain/repositories/ReadModelDtos.js";
import { AuditableService, auditActor } from "../services/AuditableService.js";
import { hashPassword } from "../auth/passwordHashing.js";
import type {
  AdminUserRepositoryPort,
  AdminUserUpdate,
} from "@core/domain/repositories/AdminUserRepository.js";
import type {
  AdminSessionRepository,
  AdminSessionDto,
} from "@core/domain/repositories/AdminSessionRepository.js";
import type { RoleRepository } from "@core/domain/repositories/RoleRepository.js";
import type { AuditLogRepository } from "@core/domain/repositories/AuditLogRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type {
  AccountProfile,
  CreateAccountRequest,
  UpdateAccountRequest,
  AccountFilters,
  ResetPasswordRequest,
} from "./accountLifecycleTypes.js";
import { AccountLifecycleQueryService } from "./accountLifecycleQueryService.js";
import { AccountSessionService } from "./AccountSessionService.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";

export class AccountLifecycleService extends AuditableService {
  constructor(
    private readonly userRepo: AdminUserRepositoryPort,
    private readonly sessionRepo: AdminSessionRepository,
    private readonly roleRepo: RoleRepository,
    auditLog: AuditLogRepository,
    private readonly queryService: AccountLifecycleQueryService,
    private readonly sessionService: AccountSessionService,
    private readonly unitOfWork?: UnitOfWork
  ) {
    super("AccountLifecycleService", auditLog);
  }

  // ---------------------------------------------------------------------------
  // Mutation operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new admin account
   */
  async createAccount(
    data: CreateAccountRequest,
    createdByUserId?: string
  ): Promise<Result<AccountProfile, "EMAIL_EXISTS" | "VALIDATION_ERROR" | "DATABASE_ERROR">> {
    try {
      // Validate required fields
      this.validateRequired(
        { email: data.email, password: data.password, name: data.name },
        "Missing required account fields"
      );

      if (data.password.length < 8) {
        return err("VALIDATION_ERROR");
      }

      // Check if email already exists
      const existingUserResult = await this.userRepo.findByEmail(data.email);
      if (existingUserResult.ok) {
        return err("EMAIL_EXISTS");
      }

      // Hash password
      const passwordHash = await hashPassword(data.password);

      // Create user with audit logging
      const user = await this.executeWithAudit(
        {
          operation: "createAccount",
          ...(createdByUserId !== undefined && { userId: createdByUserId }),
          ...(createdByUserId !== undefined && { accountId: createdByUserId }),
        },
        {
          action: "RESOURCE_CREATE",
          category: "ACCOUNT",
          resourceType: "AdminUser",
          severity: "MEDIUM",
        },
        async () => {
          // Resolve role by name (default to ADMIN)
          const roleName = data.role || "ADMIN";
          const roleRecord = await this.roleRepo.findByName(roleName);
          return this.userRepo.create({
            email: normalizeEmail(data.email),
            passwordHash,
            name: data.name,
            roleId: roleRecord ? roleRecord.id : "role-admin",
            emailVerified: true,
          });
        }
      );

      // Log account creation with details
      if (createdByUserId) {
        await this.logAccountAction(auditActor.admin(createdByUserId), {
          accountId: user.id,
          action: "RESOURCE_CREATE",
          category: "ACCOUNT",
          severity: "MEDIUM",
          details: {
            email: user.email,
            name: user.name,
            role: user.role,
            createdBy: createdByUserId,
          },
        });
      }

      // Future: integrate email service for welcome emails
      if (data.sendWelcomeEmail) {
        adminLogger.info({ email: user.email }, "Welcome email would be sent");
      }

      return ok(await this.mapUserToProfile(user));
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "Account creation error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get account by ID
   */
  async getAccount(
    accountId: string
  ): Promise<Result<AccountProfile, "NOT_FOUND" | "DATABASE_ERROR">> {
    try {
      this.validateRequired({ accountId }, "Account ID is required");

      const userResult = await this.userRepo.findById(accountId);

      if (!userResult.ok) {
        return err("NOT_FOUND");
      }

      // Fetch sessions separately since repository doesn't include relations
      const sessions = await this.sessionRepo.findByUserId(accountId, {
        activeOnly: true,
        limit: 1,
      });

      const user = { ...userResult.value, sessions };

      return ok(await this.mapUserToProfile(user));
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "Get account error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Update account details
   */
  async updateAccount(
    accountId: string,
    data: UpdateAccountRequest,
    updatedByUserId?: string
  ): Promise<Result<AccountProfile, "NOT_FOUND" | "DATABASE_ERROR">> {
    try {
      this.validateRequired({ accountId }, "Account ID is required");
      this.validateAtLeastOne(
        {
          name: data.name,
          role: data.role,
          isActive: data.isActive,
          emailVerified: data.emailVerified,
        },
        "At least one field must be provided for update"
      );

      // Get original user for audit logging
      const originalUserResult = await this.userRepo.findById(accountId);

      if (!originalUserResult.ok) {
        return err("NOT_FOUND");
      }

      const originalUser = originalUserResult.value;

      // Track changes for audit logging
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (data.name && data.name !== originalUser.name) {
        changes.name = { from: originalUser.name, to: data.name };
      }
      if (data.role && data.role !== originalUser.role) {
        changes.role = { from: originalUser.role, to: data.role };
      }
      if (data.isActive !== undefined && data.isActive !== originalUser.isActive) {
        changes.isActive = { from: originalUser.isActive, to: data.isActive };
      }
      if (data.emailVerified !== undefined && data.emailVerified !== originalUser.emailVerified) {
        changes.emailVerified = { from: originalUser.emailVerified, to: data.emailVerified };
      }

      // Update user with audit logging
      const updatedUser = await this.executeWithAudit(
        {
          operation: "updateAccount",
          ...(updatedByUserId !== undefined && { userId: updatedByUserId }),
          accountId,
        },
        {
          action: "RESOURCE_UPDATE",
          category: "ACCOUNT",
          resourceType: "AdminUser",
          resourceId: accountId,
          severity: "MEDIUM",
        },
        async () => {
          // Extract role name and convert to roleId for the update
          const { role: roleName, ...restData } = data;
          const updateData: AdminUserUpdate = {
            ...(restData.name !== undefined && { name: restData.name }),
            ...(restData.isActive !== undefined && { isActive: restData.isActive }),
            ...(restData.emailVerified !== undefined && {
              emailVerified: restData.emailVerified,
            }),
          };
          if (roleName) {
            const roleRecord = await this.roleRepo.findByName(roleName);
            if (roleRecord) {
              updateData.roleId = roleRecord.id;
            }
          }
          return this.userRepo.update(accountId, updateData);
        }
      );

      // Log detailed account changes
      if (Object.keys(changes).length > 0 && updatedByUserId) {
        await this.logAccountAction(auditActor.admin(updatedByUserId), {
          accountId,
          action: "RESOURCE_UPDATE",
          category: "ACCOUNT",
          severity: "MEDIUM",
          details: {
            email: originalUser.email,
            changes,
            updatedBy: updatedByUserId,
          },
        });
      }

      return ok(await this.mapUserToProfile(updatedUser));
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "Update account error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Suspend/deactivate account
   */
  async suspendAccount(
    accountId: string,
    reason: string,
    suspendedByUserId?: string
  ): Promise<Result<void, "NOT_FOUND" | "ALREADY_SUSPENDED" | "DATABASE_ERROR">> {
    try {
      this.validateRequired({ accountId, reason }, "Account ID and reason are required");

      const userResult = await this.userRepo.findById(accountId);

      if (!userResult.ok) {
        return err("NOT_FOUND");
      }

      const user = userResult.value;

      if (!user.isActive) {
        return err("ALREADY_SUSPENDED");
      }

      // Deactivate user and revoke all sessions with audit logging
      await this.executeWithAudit(
        {
          operation: "suspendAccount",
          ...(suspendedByUserId !== undefined && { userId: suspendedByUserId }),
          accountId,
        },
        {
          action: "RESOURCE_UPDATE",
          category: "COMPLIANCE",
          resourceType: "AdminUser",
          resourceId: accountId,
          severity: "CRITICAL",
        },
        async () => {
          const work = async (): Promise<void> => {
            await this.userRepo.update(accountId, { isActive: false });
            await this.sessionRepo.revokeAllForUser(accountId);
          };
          if (this.unitOfWork) {
            await this.unitOfWork.executeInTransaction(work);
          } else {
            await work();
          }
        }
      );

      // Log compliance event for account suspension
      if (suspendedByUserId) {
        await this.logComplianceEvent(auditActor.admin(suspendedByUserId), accountId, {
          action: "RESOURCE_UPDATE",
          severity: "CRITICAL",
          details: {
            email: user.email,
            reason,
            action: "ACCOUNT_SUSPENDED",
            suspendedBy: suspendedByUserId,
          },
        });
      }

      return ok(undefined);
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "Suspend account error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Reactivate suspended account
   */
  async reactivateAccount(
    accountId: string,
    reactivatedByUserId?: string
  ): Promise<Result<void, "NOT_FOUND" | "ALREADY_ACTIVE" | "DATABASE_ERROR">> {
    try {
      this.validateRequired({ accountId }, "Account ID is required");

      const userResult = await this.userRepo.findById(accountId);

      if (!userResult.ok) {
        return err("NOT_FOUND");
      }

      const user = userResult.value;

      if (user.isActive) {
        return err("ALREADY_ACTIVE");
      }

      // Reactivate account with audit logging
      await this.executeWithAudit(
        {
          operation: "reactivateAccount",
          ...(reactivatedByUserId !== undefined && { userId: reactivatedByUserId }),
          accountId,
        },
        {
          action: "RESOURCE_UPDATE",
          category: "ACCOUNT",
          resourceType: "AdminUser",
          resourceId: accountId,
          severity: "HIGH",
        },
        async () => {
          await this.userRepo.update(accountId, { isActive: true });
        }
      );

      // Log account reactivation
      if (reactivatedByUserId) {
        await this.logAccountAction(auditActor.admin(reactivatedByUserId), {
          accountId,
          action: "RESOURCE_UPDATE",
          category: "ACCOUNT",
          severity: "HIGH",
          details: {
            email: user.email,
            action: "ACCOUNT_REACTIVATED",
            reactivatedBy: reactivatedByUserId,
          },
        });
      }

      return ok(undefined);
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "Reactivate account error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Delete account (permanent)
   */
  async deleteAccount(
    accountId: string,
    deletedByUserId?: string
  ): Promise<Result<void, "NOT_FOUND" | "CANNOT_DELETE_SELF" | "DATABASE_ERROR">> {
    try {
      this.validateRequired({ accountId }, "Account ID is required");

      if (accountId === deletedByUserId) {
        return err("CANNOT_DELETE_SELF");
      }

      const userResult = await this.userRepo.findById(accountId);

      if (!userResult.ok) {
        return err("NOT_FOUND");
      }

      const user = userResult.value;

      // Delete user and all related data with audit logging
      await this.executeWithAudit(
        {
          operation: "deleteAccount",
          ...(deletedByUserId !== undefined && { userId: deletedByUserId }),
          accountId,
        },
        {
          action: "RESOURCE_DELETE",
          category: "COMPLIANCE",
          resourceType: "AdminUser",
          resourceId: accountId,
          severity: "CRITICAL",
        },
        async () => {
          const work = async (): Promise<void> => {
            await this.sessionRepo.deleteAllForUser(accountId);
            // Audit logs are kept for compliance; only the user reference is removed.
            await this.auditLog.anonymizeUser(accountId);
            await this.userRepo.delete(accountId);
          };
          if (this.unitOfWork) {
            await this.unitOfWork.executeInTransaction(work);
          } else {
            await work();
          }
        }
      );

      // Log compliance event for account deletion
      if (deletedByUserId) {
        await this.logComplianceEvent(auditActor.admin(deletedByUserId), accountId, {
          action: "RESOURCE_DELETE",
          severity: "CRITICAL",
          details: {
            email: user.email,
            name: user.name,
            role: user.role,
            action: "ACCOUNT_DELETED",
            deletedBy: deletedByUserId,
          },
        });
      }

      return ok(undefined);
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "Delete account error");
      return err("DATABASE_ERROR");
    }
  }

  // ---------------------------------------------------------------------------
  // Delegated query operations (thin wrappers to preserve the existing API)
  // ---------------------------------------------------------------------------

  /** @see AccountLifecycleQueryService.listAccounts */
  listAccounts(
    filters: AccountFilters,
    page: number,
    limit: number
  ): ReturnType<AccountLifecycleQueryService["listAccounts"]> {
    return this.queryService.listAccounts(filters, page, limit);
  }

  /** @see AccountLifecycleQueryService.getAccountStats */
  getAccountStats(): ReturnType<AccountLifecycleQueryService["getAccountStats"]> {
    return this.queryService.getAccountStats();
  }

  // ---------------------------------------------------------------------------
  // Delegated session/password operations (thin wrappers to preserve API)
  // ---------------------------------------------------------------------------

  /** @see AccountSessionService.resetPassword */
  resetPassword(
    accountId: string,
    data: ResetPasswordRequest,
    resetByUserId?: string
  ): ReturnType<AccountSessionService["resetPassword"]> {
    return this.sessionService.resetPassword(accountId, data, resetByUserId);
  }

  /** @see AccountSessionService.getAccountSessions */
  getAccountSessions(accountId: string): ReturnType<AccountSessionService["getAccountSessions"]> {
    return this.sessionService.getAccountSessions(accountId);
  }

  /** @see AccountSessionService.revokeAllSessions */
  revokeAllSessions(
    accountId: string,
    revokedByUserId?: string
  ): ReturnType<AccountSessionService["revokeAllSessions"]> {
    return this.sessionService.revokeAllSessions(accountId, revokedByUserId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async mapUserToProfile(
    user: AdminUserDto & { sessions?: AdminSessionDto[] }
  ): Promise<AccountProfile> {
    return this.queryService.mapUserToProfile(user);
  }
}

// ---------------------------------------------------------------------------
// Re-export types so existing importers of this module keep working
// ---------------------------------------------------------------------------
export type {
  AccountProfile,
  CreateAccountRequest,
  UpdateAccountRequest,
  ResetPasswordRequest,
  AccountFilters,
  AccountStats,
} from "./accountLifecycleTypes.js";
