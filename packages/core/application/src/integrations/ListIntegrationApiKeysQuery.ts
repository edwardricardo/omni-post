/**
 * @file ListIntegrationApiKeysQuery.ts
 * @description Query that returns all active integration API keys for an account.
 *   Returns only safe fields (prefix, label, timestamps, platform) -- never the hash.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { IntegrationApiKeyRepository } from "@core/domain/repositories/IntegrationApiKeyRepository.js";
import type { IntegrationPlatformValue } from "@core/domain/entities/IntegrationApiKey.js";

export interface ListIntegrationApiKeysInput {
  accountId: string;
}

export interface IntegrationApiKeyDto {
  id: string;
  keyPrefix: string;
  platform: IntegrationPlatformValue;
  label: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/**
 * @class ListIntegrationApiKeysQuery
 * @description Returns all active (non-revoked) integration API keys for an account
 *   as safe DTOs without the key hash.
 */
export class ListIntegrationApiKeysQuery implements UseCase<
  ListIntegrationApiKeysInput,
  IntegrationApiKeyDto[],
  UseCaseError
> {
  constructor(private readonly repository: IntegrationApiKeyRepository) {}

  /**
   * @method execute
   * @description Fetches active keys and maps to DTOs.
   */
  async execute(
    input: ListIntegrationApiKeysInput
  ): Promise<Result<IntegrationApiKeyDto[], UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    try {
      const keys = await this.repository.findActiveByAccountId(input.accountId);

      const dtos: IntegrationApiKeyDto[] = keys.map((key) => ({
        id: key.id,
        keyPrefix: key.keyPrefix,
        platform: key.platform,
        label: key.label,
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
      }));

      return ok(dtos);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to list integration API keys",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
