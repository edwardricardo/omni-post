/**
 * @file PrismaCustomerUserRepository.ts
 * @description Infrastructure adapter implementing CustomerUserRepository using
 *   Prisma. Maps between the persisted shape (CustomerUser + CustomerRole +
 *   CustomerRolePermission rows) and the CustomerUser domain entity, including
 *   the denormalised role snapshot fields (roleName, roleLevel, permissions).
 * @layer infrastructure
 */

import type { Prisma, PrismaClient } from "@infra/prisma";
import { isUniqueViolationOf } from "@infra/prisma/extensions/constraintViolation.js";
import { type Result, ok, err } from "@shared/types";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import { CustomerUser, type CustomerUserProps } from "@core/domain/entities/CustomerUser.js";
import { EntityNotFoundError, type DomainError } from "@core/domain/errors/index.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
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
 * The account/e-mail unique of `CustomerUser`, as the migrations name it.
 *
 * Narrow on purpose. A creation can also collide on the row id or on an invite
 * token, and answering `EMAIL_EXISTS` to those would tell a caller something
 * false about what went wrong, so only this constraint is matched, by its name
 * or by its exact columns (`isUniqueViolationOf` reads both shapes the driver
 * adapter reports, and refuses any other).
 */
const ACCOUNT_EMAIL_UNIQUE = {
  index: "CustomerUser_accountId_email_key",
  fields: ["accountId", "email"],
} as const;

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

  /**
   * @method findById
   * @description Reads one live customer user, with its role snapshot, by id.
   * @param id - The customer user's id.
   * @returns The user, or EntityNotFoundError when no live row has that id or the read failed.
   */
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

  /**
   * @method findByEmail
   * @description Reads the live customer user holding an e-mail within one account, comparing the
   *   normalized address.
   * @param email - The address, normalized before the comparison.
   * @param accountId - The account the user belongs to.
   * @returns The user, or EntityNotFoundError when no live row matches or the read failed.
   */
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

  /**
   * @method findByEmailAcrossAccounts
   * @description Reads every live customer user holding an e-mail, in any account.
   * @param email - The address, normalized before the comparison.
   * @returns The matching users; empty when none holds the address.
   */
  async findByEmailAcrossAccounts(email: string): Promise<CustomerUser[]> {
    const rows = await this.getClient().customerUser.findMany({
      where: { email: normalizeEmail(email), deletedAt: null },
      include: CUSTOMER_ROLE_INCLUDE,
    });
    return rows.map((r) => this.toDomain(r as unknown as PrismaCustomerUserRowWithRole));
  }

  /**
   * DELIBERATE soft-delete-sweep exception: the read targets SOFT-DELETED users
   * (`NOT: { deletedAt: null }`) because registration must tell an address that belongs to a
   * deleted user apart from a free one, and every other read here hides those rows. It
   * answers a count, so nothing about the deleted row leaves the repository.
   *
   * @method existsDeletedByEmailAcrossAccounts
   * @description Answers whether a soft-deleted customer user, in any account, holds an
   *   e-mail.
   * @param email - The address, normalized before the comparison.
   * @returns True when at least one soft-deleted customer user carries the address.
   */
  async existsDeletedByEmailAcrossAccounts(email: string): Promise<boolean> {
    const count = await this.getClient().customerUser.count({
      where: { email: normalizeEmail(email), NOT: { deletedAt: null } },
    });
    return count > 0;
  }

  /**
   * @method findByAccountId
   * @description Reads every live customer user of one account.
   * @param accountId - The account whose users are read.
   * @returns The account's live users.
   */
  async findByAccountId(accountId: string): Promise<CustomerUser[]> {
    const rows = await this.getClient().customerUser.findMany({
      where: { accountId, deletedAt: null },
      include: CUSTOMER_ROLE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDomain(r as unknown as PrismaCustomerUserRowWithRole));
  }

  /**
   * @method findByProjectId
   * @description Reads the customer users who are members of one project, through its membership
   *   rows.
   * @param projectId - The project whose members are read.
   * @returns The members, each with its role snapshot.
   */
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

  /**
   * @method findByInviteToken
   * @description Reads the live customer user an invitation token belongs to.
   * @param token - The invitation token.
   * @returns The invitee, or EntityNotFoundError when no live row holds the token or the read
   *   failed.
   */
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

  /**
   * @method claimPasswordReset
   * @description Consumes a password-reset token in one conditional write that also stores the new
   *   hash, so two presentations of one token cannot both succeed.
   * @param token - The reset token presented.
   * @param newPasswordHash - The hash to store when the claim succeeds.
   * @returns Ok when exactly one live row held the unexpired token; INVALID_TOKEN otherwise;
   *   INTERNAL_ERROR when the write could not be made.
   */
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

  /**
   * @method issueResetToken
   * @description Stores a new password-reset token and its expiry on one live customer user.
   * @param userId - The user the token is issued to.
   * @param token - The reset token.
   * @param expiresAt - When the token stops being claimable.
   * @returns Ok, USER_NOT_FOUND when no live row has that id, or INTERNAL_ERROR.
   */
  async issueResetToken(
    userId: string,
    token: string,
    expiresAt: Date
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    return this.updateOneLiveRow("issueResetToken", userId, {
      resetToken: token,
      resetTokenExpiry: expiresAt,
    });
  }

  /**
   * @method create
   * @description Inserts a new customer user. A collision on the account and e-mail unique is a
   *   typed conflict; any other failure, including a collision on another constraint, is internal.
   * @param user - The user to create.
   * @param passwordHash - The credential to store, the empty stub for an invitee.
   * @returns Ok, EMAIL_EXISTS when the account already holds the address, or INTERNAL_ERROR.
   */
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
      if (isUniqueViolationOf(error, ACCOUNT_EMAIL_UNIQUE)) {
        return err("EMAIL_EXISTS");
      }
      this.logWriteFailure("create", error);
      return err("INTERNAL_ERROR");
    }
  }

  /**
   * @method recordLogin
   * @description Stores the instant of a successful login on one live customer user.
   * @param userId - The user who logged in.
   * @param at - The login instant.
   * @returns Ok, USER_NOT_FOUND when no live row has that id, or INTERNAL_ERROR.
   */
  async recordLogin(
    userId: string,
    at: Date
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    return this.updateOneLiveRow("recordLogin", userId, { lastLoginAt: at });
  }

  /**
   * @method upgradePasswordHash
   * @description Replaces one live customer user's password hash with a rehash of the same
   *   password.
   * @param userId - The user whose hash is upgraded.
   * @param newHash - The new hash.
   * @returns Ok, USER_NOT_FOUND when no live row has that id, or INTERNAL_ERROR.
   */
  async upgradePasswordHash(
    userId: string,
    newHash: string
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    return this.updateOneLiveRow("upgradePasswordHash", userId, { passwordHash: newHash });
  }

  /**
   * @method changeRole
   * @description Points one live customer user at another role.
   * @param userId - The user whose role changes.
   * @param roleId - The new role's id.
   * @returns Ok, USER_NOT_FOUND when no live row has that id, or INTERNAL_ERROR.
   */
  async changeRole(
    userId: string,
    roleId: string
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    return this.updateOneLiveRow("changeRole", userId, { roleId });
  }

  /**
   * @method deactivate
   * @description Marks one live customer user inactive.
   * @param userId - The user to deactivate.
   * @returns Ok, USER_NOT_FOUND when no live row has that id, or INTERNAL_ERROR.
   */
  async deactivate(userId: string): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">> {
    return this.updateOneLiveRow("deactivate", userId, { isActive: false });
  }

  /**
   * The shared body of EVERY single-intent update: one count-gated `updateMany`
   * naming the caller's columns and a live owner, with the count as the whole
   * verdict. Sharing it is what makes the column projection the ONLY thing that
   * differs between these commands, so the declared write set of each is
   * readable at its call site instead of buried in a repeated try/catch.
   *
   * Every one of them routes through here, `issueResetToken` included. A command
   * that kept a private copy of this body would be outside the invariant the
   * body carries: a later change to the predicate — the live-owner clause, the
   * count gate, what a throw is allowed to become — would apply to five commands
   * and silently miss the sixth. One command writing the same columns two ways,
   * with neither authoritative, is the exact shape this API exists to delete.
   *
   * `claimPasswordReset` is NOT here, and that is not an exception: it selects by
   * a globally-unique token rather than by id, and answers `INVALID_TOKEN` rather
   * than `USER_NOT_FOUND`. A different predicate and a different verdict is a
   * different command, not a variation on this one.
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

  /**
   * @method delete
   * @description Deletes one customer user's row.
   * @param userId - The user to delete.
   * @returns Ok, or EntityNotFoundError when the delete failed.
   */
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
