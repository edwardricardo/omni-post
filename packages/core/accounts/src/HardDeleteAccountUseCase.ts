/**
 * @file HardDeleteAccountUseCase.ts
 * @description Orchestrates the IRREVERSIBLE removal of an account and every row beneath it.
 *              Deliberately separate from the normal (soft) delete path so the destructive
 *              operation can only be reached by naming it, and only by an admin caller.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import {
  type CommandUseCase,
  UseCaseError,
  USE_CASE_ERRORS,
  classifyPersistenceFailure,
} from "@core/application/UseCase.js";
import {
  HARD_DELETE_MAX_CASCADE_ROWS,
  HARD_DELETE_MAX_POSTS,
} from "@core/application/hardDeletePolicy.js";
import {
  WRITE_CONFLICT_MAX_ATTEMPTS,
  type WriteConflictRetryOptions,
  retryOnWriteConflict,
} from "@core/application/retryOnWriteConflict.js";
import { AccountId, type AdminActorId } from "@core/domain/index.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { HardDeleteContext, UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Required caller context for a hard delete. Single-variant on purpose: there is
 * no `customer` variant, so a customer-facing call site cannot construct a valid
 * input for this use case at all. The gate is the type, not a runtime check
 * someone can forget. `reason` is mandatory and flows into the tombstone context
 * and the caller's audit record.
 */
export interface HardDeleteAccountCaller {
  type: "admin";
  /**
   * Branded ({@link AdminActorId}) so a call site cannot pass a placeholder such
   * as `"unknown"`: the only way to obtain one is to validate a real principal.
   */
  adminUserId: AdminActorId;
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
 * This destroys rows; there is no recovery.
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
 * This use case OPENS the transaction (via the injected Unit of Work) rather
 * than leaving the adapter to open its own. That is load-bearing, not
 * ceremony: the dedicated hard-delete Unit of Work runs at Serializable
 * isolation and, under the route's `withSystemContext`, binds the
 * `app.account_id` RLS GUC for the whole transaction. Without it the adapter's
 * standalone transaction would leave the GUC unbound, so the day RLS is
 * enforced the tombstone writes and the cascade would be gated by the tenant
 * policy — the delete would silently become a no-op or fail. The adapter's
 * `hardDelete` JOINS this transaction rather than nesting a second one.
 *
 * @example
 * const useCase = new HardDeleteAccountUseCase(accountRepository, unitOfWork);
 * const result = await useCase.execute({
 *   accountId: 'account-abc',
 *   caller: { type: 'admin', adminUserId, reason: 'GDPR erasure request' },
 * });
 */
/**
 * Translates a persistence failure into the typed use-case error the route maps to a
 * status. It lives here, called from BOTH the retry's exhausted branch and the outer
 * catch, because those two paths answer for the same failure and a second copy of this
 * mapping is a second chance for them to disagree.
 */
function toPersistenceFailure(error: unknown): UseCaseError {
  const code = classifyPersistenceFailure(error);
  const message =
    code === USE_CASE_ERRORS.CONFLICT
      ? "Cannot hard-delete account: a protected relationship still references it"
      : code === USE_CASE_ERRORS.TRANSIENT_FAILURE
        ? `Hard-delete of account failed after ${WRITE_CONFLICT_MAX_ATTEMPTS} attempts ` +
          `because the database kept aborting it (a write conflict or a transaction ` +
          `timeout). A write conflict means the tenant is still taking writes: retrying ` +
          `will keep losing until it is quiesced — soft-delete it first, then erase.`
        : "Failed to hard-delete account";
  return new UseCaseError(message, code, error instanceof Error ? error : undefined);
}

export class HardDeleteAccountUseCase implements CommandUseCase<
  HardDeleteAccountInput,
  UseCaseError
> {
  constructor(
    private readonly accountRepository: AccountRepositoryPort,
    private readonly unitOfWork: UnitOfWork,
    /**
     * Backoff/attempt seams for the write-conflict retry. Production leaves it
     * undefined and takes the policy defaults; a test injects a no-op sleep so the
     * retry SCHEDULE is exercised without spending its wall-clock in the suite.
     */
    private readonly retryOptions?: WriteConflictRetryOptions
  ) {}

  /**
   * @method execute
   * @description Validates the id and the admin caller, refuses a tenant too large to remove
   *              atomically, then irreversibly removes the account and its dependent rows inside
   *              a Serializable, tenant-bound transaction.
   * @param input - Account id plus the required admin caller context
   * @returns Ok on success; VALIDATION_FAILED on a malformed id or empty reason;
   *          OPERATION_TOO_LARGE when the cascade exceeds the single-transaction ceiling;
   *          NOT_FOUND when no account (including a soft-deleted one) carries that id;
   *          CONFLICT on a foreign-key interlock; TRANSIENT_FAILURE on a timeout or write conflict
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

    const accountId = accountIdResult.value;

    try {
      // Pre-flight size guard, BEFORE opening the transaction: a tenant whose
      // cascade is too large to finish inside the transaction budget is refused
      // with an actionable error, not left to time out (and stay undeletable)
      // with the erasure clock running.
      const impact = await this.accountRepository.countHardDeleteImpact(accountId);
      // TWO bounds, because the transaction budget is spent on two dimensions that
      // fail independently. Posts alone let a tenant with few posts and a huge child
      // population through — and that tenant then cannot finish inside the budget,
      // which is the failure the posts-only guard was blind to.
      if (impact.posts > HARD_DELETE_MAX_POSTS) {
        return err(
          new UseCaseError(
            `Hard delete refused: this account owns ${impact.posts} posts, above the ` +
              `${HARD_DELETE_MAX_POSTS} ceiling for a single transaction. Reduce the tenant ` +
              `(delete posts or projects first) before erasing it.`,
            USE_CASE_ERRORS.OPERATION_TOO_LARGE
          )
        );
      }
      if (impact.childRows > HARD_DELETE_MAX_CASCADE_ROWS) {
        return err(
          new UseCaseError(
            `Hard delete refused: this account's cascade would touch ${impact.childRows} ` +
              `dependent rows (tasks and webhook events), above the ` +
              `${HARD_DELETE_MAX_CASCADE_ROWS} ceiling for a single transaction — the cost is ` +
              `posts MULTIPLIED BY the rows that reference them, not posts alone. Reduce the ` +
              `tenant (prune webhook events and tasks first) before erasing it.`,
            USE_CASE_ERRORS.OPERATION_TOO_LARGE
          )
        );
      }

      const context: HardDeleteContext = {
        deletedBy: input.caller.adminUserId,
        reason: input.caller.reason,
      };

      // The transaction is opened HERE so its Serializable isolation and its
      // RLS-GUC binding cover the adapter's tombstone-then-delete cascade, which
      // joins this transaction rather than opening its own. The adapter's Result
      // is returned out of the transaction so its error is inspected here.
      //
      // Wrapped in a bounded retry because Serializable is what makes the tombstone
      // snapshot trustworthy, and the price of that is aborting when a concurrent
      // writer touches the tenant mid-transaction. Without a retry the only
      // convergent path left to the operator is re-running a minutes-long cascade
      // by hand. Only a write conflict is retried; a timeout or an interlock is not
      // (see `isRetryableWriteConflict`). The retry does NOT make an erasure
      // converge against a tenant under continuous write load — the exhausted error
      // below says exactly that.
      const attempt = await retryOnWriteConflict(
        () =>
          this.unitOfWork.executeInTransaction(() =>
            this.accountRepository.hardDelete(accountId, context)
          ),
        this.retryOptions
      );
      if (!attempt.ok) {
        return err(toPersistenceFailure(attempt.error));
      }
      const hardDeleteResult = attempt.value;

      if (!hardDeleteResult.ok) {
        return err(
          new UseCaseError(
            `Account not found: ${input.accountId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            hardDeleteResult.error
          )
        );
      }
      return ok(undefined);
    } catch (error: unknown) {
      return err(toPersistenceFailure(error));
    }
  }
}
