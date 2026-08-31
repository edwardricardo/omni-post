/**
 * @file ProjectRepository.ts
 * @description Repository port for Project aggregate persistence — defines the contract for CRUD, account-based lookups, and publish log retrieval.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type HardDeleteContext, type Repository } from "./Repository.js";
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
   * Find a project by its ID INCLUDING soft-deleted rows (no `deletedAt: null`
   * filter). The deliberate counterpart to {@link findById}: the restore path
   * needs the project's stored `accountId` for its ownership gate, and the row
   * it is trying to restore is by definition soft-deleted, so the standard
   * finder would never return it. Reserved for the restore use case.
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
   * Restore a soft-deleted project (clears deletedAt = null), reversing the soft
   * delete. Like {@link findByIdIncludingDeleted}, this is a deliberate exception
   * to the `deletedAt: null` sweep — it exists to act on a soft-deleted row.
   *
   * Succeeds only when the row exists AND is currently soft-deleted. Returns
   * EntityNotFoundError when the project is absent (never existed or was
   * hard-deleted) OR is already active, so "restore a non-deleted row" is
   * indistinguishable from "restore a row that does not exist" (anti-enumeration).
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
   * Estimate the blast radius of a hard delete: the number of posts the cascade
   * would destroy for this project. Posts are the dominant per-row cascade cost,
   * so this count is the pre-flight signal the hard-delete use case uses to
   * refuse a project too large to remove in one transaction, before any
   * destructive work begins. Cheap: a single aggregate, no rows materialized.
   */
  countHardDeleteImpact(id: ProjectId): Promise<number>;

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
