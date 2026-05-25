/**
 * @file GetNotificationsQuery.ts
 * @description Application query handler for listing notifications with cursor-based pagination.
 *   Returns DTOs (not domain objects) following the CQRS read-side pattern.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import type { UseCase } from "../UseCase.js";
import type { UseCaseError } from "../UseCase.js";
import type { NotificationRepository } from "@core/domain/repositories/NotificationRepository.js";

/**
 * Input DTO for querying notifications
 */
export interface GetNotificationsInput {
  recipientId: string;
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
}

/**
 * Output DTO for notification data (CQRS read model)
 */
export interface NotificationDTO {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  actorName?: string;
  isRead: boolean;
  readAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Paginated response DTO
 */
export interface NotificationListDTO {
  items: NotificationDTO[];
  nextCursor?: string;
}

/**
 * @class GetNotificationsQuery
 * @description Retrieves notifications for a recipient, mapped to read-side DTOs
 *   with cursor-based pagination support.
 */
export class GetNotificationsQuery implements UseCase<
  GetNotificationsInput,
  NotificationListDTO,
  UseCaseError
> {
  constructor(private readonly repository: NotificationRepository) {}

  /**
   * @method execute
   * @description Loads notifications for the given recipient and maps to DTOs.
   * @param input - Query parameters including recipientId, cursor, limit, unreadOnly
   * @returns Result<NotificationListDTO> on success
   */
  async execute(input: GetNotificationsInput): Promise<Result<NotificationListDTO, UseCaseError>> {
    const limit = input.limit ?? 20;

    const result = await this.repository.findByRecipient(input.recipientId, {
      limit,
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      ...(input.unreadOnly !== undefined && { unreadOnly: input.unreadOnly }),
    });

    const items: NotificationDTO[] = result.items.map((notification) => ({
      id: notification.id.value,
      recipientId: notification.recipientId,
      type: notification.type.value,
      title: notification.title,
      body: notification.body,
      isRead: notification.isRead,
      createdAt: notification.createdAt.toISOString(),
      ...(notification.resourceType !== undefined && {
        resourceType: notification.resourceType,
      }),
      ...(notification.resourceId !== undefined && {
        resourceId: notification.resourceId,
      }),
      ...(notification.actorId !== undefined && { actorId: notification.actorId }),
      ...(notification.actorName !== undefined && {
        actorName: notification.actorName,
      }),
      ...(notification.readAt !== undefined && {
        readAt: notification.readAt.toISOString(),
      }),
      ...(notification.metadata !== undefined && { metadata: notification.metadata }),
    }));

    return ok({
      items,
      ...(result.nextCursor !== undefined && { nextCursor: result.nextCursor }),
    });
  }
}
