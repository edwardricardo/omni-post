/**
 * @file ConversationCard.tsx
 * @description Single inbox-message row in the inbox list. Shows platform badge,
 *              priority indicator, AI sentiment label, message-type badge, author
 *              name, message preview, relative time, unread highlight, and an
 *              optional "In CRM" badge when the sender matches a CRM contact.
 * @layer infrastructure
 */

"use client";

import { memo } from "react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import type { InboxMessage, InboxMessageWireType, InboxPriority } from "@/hooks/api/useInbox";

// ---------------------------------------------------------------------------
// Platform badge colours
// ---------------------------------------------------------------------------

const PROVIDER_COLOURS: Record<string, string> = {
  X: "bg-black text-white",
  INSTAGRAM: "bg-gradient-to-br from-purple-500 to-pink-500 text-white",
  FACEBOOK: "bg-blue-600 text-white",
  YOUTUBE: "bg-red-600 text-white",
  TIKTOK: "bg-black text-white",
  SNAPCHAT: "bg-yellow-400 text-black",
  TELEGRAM: "bg-sky-500 text-white",
  PINTEREST: "bg-red-500 text-white",
  LINKEDIN: "bg-blue-700 text-white",
};

const PROVIDER_LABELS: Record<string, string> = {
  X: "X",
  INSTAGRAM: "IG",
  FACEBOOK: "FB",
  YOUTUBE: "YT",
  TIKTOK: "TK",
  SNAPCHAT: "SC",
  TELEGRAM: "TG",
  PINTEREST: "PI",
  LINKEDIN: "LI",
};

const PRIORITY_COLOURS: Record<InboxPriority, string> = {
  URGENT: "bg-red-500",
  HIGH: "bg-orange-500",
  NORMAL: "bg-gray-300",
  LOW: "bg-gray-200",
};

const MESSAGE_TYPE_STYLES: Record<InboxMessageWireType, string> = {
  COMMENT: "bg-blue-100 text-blue-700",
  MENTION: "bg-purple-100 text-purple-700",
  REPLY: "bg-green-100 text-green-700",
  DIRECT_MESSAGE: "bg-amber-100 text-amber-700",
};

const MESSAGE_TYPE_LABEL_KEYS: Record<InboxMessageWireType, string> = {
  COMMENT: "messageType.COMMENT",
  MENTION: "messageType.MENTION",
  REPLY: "messageType.REPLY",
  DIRECT_MESSAGE: "messageType.DIRECT_MESSAGE",
};

// ---------------------------------------------------------------------------
// Sentiment label
// ---------------------------------------------------------------------------

function sentimentLabel(score: number | null): {
  key: string;
  className: string;
} | null {
  if (score === null) return null;
  if (score > 0.2) {
    return { key: "sentiment.positive", className: "bg-green-100 text-green-700" };
  }
  if (score < -0.2) {
    return { key: "sentiment.negative", className: "bg-red-100 text-red-700" };
  }
  return { key: "sentiment.neutral", className: "bg-gray-100 text-gray-600" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ConversationCardProps {
  message: InboxMessage;
  selected: boolean;
  /** Fires with the message's conversationId when clicked (no-op if null). */
  onSelect: (conversationId: string) => void;
}

/**
 * @component ConversationCard
 * @description Single inbox-message row. Surfaces the AI triage classification
 *              (priority, sentiment, CRM hint) alongside the message metadata so
 *              the user can prioritise the queue at a glance.
 * @param props.message - The inbox message data (flat DTO).
 * @param props.selected - Whether this row is currently active.
 * @param props.onSelect - Callback when the row is clicked. Receives the
 *   conversationId; the card is non-interactive when the message has none.
 */
function ConversationCardComponent({ message, selected, onSelect }: ConversationCardProps) {
  const t = useTranslations("inbox.components");
  const providerKey = message.provider.toUpperCase();
  const colour = PROVIDER_COLOURS[providerKey] ?? "bg-gray-500 text-white";
  const label = PROVIDER_LABELS[providerKey] ?? providerKey.slice(0, 2);
  const preview = message.body.length > 80 ? `${message.body.slice(0, 80)}…` : message.body;
  const timeAgo = formatDistanceToNow(new Date(message.providerCreatedAt), { addSuffix: true });
  const sentiment = sentimentLabel(message.sentimentScore);
  const isUnread = message.status === "UNREAD";
  const showPriority = message.priority !== "NORMAL" && message.priority !== "LOW";
  const canOpen = message.conversationId !== null;

  const handleClick = (): void => {
    if (canOpen) onSelect(message.conversationId!);
  };

  return (
    <button
      onClick={handleClick}
      disabled={!canOpen}
      className={[
        "w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors",
        selected && "bg-indigo-50 border-l-2 border-l-indigo-500",
        isUnread && !selected && "bg-blue-50/30",
        !canOpen && "cursor-default opacity-90",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={t("cardAriaLabel", {
        type: t(MESSAGE_TYPE_LABEL_KEYS[message.messageType]),
        author: message.authorName,
        provider: message.provider,
      })}
      aria-current={selected ? "true" : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1.5 shrink-0 w-2">
          {isUnread && (
            <span className="block h-2 w-2 rounded-full bg-blue-500" aria-label={t("unread")} />
          )}
        </div>

        <span
          className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${colour}`}
          aria-label={message.provider}
        >
          {label}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {showPriority && (
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_COLOURS[message.priority]}`}
                  title={message.priority}
                  aria-label={t("priorityAriaLabel", { priority: message.priority })}
                />
              )}
              <p
                className={`text-sm truncate ${isUnread ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}
              >
                {message.authorName}
              </p>
              <span
                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${MESSAGE_TYPE_STYLES[message.messageType]}`}
              >
                {t(MESSAGE_TYPE_LABEL_KEYS[message.messageType])}
              </span>
              {sentiment && (
                <span
                  className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${sentiment.className}`}
                  title={t("sentimentTitle", {
                    score: message.sentimentScore?.toFixed(2) ?? "",
                  })}
                >
                  {t(sentiment.key)}
                </span>
              )}
              {message.crmContactId && (
                <span
                  className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium"
                  title={t("crmTitle")}
                >
                  {t("inCrm")}
                </span>
              )}
            </div>
            <span className="shrink-0 text-xs text-gray-400">{timeAgo}</span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{preview}</p>
        </div>
      </div>
    </button>
  );
}

export const ConversationCard = memo(ConversationCardComponent);
