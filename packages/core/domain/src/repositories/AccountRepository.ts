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
   * Check if an account exists (excludes soft-deleted accounts)
   */
  exists(id: AccountId): Promise<boolean>;

  /**
   * Return all accounts ordered by creation date descending (excludes soft-deleted)
   */
  findAll(): Promise<Account[]>;
}
