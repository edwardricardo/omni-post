/**
 * @file AdminUserRepository.ts
 * @description Repository port for admin user lookup operations — defines the contract for finding and verifying active admin users by ID or email.
 * @layer domain
 */

import type { AdminUserDto, AdminUserCredentialsDto } from "./ReadModelDtos.js";
import type { Result } from "@shared/types";

/**
 * Fields required to create a new admin user.
 * Role is referenced by its primary key (resolved from a role name by the caller).
 */
export interface AdminUserCreateInput {
  email: string;
  passwordHash: string;
  name: string;
  roleId: string;
  emailVerified?: boolean;
}

/**
 * Partial update payload for an admin user.
 * Nullable fields (`mfaSecret`, `passwordResetToken`, `passwordResetExpires`)
 * accept `null` to clear the stored value; omit a key to leave it unchanged.
 */
export interface AdminUserUpdate {
  name?: string;
  email?: string;
  passwordHash?: string;
  roleId?: string;
  isActive?: boolean;
  emailVerified?: boolean;
  lastLoginAt?: Date;
  mfaEnabled?: boolean;
  mfaSecret?: string | null;
  passwordResetToken?: string | null;
  passwordResetExpires?: Date | null;
  department?: string | null;
  team?: string | null;
  avatarUrl?: string | null;
}

/**
 * Port interface for admin user lookup operations.
 *
 * Consumers receive this interface via constructor injection —
 * they never import a concrete Prisma implementation directly.
 */
export interface AdminUserRepositoryPort {
  /**
   * Find an admin user and verify they are active.
   *
   * @param identifier - User ID or email address
   * @param type - Lookup type: "id" (default) or "email"
   * @returns Ok(user) when found and active,
   *          Err("NOT_FOUND") when no user matches,
   *          Err("USER_INACTIVE") when user exists but isActive = false
   */
  findActiveUser(
    identifier: string,
    type?: "email" | "id"
  ): Promise<Result<AdminUserDto, "NOT_FOUND" | "USER_INACTIVE">>;

  /**
   * Find an admin user by ID without performing an active-status check.
   *
   * @param id - AdminUser primary key
   * @returns Ok(user) when found, Err("NOT_FOUND") otherwise
   */
  findById(id: string): Promise<Result<AdminUserDto, "NOT_FOUND">>;

  /**
   * Find an admin user by email address without performing an active-status check.
   * Email comparison is case-insensitive (normalized to lowercase internally).
   *
   * @param email - Email address to look up
   * @returns Ok(user) when found, Err("NOT_FOUND") otherwise
   */
  findByEmail(email: string): Promise<Result<AdminUserDto, "NOT_FOUND">>;

  /**
   * Find an admin user by ID including credential material (password hash, MFA
   * secret, reset/backup-code state). For the authentication and MFA flows only.
   *
   * @param id - AdminUser primary key
   * @returns Ok(user) when found, Err("NOT_FOUND") otherwise
   */
  findCredentialsById(id: string): Promise<Result<AdminUserCredentialsDto, "NOT_FOUND">>;

  /**
   * Find an admin user by email including credential material. For the login
   * flow only. Email comparison is case-insensitive.
   *
   * @param email - Email address to look up
   * @returns Ok(user) when found, Err("NOT_FOUND") otherwise
   */
  findCredentialsByEmail(email: string): Promise<Result<AdminUserCredentialsDto, "NOT_FOUND">>;

  /**
   * Validate that a given user is active (synchronous guard).
   *
   * @param user - AdminUserDto record already retrieved from storage
   * @returns Ok(undefined) when active, Err("USER_INACTIVE") when not
   */
  validateActive(user: AdminUserDto): Result<void, "USER_INACTIVE">;

  /**
   * Retrieve multiple users by their IDs in a single query.
   * Both active and inactive users are returned.
   * Non-existent IDs are silently omitted.
   *
   * @param ids - Array of AdminUser primary keys
   * @returns Array of matching AdminUserDto records (order not guaranteed)
   */
  findManyByIds(ids: string[]): Promise<AdminUserDto[]>;

  /**
   * List every admin user (active and inactive), oldest first. For the admin
   * user-management console.
   *
   * @returns All admin users as AdminUserDto records
   */
  findAll(): Promise<AdminUserDto[]>;

  /**
   * Persist a new admin user.
   *
   * @param input - Creation fields including the resolved roleId
   * @returns The created user as an AdminUserDto (role exposed as its name)
   */
  create(input: AdminUserCreateInput): Promise<AdminUserDto>;

  /**
   * Apply a partial update to an admin user.
   *
   * @param id - AdminUser primary key
   * @param data - Fields to change; omitted keys are left untouched, `null`
   *               clears a nullable field
   * @returns The updated user as an AdminUserDto (role exposed as its name)
   */
  update(id: string, data: AdminUserUpdate): Promise<AdminUserDto>;

  /**
   * List all admin users assigned to a given role, newest first.
   *
   * @param roleId - Role primary key
   * @returns Matching AdminUserDto records ordered by createdAt descending
   */
  findByRoleId(roleId: string): Promise<AdminUserDto[]>;

  /**
   * Permanently delete an admin user.
   *
   * @param id - AdminUser primary key
   */
  delete(id: string): Promise<void>;
}
