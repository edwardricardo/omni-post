/**
 * @file CustomerUserRepository.ts
 * @description Port interface for CustomerUser persistence operations.
 *   Infrastructure adapters implement this contract.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { CustomerUser } from "../entities/CustomerUser.js";
import type { DomainError } from "../errors/index.js";

/**
 * @interface CustomerUserRepository
 * @description Command + query repository for CustomerUser aggregate.
 */
export interface CustomerUserRepository {
  /**
   * @method findById
   * @description Retrieves a customer user by unique ID.
   */
  findById(id: string): Promise<Result<CustomerUser, DomainError>>;

  /**
   * @method findByEmail
   * @description Finds a customer user by email within a specific account.
   *   Excludes soft-deleted records.
   */
  findByEmail(email: string, accountId: string): Promise<Result<CustomerUser, DomainError>>;

  /**
   * @method findByEmailAcrossAccounts
   * @description Finds all non-deleted customer users with a given email
   *   across all accounts. Used during login when no account slug is provided.
   */
  findByEmailAcrossAccounts(email: string): Promise<CustomerUser[]>;

  /**
   * @method findByAccountId
   * @description Lists all non-deleted customer users for a given account.
   */
  findByAccountId(accountId: string): Promise<CustomerUser[]>;

  /**
   * @method findByProjectId
   * @description Lists customer users assigned to a given project via the
   *   ProjectMember table. Tenant-scoped: the guarded client restricts results
   *   to the bound tenant context; a foreign projectId yields an empty list.
   */
  findByProjectId(projectId: string): Promise<CustomerUser[]>;

  /**
   * @method findByInviteToken
   * @description Finds a customer user by an active invitation token. Used
   *   during invitation acceptance flow.
   */
  findByInviteToken(token: string): Promise<Result<CustomerUser, DomainError>>;

  /**
   * @method findByResetToken
   * @description Finds a customer user by their password reset token.
   */
  findByResetToken(token: string): Promise<Result<CustomerUser, DomainError>>;

  /**
   * @method save
   * @description Upserts a customer user. If passwordHash is provided it is
   *   persisted; otherwise the existing hash is preserved on update.
   */
  save(user: CustomerUser, passwordHash?: string): Promise<Result<void, DomainError>>;

  /**
   * @method updatePasswordHash
   * @description Updates only the password hash for a specific user.
   */
  updatePasswordHash(userId: string, passwordHash: string): Promise<Result<void, DomainError>>;

  /**
   * @method delete
   * @description Hard-deletes a customer user record.
   */
  delete(userId: string): Promise<Result<void, DomainError>>;
}
