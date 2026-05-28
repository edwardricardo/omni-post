/**
 * @file EnableSsoUseCase.ts
 * @description Enables SSO on an account. Guards: SamlConfiguration must exist and be active.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { SamlConfigurationRepository } from "@core/domain/repositories/SamlConfigurationRepository.js";
import type { AccountQueryRepositoryPort } from "@core/domain/repositories/AccountQueryRepository.js";

export interface EnableSsoInput {
  accountId: string;
}

export class EnableSsoUseCase implements UseCase<EnableSsoInput, void, UseCaseError> {
  constructor(
    private readonly samlRepo: SamlConfigurationRepository,
    private readonly accountQueryRepo: AccountQueryRepositoryPort
  ) {}

  /**
   * @method execute
   * @description Sets ssoEnabled = true on the account after verifying
   *              that a SAML configuration exists and is active.
   */
  async execute(input: EnableSsoInput): Promise<Result<void, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    try {
      const config = await this.samlRepo.findByAccountId(input.accountId);

      if (!config) {
        return err(
          new UseCaseError(
            "SAML configuration must be set up before enabling SSO",
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }

      if (!config.isActive) {
        return err(
          new UseCaseError("SAML configuration is not active", USE_CASE_ERRORS.VALIDATION_FAILED)
        );
      }

      const updateResult = await this.accountQueryRepo.setSsoEnabled(input.accountId, true, "SAML");
      if (!updateResult.ok) {
        return err(new UseCaseError("Account not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to enable SSO",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
