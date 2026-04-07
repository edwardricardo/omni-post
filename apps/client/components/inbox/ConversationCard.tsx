/**
 * @file ConversationCard.tsx
 * @description Single conversation row in the inbox conversation list.
 *              Shows: platform badge, sender name, message preview, relative time,
 *              and unread dot.
 * @layer ui
 */

"use client";

import { formatDistanceToNow } from "date-fns";
import type { ConversationListItem, InboxMessageType } from "@/hooks/api/useInbox";

// ---------------------------------------------------------------------------
// Platform badge colours
// ---------------------------------------------------------------------------

const PROVIDER_COLOURS: Record<string, string> = {
  x: "bg-black text-white",
  instagram: "bg-gradient-to-br from-purple-500 to-pink-500 text-white",
  facebook: "bg-blue-600 text-white",
  youtube: "bg-red-600 text-white",
  tiktok: "bg-black text-white",
  snapchat: "bg-yellow-400 text-black",
  telegram: "bg-sky-500 text-white",
  pinterest: "bg-red-500 text-white",
  linkedin: "bg-blue-700 text-white",
};

const MESSAGE_TYPE_STYLES: Record<InboxMessageType, string> = {
  COMPLAINT: "bg-red-100 text-red-700",
  LEAD: "bg-green-100 text-green-700",
  QUESTION: "bg-blue-100 text-blue-700",
  SPAM: "bg-gray-100 text-gray-500",
  FEEDBACK: "bg-gray-100 text-gray-600",
};

const PRIORITY_COLOURS: Record<string, string> = {
  URGENT: "bg-red-500",
  HIGH: "bg-orange-500",
  LOW: "bg-gray-400",
};

const PROVIDER_LABELS: Record<string, string> = {
  x: "X",
  instagram: "IG",
  facebook: "FB",
  youtube: "YT",
  tiktok: "TK",
  snapchat: "SC",
  telegram: "TG",
  pinterest: "PI",
  linkedin: "LI",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ConversationCardProps {
  conversation: ConversationListItem;
  selected: boolean;
  onClick: () => void;
}

export function ConversationCard({ conversation, selected, onClick }: ConversationCardProps) {
  const colour = PROVIDER_COLOURS[conversation.provider] ?? "bg-gray-500 text-white";
  const label =
    PROVIDER_LABELS[conversation.provider] ?? conversation.provider.slice(0, 2).toUpperCase();
  const preview = conversation.lastMessage?.body ?? "No messages yet";
  const truncatedPreview = preview.length > 80 ? `${preview.slice(0, 80)}…` : preview;
  const timeAgo = conversation.lastMessage
    ? formatDistanceToNow(new Date(conversation.lastMessage.createdAt), { addSuffix: true })
    : "";

  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors",
        selected && "bg-indigo-50 border-l-2 border-l-indigo-500",
        conversation.unreadCount > 0 && !selected && "bg-blue-50/30",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Conversation with ${conversation.lastMessage?.senderName ?? "unknown"} on ${conversation.provider}`}
      aria-current={selected ? "true" : undefined}
    >
      <div className="flex items-start gap-3">
        {/* Unread dot */}
        <div className="mt-1.5 shrink-0 w-2">
          {conversation.unreadCount > 0 && (
            <span className="block h-2 w-2 rounded-full bg-blue-500" aria-label="Unread" />
          )}
        </div>

        {/* Platform badge */}
        <span
          className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${colour}`}
          aria-label={conversation.provider}
        >
          {label}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {/* Priority indicator */}
              {conversation.priority && conversation.priority !== "NORMAL" && (
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_COLOURS[conversation.priority] ?? ""}`}
                  title={conversation.priority}
                  aria-label={`Priority: ${conversation.priority}`}
                />
              )}
              <p
                className={`text-sm truncate ${conversation.unreadCount > 0 ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}
              >
                {conversation.lastMessage?.senderName ?? "Unknown sender"}
              </p>
              {/* Message type badge */}
              {conversation.messageType && conversation.messageType !== "FEEDBACK" && (
                <span
                  className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${MESSAGE_TYPE_STYLES[conversation.messageType]}`}
                >
                  {conversation.messageType}
                </span>
              )}
            </div>
            {timeAgo && <span className="shrink-0 text-xs text-gray-400">{timeAgo}</span>}
          </div>
          <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{truncatedPreview}</p>
        </div>
      </div>
    </button>
  );
}
