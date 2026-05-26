/**
 * @file MarkNotificationReadUseCase.ts
 * @description Application use case for marking notifications as read.
 *   Supports both single-notification and mark-all operations.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { NotificationRepository } from "@core/domain/repositories/NotificationRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for marking a single notification as read
 */
export interface MarkNotificationReadInput {
  notificationId: string;
}

/**
 * Input DTO for marking all notifications as read
 */
export interface MarkAllNotificationsReadInput {
  recipientId: string;
}

/**
 * @class MarkNotificationReadUseCase
 * @description Marks a single notification as read by ID.
 */
export class MarkNotificationReadUseCase implements UseCase<
  MarkNotificationReadInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Marks the specified notification as read.
   * @param input - Contains notificationId
   * @returns Result<void> on success, NOT_FOUND error if notification does not exist
   */
  async execute(input: MarkNotificationReadInput): Promise<Result<void, UseCaseError>> {
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const result = await this.repository.markAsRead(input.notificationId);

      if (!result.ok) {
        return err(
          new UseCaseError(
            `Notification not found: ${input.notificationId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            result.error
          )
        );
      }

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined) as Result<void, UseCaseError>;
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to mark notification as read",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}

/**
 * @class MarkAllNotificationsReadUseCase
 * @description Marks all notifications for a recipient as read.
 */
export class MarkAllNotificationsReadUseCase implements UseCase<
  MarkAllNotificationsReadInput,
  { count: number },
  UseCaseError
> {
  constructor(private readonly repository: NotificationRepository) {}

  /**
   * @method execute
   * @description Marks all unread notifications for the recipient as read.
   * @param input - Contains recipientId
   * @returns Result<{ count: number }> with the number of notifications marked as read
   */
  async execute(
    input: MarkAllNotificationsReadInput
  ): Promise<Result<{ count: number }, UseCaseError>> {
    const count = await this.repository.markAllAsRead(input.recipientId);
    return ok({ count });
  }
}
