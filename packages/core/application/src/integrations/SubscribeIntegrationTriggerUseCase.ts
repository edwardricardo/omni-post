/**
 * @file SubscribeIntegrationTriggerUseCase.ts
 * @description Creates an integration webhook subscription for a specific event type.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { IntegrationSubscriptionRepository } from "@core/domain/repositories/IntegrationSubscriptionRepository.js";
import { IntegrationSubscription } from "@core/domain/entities/IntegrationSubscription.js";
import type { IntegrationPlatformValue } from "@core/domain/entities/IntegrationApiKey.js";

export interface SubscribeIntegrationTriggerInput {
  accountId: string;
  platform?: IntegrationPlatformValue;
  event: string;
  targetUrl: string;
}

export interface SubscribeIntegrationTriggerOutput {
  id: string;
  event: string;
  targetUrl: string;
  platform: IntegrationPlatformValue;
}

/**
 * @class SubscribeIntegrationTriggerUseCase
 * @description Creates a new webhook subscription for an integration trigger.
 */
export class SubscribeIntegrationTriggerUseCase implements UseCase<
  SubscribeIntegrationTriggerInput,
  SubscribeIntegrationTriggerOutput,
  UseCaseError
> {
  constructor(private readonly repository: IntegrationSubscriptionRepository) {}

  /**
   * @method execute
   * @description Validates and creates a new integration subscription.
   */
  async execute(
    input: SubscribeIntegrationTriggerInput
  ): Promise<Result<SubscribeIntegrationTriggerOutput, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const platform: IntegrationPlatformValue = input.platform ?? "ZAPIER";

    try {
      const entityResult = IntegrationSubscription.create({
        accountId: input.accountId,
        platform,
        event: input.event,
        targetUrl: input.targetUrl,
      });

      if (!entityResult.ok) {
        return err(new UseCaseError(entityResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
      }

      const saveResult = await this.repository.save(entityResult.value);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save subscription",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok({
        id: entityResult.value.id,
        event: entityResult.value.event,
        targetUrl: entityResult.value.targetUrl,
        platform: entityResult.value.platform,
      });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to create integration subscription",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
