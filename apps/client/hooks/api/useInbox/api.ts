/**
 * @file api.ts
 * @description Internal fetch helpers for the Social Inbox endpoints. Each
 *              function maps directly to a backend route under
 *              `/api/backend/inbox` and unwraps the `{ ok, data }` envelope.
 *              Returned shapes mirror the server DTOs 1:1.
 * @layer infrastructure
 */

import type { InboxConversation, InboxFilters, InboxMessage, InboxMessagesPage } from "./types.js";

function buildInboxQueryString(filters: InboxFilters, cursor: string | null, limit = 20): string {
  const params = new URLSearchParams();
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.channelId) params.set("channelId", filters.channelId);
  if (filters.messageType) params.set("messageType", filters.messageType);
  if (filters.status) params.set("status", filters.status);
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return params.toString();
}

const EMPTY_PAGE: InboxMessagesPage = { items: [], nextCursor: null, hasMore: false };

export async function fetchInboxMessages(
  filters: InboxFilters,
  cursor: string | null
): Promise<InboxMessagesPage> {
  const res = await fetch(`/api/backend/inbox?${buildInboxQueryString(filters, cursor)}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch inbox");
  const envelope = (await res.json()) as { ok: boolean; data?: InboxMessagesPage };
  return envelope.ok && envelope.data ? envelope.data : EMPTY_PAGE;
}

export async function fetchMentions(
  cursor: string | null,
  projectId?: string
): Promise<InboxMessagesPage> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  if (projectId) params.set("projectId", projectId);

  const res = await fetch(`/api/backend/inbox/mentions?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch mentions");
  const envelope = (await res.json()) as { ok: boolean; data?: InboxMessagesPage };
  return envelope.ok && envelope.data ? envelope.data : EMPTY_PAGE;
}

export async function fetchConversation(id: string): Promise<InboxConversation> {
  const res = await fetch(`/api/backend/inbox/conversations/${id}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch conversation");
  const envelope = (await res.json()) as { ok: boolean; data?: InboxConversation };
  if (!envelope.ok || !envelope.data) throw new Error("Conversation not found");
  return envelope.data;
}

export async function fetchConversationMessages(
  conversationId: string,
  cursor: string | null
): Promise<InboxMessagesPage> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(
    `/api/backend/inbox/conversations/${conversationId}/messages?${params.toString()}`,
    { credentials: "include", cache: "no-store" }
  );
  if (!res.ok) throw new Error("Failed to fetch messages");
  const envelope = (await res.json()) as { ok: boolean; data?: InboxMessagesPage };
  return envelope.ok && envelope.data ? envelope.data : EMPTY_PAGE;
}

export async function sendReply(messageId: string, body: string): Promise<InboxMessage> {
  const res = await fetch(`/api/backend/inbox/messages/${messageId}/reply`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error("Failed to send reply");
  const envelope = (await res.json()) as { ok: boolean; data?: InboxMessage };
  if (!envelope.ok || !envelope.data) throw new Error("Reply failed");
  return envelope.data;
}

export async function resolveConversation(
  conversationId: string,
  resolvedById: string
): Promise<void> {
  const res = await fetch(`/api/backend/inbox/conversations/${conversationId}/resolve`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolvedById }),
  });
  if (!res.ok) throw new Error("Failed to resolve conversation");
}

export async function reopenConversation(conversationId: string): Promise<void> {
  const res = await fetch(`/api/backend/inbox/conversations/${conversationId}/reopen`, {
    method: "PATCH",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to reopen conversation");
}

export async function assignMessage(messageId: string, assigneeId: string): Promise<void> {
  const res = await fetch(`/api/backend/inbox/messages/${messageId}/assign`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assigneeId }),
  });
  if (!res.ok) throw new Error("Failed to assign message");
}

export async function markMessageRead(messageId: string): Promise<void> {
  const res = await fetch(`/api/backend/inbox/messages/${messageId}/read`, {
    method: "PATCH",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to mark message as read");
}
