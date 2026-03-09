/**
 * @file PrismaNotificationRepository.ts
 * @description Infrastructure adapter implementing NotificationRepository and
 *   NotificationPreferenceRepository ports using Prisma ORM.
 *   Maps between Prisma database types and domain entities.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type {
  NotificationRepository,
  NotificationPreferenceRepository,
  NotificationPreferenceDTO,
  NotificationFindOptions,
  NotificationPaginatedResult,
} from "../../domain/repositories/NotificationRepository.js";
import { NotificationEntity } from "../../domain/entities/Notification.js";
import { NotificationId } from "../../domain/value-objects/NotificationId.js";
import { NotificationType } from "../../domain/value-objects/NotificationType.js";
import { EntityNotFoundError } from "../../domain/errors/index.js";

/**
 * Raw Prisma row shape for type-safe mapping
 */
interface PrismaNotificationRow {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  actorId: string | null;
  actorName: string | null;
  isRead: boolean;
  readAt: Date | null;
  metadata: unknown;
  createdAt: Date;
}

/**
 * @class PrismaNotificationRepository
 * @description Adapter for NotificationRepository and NotificationPreferenceRepository
 *   using Prisma. Converts between Prisma database records and domain objects.
 */
export class PrismaNotificationRepository
  implements NotificationRepository, NotificationPreferenceRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a notification by its unique identifier.
   * @param id - The notification ID string
   * @returns Result containing entity on success, EntityNotFoundError if missing
   */
  async findById(id: string): Promise<Result<NotificationEntity, EntityNotFoundError>> {
    try {
      const row = await this.prisma.notification.findUnique({
        where: { id },
      });

      if (!row) {
        return err(new EntityNotFoundError("Notification", id));
      }

      return ok(this.toDomain(row));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "Notification",
          `${id} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  /**
   * @method findByRecipient
   * @description Retrieves notifications for a recipient with cursor-based pagination.
   *   Uses createdAt + id as a composite cursor for stable ordering.
   * @param recipientId - The recipient's team member ID
   * @param options - Pagination and filter options
   * @returns Paginated result with notifications and optional next cursor
   */
  async findByRecipient(
    recipientId: string,
    options: NotificationFindOptions
  ): Promise<NotificationPaginatedResult> {
    const limit = Math.min(options.limit, 100);

    // Build where clause
    const where: Record<string, unknown> = { recipientId };

    if (options.unreadOnly) {
      where.isRead = false;
    }

    // Apply cursor-based pagination using createdAt + id
    if (options.cursor) {
      const cursorRow = await this.prisma.notification.findUnique({
        where: { id: options.cursor },
        select: { createdAt: true, id: true },
      });

      if (cursorRow) {
        where.OR = [
          { createdAt: { lt: cursorRow.createdAt } },
          {
            createdAt: cursorRow.createdAt,
            id: { lt: cursorRow.id },
          },
        ];
      }
    }

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const lastItem = items[items.length - 1];

    return {
      items: items.map((row) => this.toDomain(row)),
      ...(hasMore && lastItem ? { nextCursor: lastItem.id } : {}),
    };
  }

  /**
   * @method save
   * @description Persists a notification (create or update via upsert).
   * @param notification - The NotificationEntity to save
   */
  async save(notification: NotificationEntity): Promise<void> {
    const base = {
      recipientId: notification.recipientId,
      type: notification.type.value,
      title: notification.title,
      body: notification.body,
      resourceType: notification.resourceType ?? null,
      resourceId: notification.resourceId ?? null,
      actorId: notification.actorId ?? null,
      actorName: notification.actorName ?? null,
      isRead: notification.isRead,
      readAt: notification.readAt ?? null,
    };

    // Prisma JSON fields require InputJsonValue (not plain null).
    // Conditionally spread metadata only when present.
    const metadataSpread =
      notification.metadata !== undefined
        ? { metadata: notification.metadata as Prisma.InputJsonValue }
        : {};

    await this.prisma.notification.upsert({
      where: { id: notification.id.value },
      create: {
        id: notification.id.value,
        ...base,
        ...metadataSpread,
      },
      update: {
        isRead: base.isRead,
        readAt: base.readAt,
      },
    });
  }

  /**
   * @method markAsRead
   * @description Marks a single notification as read by ID.
   * @param id - The notification ID string
   * @returns Result<void> on success, EntityNotFoundError if not found
   */
  async markAsRead(id: string): Promise<Result<void, EntityNotFoundError>> {
    try {
      const existing = await this.prisma.notification.findUnique({
        where: { id },
      });

      if (!existing) {
        return err(new EntityNotFoundError("Notification", id));
      }

      await this.prisma.notification.update({
        where: { id },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "Notification",
          `markAsRead failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method markAllAsRead
   * @description Marks all notifications for a recipient as read.
   * @param recipientId - The recipient's team member ID
   * @returns The number of notifications marked as read
   */
  async markAllAsRead(recipientId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        recipientId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return result.count;
  }

  /**
   * @method countUnread
   * @description Counts unread notifications for a recipient.
   * @param recipientId - The recipient's team member ID
   * @returns The count of unread notifications
   */
  async countUnread(recipientId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        recipientId,
        isRead: false,
      },
    });
  }

  /**
   * @method delete
   * @description Removes a notification by ID.
   * @param id - The notification ID string
   */
  async delete(id: string): Promise<void> {
    await this.prisma.notification.delete({
      where: { id },
    });
  }

  // --- NotificationPreferenceRepository ---

  /**
   * @method findByMember
   * @description Retrieves all notification preferences for a team member.
   * @param memberId - The team member ID
   * @returns Array of preference DTOs
   */
  async findByMember(memberId: string): Promise<NotificationPreferenceDTO[]> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { memberId },
      orderBy: { type: "asc" },
    });

    return rows.map((row) => ({
      type: row.type,
      enabled: row.enabled,
    }));
  }

  /**
   * @method upsert
   * @description Creates or updates a notification preference for a member and type.
   * @param memberId - The team member ID
   * @param type - The notification type string
   * @param enabled - Whether this notification type is enabled
   */
  async upsert(memberId: string, type: string, enabled: boolean): Promise<void> {
    // Cast type to the Prisma enum. The domain layer validates the type value.
    const prismaType = type as Parameters<
      typeof this.prisma.notificationPreference.upsert
    >[0]["create"]["type"];

    await this.prisma.notificationPreference.upsert({
      where: {
        memberId_type: {
          memberId,
          type: prismaType,
        },
      },
      create: {
        memberId,
        type: prismaType,
        enabled,
      },
      update: {
        enabled,
      },
    });
  }

  /**
   * @method toDomain
   * @description Maps a Prisma row to a NotificationEntity domain object.
   * @param row - Raw Prisma record
   * @returns Reconstituted NotificationEntity
   */
  private toDomain(row: PrismaNotificationRow): NotificationEntity {
    const typeResult = NotificationType.fromString(row.type);
    // DB should always have valid types; fall back to MENTION for safety
    const type = typeResult.ok
      ? typeResult.value
      : (NotificationType.create("MENTION") as { ok: true; value: NotificationType }).value;

    return NotificationEntity.reconstitute({
      id: NotificationId.fromStringUnsafe(row.id),
      recipientId: row.recipientId,
      type,
      title: row.title,
      body: row.body,
      isRead: row.isRead,
      createdAt: row.createdAt,
      ...(row.resourceType !== null && { resourceType: row.resourceType }),
      ...(row.resourceId !== null && { resourceId: row.resourceId }),
      ...(row.actorId !== null && { actorId: row.actorId }),
      ...(row.actorName !== null && { actorName: row.actorName }),
      ...(row.readAt !== null && { readAt: row.readAt }),
      ...(row.metadata !== null && { metadata: row.metadata as Record<string, unknown> }),
    });
  }
}
