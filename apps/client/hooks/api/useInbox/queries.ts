/**
 * @file queries.ts
 * @description Read-only TanStack hooks for the Social Inbox — conversation
 *              list (infinite), single conversation, message list (infinite),
 *              and mentions feed.
 * @layer infrastructure
 */

"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchConversation, fetchConversations, fetchMentions, fetchMessages } from "./api";
import type { InboxFilters } from "./types";

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
