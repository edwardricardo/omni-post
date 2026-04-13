/**
 * @file ConversationHeader.tsx
 * @description Header for the conversation thread view. Shows platform badge,
 *              sender name, status badge, and Resolve/Reopen button.
 * @layer ui
 */

"use client";

import { useResolveConversation, useReopenConversation } from "@/hooks/api/useInbox";
import type { Conversation } from "@/hooks/api/useInbox";

interface ConversationHeaderProps {
  conversation: Conversation;
  userId: string;
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  RESOLVED: "Resolved",
  ARCHIVED: "Archived",
};

const STATUS_COLOURS: Record<string, string> = {
  OPEN: "bg-green-100 text-green-700",
  RESOLVED: "bg-gray-100 text-gray-600",
  ARCHIVED: "bg-yellow-100 text-yellow-700",
};

/**
 * @component ConversationHeader
 * @description Header bar for the conversation thread view. Shows platform name,
 *              sender, status badge, and a Resolve/Reopen toggle button.
 * @param props.conversation - The full conversation object
 * @param props.userId - ID of the current user performing resolve/reopen actions
 */
export function ConversationHeader({ conversation, userId }: ConversationHeaderProps) {
  const resolveMutation = useResolveConversation();
  const reopenMutation = useReopenConversation();

  const isOpen = conversation.status === "OPEN";
  const statusLabel = STATUS_LABELS[conversation.status] ?? conversation.status;
  const statusColour = STATUS_COLOURS[conversation.status] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 shrink-0">
      <div className="flex items-center gap-3">
        {/* Platform */}
        <span className="text-sm font-medium capitalize text-gray-700">
          {conversation.provider}
        </span>
        <span className="text-gray-300">·</span>
        <span className="text-sm text-gray-600">
          {conversation.lastMessage?.senderName ?? "Unknown"}
        </span>
        {/* Status badge */}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColour}`}>
          {statusLabel}
        </span>
      </div>

      {/* Resolve / Reopen */}
      {isOpen ? (
        <button
          onClick={() =>
            resolveMutation.mutate({ conversationId: conversation.id, resolvedById: userId })
          }
          disabled={resolveMutation.isPending}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60"
        >
          {resolveMutation.isPending ? "Resolving…" : "Resolve"}
        </button>
      ) : (
        <button
          onClick={() => reopenMutation.mutate(conversation.id)}
          disabled={reopenMutation.isPending}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60"
        >
          {reopenMutation.isPending ? "Reopening…" : "Reopen"}
        </button>
      )}
    </div>
  );
}
