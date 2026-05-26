/**
 * @file PrismaCustomerUserRepository.ts
 * @description Infrastructure adapter implementing CustomerUserRepository using
 *   Prisma. Maps between the persisted shape (CustomerUser + CustomerRole +
 *   CustomerRolePermission rows) and the CustomerUser domain entity, including
 *   the denormalised role snapshot fields (roleName, roleLevel, permissions).
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import { CustomerUser, type CustomerUserProps } from "@core/domain/entities/CustomerUser.js";
import { EntityNotFoundError, type DomainError } from "@core/domain/errors/index.js";

/**
 * Prisma row shape including the joined CustomerRole + permissions. This is
 * what `findFirst({ include: customerRoleWithPermissions })` returns at runtime.
 */
interface PrismaCustomerUserRowWithRole {
  id: string;
  accountId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roleId: string | null;
  isActive: boolean;
  isEmailVerified: boolean;
  emailVerifyToken: string | null;
  emailVerifyExpiry: Date | null;
  resetToken: string | null;
  resetTokenExpiry: Date | null;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  lastLoginAt: Date | null;
  invitedBy: string | null;
  inviteToken: string | null;
  inviteTokenExpiry: Date | null;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  customerRole: {
    id: string;
    name: string;
    level: number;
    permissions: { permission: string }[];
  } | null;
}

const CUSTOMER_ROLE_INCLUDE = {
  customerRole: {
    include: { permissions: true },
  },
} as const;

/**
 * @class PrismaCustomerUserRepository
 * @description Adapter for CustomerUserRepository using Prisma.
 */
export class PrismaCustomerUserRepository implements CustomerUserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Result<CustomerUser, DomainError>> {
    try {
      const row = await this.prisma.customerUser.findFirst({
        where: { id, deletedAt: null },
        include: CUSTOMER_ROLE_INCLUDE,
      });
      if (!row) return err(new EntityNotFoundError("CustomerUser", id));
      return ok(this.toDomain(row as unknown as PrismaCustomerUserRowWithRole));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "CustomerUser",
          `${id} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  async findByEmail(email: string, accountId: string): Promise<Result<CustomerUser, DomainError>> {
    try {
      const row = await this.prisma.customerUser.findFirst({
        where: { email: email.toLowerCase().trim(), accountId, deletedAt: null },
        include: CUSTOMER_ROLE_INCLUDE,
      });
      if (!row) return err(new EntityNotFoundError("CustomerUser", email));
      return ok(this.toDomain(row as unknown as PrismaCustomerUserRowWithRole));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "CustomerUser",
          `${email} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  async findByEmailAcrossAccounts(email: string): Promise<CustomerUser[]> {
    const rows = await this.prisma.customerUser.findMany({
      where: { email: email.toLowerCase().trim(), deletedAt: null },
      include: CUSTOMER_ROLE_INCLUDE,
    });
    return rows.map((r) => this.toDomain(r as unknown as PrismaCustomerUserRowWithRole));
  }

  async findByAccountId(accountId: string): Promise<CustomerUser[]> {
    const rows = await this.prisma.customerUser.findMany({
      where: { accountId, deletedAt: null },
      include: CUSTOMER_ROLE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDomain(r as unknown as PrismaCustomerUserRowWithRole));
  }

  async findByProjectId(projectId: string): Promise<CustomerUser[]> {
    const memberships = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        member: { include: CUSTOMER_ROLE_INCLUDE },
      },
    });
    return memberships.map((m) =>
      this.toDomain(m.member as unknown as PrismaCustomerUserRowWithRole)
    );
  }

  async findByInviteToken(token: string): Promise<Result<CustomerUser, DomainError>> {
    try {
      const row = await this.prisma.customerUser.findFirst({
        where: { inviteToken: token, deletedAt: null },
        include: CUSTOMER_ROLE_INCLUDE,
      });
      if (!row) {
        return err(new EntityNotFoundError("CustomerUser", `inviteToken:${token}`));
      }
      return ok(this.toDomain(row as unknown as PrismaCustomerUserRowWithRole));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "CustomerUser",
          `inviteToken query failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  async findByResetToken(token: string): Promise<Result<CustomerUser, DomainError>> {
    try {
      const row = await this.prisma.customerUser.findFirst({
        where: { resetToken: token, deletedAt: null },
        include: CUSTOMER_ROLE_INCLUDE,
      });
      if (!row) {
        return err(new EntityNotFoundError("CustomerUser", `resetToken:${token}`));
      }
      return ok(this.toDomain(row as unknown as PrismaCustomerUserRowWithRole));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "CustomerUser",
          `resetToken query failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  async save(user: CustomerUser, passwordHash?: string): Promise<Result<void, DomainError>> {
    try {
      const hash = passwordHash ?? user.passwordHash;
      // The `role` enum column mirrors customerRole.name (same string set).
      // Both are populated from the entity's roleName.
      const enumRole = user.roleName as "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";

      const baseData = {
        email: user.email,
        passwordHash: hash,
        firstName: user.firstName,
        lastName: user.lastName,
        role: enumRole,
        roleId: user.roleId,
        isActive: user.isActive,
        isEmailVerified: user.isEmailVerified,
        emailVerifyToken: user.emailVerifyToken ?? null,
        emailVerifyExpiry: user.emailVerifyExpiry ?? null,
        resetToken: user.resetToken ?? null,
        resetTokenExpiry: user.resetTokenExpiry ?? null,
        mfaEnabled: user.mfaEnabled,
        mfaSecret: user.mfaSecret ?? null,
        lastLoginAt: user.lastLoginAt ?? null,
        invitedBy: user.invitedBy ?? null,
        inviteToken: user.inviteToken ?? null,
        inviteTokenExpiry: user.inviteTokenExpiry ?? null,
        joinedAt: user.joinedAt,
        deletedAt: user.deletedAt ?? null,
      };

      await this.prisma.customerUser.upsert({
        where: { id: user.id },
        create: { id: user.id, accountId: user.accountId, ...baseData },
        update: baseData,
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "CustomerUser",
          `save failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string
  ): Promise<Result<void, DomainError>> {
    try {
      await this.prisma.customerUser.update({
        where: { id: userId },
        data: { passwordHash },
      });
      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "CustomerUser",
          `updatePasswordHash failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  async delete(userId: string): Promise<Result<void, DomainError>> {
    try {
      await this.prisma.customerUser.delete({ where: { id: userId } });
      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "CustomerUser",
          `${userId} (delete failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  /**
   * Map a Prisma row (with joined CustomerRole + permissions) to a CustomerUser
   * domain entity. If the role join is missing (data integrity issue or a row
   * with a null roleId), fall back to a "VIEWER-like" snapshot with no
   * permissions so the entity stays constructible.
   */
  private toDomain(row: PrismaCustomerUserRowWithRole): CustomerUser {
    const roleId = row.customerRole?.id ?? row.roleId ?? "";
    const roleName = row.customerRole?.name ?? "VIEWER";
    const roleLevel = row.customerRole?.level ?? 0;
    const permissions: ReadonlySet<string> = new Set(
      (row.customerRole?.permissions ?? []).map((p) => p.permission)
    );

    const props: CustomerUserProps = {
      id: row.id,
      accountId: row.accountId,
      email: row.email,
      passwordHash: row.passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      roleId,
      roleName,
      roleLevel,
      permissions,
      isActive: row.isActive,
      isEmailVerified: row.isEmailVerified,
      ...(row.emailVerifyToken !== null && { emailVerifyToken: row.emailVerifyToken }),
      ...(row.emailVerifyExpiry !== null && { emailVerifyExpiry: row.emailVerifyExpiry }),
      ...(row.resetToken !== null && { resetToken: row.resetToken }),
      ...(row.resetTokenExpiry !== null && { resetTokenExpiry: row.resetTokenExpiry }),
      mfaEnabled: row.mfaEnabled,
      ...(row.mfaSecret !== null && { mfaSecret: row.mfaSecret }),
      ...(row.lastLoginAt !== null && { lastLoginAt: row.lastLoginAt }),
      ...(row.invitedBy !== null && { invitedBy: row.invitedBy }),
      ...(row.inviteToken !== null && { inviteToken: row.inviteToken }),
      ...(row.inviteTokenExpiry !== null && { inviteTokenExpiry: row.inviteTokenExpiry }),
      joinedAt: row.joinedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.deletedAt !== null && { deletedAt: row.deletedAt }),
    };

    return CustomerUser.reconstitute(props);
  }
}
