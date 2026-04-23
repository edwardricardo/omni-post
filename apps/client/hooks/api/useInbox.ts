/**
 * @file useInbox.ts
 * @description TanStack Query hooks for Social Inbox data.
 *              Covers conversation list (infinite), unread count, conversation detail,
 *              messages, and mutations (reply, resolve, reopen, assign, mark read).
 * @layer infrastructure
 */

"use client";

import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface InboxFilters {
  projectId?: string;
  provider?: string;
  status?: string;
  messageType?: string;
  assigneeId?: string;
}

interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchConversations(
  filters: InboxFilters,
  cursor: string | null
): Promise<PagedResult<ConversationListItem>> {
  const params = new URLSearchParams();
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.status) params.set("status", filters.status);
  if (filters.messageType) params.set("messageType", filters.messageType);
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", "20");

  const res = await fetch(`/api/backend/inbox?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch inbox");
  const data = (await res.json()) as { ok: boolean; value?: PagedResult<ConversationListItem> };
  return data.ok && data.value ? data.value : { items: [], nextCursor: null };
}

async function fetchMentions(
  cursor: string | null,
  projectId?: string
): Promise<PagedResult<ConversationListItem>> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  if (projectId) params.set("projectId", projectId);

  const res = await fetch(`/api/backend/inbox/mentions?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch mentions");
  const data = (await res.json()) as { ok: boolean; value?: PagedResult<ConversationListItem> };
  return data.ok && data.value ? data.value : { items: [], nextCursor: null };
}

async function fetchConversation(id: string): Promise<Conversation> {
  const res = await fetch(`/api/backend/inbox/conversations/${id}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch conversation");
  const data = (await res.json()) as { ok: boolean; value?: Conversation };
  if (!data.ok || !data.value) throw new Error("Conversation not found");
  return data.value;
}

async function fetchMessages(
  conversationId: string,
  cursor: string | null
): Promise<PagedResult<Message>> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(
    `/api/backend/inbox/conversations/${conversationId}/messages?${params.toString()}`,
    { credentials: "include", cache: "no-store" }
  );
  if (!res.ok) throw new Error("Failed to fetch messages");
  const data = (await res.json()) as { ok: boolean; value?: PagedResult<Message> };
  return data.ok && data.value ? data.value : { items: [], nextCursor: null };
}

async function sendReply(messageId: string, body: string): Promise<Message> {
  const res = await fetch(`/api/backend/inbox/messages/${messageId}/reply`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error("Failed to send reply");
  const data = (await res.json()) as { ok: boolean; value?: Message };
  if (!data.ok || !data.value) throw new Error("Reply failed");
  return data.value;
}

async function resolveConversation(conversationId: string, resolvedById: string): Promise<void> {
  const res = await fetch(`/api/backend/inbox/conversations/${conversationId}/resolve`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolvedById }),
  });
  if (!res.ok) throw new Error("Failed to resolve conversation");
}

async function reopenConversation(conversationId: string): Promise<void> {
  const res = await fetch(`/api/backend/inbox/conversations/${conversationId}/reopen`, {
    method: "PATCH",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to reopen conversation");
}

async function assignMessage(messageId: string, assigneeId: string): Promise<void> {
  const res = await fetch(`/api/backend/inbox/messages/${messageId}/assign`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assigneeId }),
  });
  if (!res.ok) throw new Error("Failed to assign message");
}

async function markMessageRead(messageId: string): Promise<void> {
  await fetch(`/api/backend/inbox/messages/${messageId}/read`, {
    method: "PATCH",
    credentials: "include",
  });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * @hook useInboxConversations
 * @description Fetches paginated inbox conversations with infinite scrolling and optional filters.
 * @param filters - Filter options: projectId, provider, status, messageType, assigneeId
 * @returns TanStack infinite query result with conversation pages
 */
export function useInboxConversations(filters: InboxFilters) {
  return useInfiniteQuery({
    queryKey: ["inbox", "conversations", filters],
    queryFn: ({ pageParam }) => fetchConversations(filters, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
  });
}

/**
 * @hook useMentions
 * @description Fetches paginated social mentions with infinite scrolling.
 * @param projectId - Optional project to filter mentions for
 * @returns TanStack infinite query result with mention conversation pages
 */
export function useMentions(projectId?: string) {
  return useInfiniteQuery({
    queryKey: ["inbox", "mentions", projectId],
    queryFn: ({ pageParam }) => fetchMentions(pageParam as string | null, projectId),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
  });
}

/**
 * @hook useConversation
 * @description Fetches a single inbox conversation by ID.
 * @param id - The conversation ID, or null to disable
 * @returns TanStack Query result with conversation data
 */
export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ["inbox", "conversation", id],
    queryFn: () => fetchConversation(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/**
 * @hook useConversationMessages
 * @description Fetches paginated messages for a conversation with infinite scrolling.
 * @param conversationId - The conversation to fetch messages for, or null to disable
 * @returns TanStack infinite query result with message pages
 */
export function useConversationMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: ["inbox", "messages", conversationId],
    queryFn: ({ pageParam }) => fetchMessages(conversationId!, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!conversationId,
    staleTime: 30_000,
  });
}

/**
 * @hook useSendReply
 * @description Mutation hook for sending a reply to a conversation message.
 * @param conversationId - The conversation the reply belongs to
 * @returns TanStack Query mutation that invalidates messages and conversations on success
 */
export function useSendReply(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, body }: { messageId: string; body: string }) =>
      sendReply(messageId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox", "messages", conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["inbox", "conversations"] });
    },
  });
}

/**
 * @hook useResolveConversation
 * @description Mutation hook for marking a conversation as resolved.
 * @returns TanStack Query mutation that invalidates all inbox queries on success
 */
export function useResolveConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      resolvedById,
    }: {
      conversationId: string;
      resolvedById: string;
    }) => resolveConversation(conversationId, resolvedById),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

/**
 * @hook useReopenConversation
 * @description Mutation hook for reopening a previously resolved conversation.
 * @returns TanStack Query mutation that invalidates all inbox queries on success
 */
export function useReopenConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => reopenConversation(conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

/**
 * @hook useAssignMessage
 * @description Mutation hook for assigning an inbox message to a team member.
 * @returns TanStack Query mutation that invalidates all inbox queries on success
 */
export function useAssignMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, assigneeId }: { messageId: string; assigneeId: string }) =>
      assignMessage(messageId, assigneeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

/**
 * @hook useMarkMessageRead
 * @description Mutation hook for marking a message as read.
 * @returns TanStack Query mutation for the read status update
 */
export function useMarkMessageRead() {
  return useMutation({
    mutationFn: (messageId: string) => markMessageRead(messageId),
  });
}
