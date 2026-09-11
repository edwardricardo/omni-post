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
   * @method claimPasswordReset
   * @description Consumes a live password-reset token and stores the new hash in
   *   ONE conditional write. The predicate names the token, an expiry strictly in
   *   the future, and a non-deleted owner together, so there is no read-then-write
   *   window in which a second caller can claim the same token.
   * @param token - The reset token presented by the caller.
   * @param newPasswordHash - The already-hashed new password.
   * @returns ok(void) when exactly ONE row was claimed. `INVALID_TOKEN` when no row
   *   matched the whole predicate — unknown, expired, already consumed and
   *   soft-deleted-owner are deliberately indistinguishable, because telling them
   *   apart is a token-validity oracle. `INTERNAL_ERROR` for every other failure,
   *   including a tenant-context failure, which MUST NOT be degraded into a token
   *   verdict.
   */
  claimPasswordReset(
    token: string,
    newPasswordHash: string
  ): Promise<Result<void, "INVALID_TOKEN" | "INTERNAL_ERROR">>;

  /**
   * @method issueResetToken
   * @description Stores a reset token and its expiry on ONE user row. Every matched
   *   row needs its OWN token: `resetToken` is globally unique, so reusing a single
   *   value across the rows that share an e-mail address collides, one arbitrary row
   *   wins, and the rest fail.
   * @param userId - The row to issue the token for.
   * @param token - The token to persist; distinct per row.
   * @param expiresAt - Absolute expiry instant.
   * @returns ok(void) when exactly ONE row was updated, `USER_NOT_FOUND` when none
   *   matched, `INTERNAL_ERROR` on any other failure.
   */
  issueResetToken(
    userId: string,
    token: string,
    expiresAt: Date
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">>;

  /**
   * @method create
   * @description Creates a NEW customer-user row. It creates or it fails; it never
   *   absorbs a duplicate as an update, because an invitation sent to an address
   *   that already registered would then silently overwrite that person's row.
   *   The credential is a REQUIRED parameter rather than a value read off the
   *   entity, so a caller cannot omit it and still get a row.
   * @param user - The entity whose creation columns are persisted. The MFA columns,
   *   `deletedAt`, the reset-token pair and the login timestamp are NOT part of the
   *   creation projection — each is owned by the command that names it.
   * @param passwordHash - The already-hashed credential of record.
   * @returns ok(void) on creation, `EMAIL_EXISTS` when the account/e-mail pair is
   *   already taken, `INTERNAL_ERROR` on any other failure.
   */
  create(
    user: CustomerUser,
    passwordHash: string
  ): Promise<Result<void, "EMAIL_EXISTS" | "INTERNAL_ERROR">>;

  /**
   * @method recordLogin
   * @description Stamps the last successful login on ONE row, writing the timestamp
   *   and nothing else. It takes an id rather than an entity on purpose: an entity
   *   loaded before the credential path ran carries a hash that may already be
   *   stale, and a write shaped from it would revert whatever ran in between.
   * @param userId - The row to stamp.
   * @param at - The login instant.
   * @returns ok(void) when exactly ONE live row was stamped, `USER_NOT_FOUND` when
   *   none matched, `INTERNAL_ERROR` on any other failure.
   */
  recordLogin(userId: string, at: Date): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">>;

  /**
   * @method upgradePasswordHash
   * @description Replaces the stored hash with one computed at the current hashing
   *   parameters, writing that single column.
   *
   *   Its ONLY sanctioned caller is the transparent rehash inside the customer
   *   login: the plaintext is on the stack, the stored hash was verified against
   *   it, and the parameters advanced since it was written. Any other caller is
   *   changing a password, which goes through the reset claim so the token that
   *   authorised the change is consumed in the same statement.
   * @param userId - The row whose credential is being re-encoded.
   * @param newHash - The hash computed at the current parameters.
   * @returns ok(void) when exactly ONE live row was updated, `USER_NOT_FOUND` when
   *   none matched, `INTERNAL_ERROR` on any other failure.
   */
  upgradePasswordHash(
    userId: string,
    newHash: string
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">>;

  /**
   * @method changeRole
   * @description Points ONE row at a different customer role, writing the role
   *   foreign key and nothing else.
   * @param userId - The member whose role changes.
   * @param roleId - The role to point at.
   * @returns ok(void) when exactly ONE live row was updated, `USER_NOT_FOUND` when
   *   none matched, `INTERNAL_ERROR` on any other failure.
   */
  changeRole(
    userId: string,
    roleId: string
  ): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">>;

  /**
   * @method deactivate
   * @description Marks ONE row inactive, writing the active flag and nothing else.
   *   Deactivation is not deletion: `deletedAt` is untouched, so a member removed
   *   from a team keeps whatever soft-delete state the row already carried.
   * @param userId - The member to deactivate.
   * @returns ok(void) when exactly ONE live row was updated, `USER_NOT_FOUND` when
   *   none matched, `INTERNAL_ERROR` on any other failure.
   */
  deactivate(userId: string): Promise<Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">>;

  /**
   * @method delete
   * @description Hard-deletes a customer user record.
   */
  delete(userId: string): Promise<Result<void, DomainError>>;
}
