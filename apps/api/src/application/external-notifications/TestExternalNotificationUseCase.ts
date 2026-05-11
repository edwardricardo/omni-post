/**
 * @file TestExternalNotificationUseCase.ts
 * @description Application use case for sending a test notification to an
 *   existing external notification config. Verifies webhook connectivity.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type ExternalNotificationConfigRepository } from "../../domain/repositories/ExternalNotificationConfigRepository.js";
import { type ExternalNotifierPort } from "../../domain/repositories/ExternalNotifierPort.js";

/**
 * Input for testing a notification config
 */
export interface TestExternalNotificationInput {
  id: string;
}

/**
 * @class TestExternalNotificationUseCase
 * @description Sends a test notification through a configured webhook.
 */
export class TestExternalNotificationUseCase implements UseCase<
  TestExternalNotificationInput,
  { delivered: boolean },
  UseCaseError
> {
  constructor(
    private readonly repository: ExternalNotificationConfigRepository,
    private readonly notifier: ExternalNotifierPort
  ) {}

  /**
   * @method execute
   * @description Fetches the config, builds a test payload, and sends it.
   */
  async execute(
    input: TestExternalNotificationInput
  ): Promise<Result<{ delivered: boolean }, UseCaseError>> {
    const configResult = await this.repository.findById(input.id);

    if (!configResult.ok) {
      return err(new UseCaseError(configResult.error.message, USE_CASE_ERRORS.NOT_FOUND));
    }

    const config = configResult.value;

    const sendResult = await this.notifier.send(config.webhookUrl, config.channel, {
      title: "OmniPost Test Notification",
      message: `This is a test notification for "${config.label}". If you see this, your webhook is configured correctly.`,
      event: "test",
      projectId: config.projectId,
      metadata: {
        configId: config.id,
        channel: config.channel,
        timestamp: new Date().toISOString(),
      },
    });

    if (!sendResult.ok) {
      return err(
        new UseCaseError(
          `Test notification failed: ${sendResult.error.message}`,
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }

    return ok({ delivered: true });
  }
}
