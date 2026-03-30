/**
 * @file MessageBubble.tsx
 * @description Single message row in the conversation thread.
 *              INBOUND: left-aligned gray bubble. OUTBOUND: right-aligned blue bubble.
 * @layer ui
 */

"use client";

import { formatDistanceToNow } from "date-fns";
import type { Message } from "@/hooks/api/useInbox";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === "OUTBOUND";
  const timeAgo = formatDistanceToNow(new Date(message.createdAt), { addSuffix: true });

  // Initials avatar
  const initials = message.senderName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className={[
        "flex items-end gap-2 px-4 py-1.5",
        isOutbound ? "flex-row-reverse" : "flex-row",
      ].join(" ")}
    >
      {/* Avatar */}
      {!isOutbound && (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-300 text-[10px] font-semibold text-gray-700"
          aria-label={message.senderName}
        >
          {initials}
        </div>
      )}

      {/* Bubble */}
      <div className={["max-w-[70%]", isOutbound ? "items-end" : "items-start"].join(" ")}>
        {!isOutbound && (
          <p className="mb-0.5 text-[11px] font-medium text-gray-500">{message.senderName}</p>
        )}
        <div
          className={[
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isOutbound
              ? "rounded-br-sm bg-indigo-600 text-white"
              : "rounded-bl-sm bg-gray-100 text-gray-900",
          ].join(" ")}
        >
          {message.body}
        </div>
        <p
          className={[
            "mt-0.5 text-[10px] text-gray-400",
            isOutbound ? "text-right" : "text-left",
          ].join(" ")}
        >
          {timeAgo}
        </p>
      </div>
    </div>
  );
}
