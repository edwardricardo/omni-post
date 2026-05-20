/**
 * @file types.ts
 * @description Public types for the Social Inbox feature. Mirror the server DTOs
 *              (`SocialMessageDTO`, `SocialConversationDTO`,
 *              `CursorPaginatedResult<T>`) so the wire shape and the client
 *              type stay aligned — no client-side reinterpretation of the
 *              read model.
 * @layer infrastructure
 */

export type InboxPriority = "URGENT" | "HIGH" | "NORMAL" | "LOW";
export type InboxMessageWireType = "COMMENT" | "MENTION" | "REPLY" | "DIRECT_MESSAGE";
export type InboxMessageStatus = "UNREAD" | "READ" | "REPLIED" | "ARCHIVED";

/**
 * Flat inbox message DTO mirroring the server's `SocialMessageDTO`. All
 * fields the read endpoints expose, including the AI triage fields populated
 * by the TRIAGE_INBOX worker (priority, sentimentScore, suggestedReplies,
 * aiProcessedAt, crmContactId).
 */
export interface InboxMessage {
  id: string;
  accountId: string;
  projectId: string;
  channelId: string;
  conversationId: string | null;
  provider: string;
  providerMessageId: string;
  providerParentId: string | null;
  messageType: InboxMessageWireType;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorProviderId: string;
  body: string;
  mediaUrls: string[];
  webhookEventId: string | null;
  relatedPostId: string | null;
  status: InboxMessageStatus;
  assigneeId: string | null;
  isArchived: boolean;
  priority: InboxPriority;
  sentimentScore: number | null;
  suggestedReplies: string[];
  aiProcessedAt: string | null;
  crmContactId: string | null;
  providerCreatedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Cursor-paginated page of inbox messages — mirrors the server's
 * `CursorPaginatedResult<SocialMessageDTO>` (items + nextCursor + hasMore).
 */
export interface InboxMessagesPage {
  items: InboxMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Inbox conversation entity DTO mirroring the server's
 * `SocialConversationDTO`. Returned by `GET /inbox/conversations/:id`.
 */
export interface InboxConversation {
  id: string;
  accountId: string;
  projectId: string;
  channelId: string;
  provider: string;
  subject: string | null;
  participantCount: number;
  messageCount: number;
  lastMessageAt: string;
  isResolved: boolean;
  resolvedAt: string | null;
  resolvedById: string | null;
  rootProviderMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Filters consumed by the inbox listing hooks. Mirror the server
 * `InboxFilter` shape one-for-one (account scoping is applied server-side
 * from the JWT).
 */
export interface InboxFilters {
  projectId?: string;
  provider?: string;
  channelId?: string;
  messageType?: InboxMessageWireType;
  status?: InboxMessageStatus;
  assigneeId?: string;
}
