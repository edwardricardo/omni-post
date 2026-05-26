/**
 * @file PrismaAdminUserRepository.ts
 * @description Prisma adapter implementing AdminUserRepositoryPort.
 *              Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma, AdminUser, Role } from "@infra/prisma";
import { ok, err } from "@shared/types";
import type { Result } from "@shared/types";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import type {
  AdminUserRepositoryPort,
  AdminUserCreateInput,
  AdminUserUpdate,
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
   * Find an admin user and verify they are active.
   *
   * Looks up by ID (default) or email. Email is normalized to lowercase
   * before the query so the caller does not need to pre-normalize.
   */
  async findActiveUser(
    identifier: string,
    type: "email" | "id" = "id"
  ): Promise<Result<AdminUserDto, "NOT_FOUND" | "USER_INACTIVE">> {
    const user = await this.prisma.adminUser.findUnique({
      where: type === "email" ? { email: identifier.toLowerCase() } : { id: identifier },
      include: { role: true },
    });

    if (!user) return err("NOT_FOUND");
    if (!user.isActive) return err("USER_INACTIVE");

    return ok(toDto(user));
  }

  /**
   * Find an admin user by ID without performing an active-status check.
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
   * Find an admin user by email address.
   * Email is normalized to lowercase before the query.
   */
  async findByEmail(email: string): Promise<Result<AdminUserDto, "NOT_FOUND">> {
    const user = await this.prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true },
    });

    if (!user) return err("NOT_FOUND");
    return ok(toDto(user));
  }

  /**
   * Find an admin user by ID including credential material.
   * For the authentication and MFA flows only.
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
   * Find an admin user by email including credential material.
   * Email is normalized to lowercase before the query. For the login flow only.
   */
  async findCredentialsByEmail(
    email: string
  ): Promise<Result<AdminUserCredentialsDto, "NOT_FOUND">> {
    const user = await this.prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true },
    });

    if (!user) return err("NOT_FOUND");
    return ok(toCredentialsDto(user));
  }

  /**
   * Validate that a given user record is active (synchronous guard).
   * Does not perform any I/O — operates on the already-fetched user object.
   */
  validateActive(user: AdminUserDto): Result<void, "USER_INACTIVE"> {
    if (!user.isActive) return err("USER_INACTIVE");
    return ok(undefined);
  }

  /**
   * Retrieve multiple users by their IDs in a single query.
   * Both active and inactive users are returned.
   * Non-existent IDs are silently omitted.
   */
  async findManyByIds(ids: string[]): Promise<AdminUserDto[]> {
    const users = await this.prisma.adminUser.findMany({
      where: { id: { in: ids } },
      include: { role: true },
    });
    return users.map(toDto);
  }

  /**
   * Persist a new admin user with the role relation eagerly loaded.
   *
   * @param input - Creation fields including the resolved roleId
   * @returns The created user mapped to AdminUserDto
   */
  async create(input: AdminUserCreateInput): Promise<AdminUserDto> {
    const user = await this.getClient().adminUser.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        name: input.name,
        roleId: input.roleId,
        ...(input.emailVerified !== undefined && { emailVerified: input.emailVerified }),
      },
      include: { role: true },
    });
    return toDto(user);
  }

  /**
   * Apply a partial update to an admin user.
   *
   * @param id - AdminUser primary key
   * @param data - Fields to change; `null` clears a nullable field, omitted
   *               keys are untouched
   * @returns The updated user mapped to AdminUserDto
   */
  async update(id: string, data: AdminUserUpdate): Promise<AdminUserDto> {
    const updateData: Prisma.AdminUserUncheckedUpdateInput = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.email !== undefined && { email: data.email }),
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
   * List every admin user (active and inactive), oldest first.
   */
  async findAll(): Promise<AdminUserDto[]> {
    const users = await this.prisma.adminUser.findMany({
      include: { role: true },
      orderBy: { createdAt: "asc" },
    });
    return users.map(toDto);
  }

  /**
   * List all admin users assigned to a given role, newest first.
   *
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
   * Permanently delete an admin user.
   *
   * @param id - AdminUser primary key
   */
  async delete(id: string): Promise<void> {
    await this.getClient().adminUser.delete({ where: { id } });
  }
}
