/**
 * @file Repository.ts
 * @description Base repository interfaces (ports) for all aggregates — defines generic CRUD, pagination, sorting, and UnitOfWork contracts.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { EntityId } from "../value-objects/EntityId.js";
import { type AdminActorId } from "../value-objects/AdminActorId.js";
import { EntityNotFoundError } from "../errors/index.js";

/**
 * Base repository interface for all aggregates
 *
 * @typeParam T - The aggregate type
 * @typeParam TId - The aggregate's identifier type
 */
export interface Repository<T, TId extends EntityId> {
  /**
   * Find an aggregate by its ID
   */
  findById(id: TId): Promise<Result<T, EntityNotFoundError>>;

  /**
   * Save an aggregate (create or update)
   */
  save(aggregate: T): Promise<Result<void, Error>>;

  /**
   * Delete an aggregate by its ID
   */
  delete(id: TId): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Check if an aggregate exists
   */
  exists(id: TId): Promise<boolean>;
}

/**
 * Read-only repository interface for query operations
 */
export interface ReadRepository<T, TId extends EntityId> {
  /** Load an aggregate by id. `EntityNotFoundError` when absent. */
  findById(id: TId): Promise<Result<T, EntityNotFoundError>>;
  /** Cheap existence probe — does not deserialize the aggregate. */
  exists(id: TId): Promise<boolean>;
}

/**
 * Write-only repository interface for command operations (CQRS pattern)
 */
export interface WriteRepository<T, TId extends EntityId> {
  /** Persist an aggregate (insert or update). Implementations dispatch domain events after commit. */
  save(aggregate: T): Promise<Result<void, Error>>;
  /** Delete an aggregate by id. `EntityNotFoundError` when nothing was removed. */
  delete(id: TId): Promise<Result<void, EntityNotFoundError>>;
}

/**
 * Caller context required by every irreversible `hardDelete`.
 *
 * A hard delete destroys the rows that carried an entity's identity, so the
 * operation also writes a tombstone (`DeletionRecord`) recording what was
 * destroyed and by whom, inside the same transaction as the delete. The
 * principal cannot be recovered afterwards from anything the delete leaves
 * behind, so it travels with the call rather than being looked up later.
 *
 * Required, not optional: an optional field would let a call site forget it and
 * still compile, and the resulting tombstone would name nobody.
 */
export interface HardDeleteContext {
  /**
   * Admin principal executing the destruction; recorded on the tombstone.
   * Branded ({@link AdminActorId}) so a missing principal cannot be papered over
   * with a placeholder string such as `"unknown"` — that no longer type-checks.
   */
  deletedBy: AdminActorId;
  /**
   * Operator-supplied reason for the destruction. It rides with the call so the
   * tombstone can record WHY a tenant's data was destroyed, not only who did it,
   * and it is persisted onto `DeletionRecord.reason` inside the same transaction
   * as the delete. AuditLog is written outside that transaction, so it can
   * outlive a rolled-back destruction or be lost with a committed one; the
   * tombstone cannot disagree with the delete it accompanies.
   */
  reason: string;
}

/**
 * The measured blast radius of a hard delete, as the pre-flight size guard sees it.
 *
 * WHY THIS IS NOT A SINGLE NUMBER. The guard used to be one count — posts — on the
 * premise that posts are "the dominant per-row cascade cost". They are not: the
 * cost is posts MULTIPLIED BY the rows in the tables that reference them, because
 * PostgreSQL fires one referential trigger per destroyed row per referencing table.
 * A tenant with few posts and a large child population sails past a posts-only
 * ceiling and then cannot finish inside the transaction budget — measured on this
 * schema at 10 000 posts with 100 000 child rows, which is a fifth of the old
 * 50 000-post ceiling and already consumed most of a 120 s budget before the FK
 * indexes landed. So the probe reports both dimensions and the guard bounds both.
 *
 * WHAT `childRows` CAN AND CANNOT SEE. It counts the child populations that carry
 * a tenant column of their own and are therefore countable with an index scan
 * instead of a join through the very rows we are trying not to touch. On this
 * schema that is `Task` and `WebhookEvent`: the two whose size a post count does
 * not imply, and the two measured as the largest per-post triggers. The other
 * thirteen children of `Post` (`Analytics`, `PostContent`, `PublishLog`,
 * `PostMedia`, …) carry no `accountId` / `projectId`, so counting them means
 * joining through `Post` — which costs the scan the guard exists to avoid. Their
 * fan-out per post is what the `posts` bound approximates, and the transaction
 * timeout remains the backstop for a tenant that is pathological in one of them.
 * Making them countable is the tenant-column denormalization the tenant-isolation
 * workstream owns; when it lands, they belong in this count.
 */
export interface HardDeleteImpact {
  /**
   * Posts the cascade would destroy, soft-deleted ones included — the cascade
   * takes those too.
   */
  posts: number;
  /**
   * Rows in the directly-countable child populations the cascade would destroy or
   * detach. See the caveat above: this is a floor on the child dimension, not a
   * total of every dependent row.
   */
  childRows: number;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page: number;
  limit: number;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * Sort direction
 */
export type SortDirection = "asc" | "desc";

/**
 * Sort parameters
 */
export interface SortParams<TFields extends string> {
  field: TFields;
  direction: SortDirection;
}

/**
 * Unit of Work interface for operaciones transaccionales.
 *
 * Usa el patrón de callback (executeInTransaction) que se mapea
 * de forma natural a la API de $transaction() de Prisma. El patrón
 * begin/commit/rollback fue eliminado porque las transacciones
 * interactivas de Prisma manejan commit/rollback automáticamente.
 *
 */
export interface UnitOfWork {
  /**
   * Ejecuta una función dentro de una transacción de base de datos.
   * Todas las operaciones de repositorio dentro del callback comparten
   * la misma transacción. En caso de éxito, la transacción se confirma
   * automáticamente. En caso de error (excepción lanzada), la transacción
   * se revierte automáticamente.
   */
  executeInTransaction<T>(fn: () => Promise<T>): Promise<T>;
}
