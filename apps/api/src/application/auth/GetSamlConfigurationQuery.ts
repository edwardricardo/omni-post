/**
 * @file GetSamlConfigurationQuery.ts
 * @description Read-only query that returns the SAML configuration for an account, or null.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  SamlConfigurationRepository,
  SamlConfigurationData,
} from "../../domain/repositories/SamlConfigurationRepository.js";

export interface GetSamlConfigurationInput {
  accountId: string;
}

export type GetSamlConfigurationOutput = SamlConfigurationData | null;

export class GetSamlConfigurationQuery implements UseCase<
  GetSamlConfigurationInput,
  GetSamlConfigurationOutput,
  UseCaseError
> {
  constructor(private readonly repository: SamlConfigurationRepository) {}

  /**
   * @method execute
   * @description Retrieves the SAML configuration for an account. Returns null when not configured.
   */
  async execute(
    input: GetSamlConfigurationInput
  ): Promise<Result<GetSamlConfigurationOutput, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const config = await this.repository.findByAccountId(input.accountId);
    return ok(config);
  }
}
