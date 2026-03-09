/**
 * @file PrismaSocialMessageQueryRepository.ts
 * @description Prisma adapter implementing the SocialMessageQueryRepository port.
 *   Read-side repository for the Social Inbox CQRS query path. Returns flat DTOs
 *   with cursor-based pagination (no domain reconstitution).
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type $Enums } from "@infra/prisma";

import {
  type SocialMessageQueryRepository,
  type SocialMessageDTO,
  type InboxFilter,
  type CursorPagination,
  type CursorPaginatedResult,
} from "../../domain/repositories/SocialMessageQueryRepository.js";

/**
 * @class PrismaSocialMessageQueryRepository
 * @description Infrastructure adapter for read-model queries on social inbox messages.
 *   Implements cursor-based pagination using the composite cursor (providerCreatedAt + id).
 */
export class PrismaSocialMessageQueryRepository implements SocialMessageQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findInbox
   * @description Unified inbox feed with cursor-based pagination and flexible filters.
   *   Orders by providerCreatedAt DESC, id DESC (newest first).
   * @param filter - Filter criteria (accountId required, others optional)
   * @param pagination - Cursor and limit for pagination
   * @returns Paginated list of SocialMessageDTO items
   */
  async findInbox(
    filter: InboxFilter,
    pagination: CursorPagination
  ): Promise<CursorPaginatedResult<SocialMessageDTO>> {
    const where = this.buildWhereClause(filter);
    const cursorCondition = this.parseCursorCondition(pagination.cursor, "DESC");

    const rows = await this.prisma.socialMessage.findMany({
      where: {
        ...where,
        ...cursorCondition,
      },
      orderBy: [{ providerCreatedAt: "desc" }, { id: "desc" }],
      take: pagination.limit + 1,
    });

    return this.buildPaginatedResult(rows, pagination.limit, "DESC");
  }

  /**
   * @method findMentions
   * @description Filtered inbox view showing only MENTION messages.
   * @param accountId - The account ID
   * @param projectId - Optional project filter
   * @param pagination - Cursor and limit for pagination
   * @returns Paginated list of mention SocialMessageDTO items
   */
  async findMentions(
    accountId: string,
    projectId: string | undefined,
    pagination: CursorPagination
  ): Promise<CursorPaginatedResult<SocialMessageDTO>> {
    const filter: InboxFilter = {
      accountId,
      messageType: "MENTION",
      isArchived: false,
      ...(projectId !== undefined && { projectId }),
    };

    return this.findInbox(filter, pagination);
  }

  /**
   * @method countUnread
   * @description Counts unread, non-archived messages for an account (optionally scoped to project).
   * @param accountId - The account ID
   * @param projectId - Optional project filter
   * @returns The count of unread messages
   */
  async countUnread(accountId: string, projectId?: string): Promise<number> {
    return this.prisma.socialMessage.count({
      where: {
        accountId,
        status: "UNREAD" as $Enums.SocialMessageStatus,
        isArchived: false,
        ...(projectId !== undefined && { projectId }),
      },
    });
  }

  /**
   * @method findByConversationId
   * @description Retrieves all messages in a conversation, ordered chronologically (ASC).
   * @param conversationId - The conversation ID
   * @param pagination - Cursor and limit for pagination
   * @returns Paginated list of messages in the conversation
   */
  async findByConversationId(
    conversationId: string,
    pagination: CursorPagination
  ): Promise<CursorPaginatedResult<SocialMessageDTO>> {
    const cursorCondition = this.parseCursorCondition(pagination.cursor, "ASC");

    const rows = await this.prisma.socialMessage.findMany({
      where: {
        conversationId,
        ...cursorCondition,
      },
      orderBy: [{ providerCreatedAt: "asc" }, { id: "asc" }],
      take: pagination.limit + 1,
    });

    return this.buildPaginatedResult(rows, pagination.limit, "ASC");
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * @method buildWhereClause
   * @description Builds a Prisma WHERE clause from the InboxFilter,
   *   using conditional spreads for optional properties.
   * @param filter - The inbox filter criteria
   * @returns A Prisma-compatible where object
   */
  private buildWhereClause(filter: InboxFilter): Record<string, unknown> {
    return {
      accountId: filter.accountId,
      ...(filter.projectId !== undefined && { projectId: filter.projectId }),
      ...(filter.channelId !== undefined && { channelId: filter.channelId }),
      ...(filter.provider !== undefined && {
        provider: filter.provider as $Enums.Provider,
      }),
      ...(filter.messageType !== undefined && {
        messageType: filter.messageType as $Enums.SocialMessageType,
      }),
      ...(filter.status !== undefined && {
        status: filter.status as $Enums.SocialMessageStatus,
      }),
      ...(filter.assigneeId !== undefined && {
        assigneeId: filter.assigneeId,
      }),
      ...(filter.isArchived !== undefined && {
        isArchived: filter.isArchived,
      }),
    };
  }

  /**
   * @method parseCursorCondition
   * @description Parses a cursor string into a Prisma WHERE condition for keyset pagination.
   *   Cursor format: `${providerCreatedAt.toISOString()}_${id}`
   * @param cursor - The cursor string, or undefined for the first page
   * @param direction - Sort direction (ASC or DESC)
   * @returns A Prisma-compatible OR condition, or empty object if no cursor
   */
  private parseCursorCondition(
    cursor: string | undefined,
    direction: "ASC" | "DESC"
  ): Record<string, unknown> {
    if (cursor === undefined) {
      return {};
    }

    const separatorIndex = cursor.indexOf("_");
    if (separatorIndex === -1) {
      return {};
    }

    const dateStr = cursor.substring(0, separatorIndex);
    const cursorId = cursor.substring(separatorIndex + 1);
    const cursorDate = new Date(dateStr);

    if (isNaN(cursorDate.getTime())) {
      return {};
    }

    const dateOp = direction === "DESC" ? "lt" : "gt";
    const idOp = direction === "DESC" ? "lt" : "gt";

    return {
      OR: [
        { providerCreatedAt: { [dateOp]: cursorDate } },
        {
          providerCreatedAt: cursorDate,
          id: { [idOp]: cursorId },
        },
      ],
    };
  }

  /**
   * @method buildPaginatedResult
   * @description Constructs a CursorPaginatedResult from a query result set.
   *   Uses the take+1 pattern to determine hasMore.
   * @param rows - The query result rows (may include 1 extra for hasMore detection)
   * @param limit - The requested page size
   * @param direction - Sort direction (ASC or DESC) for cursor encoding
   * @returns A CursorPaginatedResult with items, nextCursor, and hasMore
   */
  private buildPaginatedResult(
    rows: unknown[],
    limit: number,
    direction: "ASC" | "DESC"
  ): CursorPaginatedResult<SocialMessageDTO> {
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows) as PrismaSocialMessageRow[];
    const dtos = items.map((row) => this.toDTO(row));

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      if (lastItem) {
        nextCursor = this.encodeCursor(lastItem.providerCreatedAt, lastItem.id);
      }
    }

    return { items: dtos, nextCursor, hasMore };
  }

  /**
   * @method encodeCursor
   * @description Encodes a providerCreatedAt + id pair into a cursor string.
   * @param date - The providerCreatedAt timestamp
   * @param id - The message ID
   * @returns The encoded cursor string
   */
  private encodeCursor(date: Date, id: string): string {
    return `${date.toISOString()}_${id}`;
  }

  /**
   * @method toDTO
   * @description Maps a raw Prisma row to a SocialMessageDTO (flat read model).
   * @param row - The raw Prisma row
   * @returns A SocialMessageDTO
   */
  private toDTO(row: PrismaSocialMessageRow): SocialMessageDTO {
    return {
      id: row.id,
      accountId: row.accountId,
      projectId: row.projectId,
      channelId: row.channelId,
      conversationId: row.conversationId,
      provider: row.provider,
      providerMessageId: row.providerMessageId,
      providerParentId: row.providerParentId,
      messageType: row.messageType,
      authorName: row.authorName,
      authorHandle: row.authorHandle,
      authorAvatarUrl: row.authorAvatarUrl,
      authorProviderId: row.authorProviderId,
      body: row.body,
      mediaUrls: [...row.mediaUrls],
      webhookEventId: row.webhookEventId,
      relatedPostId: row.relatedPostId,
      status: row.status,
      assigneeId: row.assigneeId,
      isArchived: row.isArchived,
      providerCreatedAt: row.providerCreatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal row type (mirrors Prisma model without importing generated types)
// ---------------------------------------------------------------------------

interface PrismaSocialMessageRow {
  id: string;
  accountId: string;
  projectId: string;
  channelId: string;
  conversationId: string | null;
  provider: string;
  providerMessageId: string;
  providerParentId: string | null;
  messageType: string;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorProviderId: string;
  body: string;
  mediaUrls: string[];
  webhookEventId: string | null;
  relatedPostId: string | null;
  status: string;
  assigneeId: string | null;
  isArchived: boolean;
  providerCreatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
