/**
 * @file CreateNotificationUseCase.ts
 * @description Application use case for creating a new in-app notification.
 *   Checks recipient preferences before creating and persisting the notification.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { NotificationRepository } from "@core/domain/repositories/NotificationRepository.js";
import type { NotificationPreferenceRepository } from "@core/domain/repositories/NotificationRepository.js";
import { NotificationEntity } from "@core/domain/entities/Notification.js";
import type { NotificationTypeValue } from "@core/domain/value-objects/NotificationType.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for creating a notification.
 *
 * `callerAccountId` is the cross-tenant recipient gate (CWE-639). The
 * POST /notifications route runs under customer auth, so a caller must only be
 * able to notify recipients within their own account. When set, the use case
 * resolves the recipient's owning account via `findRecipientAccountId` and
 * rejects a foreign/unknown recipient with NOT_FOUND (anti-enumeration — same
 * shape as a missing recipient). Optional for backward compat with
 * admin/internal/system callers (e.g. event handlers) that legitimately notify
 * across the recipient set.
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
  callerAccountId?: string;
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
    // Cross-tenant recipient gate (CWE-639). Resolve the recipient's owning
    // account before doing any work. A caller targeting a recipient outside
    // their own account (or a recipient that does not exist) gets NOT_FOUND,
    // not FORBIDDEN — the return shape matches a missing recipient (no
    // enumeration). Skipped for internal/admin callers that omit callerAccountId.
    if (input.callerAccountId !== undefined) {
      const recipientAccountId = await this.notificationRepo.findRecipientAccountId(
        input.recipientId
      );
      if (!recipientAccountId || recipientAccountId.value !== input.callerAccountId) {
        return err(
          new UseCaseError(`Recipient not found: ${input.recipientId}`, USE_CASE_ERRORS.NOT_FOUND)
        );
      }
    }

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
