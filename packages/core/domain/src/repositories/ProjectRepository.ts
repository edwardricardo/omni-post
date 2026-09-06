/**
 * @file ProjectRepository.ts
 * @description Repository port for Project aggregate persistence — defines the contract for CRUD, account-based lookups, and publish log retrieval.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type HardDeleteContext, type HardDeleteImpact, type Repository } from "./Repository.js";
import { type Project } from "../entities/Project.js";
import { type ProjectId, type AccountId } from "../value-objects/EntityId.js";
import { type EntityNotFoundError } from "../errors/index.js";

/**
 * Publish log view returned by findPublishLogsByProjectId.
 * A read-only projection used by the project publish-history endpoint.
 */
export interface PublishLogView {
  id: string;
  postId: string;
  channelId: string;
  status: string;
  provider: string;
  channel: {
    id: string;
    name: string;
    provider: string;
  };
  createdAt: Date;
}

/**
 * Project Repository Interface
 *
 * This is a PORT in the hexagonal architecture - it defines what the domain
 * needs from persistence without specifying how it's implemented.
 *
 * The base Repository interface provides: findById, save, delete, exists.
 * This interface adds Project-specific query methods.
 */
export interface ProjectRepository extends Repository<Project, ProjectId> {
  /**
   * Find all projects belonging to an account
   */
  findByAccountId(accountId: AccountId): Promise<Project[]>;
}

/**
 * Standalone Project Repository Interface (non-extending variant)
 *
 * Use this when injecting into services that only need a subset of operations,
 * or when testing with minimal mocks.
 */
export interface ProjectRepositoryPort {
  /**
   * Find a project by its ID
   */
  findById(id: ProjectId): Promise<Result<Project, EntityNotFoundError>>;

  /**
   * Find a project by its ID INCLUDING soft-deleted rows.
   *
   * This exists because {@link findById} filters `deletedAt: null` BY DESIGN, and
   * that design makes it useless to a restore path: the subject of a restore is,
   * by definition, a soft-deleted row, so `findById` can never see it. A restore
   * that had only `findById` would report "not found" for every row it is meant
   * to act on. Reserved for restore (and any path that must reason about deleted
   * rows); every ordinary read keeps the sweep.
   *
   * @method findByIdIncludingDeleted
   * @description Loads a project by id without the soft-delete filter, so callers can read a row the standard queries hide.
   * @param id - Identity of the project to load.
   * @returns Result with the Project (live OR soft-deleted), or EntityNotFoundError when no row carries the id at all.
   */
  findByIdIncludingDeleted(id: ProjectId): Promise<Result<Project, EntityNotFoundError>>;

  /**
   * Find all projects belonging to an account
   */
  findByAccountId(accountId: AccountId): Promise<Project[]>;

  /**
   * Save a project (create or update)
   */
  save(project: Project): Promise<Result<void, Error>>;

  /**
   * Soft-delete a project (sets deletedAt = now).
   * The project becomes invisible to all standard find queries.
   */
  delete(id: ProjectId): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Reverse a soft delete by clearing `deletedAt`, returning the project to the
   * live population every standard read serves.
   *
   * The subject MUST be soft-deleted. A row that is absent (never existed, or was
   * hard-deleted) and a row that is currently LIVE are both un-restorable and
   * yield the same NOT_FOUND, deliberately: restoring a live row is a no-op
   * dressed as a success, and distinguishing the two cases would let a caller
   * probe which ids exist.
   *
   * @method restore
   * @description Clears deletedAt on a soft-deleted project so standard reads return it again.
   * @param id - Identity of the project to restore.
   * @returns Result void on success, or EntityNotFoundError when no SOFT-DELETED row carries the id (a live row is not restorable).
   */
  restore(id: ProjectId): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Hard-delete a project and all its data (irreversible).
   * Only callable by SUPER_ADMIN. Cascades to channels, posts, etc.
   *
   * Implementations MUST write the project's tombstone (`DeletionRecord`) in the
   * same transaction as the delete: no tombstone, no delete. `context` carries
   * the acting principal, which nothing left behind by the delete could supply.
   */
  hardDelete(id: ProjectId, context: HardDeleteContext): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Measure the blast radius of a hard delete for this project, in BOTH dimensions
   * the transaction budget is spent on: the posts destroyed (soft-deleted ones
   * included — the cascade takes them too) and the rows in the directly-countable
   * child populations. See {@link HardDeleteImpact} for why one number was not
   * enough and for what the child count can and cannot see.
   *
   * This is the pre-flight signal the hard-delete use case uses to refuse a project
   * too large to remove in one transaction, before any destructive work begins, so
   * it must stay cheap: indexed aggregates only, no rows materialized.
   */
  countHardDeleteImpact(id: ProjectId): Promise<HardDeleteImpact>;

  /**
   * Check if a project exists (excludes soft-deleted projects)
   */
  exists(id: ProjectId): Promise<boolean>;

  /**
   * Find a project by account + name (for duplicate name validation).
   * Returns null when no matching project is found.
   */
  findByName(accountId: AccountId, name: string): Promise<Project | null>;

  /**
   * Return the publish history for all posts in a project.
   * Ordered by creation date descending, limited to 100 entries.
   */
  findPublishLogsByProjectId(id: ProjectId): Promise<PublishLogView[]>;
}
