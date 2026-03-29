/**
 * @file GetOidcConfigurationQuery.ts
 * @description Read-only query that returns the OIDC configuration for an account, or null.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  OidcConfigurationRepository,
  OidcConfigurationData,
} from "../../domain/repositories/OidcConfigurationRepository.js";

export interface GetOidcConfigurationInput {
  accountId: string;
}

export type GetOidcConfigurationOutput = OidcConfigurationData | null;

export class GetOidcConfigurationQuery implements UseCase<
  GetOidcConfigurationInput,
  GetOidcConfigurationOutput,
  UseCaseError
> {
  constructor(private readonly repository: OidcConfigurationRepository) {}

  /**
   * @method execute
   * @description Retrieves the OIDC configuration for an account. Returns null when not configured.
   */
  async execute(
    input: GetOidcConfigurationInput
  ): Promise<Result<GetOidcConfigurationOutput, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const config = await this.repository.findByAccountId(input.accountId);
    return ok(config);
  }
}
