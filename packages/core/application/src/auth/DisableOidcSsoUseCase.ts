/**
 * @file DisableOidcSsoUseCase.ts
 * @description Disables OIDC SSO on an account. Does NOT delete the OIDC configuration.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { AccountQueryRepositoryPort } from "@core/domain/repositories/AccountQueryRepository.js";

export interface DisableOidcSsoInput {
  accountId: string;
}

export class DisableOidcSsoUseCase implements UseCase<DisableOidcSsoInput, void, UseCaseError> {
  constructor(private readonly accountQueryRepo: AccountQueryRepositoryPort) {}

  /**
   * @method execute
   * @description Sets ssoEnabled = false and ssoProvider = NONE on the account. Configuration is preserved.
   */
  async execute(input: DisableOidcSsoInput): Promise<Result<void, UseCaseError>> {
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
          "Failed to disable OIDC SSO",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
