/**
 * @file DeleteExternalNotificationUseCase.ts
 * @description Application use case for deleting an external notification config.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type ExternalNotificationConfigRepository } from "../../domain/repositories/ExternalNotificationConfigRepository.js";

/**
 * Input for deleting a notification config
 */
export interface DeleteExternalNotificationInput {
  id: string;
}

/**
 * @class DeleteExternalNotificationUseCase
 * @description Deletes an external notification configuration by ID.
 */
export class DeleteExternalNotificationUseCase
  implements UseCase<DeleteExternalNotificationInput, void, UseCaseError>
{
  constructor(private readonly repository: ExternalNotificationConfigRepository) {}

  /**
   * @method execute
   * @description Removes the specified notification config.
   */
  async execute(input: DeleteExternalNotificationInput): Promise<Result<void, UseCaseError>> {
    const result = await this.repository.delete(input.id);

    if (!result.ok) {
      const statusCode =
        result.error.code === "ENTITY_NOT_FOUND"
          ? USE_CASE_ERRORS.NOT_FOUND
          : USE_CASE_ERRORS.INTERNAL_ERROR;
      return err(new UseCaseError(result.error.message, statusCode));
    }

    return ok(undefined);
  }
}
