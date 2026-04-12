/**
 * @file AdminUserRepository.ts
 * @description Repository port for admin user lookup operations — defines the contract for finding and verifying active admin users by ID or email.
 * @layer domain
 */

import type { AdminUserDto } from "./ReadModelDtos.js";
import type { Result } from "@shared/types";

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
}
