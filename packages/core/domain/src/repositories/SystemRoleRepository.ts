/**
 * @file SystemRoleRepository.ts
 * @description Write-side port for an administration system role: a role whose identity and
 *   permissions are fixed by a definition in code rather than by the administration console.
 *   It writes the role so that afterwards the store holds exactly that definition.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { Permission } from "../auth/Permission.js";
import { DomainError } from "../errors/DomainError.js";
import {
  causeOfStoreFailure,
  type RepositoryFailureError,
} from "../errors/RepositoryFailureError.js";

/**
 * The code a {@link SystemRoleConflictError} carries. Exported so a caller recognises the
 * conflict by value: class identity is not stable across this package's dual conditional export
 * (`development` -> `src`, `default` -> `dist`), so `instanceof` can go false where a string
 * comparison cannot.
 */
export const SYSTEM_ROLE_CONFLICT_CODE = "SYSTEM_ROLE_CONFLICT";

/**
 * Which unique key of the role another writer holds. The two call for different answers: the id
 * is taken by a concurrent write of the same role, which ends, while the name held under another
 * id belongs to a different role, which refuses every later write until it is renamed or removed.
 */
export const SYSTEM_ROLE_COLLISIONS = {
  ID: "id",
  NAME: "name",
} as const;

/** One of {@link SYSTEM_ROLE_COLLISIONS}. */
export type SystemRoleCollision =
  (typeof SYSTEM_ROLE_COLLISIONS)[keyof typeof SYSTEM_ROLE_COLLISIONS];

/** The message of each collision; it names the key and holds no value of the definition. */
const CONFLICT_MESSAGES: Readonly<Record<SystemRoleCollision, string>> = {
  [SYSTEM_ROLE_COLLISIONS.ID]: "Another writer already holds this system role's id",
  [SYSTEM_ROLE_COLLISIONS.NAME]:
    "Another role already holds this system role's name under another id",
};

/**
 * A system-role write the store refused because another writer already holds the role's id or
 * its name, as when a concurrent run wrote the same role first. The store's unique constraints
 * decide it, since two writers that both read no role can both try to create it.
 *
 * `collision` says which key, as read from the constraint the store's violation names; `cause`
 * is that violation. A raised value that is not an `Error` goes through the function
 * `RepositoryFailureError` uses: it is not kept, since it may be any data, and an `Error` of its
 * own names its type.
 */
export class SystemRoleConflictError extends DomainError {
  public override readonly cause: Error;

  /** Which unique key of the role another writer holds. */
  public readonly collision: SystemRoleCollision;

  /**
   * @description Builds the error with the message of its collision,
   *   {@link SYSTEM_ROLE_CONFLICT_CODE} and the store's violation as its cause.
   * @param collision - The key the violated constraint covers
   * @param caught - The value the store raised
   */
  constructor(collision: SystemRoleCollision, caught: unknown) {
    super(CONFLICT_MESSAGES[collision], SYSTEM_ROLE_CONFLICT_CODE);
    this.collision = collision;
    this.cause = causeOfStoreFailure(caught);
  }
}

/** The definition of an administration system role, as code fixes it. */
export interface SystemRoleDefinition {
  /** The role's fixed primary key, the same in every database. */
  readonly id: string;
  /** The role's unique name. */
  readonly name: string;
  readonly description: string;
  /** The role's rank among the administration roles. */
  readonly level: number;
  readonly isSystem: boolean;
  /** Every permission the role grants, and no other. */
  readonly permissions: readonly Permission[];
}

/**
 * Port for writing an administration system role. Consumers receive it by constructor
 * injection; inside an open Unit of Work the write joins that transaction.
 */
export interface SystemRoleRepository {
  /**
   * Write the role so that, afterwards, its row carries the definition's fields and its
   * permissions are exactly the definition's, whatever the role held before. The write is
   * atomic: it leaves either the whole definition or what was there before. It does not change
   * whether an existing role is active, since the definition does not say; a role it creates
   * is active.
   *
   * An error returned inside an open Unit of Work means the store may have aborted that
   * transaction: the caller returns the error so the transaction ends, and writes nothing more
   * in it.
   *
   * @param definition - The role as code defines it
   * @returns Ok when written, Err(SystemRoleConflictError) when another writer holds the role's
   *          id or name, Err(RepositoryFailureError) carrying what the store raised on any other
   *          failure
   */
  save(
    definition: SystemRoleDefinition
  ): Promise<Result<void, SystemRoleConflictError | RepositoryFailureError>>;
}
