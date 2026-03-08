/**
 * Infrastructure Layer - PrismaAdminUserRepository
 *
 * Prisma adapter that implements the AdminUserRepositoryPort.
 * Receives PrismaClient via constructor injection — never imports the singleton.
 *
 * Replaces the legacy apps/api/src/repositories/UserRepository.ts singleton
 * as part of the R1-A hexagonal architecture migration.
 */

import type { PrismaClient, AdminUser } from "@infra/prisma";
import { ok, err } from "@shared/types";
import type { Result } from "@shared/types";
import type { AdminUserRepositoryPort } from "../../domain/repositories/AdminUserRepository.js";
import type { AdminUserDto } from "../../domain/repositories/ReadModelDtos.js";

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Map a Prisma AdminUser row to the domain AdminUserDto.
 *
 * Prisma enums (AdminRole) are represented as string values at runtime —
 * this cast is safe because AdminRoleKind is the exact same set of string
 * literals as the Prisma-generated AdminRole enum values.
 */
function toDto(user: AdminUser): AdminUserDto {
  return user as unknown as AdminUserDto;
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
    });

    if (!user) return err("NOT_FOUND");
    return ok(toDto(user));
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
    });
    return users.map(toDto);
  }
}
