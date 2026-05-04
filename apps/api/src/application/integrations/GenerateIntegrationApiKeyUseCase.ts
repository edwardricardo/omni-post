/**
 * @file GenerateIntegrationApiKeyUseCase.ts
 * @description Generates a new integration API key for an account. The plain-text key
 *   is returned exactly once at creation time. Only the argon2id hash is persisted.
 *   Enforces a maximum of 5 active keys per account. Supports multiple platforms
 *   (Zapier, Make, etc.) with platform-specific key prefixes.
 * @layer application
 */

import { randomBytes } from "node:crypto";
import { hashPassword } from "../../auth/passwordHashing.js";
import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { IntegrationApiKeyRepository } from "../../domain/repositories/IntegrationApiKeyRepository.js";
import {
  IntegrationApiKey,
  type IntegrationPlatformValue,
} from "../../domain/entities/IntegrationApiKey.js";

const MAX_ACTIVE_KEYS = 5;
const KEY_RANDOM_BYTES = 24;
const KEY_PREFIX_VISIBLE_LENGTH = 12;

export interface GenerateIntegrationApiKeyInput {
  accountId: string;
  platform?: IntegrationPlatformValue;
  label?: string;
}

export interface GenerateIntegrationApiKeyOutput {
  id: string;
  plainKey: string;
  keyPrefix: string;
  platform: IntegrationPlatformValue;
}

/**
 * @class GenerateIntegrationApiKeyUseCase
 * @description Creates a new integration API key: validates limits, generates plain key,
 *   hashes with argon2, persists via repository, and returns the plain key once.
 */
export class GenerateIntegrationApiKeyUseCase implements UseCase<
  GenerateIntegrationApiKeyInput,
  GenerateIntegrationApiKeyOutput,
  UseCaseError
> {
  constructor(private readonly repository: IntegrationApiKeyRepository) {}

  /**
   * @method execute
   * @description Generates a new API key for the given account and platform.
   * @param input - Account ID, optional platform (defaults to ZAPIER), and optional label
   * @returns Result with id, plainKey, keyPrefix, and platform on success
   */
  async execute(
    input: GenerateIntegrationApiKeyInput
  ): Promise<Result<GenerateIntegrationApiKeyOutput, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const platform: IntegrationPlatformValue = input.platform ?? "ZAPIER";

    try {
      // Check active key limit
      const activeCount = await this.repository.countActiveByAccountId(input.accountId);
      if (activeCount >= MAX_ACTIVE_KEYS) {
        return err(
          new UseCaseError(
            `Maximum of ${MAX_ACTIVE_KEYS} active integration API keys per account`,
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }

      // Generate plain key with platform-specific prefix
      const keyPrefixStr = IntegrationApiKey.PLATFORM_KEY_PREFIX[platform];
      const randomPart = randomBytes(KEY_RANDOM_BYTES).toString("base64url");
      const plainKey = `${keyPrefixStr}${randomPart}`;

      // Compute hash and prefix
      const keyHash = await hashPassword(plainKey);
      const keyPrefix = plainKey.substring(0, KEY_PREFIX_VISIBLE_LENGTH);

      // Create domain entity
      const entityResult = IntegrationApiKey.create({
        accountId: input.accountId,
        platform,
        keyHash,
        keyPrefix,
        ...(input.label !== undefined && { label: input.label }),
      });

      if (!entityResult.ok) {
        return err(new UseCaseError(entityResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
      }

      // Persist
      const saveResult = await this.repository.save(entityResult.value);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save API key",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok({
        id: entityResult.value.id,
        plainKey,
        keyPrefix,
        platform,
      });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to generate integration API key",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
