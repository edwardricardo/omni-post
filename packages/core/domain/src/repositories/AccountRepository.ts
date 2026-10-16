/**
 * @file AccountRepository.ts
 * @description Repository port for Account entity persistence — defines the contract for CRUD operations and email-based lookup without infrastructure details.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type HardDeleteContext, type HardDeleteImpact, type Repository } from "./Repository.js";
import { type Account } from "../entities/Account.js";
import { type AccountId } from "../value-objects/EntityId.js";
import { DomainError, type EntityNotFoundError } from "../errors/index.js";

/**
 * The code an {@link AccountEmailTakenError} carries. Exported so a caller recognises the
 * failure by value: class identity is not stable across this package's dual conditional
 * export (`development` -> `src`, `default` -> `dist`), so `instanceof` can go false where a
 * string comparison cannot.
 */
export const ACCOUNT_EMAIL_TAKEN_CODE = "ACCOUNT_EMAIL_TAKEN";

/**
 * A save the database refused because another LIVE account already holds the e-mail
 * address. The address is unique among live accounts only, so this is the answer to a race
 * a pre-flight read cannot close: the competing account can be born between the read and
 * the write, and the unique index is what decides. The message names no address, because
 * it can reach a log.
 */
export class AccountEmailTakenError extends DomainError {
  /**
   * @description Builds the error with its fixed message and {@link ACCOUNT_EMAIL_TAKEN_CODE}.
   */
  constructor() {
    super("Another live account already holds this e-mail address", ACCOUNT_EMAIL_TAKEN_CODE);
  }
}

/**
 * @function isAccountEmailTaken
 * @description Recognises an {@link AccountEmailTakenError} by its code rather than by
 *   class identity, for the reason {@link ACCOUNT_EMAIL_TAKEN_CODE} states.
 * @param error - The failure a save returned.
 * @returns True when the save failed because a live account holds the address.
 */
export function isAccountEmailTaken(error: Error): error is AccountEmailTakenError {
  return (error as { readonly code?: unknown }).code === ACCOUNT_EMAIL_TAKEN_CODE;
}

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
   * Find an account by its ID INCLUDING soft-deleted rows.
   *
   * This exists because {@link findById} filters `deletedAt: null` BY DESIGN, and
   * that design makes it useless to a restore path: the subject of a restore is,
   * by definition, a soft-deleted row, so `findById` can never see it. A restore
   * that had only `findById` would report "not found" for every row it is meant
   * to act on. Reserved for restore (and any path that must reason about deleted
   * rows — e.g. checking the stored e-mail against the live population before
   * bringing the row back); every ordinary read keeps the sweep.
   *
   * @method findByIdIncludingDeleted
   * @description Loads an account by id without the soft-delete filter, so callers can read a row the standard queries hide.
   * @param id - Identity of the account to load.
   * @returns Result with the Account (live OR soft-deleted), or EntityNotFoundError when no row carries the id at all.
   */
  findByIdIncludingDeleted(id: AccountId): Promise<Result<Account, EntityNotFoundError>>;

  /**
   * Find an account by email address
   *
   * @returns The account if found, null otherwise
   */
  findByEmail(email: string): Promise<Account | null>;

  /**
   * @method existsDeletedByEmail
   * @description Answers whether a SOFT-DELETED account holds the address. It is the one
   *   read that sees deleted accounts by e-mail on purpose: registration must tell an
   *   address that belongs to a deleted account apart from a free one, and
   *   {@link findByEmail} hides exactly those rows by design. It answers a boolean so nothing
   *   about the deleted row leaves the repository.
   * @param email - The address to look for; the implementation normalizes it the way it
   *   stores it.
   * @returns True when at least one soft-deleted account carries the address.
   */
  existsDeletedByEmail(email: string): Promise<boolean>;

  /**
   * @method save
   * @description Creates or updates an account. Inside a Unit of Work the write joins the
   *   open transaction, so a later failure in the same unit rolls it back.
   * @param account - The account to persist.
   * @returns Ok on success; {@link AccountEmailTakenError} when another live account already
   *   holds the address (recognise it with {@link isAccountEmailTaken}); any other failure as
   *   an Error.
   */
  save(account: Account): Promise<Result<void, AccountEmailTakenError | Error>>;

  /**
   * Soft-delete an account (sets deletedAt = now).
   * The account becomes invisible to all standard find queries.
   */
  delete(id: AccountId): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Reverse a soft delete by clearing `deletedAt`, returning the account to the
   * live population every standard read serves.
   *
   * The subject MUST be soft-deleted. A row that is absent (never existed, or was
   * hard-deleted) and a row that is currently LIVE are both un-restorable and
   * yield the same NOT_FOUND, deliberately: restoring a live row is a no-op
   * dressed as a success, and distinguishing the two cases would let a caller
   * probe which ids exist.
   *
   * @method restore
   * @description Clears deletedAt on a soft-deleted account so standard reads return it again.
   * @param id - Identity of the account to restore.
   * @returns Result void on success, or EntityNotFoundError when no SOFT-DELETED row carries the id (a live row is not restorable).
   */
  restore(id: AccountId): Promise<Result<void, EntityNotFoundError>>;

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
   * Measure the blast radius of a hard delete across every project of the account
   * (soft-deleted ones included — the cascade takes them too), in BOTH dimensions
   * the transaction budget is spent on: the posts destroyed and the rows in the
   * directly-countable child populations. See {@link HardDeleteImpact} for why one
   * number was not enough and for what the child count can and cannot see.
   *
   * This is the pre-flight signal the hard-delete use case uses to refuse a tenant
   * too large to remove in one transaction, before any destructive work begins, so
   * it must stay cheap: indexed aggregates only, no rows materialized, no join
   * through the rows the guard exists to avoid touching.
   */
  countHardDeleteImpact(id: AccountId): Promise<HardDeleteImpact>;

  /**
   * Check if an account exists (excludes soft-deleted accounts)
   */
  exists(id: AccountId): Promise<boolean>;

  /**
   * Return all accounts ordered by creation date descending (excludes soft-deleted)
   */
  findAll(): Promise<Account[]>;
}
