/**
 * @file RestoreAccountUseCase.ts
 * @description Orchestrates the reversal of a soft delete: validates the id, gates the caller
 *              against the target tenant, then clears `deletedAt` via the repository inside the
 *              Unit of Work. The mirror of {@link DeleteAccountUseCase} — soft delete is reversible
 *              by design, and this use case is what makes that guarantee real.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type CommandUseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { AccountId } from "@core/domain/index.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Required caller context for an account restore. A discriminated union so the
 * compiler forces every call site to declare its authorization surface. An
 * `Account` IS the tenant root, so the only account a `customer` caller may
 * restore is its own; an `admin` caller (support recovering a mistaken deletion)
 * skips the ownership gate explicitly and auditably. Omitting the context is a
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
 * Restore Account Use Case
 *
 * Reverses a soft delete by clearing `deletedAt`. The account becomes visible to
 * standard reads again. Only a currently soft-deleted account can be restored:
 * the repository returns NOT_FOUND for an absent (never existed / hard-deleted)
 * or already-active row, and this use case surfaces that as NOT_FOUND unchanged.
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
   * @description Validates the id, applies the caller tenant gate, and clears `deletedAt`
   *              transactionally when a Unit of Work is available.
   * @param input - Account id plus the required caller context
   * @returns Ok on success; NOT_FOUND when the account is absent, already active, or is not the
   *          caller's own tenant; VALIDATION_FAILED on a malformed id
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

    // Caller-context tenant gate (CWE-639). Runs BEFORE any mutation so a foreign
    // id never reaches the repository. The switch is exhaustive over
    // RestoreAccountCaller; the `never` default fails closed if a future variant
    // is added without handling it here.
    const { caller } = input;
    switch (caller.type) {
      case "customer": {
        if (caller.accountId !== accountIdResult.value.value) {
          // Mismatch and nonexistent are indistinguishable — NOT_FOUND, never
          // FORBIDDEN — so no signal reveals a foreign id exists (anti-enumeration).
          return err(
            new UseCaseError(`Account not found: ${input.accountId}`, USE_CASE_ERRORS.NOT_FOUND)
          );
        }
        break;
      }
      case "admin":
        // Explicit, auditable bypass of the tenant gate for admin recovery.
        break;
      default: {
        // The `never` assignment is the real guard: adding a variant to
        // RestoreAccountCaller without handling it above is a COMPILE error. The
        // runtime arm only exists for a caller built outside the type system, and
        // it fails CLOSED — refusing the restore. It returns rather than throws,
        // because a throw crossing the application boundary is itself a canon
        // violation (CODING_STANDARDS: fallible operations return Result).
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
      // E-mail-collision gate. `Account.email` is unique only WHERE
      // `deletedAt IS NULL`, which is what stops a soft delete from confiscating
      // an address forever — but it also means two soft-deleted accounts may
      // legally share one, and the moment a restore makes one of them live again
      // the partial index applies to it. Without this check the collision
      // surfaces as a raw P2002 from deep inside the adapter: an opaque 500
      // naming an index, for a situation an operator can actually resolve.
      //
      // Deliberately NOT a full guarantee against a concurrent signup: the
      // authoritative arbiter is the partial unique itself. This exists to turn
      // the ordinary case into an answerable error, not to replace the index.
      const restoring = await this.accountRepository.findByIdIncludingDeleted(
        accountIdResult.value
      );
      if (restoring.ok) {
        const holder = await this.accountRepository.findByEmail(restoring.value.email);
        if (holder !== null && holder.id.value !== accountIdResult.value.value) {
          return err(
            new UseCaseError(
              `Cannot restore account ${input.accountId}: the e-mail ` +
                `"${restoring.value.email}" is already used by active account ` +
                `${holder.id.value}. Change that account's address, then restore this one.`,
              USE_CASE_ERRORS.CONFLICT
            )
          );
        }
      }

      const restoreResult = await this.accountRepository.restore(accountIdResult.value);
      if (!restoreResult.ok) {
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
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doRestore();
        });
        return result;
      }
      return await doRestore();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to restore account",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
