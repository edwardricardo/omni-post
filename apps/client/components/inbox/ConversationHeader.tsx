/**
 * @file ConversationHeader.tsx
 * @description Header for the conversation thread view. Shows the platform
 *              name, conversation subject (or message count fallback), the
 *              open/resolved status pill, and a Resolve/Reopen action button.
 * @layer infrastructure
 */

"use client";

import { useTranslations } from "next-intl";
import { useResolveConversation, useReopenConversation } from "@/hooks/api/useInbox";
import type { InboxConversation } from "@/hooks/api/useInbox";

interface ConversationHeaderProps {
  conversation: InboxConversation;
  userId: string;
}

/**
 * @component ConversationHeader
 * @description Header bar for the conversation thread view. Surfaces the
 *              platform, subject (if any), status pill, and a Resolve/Reopen
 *              toggle.
 * @param props.conversation - The full conversation entity DTO.
 * @param props.userId - The current user id used as `resolvedById` when
 *   marking the conversation resolved.
 */
export function ConversationHeader({ conversation, userId }: ConversationHeaderProps) {
  const t = useTranslations("inbox.components");
  const resolveMutation = useResolveConversation();
  const reopenMutation = useReopenConversation();

  const statusLabel = conversation.isResolved ? t("statusResolved") : t("statusOpen");
  const statusColour = conversation.isResolved
    ? "bg-gray-100 text-gray-600"
    : "bg-green-100 text-green-700";
  const subject = conversation.subject ?? t("messageCount", { count: conversation.messageCount });

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium capitalize text-gray-700">
          {conversation.provider.toLowerCase()}
        </span>
        <span className="text-gray-300">·</span>
        <span className="truncate text-sm text-gray-600">{subject}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColour}`}>
          {statusLabel}
        </span>
      </div>

      {conversation.isResolved ? (
        <button
          onClick={() => reopenMutation.mutate(conversation.id)}
          disabled={reopenMutation.isPending}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60"
        >
          {reopenMutation.isPending ? t("reopening") : t("reopen")}
        </button>
      ) : (
        <button
          onClick={() =>
            resolveMutation.mutate({ conversationId: conversation.id, resolvedById: userId })
          }
          disabled={resolveMutation.isPending}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60"
        >
          {resolveMutation.isPending ? t("resolving") : t("resolve")}
        </button>
      )}
    </div>
  );
}
