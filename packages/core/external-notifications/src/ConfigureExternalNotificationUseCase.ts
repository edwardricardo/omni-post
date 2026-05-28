/**
 * @file ConfigureExternalNotificationUseCase.ts
 * @description Application use case for creating or updating an external
 *   notification configuration (Slack/Teams webhook).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  type ExternalNotificationConfigRepository,
  type ExternalNotificationConfigData,
  type NotificationChannel,
} from "@core/domain/repositories/ExternalNotificationConfigRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { randomUUID } from "node:crypto";

/**
 * Input for creating or updating a notification config
 */
export interface ConfigureExternalNotificationInput {
  id?: string;
  projectId: string;
  channel: NotificationChannel;
  webhookUrl: string;
  label: string;
  events: string[];
  isActive?: boolean;
}

/**
 * Output DTO for notification config
 */
export interface ExternalNotificationConfigOutput {
  id: string;
  projectId: string;
  channel: NotificationChannel;
  webhookUrl: string;
  label: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class ConfigureExternalNotificationUseCase
 * @description Creates or updates an external notification configuration.
 */
export class ConfigureExternalNotificationUseCase implements UseCase<
  ConfigureExternalNotificationInput,
  ExternalNotificationConfigOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: ExternalNotificationConfigRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates input and persists the notification config.
   */
  async execute(
    input: ConfigureExternalNotificationInput
  ): Promise<Result<ExternalNotificationConfigOutput, UseCaseError>> {
    // Validate webhook URL format
    if (!input.webhookUrl.startsWith("https://")) {
      return err(new UseCaseError("Webhook URL must use HTTPS", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Validate at least one event is specified
    if (input.events.length === 0) {
      return err(
        new UseCaseError("At least one event must be specified", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const doWork = async (): Promise<Result<ExternalNotificationConfigOutput, UseCaseError>> => {
      const now = new Date();
      const configData: ExternalNotificationConfigData = {
        id: input.id ?? randomUUID(),
        projectId: input.projectId,
        channel: input.channel,
        webhookUrl: input.webhookUrl,
        label: input.label,
        events: input.events,
        isActive: input.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      };

      const result = await this.repository.save(configData);

      if (!result.ok) {
        return err(new UseCaseError(result.error.message, USE_CASE_ERRORS.INTERNAL_ERROR));
      }

      return ok({
        id: result.value.id,
        projectId: result.value.projectId,
        channel: result.value.channel,
        webhookUrl: result.value.webhookUrl,
        label: result.value.label,
        events: result.value.events,
        isActive: result.value.isActive,
        createdAt: result.value.createdAt,
        updatedAt: result.value.updatedAt,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ExternalNotificationConfigOutput, UseCaseError> = ok({
          id: "",
          projectId: "",
          channel: "slack" as NotificationChannel,
          webhookUrl: "",
          label: "",
          events: [],
          isActive: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as Result<ExternalNotificationConfigOutput, UseCaseError>;
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to configure external notification",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
