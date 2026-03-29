/**
 * @file EnableOidcSsoUseCase.ts
 * @description Enables OIDC SSO on an account. Guards: OidcConfiguration must exist and be active.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { OidcConfigurationRepository } from "../../domain/repositories/OidcConfigurationRepository.js";
import type { AccountQueryRepositoryPort } from "../../domain/repositories/AccountQueryRepository.js";

export interface EnableOidcSsoInput {
  accountId: string;
}

export class EnableOidcSsoUseCase implements UseCase<EnableOidcSsoInput, void, UseCaseError> {
  constructor(
    private readonly oidcRepo: OidcConfigurationRepository,
    private readonly accountQueryRepo: AccountQueryRepositoryPort
  ) {}

  /**
   * @method execute
   * @description Sets ssoEnabled = true and ssoProvider = OIDC on the account after verifying
   *              that an OIDC configuration exists and is active.
   */
  async execute(input: EnableOidcSsoInput): Promise<Result<void, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    try {
      const config = await this.oidcRepo.findByAccountId(input.accountId);

      if (!config) {
        return err(
          new UseCaseError(
            "OIDC configuration must be set up before enabling SSO",
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }

      if (!config.isActive) {
        return err(
          new UseCaseError("OIDC configuration is not active", USE_CASE_ERRORS.VALIDATION_FAILED)
        );
      }

      const updateResult = await this.accountQueryRepo.setSsoEnabled(input.accountId, true, "OIDC");
      if (!updateResult.ok) {
        return err(new UseCaseError("Account not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to enable OIDC SSO",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
