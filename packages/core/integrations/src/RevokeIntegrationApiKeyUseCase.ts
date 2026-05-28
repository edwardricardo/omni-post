/**
 * @file RevokeIntegrationApiKeyUseCase.ts
 * @description Revokes an integration API key. Verifies ownership before revoking.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { IntegrationApiKeyRepository } from "@core/domain/repositories/IntegrationApiKeyRepository.js";

export interface RevokeIntegrationApiKeyInput {
  keyId: string;
  accountId: string;
}

/**
 * @class RevokeIntegrationApiKeyUseCase
 * @description Loads an API key, verifies it belongs to the requesting account,
 *   and marks it as revoked.
 */
export class RevokeIntegrationApiKeyUseCase implements UseCase<
  RevokeIntegrationApiKeyInput,
  void,
  UseCaseError
> {
  constructor(private readonly repository: IntegrationApiKeyRepository) {}

  /**
   * @method execute
   * @description Revokes the specified API key.
   * @param input - Key ID and the account ID of the requester
   * @returns Result<void> on success
   */
  async execute(input: RevokeIntegrationApiKeyInput): Promise<Result<void, UseCaseError>> {
    if (!input.keyId) {
      return err(new UseCaseError("keyId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    try {
      const key = await this.repository.findById(input.keyId);
      if (!key) {
        return err(new UseCaseError("API key not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      if (key.accountId !== input.accountId) {
        return err(
          new UseCaseError("API key does not belong to this account", USE_CASE_ERRORS.FORBIDDEN)
        );
      }

      key.revoke();

      const saveResult = await this.repository.save(key);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to revoke API key",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to revoke integration API key",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
