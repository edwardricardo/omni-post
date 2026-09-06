/**
 * @file DeleteAccountUseCase.ts
 * @description Orchestrates the NORMAL (reversible) deletion of an account: validates the id,
 *              gates the caller against the target tenant, then soft-deletes via the repository
 *              inside the Unit of Work. Child data (projects, channels, posts) is left intact.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type CommandUseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { AccountId } from "@core/domain/index.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Required caller context for an account delete (CWE-639 gate). A discriminated
 * union so the compiler forces every call site to declare its authorization
 * surface. An `Account` IS the tenant root, so the only account a `customer`
 * caller may delete is its own; a `system` caller (billing teardown, retention)
 * skips the gate explicitly and auditably. Omitting the context is a compile
 * error — no call site can obtain an ungated delete by forgetting a parameter.
 */
export type DeleteAccountCaller =
  { type: "customer"; accountId: string } | { type: "system"; source: string };

/**
 * Input DTO for deleting an account.
 */
export interface DeleteAccountInput {
  accountId: string;
  /**
   * Required auth context. Customer callers may only delete their own tenant;
   * system callers skip the gate explicitly (see {@link DeleteAccountCaller}).
   */
  caller: DeleteAccountCaller;
}

/**
 * Delete Account Use Case
 *
 * Soft-deletes an account (sets `deletedAt`). This is the NORMAL deletion path:
 * the row survives, standard reads stop returning it, and the tenant's projects,
 * channels and posts are preserved for audit and for billing/legal retention.
 * Irreversible removal is a separate, admin-only use case — see
 * `HardDeleteAccountUseCase`.
 *
 * @example
 * const useCase = new DeleteAccountUseCase(accountRepository, unitOfWork);
 * const result = await useCase.execute({
 *   accountId: 'account-abc',
 *   caller: { type: 'customer', accountId: 'account-abc' },
 * });
 */
export class DeleteAccountUseCase implements CommandUseCase<DeleteAccountInput, UseCaseError> {
  constructor(
    private readonly accountRepository: AccountRepositoryPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates the id, applies the caller tenant gate, and soft-deletes the account
   *              transactionally when a Unit of Work is available.
   * @param input - Account id plus the required caller context
   * @returns Ok on success; NOT_FOUND when the account is absent, already soft-deleted, or is
   *          not the caller's own tenant
   */
  async execute(input: DeleteAccountInput): Promise<Result<void, UseCaseError>> {
    const accountIdResult = AccountId.fromString(input.accountId);
    if (!accountIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid account ID: ${input.accountId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Caller-context tenant gate (CWE-639). Runs BEFORE any read or mutation so
    // a foreign id never reaches the repository at all. The switch is exhaustive
    // over DeleteAccountCaller; the `never` default fails closed if a future
    // variant is added without handling it here.
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
      case "system":
        // Explicit, auditable bypass of the tenant gate for internal callers.
        break;
      default: {
        // The `never` assignment is the real guard: adding a variant to
        // DeleteAccountCaller without handling it above is a COMPILE error.
        // The runtime arm only exists for a caller built outside the type
        // system, and it fails CLOSED — refusing the delete rather than
        // falling through to it. It returns rather than throws, because a
        // throw crossing the application boundary is itself a canon violation
        // (CODING_STANDARDS: fallible operations return Result).
        const exhaustive: never = caller;
        return err(
          new UseCaseError(
            `Unhandled delete caller type: ${JSON.stringify(exhaustive)}`,
            USE_CASE_ERRORS.FORBIDDEN
          )
        );
      }
    }

    const doDelete = async (): Promise<Result<void, UseCaseError>> => {
      const deleteResult = await this.accountRepository.delete(accountIdResult.value);
      if (!deleteResult.ok) {
        return err(
          new UseCaseError(
            `Account not found: ${input.accountId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            deleteResult.error
          )
        );
      }
      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doDelete();
        });
        return result;
      }
      return await doDelete();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to delete account",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
