/**
 * @file mutations.ts
 * @description Mutation hooks for the Social Inbox — reply, resolve, reopen,
 *              assign, mark-read. Each one invalidates the relevant TanStack
 *              cache keys on success.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  assignMessage,
  markMessageRead,
  reopenConversation,
  resolveConversation,
  sendReply,
} from "./api.js";

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
      void queryClient.invalidateQueries({
        queryKey: ["inbox", "conversation-messages", conversationId],
      });
      void queryClient.invalidateQueries({ queryKey: ["inbox", "messages"] });
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
 * @description Mutation hook for marking an inbox message as read. Invalidates
 *              the entire `["inbox"]` query family on success so conversation
 *              lists (with unread counts), conversation detail, and message
 *              lists all refetch with the new read state. Errors propagate to
 *              the global `MutationCache.onError` handler wired in
 *              `createAppQueryClient` for logging — no silent failure.
 * @returns TanStack Query mutation that invalidates inbox queries on success
 */
export function useMarkMessageRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markMessageRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}
