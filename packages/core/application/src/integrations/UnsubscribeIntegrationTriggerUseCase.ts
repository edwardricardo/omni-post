/**
 * @file UnsubscribeIntegrationTriggerUseCase.ts
 * @description Deactivates an integration webhook subscription. Verifies ownership.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { IntegrationSubscriptionRepository } from "@core/domain/repositories/IntegrationSubscriptionRepository.js";

export interface UnsubscribeIntegrationTriggerInput {
  subscriptionId: string;
  accountId: string;
}

/**
 * @class UnsubscribeIntegrationTriggerUseCase
 * @description Loads a subscription, verifies it belongs to the account, and deactivates it.
 */
export class UnsubscribeIntegrationTriggerUseCase implements UseCase<
  UnsubscribeIntegrationTriggerInput,
  void,
  UseCaseError
> {
  constructor(private readonly repository: IntegrationSubscriptionRepository) {}

  /**
   * @method execute
   * @description Deactivates the specified subscription.
   */
  async execute(input: UnsubscribeIntegrationTriggerInput): Promise<Result<void, UseCaseError>> {
    if (!input.subscriptionId) {
      return err(new UseCaseError("subscriptionId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    try {
      const sub = await this.repository.findById(input.subscriptionId);
      if (!sub) {
        return err(new UseCaseError("Subscription not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      if (sub.accountId !== input.accountId) {
        return err(
          new UseCaseError(
            "Subscription does not belong to this account",
            USE_CASE_ERRORS.FORBIDDEN
          )
        );
      }

      sub.deactivate();

      const saveResult = await this.repository.save(sub);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to deactivate subscription",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to unsubscribe integration trigger",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
