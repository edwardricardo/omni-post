/**
 * @file ListExternalNotificationsQuery.ts
 * @description Application query for listing external notification configs
 *   by project ID. Pure read operation -- no state changes.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type ExternalNotificationConfigRepository } from "@core/domain/repositories/ExternalNotificationConfigRepository.js";
import { type ExternalNotificationConfigOutput } from "./ConfigureExternalNotificationUseCase.js";

/**
 * Input for listing notification configs
 */
export interface ListExternalNotificationsInput {
  projectId: string;
}

/**
 * @class ListExternalNotificationsQuery
 * @description Retrieves all external notification configs for a project.
 */
export class ListExternalNotificationsQuery implements UseCase<
  ListExternalNotificationsInput,
  ExternalNotificationConfigOutput[],
  UseCaseError
> {
  constructor(private readonly repository: ExternalNotificationConfigRepository) {}

  /**
   * @method execute
   * @description Queries all configs for the given project.
   */
  async execute(
    input: ListExternalNotificationsInput
  ): Promise<Result<ExternalNotificationConfigOutput[], UseCaseError>> {
    const result = await this.repository.findByProjectId(input.projectId);

    if (!result.ok) {
      return err(new UseCaseError(result.error.message, USE_CASE_ERRORS.INTERNAL_ERROR));
    }

    return ok(
      result.value.map((config) => ({
        id: config.id,
        projectId: config.projectId,
        channel: config.channel,
        webhookUrl: config.webhookUrl,
        label: config.label,
        events: config.events,
        isActive: config.isActive,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      }))
    );
  }
}
