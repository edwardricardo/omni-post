/**
 * @file RestoreAccountUseCase.ts
 * @description Orchestrates the reversal of a soft delete: validates the id, gates the caller
 *              against the target tenant, refuses a row that is not actually deleted, reports a
 *              taken e-mail as an answerable conflict, then clears `deletedAt` via the repository
 *              inside the Unit of Work. The mirror of {@link DeleteAccountUseCase} — soft delete
 *              is reversible by design, and this use case is what makes that guarantee real.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import {
  type CommandUseCase,
  UseCaseError,
  USE_CASE_ERRORS,
  classifyPersistenceFailure,
} from "@core/application/UseCase.js";
import { AccountId } from "@core/domain/index.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Required caller context for an account restore. A discriminated union so the
 * compiler forces every call site to declare its authorization surface. An
 * `Account` IS the tenant root, so the only account a `customer` caller may
 * restore is its own; an `admin` caller (support recovering a mistaken deletion)
 * skips the identity gate explicitly and auditably. Omitting the context is a
 * compile error — no call site can obtain an ungated restore by forgetting a
 * parameter.
 */
export type RestoreAccountCaller =
  { type: "customer"; accountId: string } | { type: "admin"; adminUserId: string };

/**
 * Input DTO for restoring an account.
 */
export interface RestoreAccountInput {
  accountId: string;
  /**
   * Required auth context. Customer callers may only restore their own tenant;
   * admin callers skip the gate explicitly (see {@link RestoreAccountCaller}).
   */
  caller: RestoreAccountCaller;
}

/**
 * @function toRestoreFailure
 * @description Maps a THROWN data-layer failure to the typed error the route turns into a status.
 *
 *              The one that matters here is `P2002`. `Account.email` is unique only WHERE
 *              `deletedAt IS NULL` — that partial index is what stops a soft delete from
 *              confiscating an address forever — so two soft-deleted accounts may legally share
 *              one, and the instant a restore makes one live again the index applies to it. When a
 *              live twin was born after this use case took its pre-check read, the index refuses
 *              the write and the failure arrives as a throw. That is a race the database resolved
 *              CORRECTLY, so it is reported as a conflict the caller can act on, never as an
 *              internal fault blaming the system for it.
 * @param error - The value caught from the repository or the transaction.
 * @param accountId - The subject id, so the message names the row that could not come back.
 * @returns A UseCaseError carrying the classified code and an actionable message.
 */
function toRestoreFailure(error: unknown, accountId: string): UseCaseError {
  const code = classifyPersistenceFailure(error);
  const message =
    code === USE_CASE_ERRORS.CONFLICT
      ? `Cannot restore account ${accountId}: another active account claimed its e-mail ` +
        `address first. Change that account's address, then restore this one.`
      : code === USE_CASE_ERRORS.TRANSIENT_FAILURE
        ? `Restore of account ${accountId} was aborted by the database (a write conflict or a ` +
          `transaction timeout). Nothing was changed; the operation can be retried.`
        : "Failed to restore account";
  return new UseCaseError(message, code, error instanceof Error ? error : undefined);
}

/**
 * Restore Account Use Case
 *
 * Reverses a soft delete by clearing `deletedAt`, returning the account to the
 * live population every standard read serves.
 *
 * Only a currently soft-deleted account can be restored, and the three ways that
 * can fail are answered differently on purpose:
 *   - no row carries the id at all (never existed, or hard-deleted) → NOT_FOUND;
 *   - the row is LIVE → CONFLICT, because the caller has already proved it owns
 *     this id, so "not found" would be a lie and `ok` would report work nobody
 *     did;
 *   - a live account already holds the subject's e-mail → CONFLICT naming that
 *     account, because only a human can decide which of the two keeps the address.
 *
 * @example
 * const useCase = new RestoreAccountUseCase(accountRepository, unitOfWork);
 * const result = await useCase.execute({
 *   accountId: 'account-abc',
 *   caller: { type: 'customer', accountId: 'account-abc' },
 * });
 */
export class RestoreAccountUseCase implements CommandUseCase<RestoreAccountInput, UseCaseError> {
  constructor(
    private readonly accountRepository: AccountRepositoryPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates the id, applies the caller identity gate, verifies the subject is
   *              actually soft-deleted and its e-mail is free, then clears `deletedAt`
   *              transactionally when a Unit of Work is available.
   * @param input - Account id plus the required caller context
   * @returns Ok on success; VALIDATION_FAILED on a malformed id; NOT_FOUND when the account is
   *          absent or is not the caller's own tenant; CONFLICT when it is already active, when a
   *          live account holds its e-mail, or when the write loses that race; TRANSIENT_FAILURE
   *          when the database aborted the transaction
   */
  async execute(input: RestoreAccountInput): Promise<Result<void, UseCaseError>> {
    const accountIdResult = AccountId.fromString(input.accountId);
    if (!accountIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid account ID: ${input.accountId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }
    const accountId = accountIdResult.value;

    // Caller-context identity gate (CWE-639). An Account IS the tenant root, so
    // ownership is decided by comparing ids — no repository read can tell us
    // anything the caller context does not already say. It runs BEFORE any read
    // so a foreign id never reaches persistence at all. The switch is exhaustive
    // over RestoreAccountCaller; the `never` default fails closed if a future
    // variant is added without handling it here.
    const { caller } = input;
    switch (caller.type) {
      case "customer": {
        if (caller.accountId !== accountId.value) {
          // Mismatch and nonexistent are indistinguishable — NOT_FOUND, never
          // FORBIDDEN — so no signal reveals a foreign id exists (anti-enumeration).
          return err(
            new UseCaseError(`Account not found: ${input.accountId}`, USE_CASE_ERRORS.NOT_FOUND)
          );
        }
        break;
      }
      case "admin":
        // Explicit, auditable bypass of the identity gate for admin recovery.
        break;
      default: {
        // The `never` assignment is the real guard: adding a variant to
        // RestoreAccountCaller without handling it above is a COMPILE error. The
        // runtime arm only exists for a caller built outside the type system (a
        // JSON body, a JS consumer), and it fails CLOSED — refusing the restore.
        // It returns rather than throws, because a throw crossing the application
        // boundary is itself a canon violation (fallible operations return Result).
        const exhaustive: never = caller;
        return err(
          new UseCaseError(
            `Unhandled restore caller type: ${JSON.stringify(exhaustive)}`,
            USE_CASE_ERRORS.FORBIDDEN
          )
        );
      }
    }

    const doRestore = async (): Promise<Result<void, UseCaseError>> => {
      // The subject of a restore is by definition a row the sweep hides, so the
      // ordinary `findById` can never see it and only this read can tell "absent"
      // from "deleted".
      const subject = await this.accountRepository.findByIdIncludingDeleted(accountId);
      if (!subject.ok) {
        return err(
          new UseCaseError(
            `Account not found: ${input.accountId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            subject.error
          )
        );
      }

      // Liveness check, read through the SWEEP-FILTERED accessor: `findById`
      // serves only `deletedAt IS NULL`, so a hit here means the row is already
      // in the live population and there is no soft delete to reverse. Without
      // this the repository refuses the write anyway, but it refuses it as
      // NOT_FOUND — telling an owner its own account does not exist, which is
      // both false and unactionable.
      const live = await this.accountRepository.findById(accountId);
      if (live.ok) {
        return err(
          new UseCaseError(
            `Account ${input.accountId} is already active; there is no soft delete to reverse.`,
            USE_CASE_ERRORS.CONFLICT
          )
        );
      }

      // E-mail collision check against the LIVE population (`findByEmail` filters
      // the deleted rows out). Deliberately NOT a guarantee: the authoritative
      // arbiter is the partial unique index, and a twin can be born between this
      // read and the write below — that race is caught by `toRestoreFailure`.
      // This exists to turn the ordinary, quiescent case into an error naming the
      // blocking account, instead of an opaque failure naming an index.
      const holder = await this.accountRepository.findByEmail(subject.value.email);
      if (holder !== null && holder.id.value !== accountId.value) {
        return err(
          new UseCaseError(
            `Cannot restore account ${input.accountId}: the e-mail ` +
              `"${subject.value.email}" is already used by active account ` +
              `${holder.id.value}. Change that account's address, then restore this one.`,
            USE_CASE_ERRORS.CONFLICT
          )
        );
      }

      const restoreResult = await this.accountRepository.restore(accountId);
      if (!restoreResult.ok) {
        // The row was soft-deleted a moment ago and is not restorable now, so a
        // concurrent writer resolved it first (restored or hard-deleted it).
        return err(
          new UseCaseError(
            `Account not found: ${input.accountId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            restoreResult.error
          )
        );
      }
      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        // The checks run INSIDE the transaction with the write they guard, so the
        // window between reading the e-mail population and reclaiming the address
        // is as narrow as the database allows.
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doRestore();
        });
        return result;
      }
      return await doRestore();
    } catch (error: unknown) {
      return err(toRestoreFailure(error, input.accountId));
    }
  }
}
