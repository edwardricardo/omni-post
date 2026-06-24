/**
 * @file NotificationRepository.ts
 * @description Port interfaces for Notification persistence and preference management.
 *   Defines the contracts that infrastructure adapters must fulfill.
 * @layer domain
 */
import type { Result } from "@shared/types";
import type { NotificationEntity } from "../entities/Notification.js";
import type { EntityNotFoundError } from "../errors/index.js";
import type { AccountId } from "../value-objects/EntityId.js";

/**
 * @interface NotificationPreferenceDTO
 * @description Read-model DTO for notification preferences per type.
 */
export interface NotificationPreferenceDTO {
  type: string;
  enabled: boolean;
}

/**
 * @interface NotificationFindOptions
 * @description Options for paginated notification queries.
 */
export interface NotificationFindOptions {
  cursor?: string;
  limit: number;
  unreadOnly?: boolean;
}

/**
 * @interface NotificationPaginatedResult
 * @description Paginated result for notification queries with cursor-based pagination.
 */
export interface NotificationPaginatedResult {
  items: NotificationEntity[];
  nextCursor?: string;
}

/**
 * @interface NotificationRepository
 * @description Command + query repository port for Notification entity persistence.
 *   Returns domain objects, never raw Prisma types.
 */
export interface NotificationRepository {
  /**
   * @method findById
   * @description Finds a notification by its unique identifier.
   * @param id - The notification ID string
   * @returns Result containing the entity on success, EntityNotFoundError if not found
   */
  findById(id: string): Promise<Result<NotificationEntity, EntityNotFoundError>>;

  /**
   * @method findByRecipient
   * @description Retrieves notifications for a recipient with cursor-based pagination.
   * @param recipientId - The recipient's team member ID
   * @param options - Pagination and filter options
   * @returns Paginated result with notifications and optional next cursor
   */
  findByRecipient(
    recipientId: string,
    options: NotificationFindOptions
  ): Promise<NotificationPaginatedResult>;

  /**
   * @method save
   * @description Persists a notification (create or update).
   * @param notification - The NotificationEntity to save
   */
  save(notification: NotificationEntity): Promise<void>;

  /**
   * @method markAsRead
   * @description Marks a single notification as read by ID.
   * @param id - The notification ID string
   * @returns Result<void> on success, EntityNotFoundError if not found
   */
  markAsRead(id: string): Promise<Result<void, EntityNotFoundError>>;

  /**
   * @method markAllAsRead
   * @description Marks all notifications for a recipient as read.
   * @param recipientId - The recipient's team member ID
   * @returns The number of notifications marked as read
   */
  markAllAsRead(recipientId: string): Promise<number>;

  /**
   * @method countUnread
   * @description Counts unread notifications for a recipient.
   * @param recipientId - The recipient's team member ID
   * @returns The count of unread notifications
   */
  countUnread(recipientId: string): Promise<number>;

  /**
   * @method delete
   * @description Removes a notification by ID.
   * @param id - The notification ID string
   */
  delete(id: string): Promise<void>;

  /**
   * @method findRecipientAccountId
   * @description Resolves the owning tenant of a notification recipient via the
   *   `recipient (CustomerUser) -> accountId` chain. Returns `null` when the
   *   recipient does not exist. Used by the cross-tenant recipient gate
   *   (CWE-639) on notification creation — a caller may only notify recipients
   *   within their own account; a foreign/unknown recipient is rejected with
   *   NOT_FOUND (anti-enumeration).
   * @param recipientId - The recipient's CustomerUser ID
   */
  findRecipientAccountId(recipientId: string): Promise<AccountId | null>;
}

/**
 * @interface NotificationPreferenceRepository
 * @description Repository port for managing per-member notification preferences.
 */
export interface NotificationPreferenceRepository {
  /**
   * @method findByMember
   * @description Retrieves all notification preferences for a team member.
   * @param memberId - The team member ID
   * @returns Array of preference DTOs
   */
  findByMember(memberId: string): Promise<NotificationPreferenceDTO[]>;

  /**
   * @method upsert
   * @description Creates or updates a notification preference for a member and type.
   * @param memberId - The team member ID
   * @param type - The notification type string
   * @param enabled - Whether this notification type is enabled
   */
  upsert(memberId: string, type: string, enabled: boolean): Promise<void>;
}
