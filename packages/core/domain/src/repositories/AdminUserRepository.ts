/**
 * @file AdminUserRepository.ts
 * @description Repository port for admin user lookup operations — defines the contract for finding and verifying active admin users by ID or email.
 * @layer domain
 */

import type { AdminUserDto, AdminUserCredentialsDto } from "./ReadModelDtos.js";
import type { Result } from "@shared/types";
import type { RepositoryFailureError } from "../errors/RepositoryFailureError.js";

/**
 * Fields required to create a new admin user.
 * Role is referenced by its primary key (resolved from a role name by the caller).
 * An omitted optional field is not written, so the store's default applies.
 */
export interface AdminUserCreateInput {
  email: string;
  passwordHash: string;
  name: string;
  roleId: string;
  emailVerified?: boolean;
  /** When true, the administrator must set a new password before doing anything else. */
  mustChangePassword?: boolean;
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
 * A new single-use password for an administrator, and the hash and the reset token the caller
 * read: the write lands only while the row still holds both.
 */
export interface SingleUsePasswordReplacement {
  /** The administrator whose single-use password is replaced. */
  readonly id: string;
  /** The password hash as the caller read it. */
  readonly currentPasswordHash: string;
  /** The pending password reset's token as the caller read it, `null` when none was pending. */
  readonly currentPasswordResetToken: string | null;
  /** The hash of the new single-use password. */
  readonly passwordHash: string;
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
   * Say whether any admin user exists, active or not. Inside an open Unit of
   * Work it reads through that transaction, and an error returned there means
   * the store may have aborted it: the caller returns the error so the
   * transaction ends, and writes nothing more in it.
   *
   * @returns Ok(true) when at least one admin user row exists, Ok(false) when
   *          none does, Err(RepositoryFailureError) carrying what the store
   *          raised when it could not answer
   */
  existsAny(): Promise<Result<boolean, RepositoryFailureError>>;

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
   * Replace the single-use password of an administrator who has never signed
   * in and must still change the password: the hash and the date the password
   * changed are written, and a pending password reset is cleared so a link
   * issued before cannot set the password afterwards, only where the row still
   * has the given id, the hash and the reset token as read,
   * `mustChangePassword` true and no sign-in date. The mark, the sign-in date
   * and the password history are left as they are. The hash's algorithm is
   * left as it is too, because the hasher's port does not report its
   * algorithm and an eligible row was hashed by the same hasher. Inside an
   * open Unit of Work it writes through that transaction, and an error
   * returned there means the store may have aborted it.
   *
   * @param replacement - The administrator, the hash and the reset token as
   *                      read, and the new hash
   * @returns Ok(true) when one row matched and was written, Ok(false) when the
   *          row no longer holds what was read and nothing was written,
   *          Err(RepositoryFailureError) carrying what the store raised
   */
  replaceSingleUsePassword(
    replacement: SingleUsePasswordReplacement
  ): Promise<Result<boolean, RepositoryFailureError>>;

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
