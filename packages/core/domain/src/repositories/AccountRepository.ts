/**
 * @file AccountRepository.ts
 * @description Repository port for Account entity persistence — defines the contract for CRUD operations and email-based lookup without infrastructure details.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type HardDeleteContext, type Repository } from "./Repository.js";
import { type Account } from "../entities/Account.js";
import { type AccountId } from "../value-objects/EntityId.js";
import { type EntityNotFoundError } from "../errors/index.js";

/**
 * Account Repository Interface
 *
 * This is a PORT in the hexagonal architecture - it defines what the domain
 * needs from persistence without specifying how it's implemented.
 *
 * The base Repository interface provides: findById, save, delete, exists.
 * This interface adds Account-specific query methods.
 */
export interface AccountRepository extends Repository<Account, AccountId> {
  /**
   * Find an account by email address
   *
   * @returns The account if found, null otherwise
   */
  findByEmail(email: string): Promise<Account | null>;
}

/**
 * Standalone Account Repository Interface (non-extending variant)
 *
 * Use this when injecting into services that only need a subset of operations,
 * or when testing with minimal mocks.
 */
export interface AccountRepositoryPort {
  /**
   * Find an account by its ID
   */
  findById(id: AccountId): Promise<Result<Account, EntityNotFoundError>>;

  /**
   * Find an account by email address
   *
   * @returns The account if found, null otherwise
   */
  findByEmail(email: string): Promise<Account | null>;

  /**
   * Save an account (create or update)
   */
  save(account: Account): Promise<Result<void, Error>>;

  /**
   * Soft-delete an account (sets deletedAt = now).
   * The account becomes invisible to all standard find queries.
   */
  delete(id: AccountId): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Restore a soft-deleted account (clears deletedAt = null), reversing the
   * soft delete. This is the ONLY read/write path that deliberately targets a
   * currently soft-deleted row — every other query filters `deletedAt: null`.
   *
   * Succeeds only when the row exists AND is currently soft-deleted. Returns
   * EntityNotFoundError when the account is absent (never existed or was
   * hard-deleted) OR is already active — so "restore a non-deleted row" is
   * indistinguishable from "restore a row that does not exist" (anti-enumeration,
   * same shape as `delete`).
   */
  restore(id: AccountId): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Find an account by id INCLUDING soft-deleted rows (no `deletedAt` filter).
   * The deliberate counterpart to {@link findById}: the restore path has to read
   * the very row every other query is built to hide, in order to check whether
   * its e-mail is still free before making it live again.
   *
   * Reserved for the restore path. Any other caller wanting "including deleted"
   * is almost certainly a read that should have been filtered.
   */
  findByIdIncludingDeleted(id: AccountId): Promise<Result<Account, EntityNotFoundError>>;

  /**
   * Hard-delete an account and all its data (irreversible).
   * Only callable by SUPER_ADMIN. Cascades to projects, channels, posts, etc.
   *
   * Implementations MUST write the tombstones (`DeletionRecord`) — one for the
   * account and one for every project it drags along — in the same transaction
   * as the delete: no tombstone, no delete. `context` carries the acting
   * principal, which nothing left behind by the delete could supply.
   */
  hardDelete(id: AccountId, context: HardDeleteContext): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Estimate the blast radius of a hard delete: the number of posts the cascade
   * would destroy across every project of the account (soft-deleted ones
   * included — the cascade takes them too). Posts are the dominant per-row
   * cascade cost, so this count is the pre-flight signal the hard-delete use case
   * uses to refuse a tenant too large to remove in one transaction, before any
   * destructive work begins. Cheap: a single aggregate, no rows materialized.
   */
  countHardDeleteImpact(id: AccountId): Promise<number>;

  /**
   * Check if an account exists (excludes soft-deleted accounts)
   */
  exists(id: AccountId): Promise<boolean>;

  /**
   * Return all accounts ordered by creation date descending (excludes soft-deleted)
   */
  findAll(): Promise<Account[]>;
}
