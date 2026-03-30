/**
 * @file PrismaCustomerUserRepository.ts
 * @description Infrastructure adapter implementing CustomerUserRepository port
 *   using Prisma ORM. Maps between Prisma database types and CustomerUser domain entity.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { CustomerUserRepository } from "../../domain/repositories/CustomerUserRepository.js";
import {
  CustomerUser,
  type CustomerUserProps,
  type CustomerRoleValue,
} from "../../domain/entities/CustomerUser.js";
import { EntityNotFoundError, type DomainError } from "../../domain/errors/index.js";

/**
 * Raw Prisma row shape for type-safe mapping.
 */
interface PrismaCustomerUserRow {
  id: string;
  accountId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  isEmailVerified: boolean;
  emailVerifyToken: string | null;
  emailVerifyExpiry: Date | null;
  resetToken: string | null;
  resetTokenExpiry: Date | null;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * @class PrismaCustomerUserRepository
 * @description Adapter for CustomerUserRepository using Prisma.
 */
export class PrismaCustomerUserRepository implements CustomerUserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a customer user by ID (excludes soft-deleted).
   */
  async findById(id: string): Promise<Result<CustomerUser, DomainError>> {
    try {
      const row = await this.prisma.customerUser.findFirst({
        where: { id, deletedAt: null },
      });

      if (!row) {
        return err(new EntityNotFoundError("CustomerUser", id));
      }

      return ok(this.toDomain(row as unknown as PrismaCustomerUserRow));
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
   * @description Finds a non-deleted customer user by email within an account.
   */
  async findByEmail(email: string, accountId: string): Promise<Result<CustomerUser, DomainError>> {
    try {
      const row = await this.prisma.customerUser.findFirst({
        where: {
          email: email.toLowerCase().trim(),
          accountId,
          deletedAt: null,
        },
      });

      if (!row) {
        return err(new EntityNotFoundError("CustomerUser", email));
      }

      return ok(this.toDomain(row as unknown as PrismaCustomerUserRow));
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
   * @description Finds all non-deleted customer users with a given email.
   */
  async findByEmailAcrossAccounts(email: string): Promise<CustomerUser[]> {
    const rows = await this.prisma.customerUser.findMany({
      where: {
        email: email.toLowerCase().trim(),
        deletedAt: null,
      },
    });

    return rows.map((r) => this.toDomain(r as unknown as PrismaCustomerUserRow));
  }

  /**
   * @method findByAccountId
   * @description Lists all non-deleted customer users for an account.
   */
  async findByAccountId(accountId: string): Promise<CustomerUser[]> {
    const rows = await this.prisma.customerUser.findMany({
      where: { accountId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((r) => this.toDomain(r as unknown as PrismaCustomerUserRow));
  }

  /**
   * @method findByResetToken
   * @description Finds a non-deleted customer user by their password reset token.
   */
  async findByResetToken(token: string): Promise<Result<CustomerUser, DomainError>> {
    try {
      const row = await this.prisma.customerUser.findFirst({
        where: { resetToken: token, deletedAt: null },
      });

      if (!row) {
        return err(new EntityNotFoundError("CustomerUser", `resetToken:${token}`));
      }

      return ok(this.toDomain(row as unknown as PrismaCustomerUserRow));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "CustomerUser",
          `resetToken query failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method save
   * @description Upserts a customer user record.
   */
  async save(user: CustomerUser, passwordHash?: string): Promise<Result<void, DomainError>> {
    try {
      const hash = passwordHash ?? user.passwordHash;
      await this.prisma.customerUser.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          accountId: user.accountId,
          email: user.email,
          passwordHash: hash,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isActive: user.isActive,
          isEmailVerified: user.isEmailVerified,
          emailVerifyToken: user.emailVerifyToken ?? null,
          emailVerifyExpiry: user.emailVerifyExpiry ?? null,
          resetToken: user.resetToken ?? null,
          resetTokenExpiry: user.resetTokenExpiry ?? null,
          mfaEnabled: user.mfaEnabled,
          mfaSecret: user.mfaSecret ?? null,
          lastLoginAt: user.lastLoginAt ?? null,
          deletedAt: user.deletedAt ?? null,
        },
        update: {
          email: user.email,
          passwordHash: hash,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isActive: user.isActive,
          isEmailVerified: user.isEmailVerified,
          emailVerifyToken: user.emailVerifyToken ?? null,
          emailVerifyExpiry: user.emailVerifyExpiry ?? null,
          resetToken: user.resetToken ?? null,
          resetTokenExpiry: user.resetTokenExpiry ?? null,
          mfaEnabled: user.mfaEnabled,
          mfaSecret: user.mfaSecret ?? null,
          lastLoginAt: user.lastLoginAt ?? null,
          deletedAt: user.deletedAt ?? null,
        },
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

  /**
   * @method updatePasswordHash
   * @description Updates only the password hash for a user.
   */
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

  /**
   * @method delete
   * @description Hard-deletes a customer user record.
   */
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
   * @method toDomain
   * @description Maps a Prisma row to a CustomerUser domain entity.
   */
  private toDomain(row: PrismaCustomerUserRow): CustomerUser {
    const props: CustomerUserProps = {
      id: row.id,
      accountId: row.accountId,
      email: row.email,
      passwordHash: row.passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role as CustomerRoleValue,
      isActive: row.isActive,
      isEmailVerified: row.isEmailVerified,
      ...(row.emailVerifyToken !== null && { emailVerifyToken: row.emailVerifyToken }),
      ...(row.emailVerifyExpiry !== null && { emailVerifyExpiry: row.emailVerifyExpiry }),
      ...(row.resetToken !== null && { resetToken: row.resetToken }),
      ...(row.resetTokenExpiry !== null && { resetTokenExpiry: row.resetTokenExpiry }),
      mfaEnabled: row.mfaEnabled,
      ...(row.mfaSecret !== null && { mfaSecret: row.mfaSecret }),
      ...(row.lastLoginAt !== null && { lastLoginAt: row.lastLoginAt }),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.deletedAt !== null && { deletedAt: row.deletedAt }),
    };

    return CustomerUser.reconstitute(props);
  }
}
