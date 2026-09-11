/**
 * @file PrismaCustomerUserRepository.ts
 * @description Infrastructure adapter implementing CustomerUserRepository using
 *   Prisma. Maps between the persisted shape (CustomerUser + CustomerRole +
 *   CustomerRolePermission rows) and the CustomerUser domain entity, including
 *   the denormalised role snapshot fields (roleName, roleLevel, permissions).
 * @layer infrastructure
 */

import type { Prisma, PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import { CustomerUser, type CustomerUserProps } from "@core/domain/entities/CustomerUser.js";
import { EntityNotFoundError, type DomainError } from "@core/domain/errors/index.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import { authLogger } from "../../lib/logger.js";

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
 * Decide whether a failed write is the account/e-mail pair already being taken.
 *
 * Narrow on purpose. A creation can also collide on the row id or on an invite
 * token, and answering `EMAIL_EXISTS` to those would tell a caller something
 * false about what went wrong. Prisma reports the collided fields either as an
 * array of column names or as the constraint's own name, so both shapes are
 * read; the e-mail verification token is not part of the creation projection,
 * so it cannot be the constraint that matched here.
 */
function isEmailUniqueViolation(error: unknown): boolean {
  const raised = error as { code?: unknown; meta?: { target?: unknown } };
  if (raised?.code !== "P2002") return false;
  const target = raised.meta?.target;
  const fields = Array.isArray(target)
    ? target.join(",")
    : typeof target === "string"
      ? target
      : "";
  return fields.toLowerCase().includes("email");
}

/**
 * @class PrismaCustomerUserRepository
 * @description Adapter for CustomerUserRepository using Prisma.
 */
export class PrismaCustomerUserRepository implements CustomerUserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resolve the active Unit-of-Work transaction client, else the base client.
   * A query that reaches the base client while a transaction is open runs on a
   * SECOND pooled connection: it commits independently of the enclosing rollback,
   * and it passes the per-operation tenant binding unwrapped because the open
   * transaction already owns GUC adjudication for the connection it holds.
   */
  private getClient(): PrismaClient | Prisma.TransactionClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  /**
   * Report a write failure as what it is, without echoing what it was about.
   * A tenant-context failure carries `TENANT_CONTEXT_MISSING` /
   * `TENANT_CONTEXT_MISMATCH` on its `code`, so the logs keep a fail-closed
   * security signal distinguishable from an ordinary persistence error — which
   * the caller's response deliberately cannot do, since distinguishing them
   * would rebuild the token oracle.
   *
   * Only the error's name and code are recorded. A driver message can echo the
   * offending value, and on this path the offending value is a reset token.
   */
  private logWriteFailure(operation: string, error: unknown): void {
    const raised = error as { name?: unknown; code?: unknown };
    authLogger.error(
      {
        layer: "infrastructure",
        operation: `customerUser.${operation}`,
        error_name: typeof raised?.name === "string" ? raised.name : "UnknownError",
        ...(typeof raised?.code === "string" && { error_code: raised.code }),
      },
      "customer-user write failed"
    );
  }

  async findById(id: string): Promise<Result<CustomerUser, DomainError>> {
    try {
      const row = await this.getClient().customerUser.findFirst({
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
      const row = await this.getClient().customerUser.findFirst({
        where: { email: normalizeEmail(email), accountId, deletedAt: null },
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
    const rows = await this.getClient().customerUser.findMany({
      where: { email: normalizeEmail(email), deletedAt: null },
      include: CUSTOMER_ROLE_INCLUDE,
    });
    return rows.map((r) => this.toDomain(r as unknown as PrismaCustomerUserRowWithRole));
  }

  async findByAccountId(accountId: string): Promise<CustomerUser[]> {
    const rows = await this.getClient().customerUser.findMany({
      where: { accountId, deletedAt: null },
      include: CUSTOMER_ROLE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDomain(r as unknown as PrismaCustomerUserRowWithRole));
  }

  async findByProjectId(projectId: string): Promise<CustomerUser[]> {
    const memberships = await this.getClient().projectMember.findMany({
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
      const row = await this.getClient().customerUser.findFirst({
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

  async claimPasswordReset(
    token: string,
    newPasswordHash: string
  ): Promise<Result<void, "INVALID_TOKEN" | "INTERNAL_ERROR">> {
    try {
      // ONE conditional write. The predicate names the token, a strictly future
      // expiry and a live owner together, so the database decides who claims the
      // token — there is no window between deciding and writing for a second
      // caller to slip into. `resetToken` is globally unique, so a match caps at
      // one row by construction and `count` is the whole verdict.
      const { count } = await this.getClient().customerUser.updateMany({
        where: {
          resetToken: token,
          resetTokenExpiry: { gt: new Date() },
          deletedAt: null,
        },
        data: { passwordHash: newPasswordHash, resetToken: null, resetTokenExpiry: null },
      });

      // INVALID_TOKEN is reachable ONLY from the count gate. A throw below is a
      // failure to ASK the question, not an answer to it, and reporting it as a
      // bad token is what made a dead endpoint read as normal behaviour.
      return count === 1 ? ok(undefined) : err("INVALID_TOKEN");
    } catch (error: unknown) {
      this.logWriteFailure("claimPasswordReset", error);
      return err("INTERNAL_ERROR");
    }
  }

  async issueResetToken(
    userId: string,
    token: string,
    expiresAt: Date
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    try {
      const { count } = await this.getClient().customerUser.updateMany({
        where: { id: userId, deletedAt: null },
        data: { resetToken: token, resetTokenExpiry: expiresAt },
      });
      return count === 1 ? ok(undefined) : err("USER_NOT_FOUND");
    } catch (error: unknown) {
      this.logWriteFailure("issueResetToken", error);
      return err("INTERNAL_ERROR");
    }
  }

  async create(
    user: CustomerUser,
    passwordHash: string
  ): Promise<Result<void, "EMAIL_EXISTS" | "INTERNAL_ERROR">> {
    try {
      await this.getClient().customerUser.create({
        data: {
          id: user.id,
          accountId: user.accountId,
          // Both e-mail reads normalize their argument, so the write must store
          // the same form or they stop finding this row.
          email: normalizeEmail(user.email),
          passwordHash,
          firstName: user.firstName,
          lastName: user.lastName,
          // The role is persisted solely via the `roleId` FK to CustomerRole.
          // An empty roleId is the `toDomain` fallback for a role-less row; it
          // must be written as NULL, never "", which would violate the FK.
          roleId: user.roleId === "" ? null : user.roleId,
          isActive: user.isActive,
          isEmailVerified: user.isEmailVerified,
          invitedBy: user.invitedBy ?? null,
          inviteToken: user.inviteToken ?? null,
          inviteTokenExpiry: user.inviteTokenExpiry ?? null,
          joinedAt: user.joinedAt,
        },
      });
      return ok(undefined);
    } catch (error: unknown) {
      if (isEmailUniqueViolation(error)) {
        return err("EMAIL_EXISTS");
      }
      this.logWriteFailure("create", error);
      return err("INTERNAL_ERROR");
    }
  }

  async recordLogin(
    userId: string,
    at: Date
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    return this.updateOneLiveRow("recordLogin", userId, { lastLoginAt: at });
  }

  async upgradePasswordHash(
    userId: string,
    newHash: string
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    return this.updateOneLiveRow("upgradePasswordHash", userId, { passwordHash: newHash });
  }

  async changeRole(
    userId: string,
    roleId: string
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    return this.updateOneLiveRow("changeRole", userId, { roleId });
  }

  async deactivate(userId: string): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    return this.updateOneLiveRow("deactivate", userId, { isActive: false });
  }

  /**
   * The shared body of every single-intent update: one count-gated `updateMany`
   * naming the caller's columns and a live owner, with the count as the whole
   * verdict. Sharing it is what makes the column projection the ONLY thing that
   * differs between these commands, so the declared write set of each is
   * readable at its call site instead of buried in a repeated try/catch.
   */
  private async updateOneLiveRow(
    operation: string,
    userId: string,
    // The unchecked variant is the one that admits scalar foreign keys such as
    // `roleId`; the checked variant models the relation instead and would leave
    // `changeRole` unable to name the column it exists to write.
    data: Prisma.CustomerUserUncheckedUpdateManyInput
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    try {
      const { count } = await this.getClient().customerUser.updateMany({
        where: { id: userId, deletedAt: null },
        data,
      });
      return count === 1 ? ok(undefined) : err("USER_NOT_FOUND");
    } catch (error: unknown) {
      this.logWriteFailure(operation, error);
      return err("INTERNAL_ERROR");
    }
  }

  async save(user: CustomerUser, passwordHash?: string): Promise<Result<void, DomainError>> {
    try {
      const hash = passwordHash ?? user.passwordHash;

      const baseData = {
        // Both reads above normalize their argument, so the write must store
        // the same form or they stop finding this row. `CustomerUser.create`
        // already normalizes, but `reconstitute` does not — it replays whatever
        // the row held — so relying on the entity alone would let a legacy
        // mixed-case row survive a round-trip through `save` unchanged.
        email: normalizeEmail(user.email),
        passwordHash: hash,
        firstName: user.firstName,
        lastName: user.lastName,
        // The role is persisted solely via the `roleId` FK to CustomerRole —
        // there is no scalar `role` column on CustomerUser. An empty roleId is
        // the `toDomain` fallback for a role-less row (the "VIEWER-like"
        // snapshot); it must be written as NULL, never "", which would violate
        // the optional FK.
        roleId: user.roleId === "" ? null : user.roleId,
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

      await this.getClient().customerUser.upsert({
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
      await this.getClient().customerUser.update({
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
      await this.getClient().customerUser.delete({ where: { id: userId } });
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
