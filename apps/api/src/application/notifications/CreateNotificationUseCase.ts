/**
 * @file CreateNotificationUseCase.ts
 * @description Application use case for creating a new in-app notification.
 *   Checks recipient preferences before creating and persisting the notification.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { NotificationRepository } from "../../domain/repositories/NotificationRepository.js";
import type { NotificationPreferenceRepository } from "../../domain/repositories/NotificationRepository.js";
import { NotificationEntity } from "../../domain/entities/Notification.js";
import type { NotificationTypeValue } from "../../domain/value-objects/NotificationType.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Input DTO for creating a notification
 */
export interface CreateNotificationInput {
  recipientId: string;
  type: NotificationTypeValue;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  actorName?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Output DTO for created notification
 */
export interface CreateNotificationOutput {
  id: string;
}

/**
 * @class CreateNotificationUseCase
 * @description Creates a new notification after checking recipient preferences.
 *   If the recipient has disabled this notification type, the notification is silently skipped.
 */
export class CreateNotificationUseCase implements UseCase<
  CreateNotificationInput,
  CreateNotificationOutput,
  UseCaseError
> {
  constructor(
    private readonly notificationRepo: NotificationRepository,
    private readonly preferenceRepo: NotificationPreferenceRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Creates a new notification for the recipient.
   * @param input - The notification creation parameters
   * @returns Result<{ id: string }> on success, or skipped result if preferences disable it
   */
  async execute(
    input: CreateNotificationInput
  ): Promise<Result<CreateNotificationOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<CreateNotificationOutput, UseCaseError>> => {
      // Check if recipient has disabled this notification type
      const preferences = await this.preferenceRepo.findByMember(input.recipientId);
      const preference = preferences.find((p) => p.type === input.type);

      if (preference && !preference.enabled) {
        // Notification type disabled by recipient -- silently skip
        return ok({ id: "" });
      }

      // Create domain entity
      const createResult = NotificationEntity.create({
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        ...(input.resourceType !== undefined && { resourceType: input.resourceType }),
        ...(input.resourceId !== undefined && { resourceId: input.resourceId }),
        ...(input.actorId !== undefined && { actorId: input.actorId }),
        ...(input.actorName !== undefined && { actorName: input.actorName }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      });

      if (!createResult.ok) {
        return err(
          new UseCaseError(
            createResult.error.message,
            USE_CASE_ERRORS.VALIDATION_FAILED,
            createResult.error
          )
        );
      }

      const notification = createResult.value;

      // Persist
      await this.notificationRepo.save(notification);

      return ok({ id: notification.id.value });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreateNotificationOutput, UseCaseError> = ok({ id: "" }) as Result<
          CreateNotificationOutput,
          UseCaseError
        >;
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to create notification",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
