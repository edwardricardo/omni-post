/**
 * @file SocialMessageQueryRepository.ts
 * @description Read-model query repository port for Social Inbox messages.
 *   Returns flat DTOs for query operations (CQRS read side).
 * @layer domain
 */

import { type ProviderType } from "../value-objects/Provider.js";
import { type SocialMessageTypeValue } from "../value-objects/SocialMessageType.js";
import { type SocialMessageStatusValue } from "../value-objects/SocialMessageStatus.js";

/**
 * DTO for Social Inbox message list items.
 */
export interface SocialMessageDTO {
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

/**
 * Filter criteria for inbox queries.
 */
export interface InboxFilter {
  accountId: string;
  projectId?: string;
  channelId?: string;
  provider?: ProviderType;
  messageType?: SocialMessageTypeValue;
  status?: SocialMessageStatusValue;
  assigneeId?: string;
  isArchived?: boolean;
}

/**
 * Cursor-based pagination options.
 */
export interface CursorPagination {
  cursor?: string;
  limit: number;
}

/**
 * Cursor-paginated result.
 */
export interface CursorPaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * @interface SocialMessageQueryRepository
 * @description Read-model port for querying social inbox messages with cursor-based pagination.
 */
export interface SocialMessageQueryRepository {
  /**
   * @method findInbox
   * @description Unified inbox feed with cursor-based pagination and filters.
   * @param filter - Filter criteria
   * @param pagination - Cursor-based pagination options
   * @returns Paginated list of message DTOs
   */
  findInbox(
    filter: InboxFilter,
    pagination: CursorPagination
  ): Promise<CursorPaginatedResult<SocialMessageDTO>>;

  /**
   * @method findMentions
   * @description Filtered view showing only mentions.
   * @param accountId - The account ID
   * @param projectId - Optional project filter
   * @param pagination - Cursor-based pagination options
   * @returns Paginated list of mention DTOs
   */
  findMentions(
    accountId: string,
    projectId: string | undefined,
    pagination: CursorPagination
  ): Promise<CursorPaginatedResult<SocialMessageDTO>>;

  /**
   * @method countUnread
   * @description Count unread messages for an account/project.
   * @param accountId - The account ID
   * @param projectId - Optional project filter
   * @returns Number of unread messages
   */
  countUnread(accountId: string, projectId?: string): Promise<number>;

  /**
   * @method findByConversationId
   * @description Get all messages in a conversation, ordered by providerCreatedAt.
   * @param conversationId - The conversation ID
   * @param pagination - Cursor-based pagination options
   * @returns Paginated list of messages in the conversation
   */
  findByConversationId(
    conversationId: string,
    pagination: CursorPagination
  ): Promise<CursorPaginatedResult<SocialMessageDTO>>;
}
