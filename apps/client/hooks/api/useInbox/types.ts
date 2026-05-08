/**
 * @file types.ts
 * @description Public domain types for the Social Inbox feature — shared by
 *              read hooks, mutation hooks, and consuming components.
 * @layer infrastructure
 */

export type InboxPriority = "URGENT" | "HIGH" | "NORMAL" | "LOW";
export type InboxMessageType = "COMPLAINT" | "LEAD" | "QUESTION" | "FEEDBACK" | "SPAM";

export interface ConversationListItem {
  id: string;
  externalId: string;
  provider: string;
  channelId: string;
  status: "OPEN" | "RESOLVED" | "ARCHIVED";
  assigneeId: string | null;
  unreadCount: number;
  lastMessage: {
    body: string;
    createdAt: string;
    senderName: string;
  } | null;
  priority?: InboxPriority;
  messageType?: InboxMessageType;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation extends ConversationListItem {
  externalId: string;
}

export interface Message {
  id: string;
  body: string;
  senderName: string;
  senderAvatar?: string;
  createdAt: string;
  isInternal: boolean;
  direction: "INBOUND" | "OUTBOUND";
  read: boolean;
  priority?: InboxPriority;
  messageType?: InboxMessageType;
  suggestedReplies?: string[];
}

export interface InboxFilters {
  projectId?: string;
  provider?: string;
  status?: string;
  messageType?: string;
  assigneeId?: string;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
}
