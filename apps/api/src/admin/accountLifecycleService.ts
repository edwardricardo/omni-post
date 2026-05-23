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
import { prisma } from "@infra/prisma";
import { logger } from "../lib/logger.js";

const adminLogger = logger.child({ module: "admin" });
import type { AdminSession } from "@infra/prisma";
import type { AdminUserDto } from "../domain/repositories/ReadModelDtos.js";
import { AuditableService } from "../services/AuditableService.js";
import { hashPassword } from "../auth/passwordHashing.js";
import type { AdminUserRepositoryPort } from "../domain/repositories/AdminUserRepository.js";
import type {
  AccountProfile,
  CreateAccountRequest,
  UpdateAccountRequest,
  AccountFilters,
  ResetPasswordRequest,
} from "./accountLifecycleTypes.js";
import {
  AccountLifecycleQueryService,
  mapAdminUserToProfile,
} from "./accountLifecycleQueryService.js";
import { AccountSessionService } from "./AccountSessionService.js";

export class AccountLifecycleService extends AuditableService {
  private readonly queryService: AccountLifecycleQueryService;
  private readonly sessionService: AccountSessionService;

  constructor(private readonly userRepo: AdminUserRepositoryPort) {
    super("AccountLifecycleService");
    this.queryService = new AccountLifecycleQueryService(prisma);
    this.sessionService = new AccountSessionService(userRepo);
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
          const roleRecord = await prisma.role.findUnique({ where: { name: roleName } });
          if (!roleRecord) {
            return await prisma.adminUser.create({
              data: {
                email: data.email.toLowerCase(),
                passwordHash,
                name: data.name,
                roleId: "role-admin", // fallback to default role ID
                emailVerified: true,
              },
              include: { role: true },
            });
          }
          return await prisma.adminUser.create({
            data: {
              email: data.email.toLowerCase(),
              passwordHash,
              name: data.name,
              roleId: roleRecord.id,
              emailVerified: true,
            },
            include: { role: true },
          });
        }
      );

      // Log account creation with details
      if (createdByUserId) {
        await this.logAccountAction(createdByUserId, {
          accountId: user.id,
          action: "RESOURCE_CREATE",
          category: "ACCOUNT",
          severity: "MEDIUM",
          details: {
            email: user.email,
            name: user.name,
            role: user.role.name,
            createdBy: createdByUserId,
          },
        });
      }

      // Future: integrate email service for welcome emails
      if (data.sendWelcomeEmail) {
        adminLogger.info({ email: user.email }, "Welcome email would be sent");
      }

      // Map Prisma result (with role relation) to AdminUserDto shape
      const userDto = { ...user, role: user.role.name } as unknown as AdminUserDto;
      return ok(await this.mapUserToProfile(userDto));
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
      const sessions = await prisma.adminSession.findMany({
        where: { userId: accountId, isActive: true },
        orderBy: { createdAt: "desc" },
        take: 1,
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
          const updateData: Record<string, unknown> = {
            ...restData,
            updatedAt: new Date(),
          };
          if (roleName) {
            const roleRecord = await prisma.role.findUnique({
              where: { name: roleName },
            });
            if (roleRecord) {
              updateData.roleId = roleRecord.id;
            }
          }
          return await prisma.adminUser.update({
            where: { id: accountId },
            data: updateData,
            include: { role: true },
          });
        }
      );

      // Log detailed account changes
      if (Object.keys(changes).length > 0 && updatedByUserId) {
        await this.logAccountAction(updatedByUserId, {
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

      // Map role relation to string for AdminUserDto compatibility
      const userWithRole = updatedUser as unknown as Record<string, unknown>;
      const roleName =
        typeof userWithRole.role === "object" && userWithRole.role !== null
          ? (userWithRole.role as { name: string }).name
          : String(userWithRole.role ?? "ADMIN");
      const userDto = { ...updatedUser, role: roleName } as unknown as AdminUserDto;
      return ok(await this.mapUserToProfile(userDto));
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
          await prisma.$transaction(async (tx) => {
            await tx.adminUser.update({
              where: { id: accountId },
              data: { isActive: false },
            });

            await tx.adminSession.updateMany({
              where: { userId: accountId, isActive: true },
              data: {
                isActive: false,
                revokedAt: new Date(),
              },
            });
          });
        }
      );

      // Log compliance event for account suspension
      if (suspendedByUserId) {
        await this.logComplianceEvent(suspendedByUserId, accountId, {
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
          await prisma.adminUser.update({
            where: { id: accountId },
            data: { isActive: true },
          });
        }
      );

      // Log account reactivation
      if (reactivatedByUserId) {
        await this.logAccountAction(reactivatedByUserId, {
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
          await prisma.$transaction(async (tx) => {
            // Delete sessions
            await tx.adminSession.deleteMany({
              where: { userId: accountId },
            });

            // Note: Audit logs are kept for compliance
            // but we update them to remove the user reference
            await tx.auditLog.updateMany({
              where: { userId: accountId },
              data: { userId: null },
            });

            // Delete the user
            await tx.adminUser.delete({
              where: { id: accountId },
            });
          });
        }
      );

      // Log compliance event for account deletion
      if (deletedByUserId) {
        await this.logComplianceEvent(deletedByUserId, accountId, {
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
    user: AdminUserDto & { sessions?: AdminSession[] }
  ): Promise<AccountProfile> {
    return mapAdminUserToProfile(prisma, user);
  }
}

// NOTE: No module-level singleton. AccountLifecycleService is registered in
// the DI container (TOKENS.AccountLifecycleService) and receives
// AdminUserRepositoryPort via constructor injection. See setup.ts.

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
