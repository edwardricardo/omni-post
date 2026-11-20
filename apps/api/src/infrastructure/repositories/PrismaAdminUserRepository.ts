/**
 * @file PrismaAdminUserRepository.ts
 * @description Prisma adapter implementing AdminUserRepositoryPort.
 *              Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma, AdminUser, Role } from "@infra/prisma";
import { ok, err } from "@shared/types";
import type { Result } from "@shared/types";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";
import { RepositoryFailureError } from "@core/domain/errors/RepositoryFailureError.js";
import type {
  AdminUserRepositoryPort,
  AdminUserCreateInput,
  AdminUserUpdate,
  SingleUsePasswordReplacement,
} from "@core/domain/repositories/AdminUserRepository.js";
import type {
  AdminUserDto,
  AdminUserCredentialsDto,
} from "@core/domain/repositories/ReadModelDtos.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Prisma AdminUser row with the role relation eagerly loaded. */
type AdminUserWithRole = AdminUser & { role: Role };

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Map a Prisma AdminUser row to the credential-free public AdminUserDto. The
 * credential columns are destructured out so they are physically absent from
 * the returned object, not merely hidden by the type.
 *
 * The Role table stores role names as strings ("SUPER_ADMIN", "ADMIN", etc.)
 * and the DTO exposes the name directly via the `role` field.
 */
function toDto(user: AdminUserWithRole): AdminUserDto {
  const {
    role: _roleRelation,
    roleId: _roleId,
    passwordHash: _passwordHash,
    passwordResetToken: _passwordResetToken,
    passwordResetExpires: _passwordResetExpires,
    mfaSecret: _mfaSecret,
    passwordHistory: _passwordHistory,
    mfaBackupCodes: _mfaBackupCodes,
    mfaBackupUsedAt: _mfaBackupUsedAt,
    ...rest
  } = user;
  return { ...rest, role: user.role.name } as unknown as AdminUserDto;
}

/**
 * Map a Prisma AdminUser row to AdminUserCredentialsDto, retaining the
 * credential columns. For the credential-bearing reads only.
 */
function toCredentialsDto(user: AdminUserWithRole): AdminUserCredentialsDto {
  const { role: _roleRelation, roleId: _roleId, ...rest } = user;
  return { ...rest, role: user.role.name } as unknown as AdminUserCredentialsDto;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Prisma implementation of AdminUserRepositoryPort.
 *
 * Register as a singleton in the DI container via TOKENS.AdminUserRepository.
 */
export class PrismaAdminUserRepository implements AdminUserRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /** Resolve the active UoW transaction client, or the base client. */
  private getClient(): PrismaClient | Prisma.TransactionClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  /**
   * @method findActiveUser
   * @description Find an admin user and verify they are active. Looks up by ID
   *   (default) or email. Email is reduced to its canonical identity form before
   *   the query so the caller does not need to pre-normalize.
   * @param identifier - User ID or email address
   * @param type - Lookup type: "id" (default) or "email"
   * @returns Ok(user) when found and active, Err("NOT_FOUND") when no user
   *   matches, Err("USER_INACTIVE") when the user is not active
   */
  async findActiveUser(
    identifier: string,
    type: "email" | "id" = "id"
  ): Promise<Result<AdminUserDto, "NOT_FOUND" | "USER_INACTIVE">> {
    const user = await this.prisma.adminUser.findUnique({
      where: type === "email" ? { email: normalizeEmail(identifier) } : { id: identifier },
      include: { role: true },
    });

    if (!user) return err("NOT_FOUND");
    if (!user.isActive) return err("USER_INACTIVE");

    return ok(toDto(user));
  }

  /**
   * @method findById
   * @description Find an admin user by ID without performing an active-status check.
   * @param id - AdminUser primary key
   * @returns Ok(user) when found, Err("NOT_FOUND") otherwise
   */
  async findById(id: string): Promise<Result<AdminUserDto, "NOT_FOUND">> {
    const user = await this.prisma.adminUser.findUnique({
      where: { id },
      include: { role: true },
    });

    if (!user) return err("NOT_FOUND");
    return ok(toDto(user));
  }

  /**
   * @method findByEmail
   * @description Find an admin user by email address. Email is reduced to its
   *   canonical identity form before the query.
   * @param email - Email address to look up
   * @returns Ok(user) when found, Err("NOT_FOUND") otherwise
   */
  async findByEmail(email: string): Promise<Result<AdminUserDto, "NOT_FOUND">> {
    const user = await this.prisma.adminUser.findUnique({
      where: { email: normalizeEmail(email) },
      include: { role: true },
    });

    if (!user) return err("NOT_FOUND");
    return ok(toDto(user));
  }

  /**
   * @method findCredentialsById
   * @description Find an admin user by ID including credential material. For
   *   the authentication and MFA flows only.
   * @param id - AdminUser primary key
   * @returns Ok(user with credentials) when found, Err("NOT_FOUND") otherwise
   */
  async findCredentialsById(id: string): Promise<Result<AdminUserCredentialsDto, "NOT_FOUND">> {
    const user = await this.prisma.adminUser.findUnique({
      where: { id },
      include: { role: true },
    });

    if (!user) return err("NOT_FOUND");
    return ok(toCredentialsDto(user));
  }

  /**
   * @method findCredentialsByEmail
   * @description Find an admin user by email including credential material.
   *   Email is reduced to its canonical identity form before the query. For the
   *   login flow only.
   * @param email - Email address to look up
   * @returns Ok(user with credentials) when found, Err("NOT_FOUND") otherwise
   */
  async findCredentialsByEmail(
    email: string
  ): Promise<Result<AdminUserCredentialsDto, "NOT_FOUND">> {
    const user = await this.prisma.adminUser.findUnique({
      where: { email: normalizeEmail(email) },
      include: { role: true },
    });

    if (!user) return err("NOT_FOUND");
    return ok(toCredentialsDto(user));
  }

  /**
   * @method validateActive
   * @description Validate that a given user record is active (synchronous
   *   guard). Does not perform any I/O — operates on the already-fetched user
   *   object.
   * @param user - AdminUserDto record already retrieved from storage
   * @returns Ok(undefined) when active, Err("USER_INACTIVE") when not
   */
  validateActive(user: AdminUserDto): Result<void, "USER_INACTIVE"> {
    if (!user.isActive) return err("USER_INACTIVE");
    return ok(undefined);
  }

  /**
   * @method findManyByIds
   * @description Retrieve multiple users by their IDs in a single query. Both
   *   active and inactive users are returned. Non-existent IDs are silently
   *   omitted.
   * @param ids - Array of AdminUser primary keys
   * @returns The matching users mapped to AdminUserDto, order not guaranteed
   */
  async findManyByIds(ids: string[]): Promise<AdminUserDto[]> {
    const users = await this.prisma.adminUser.findMany({
      where: { id: { in: ids } },
      include: { role: true },
    });
    return users.map(toDto);
  }

  /**
   * @method existsAny
   * @description Says whether any admin user row exists, active or not: the
   *   query filters on nothing and reads one id. It runs on the Unit of Work's
   *   client, so inside an open transaction it reads through that transaction.
   * @returns Ok(true) when a row exists, Ok(false) when none does, or
   *   Err(RepositoryFailureError) whose cause is what the client raised
   */
  async existsAny(): Promise<Result<boolean, RepositoryFailureError>> {
    try {
      const row = await this.getClient().adminUser.findFirst({ select: { id: true } });
      return ok(row !== null);
    } catch (error: unknown) {
      return err(new RepositoryFailureError("Reading whether an admin user exists failed", error));
    }
  }

  /**
   * @method create
   * @description Persist a new admin user with the role relation eagerly
   *   loaded, on the Unit of Work's client when a transaction is open. An
   *   optional field the input omits is not sent, so the column's default applies.
   * @param input - Creation fields including the resolved roleId
   * @returns The created user mapped to AdminUserDto
   */
  async create(input: AdminUserCreateInput): Promise<AdminUserDto> {
    const user = await this.getClient().adminUser.create({
      data: {
        // Normalized on the way IN so the reads above, which normalize their
        // argument, can actually find this row. Storing raw here while reading
        // lowercased made a mixed-case admin invisible to every lookup.
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        name: input.name,
        roleId: input.roleId,
        ...(input.emailVerified !== undefined && { emailVerified: input.emailVerified }),
        ...(input.mustChangePassword !== undefined && {
          mustChangePassword: input.mustChangePassword,
        }),
      },
      include: { role: true },
    });
    return toDto(user);
  }

  /**
   * @method update
   * @description Apply a partial update to an admin user.
   * @param id - AdminUser primary key
   * @param data - Fields to change; `null` clears a nullable field, omitted
   *               keys are untouched
   * @returns The updated user mapped to AdminUserDto
   */
  async update(id: string, data: AdminUserUpdate): Promise<AdminUserDto> {
    const updateData: Prisma.AdminUserUncheckedUpdateInput = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.email !== undefined && { email: normalizeEmail(data.email) }),
      ...(data.passwordHash !== undefined && { passwordHash: data.passwordHash }),
      ...(data.roleId !== undefined && { roleId: data.roleId }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.emailVerified !== undefined && { emailVerified: data.emailVerified }),
      ...(data.lastLoginAt !== undefined && { lastLoginAt: data.lastLoginAt }),
      ...(data.mfaEnabled !== undefined && { mfaEnabled: data.mfaEnabled }),
      ...(data.mfaSecret !== undefined && { mfaSecret: data.mfaSecret }),
      ...(data.passwordResetToken !== undefined && {
        passwordResetToken: data.passwordResetToken,
      }),
      ...(data.passwordResetExpires !== undefined && {
        passwordResetExpires: data.passwordResetExpires,
      }),
      ...(data.department !== undefined && { department: data.department }),
      ...(data.team !== undefined && { team: data.team }),
      ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
    };
    const user = await this.getClient().adminUser.update({
      where: { id },
      data: updateData,
      include: { role: true },
    });
    return toDto(user);
  }

  /**
   * @method replaceSingleUsePassword
   * @description Replaces the single-use password of an administrator who has never signed in
   *   and must still change it, on the Unit of Work's client, and clears a pending password
   *   reset as the reset's confirmation does, so a link issued before no longer sets the
   *   password. The predicate names the id, the hash and the reset token as read, the mark and
   *   the empty sign-in date, so the database decides whether the row is still the one that was
   *   read: under Read Committed a concurrent committed writer makes the update re-check these
   *   columns, and the loser matches no row. The mark, the sign-in date, the password history
   *   and the hash's algorithm are not written.
   * @param replacement - The administrator, the hash and the reset token as read, and the new
   *   hash
   * @returns Ok(true) when one row was written, Ok(false) when none matched, or
   *   Err(RepositoryFailureError) whose cause is what the client raised
   */
  async replaceSingleUsePassword(
    replacement: SingleUsePasswordReplacement
  ): Promise<Result<boolean, RepositoryFailureError>> {
    try {
      const { count } = await this.getClient().adminUser.updateMany({
        where: {
          id: replacement.id,
          passwordHash: replacement.currentPasswordHash,
          passwordResetToken: replacement.currentPasswordResetToken,
          mustChangePassword: true,
          lastLoginAt: null,
        },
        data: {
          passwordHash: replacement.passwordHash,
          passwordChangedAt: new Date(),
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      });
      return ok(count === 1);
    } catch (error: unknown) {
      return err(
        new RepositoryFailureError("Replacing an admin user's single-use password failed", error)
      );
    }
  }

  /**
   * @method findAll
   * @description List every admin user (active and inactive), oldest first.
   * @returns All admin users mapped to AdminUserDto
   */
  async findAll(): Promise<AdminUserDto[]> {
    const users = await this.prisma.adminUser.findMany({
      include: { role: true },
      orderBy: { createdAt: "asc" },
    });
    return users.map(toDto);
  }

  /**
   * @method findByRoleId
   * @description List all admin users assigned to a given role, newest first.
   * @param roleId - Role primary key
   * @returns Matching users mapped to AdminUserDto, ordered by createdAt desc
   */
  async findByRoleId(roleId: string): Promise<AdminUserDto[]> {
    const users = await this.prisma.adminUser.findMany({
      where: { roleId },
      include: { role: true },
      orderBy: { createdAt: "desc" },
    });
    return users.map(toDto);
  }

  /**
   * @method delete
   * @description Permanently delete an admin user.
   * @param id - AdminUser primary key
   */
  async delete(id: string): Promise<void> {
    await this.getClient().adminUser.delete({ where: { id } });
  }
}
