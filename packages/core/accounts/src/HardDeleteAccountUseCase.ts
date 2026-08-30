/**
 * @file HardDeleteAccountUseCase.ts
 * @description Orchestrates the IRREVERSIBLE removal of an account and every row beneath it.
 *              Deliberately separate from the normal (soft) delete path so the destructive
 *              operation can only be reached by naming it, and only by an admin caller.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type CommandUseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { AccountId } from "@core/domain/index.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";

/**
 * Required caller context for a hard delete. Single-variant on purpose: unlike
 * {@link import("./DeleteAccountUseCase.js").DeleteAccountCaller}, there is no
 * `customer` variant, so a customer-facing call site cannot construct a valid
 * input for this use case at all. The gate is the type, not a runtime check
 * someone can forget. `reason` is mandatory and flows into the caller's audit
 * record.
 */
export interface HardDeleteAccountCaller {
  type: "admin";
  adminUserId: string;
  reason: string;
}

/**
 * Input DTO for hard-deleting an account.
 */
export interface HardDeleteAccountInput {
  accountId: string;
  /** Required admin caller context — see {@link HardDeleteAccountCaller}. */
  caller: HardDeleteAccountCaller;
}

/**
 * Hard Delete Account Use Case
 *
 * Permanently removes an account and every project, channel and post beneath it.
 * This destroys rows; there is no recovery. The normal deletion path is
 * `DeleteAccountUseCase` (soft).
 *
 * Atomicity is the repository adapter's responsibility: `hardDelete` writes the
 * tombstones (one for the account, one per project it drags along) and destroys
 * the rows inside a single transaction, so a mid-way failure leaves the tenant
 * fully intact instead of half-destroyed — and no destruction can commit
 * without its durable record.
 *
 * The acting admin travels to the adapter in the `HardDeleteContext`, because
 * the tombstones are written where the transaction is and nothing the delete
 * leaves behind could name the principal afterwards.
 *
 * NOTE: this use case does NOT open a Unit of Work of its own. The adapter's
 * `hardDelete` is already transactional and UoW-aware; wrapping it in a second,
 * outer interactive transaction would only widen the lock window without adding
 * atomicity.
 *
 * @example
 * const useCase = new HardDeleteAccountUseCase(accountRepository);
 * const result = await useCase.execute({
 *   accountId: 'account-abc',
 *   caller: { type: 'admin', adminUserId: 'admin-1', reason: 'GDPR erasure request' },
 * });
 */
export class HardDeleteAccountUseCase implements CommandUseCase<
  HardDeleteAccountInput,
  UseCaseError
> {
  constructor(private readonly accountRepository: AccountRepositoryPort) {}

  /**
   * @method execute
   * @description Validates the id and the admin caller, then irreversibly removes the account
   *              and its dependent rows through the repository's transactional cascade.
   * @param input - Account id plus the required admin caller context
   * @returns Ok on success; VALIDATION_FAILED on a malformed id or empty reason; NOT_FOUND when
   *          no account (including a soft-deleted one) carries that id
   */
  async execute(input: HardDeleteAccountInput): Promise<Result<void, UseCaseError>> {
    const accountIdResult = AccountId.fromString(input.accountId);
    if (!accountIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid account ID: ${input.accountId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // A blank reason defeats the audit trail this operation exists to leave
    // behind, so it is rejected rather than recorded as an empty string.
    if (input.caller.reason.trim().length === 0) {
      return err(
        new UseCaseError(
          "A non-empty reason is required to hard-delete an account",
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    try {
      const result = await this.accountRepository.hardDelete(accountIdResult.value, {
        deletedBy: input.caller.adminUserId,
      });
      if (!result.ok) {
        return err(
          new UseCaseError(
            `Account not found: ${input.accountId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            result.error
          )
        );
      }
      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to hard-delete account",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
