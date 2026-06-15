/**
 * @file queries.ts
 * @description Read-only TanStack hooks for the Social Inbox — paginated
 *              message feed (infinite), single conversation entity, in-thread
 *              message list (infinite), and mentions feed. Return shapes
 *              mirror the server DTOs directly.
 * @layer infrastructure
 */

"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  fetchConversation,
  fetchConversationMessages,
  fetchInboxMessages,
  fetchMentions,
} from "./api";
import type { InboxFilters } from "./types";

/**
 * @hook useInboxMessages
 * @description Paginated inbox feed of social messages with optional filters
 *   (projectId, provider, channelId, messageType, status, assigneeId).
 *   Returns flat messages — not aggregated by conversation.
 */
export function useInboxMessages(filters: InboxFilters) {
  return useInfiniteQuery({
    queryKey: ["inbox", "messages", filters],
    queryFn: ({ pageParam }) => fetchInboxMessages(filters, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
  });
}

/**
 * @hook useMentions
 * @description Paginated feed scoped to messages where messageType === MENTION.
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
 * @description Fetches a single conversation entity by id (header / metadata).
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
 * @description Paginated messages inside a single conversation thread.
 */
export function useConversationMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: ["inbox", "conversation-messages", conversationId],
    queryFn: ({ pageParam }) =>
      fetchConversationMessages(conversationId!, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!conversationId,
    staleTime: 30_000,
  });
}
