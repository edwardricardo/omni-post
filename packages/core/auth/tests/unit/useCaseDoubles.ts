/**
 * @file useCaseDoubles.ts
 * @description Doubles and narrowers the unit suites of the first administrator's use cases share:
 *   a Unit of Work that writes each transaction's opening, commit and rollback into the journal the
 *   other doubles write their calls into, so a case can assert which calls ran inside the
 *   transaction and how it ended, and the two narrowers of a `Result`.
 * @layer infrastructure
 */
import { expect } from "vitest";
import type { Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/** What the Unit of Work double writes into the journal. */
export const TRANSACTION_JOURNAL = {
  open: "transaction.open",
  commit: "transaction.commit",
  rollback: "transaction.rollback",
  commitFailed: "transaction.commitFailed",
} as const;

/**
 * @description A Unit of Work that runs the work at once and journals the transaction around it:
 *   an `err` or a raise rolls back, an `ok` commits unless `commitFailure` is given, in which case
 *   the commit raises it as the store would. Each outcome the work returned is pushed onto
 *   `outcomes`.
 * @param journal - The journal the other doubles write into
 * @param outcomes - Receives each outcome the work returned
 * @param commitFailure - When given, what the commit raises
 * @returns The Unit of Work double
 */
export function makeJournalingUnitOfWork(
  journal: string[],
  outcomes: Array<Result<unknown, unknown>>,
  commitFailure?: Error
): UnitOfWork {
  return {
    async executeInTransaction<T>(fn: () => Promise<T>): Promise<T> {
      journal.push("transaction.executeInTransaction");
      return fn();
    },
    async executeResultInTransaction<T, E>(fn: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
      journal.push(TRANSACTION_JOURNAL.open);
      let outcome: Result<T, E>;
      try {
        outcome = await fn();
      } catch (error: unknown) {
        journal.push(TRANSACTION_JOURNAL.rollback);
        throw error;
      }
      outcomes.push(outcome);
      if (!outcome.ok) {
        journal.push(TRANSACTION_JOURNAL.rollback);
        return outcome;
      }
      if (commitFailure !== undefined) {
        journal.push(TRANSACTION_JOURNAL.commitFailed);
        throw commitFailure;
      }
      journal.push(TRANSACTION_JOURNAL.commit);
      return outcome;
    },
  };
}

/**
 * @description Narrows a failed outcome to its error, failing the case when the outcome succeeded.
 * @param result - The outcome of a use case
 * @returns Its error
 */
export function expectFailure<T>(result: Result<T, UseCaseError>): UseCaseError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected a failed outcome, got a success");
  }
  return result.error;
}

/**
 * @description Narrows a successful outcome to its value, failing the case when the outcome failed.
 * @param result - The outcome of a use case
 * @returns Its value
 */
export function expectSuccess<T>(result: Result<T, UseCaseError>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}
