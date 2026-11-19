/**
 * @file RepositoryFailureError.ts
 * @description The domain error a repository returns when its store could not complete an
 *   operation, carrying what the store raised as the error's standard `cause`.
 * @layer domain
 */

import { DomainError } from "./DomainError.js";

/**
 * The code a {@link RepositoryFailureError} carries. Exported so a caller recognises the failure
 * by value: class identity is not stable across this package's dual conditional export
 * (`development` -> `src`, `default` -> `dist`), so `instanceof` can go false where a string
 * comparison cannot.
 */
export const REPOSITORY_FAILURE_CODE = "REPOSITORY_FAILURE";

/**
 * A store operation that did not complete: the connection failed, a statement was refused, the
 * transaction was aborted. Its message names the operation and holds no value of the data, since
 * it can reach a log.
 *
 * `cause` is always an `Error`. When the store raised an `Error`, `cause` is that very error, so
 * nothing it carries is lost. When it raised any other value, that value is not kept, because it
 * carries no stack and may be any data; `cause` is then an `Error` that names only the value's
 * type, so the fact that the store raised something that is not an `Error` is not lost either.
 */
export class RepositoryFailureError extends DomainError {
  public override readonly cause: Error;

  /**
   * @description Builds the error with its message and {@link REPOSITORY_FAILURE_CODE}.
   * @param message - Which operation failed, with no value of the data
   * @param caught - The value the store raised
   */
  constructor(message: string, caught: unknown) {
    super(message, REPOSITORY_FAILURE_CODE);
    this.cause = causeOfStoreFailure(caught);
  }
}

/**
 * @description The `Error` a domain error keeps as its cause for a value a store raised: the
 *   value itself when it is an `Error`, so nothing it carries is lost; otherwise an `Error` that
 *   names only the value's type, since such a value carries no stack and may be any data.
 * @param caught - The value the store raised
 * @returns The error to keep as the cause
 */
export function causeOfStoreFailure(caught: unknown): Error {
  return caught instanceof Error
    ? caught
    : new Error(
        `The store raised a value that is not an Error, of type ${caught === null ? "null" : typeof caught}`
      );
}
