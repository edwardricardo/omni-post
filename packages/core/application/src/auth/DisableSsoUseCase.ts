/**
 * @file DisableSsoUseCase.ts
 * @description Disables SSO on an account. Does NOT delete the SAML configuration.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { AccountQueryRepositoryPort } from "@core/domain/repositories/AccountQueryRepository.js";

export interface DisableSsoInput {
  accountId: string;
}

export class DisableSsoUseCase implements UseCase<DisableSsoInput, void, UseCaseError> {
  constructor(private readonly accountQueryRepo: AccountQueryRepositoryPort) {}

  /**
   * @method execute
   * @description Sets ssoEnabled = false on the account. Configuration is preserved.
   */
  async execute(input: DisableSsoInput): Promise<Result<void, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    try {
      const updateResult = await this.accountQueryRepo.setSsoEnabled(
        input.accountId,
        false,
        "NONE"
      );
      if (!updateResult.ok) {
        return err(new UseCaseError("Account not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to disable SSO",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
