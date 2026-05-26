/**
 * @file MessageBubble.tsx
 * @description Single message row in the conversation thread. All inbox feed
 *              messages are inbound from the platform; the server does not
 *              currently emit outbound replies in the message stream, so the
 *              bubble renders inbound style only. Surfaces AI triage suggestions
 *              (suggested replies) below the body for inbound messages.
 * @layer infrastructure
 */

"use client";

import { memo } from "react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import type { InboxMessage } from "@/hooks/api/useInbox";

interface MessageBubbleProps {
  message: InboxMessage;
  /** Fires with the chosen text when the user clicks a suggested reply chip. */
  onSelectReply?: (text: string) => void;
}

/**
 * @component MessageBubble
 * @description Single message row in the conversation thread. Shows the sender
 *              avatar (initials), author name, body, relative timestamp, and
 *              the three AI-suggested replies as clickable chips.
 * @param props.message - The flat inbox-message DTO.
 * @param props.onSelectReply - Callback when a suggested reply chip is clicked.
 */
function MessageBubbleComponent({ message, onSelectReply }: MessageBubbleProps) {
  const t = useTranslations("inbox.components");
  const timeAgo = formatDistanceToNow(new Date(message.providerCreatedAt), { addSuffix: true });

  const initials = message.authorName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex items-end gap-2 px-4 py-1.5">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-300 text-[10px] font-semibold text-gray-700"
        aria-label={message.authorName}
      >
        {initials}
      </div>

      <div className="max-w-[70%] items-start">
        <p className="mb-0.5 text-[11px] font-medium text-gray-500">{message.authorName}</p>
        <div className="rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-gray-900">
          {message.body}
        </div>
        <p className="mt-0.5 text-left text-[10px] text-gray-400">{timeAgo}</p>

        {message.suggestedReplies.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.suggestedReplies.map((reply, i) => (
              <button
                key={i}
                onClick={() => onSelectReply?.(reply)}
                className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 transition-colors hover:bg-blue-100"
                aria-label={t("useSuggestedReply", { reply })}
              >
                {reply}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
