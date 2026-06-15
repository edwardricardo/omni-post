/**
 * @file ConversationList.tsx
 * @description Scrollable inbox message list with infinite scroll via
 *              IntersectionObserver. Switches between the general inbox feed
 *              and the mentions-only feed based on the active filter.
 * @layer infrastructure
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  useInboxMessages,
  useMentions,
  type InboxFilters as ServerInboxFilters,
} from "@/hooks/api/useInbox";
import { ConversationCard } from "./ConversationCard.js";
import type { InboxFilters as UiInboxFilters } from "./InboxSidebar.js";

interface ConversationListProps {
  filters: UiInboxFilters;
  selectedId: string | null;
  onSelect: (conversationId: string) => void;
  projectId?: string;
}

/**
 * @component ConversationList
 * @description Scrollable inbox message list with infinite scroll. Maps the
 *              UI filter pills to the server `InboxFilter` enums and switches
 *              to the mentions-only endpoint when the user filters by Mentions.
 * @param props.filters - Active UI filter selections (sidebar pills).
 * @param props.selectedId - Currently selected conversation id (highlights row).
 * @param props.onSelect - Fired with the message's conversationId when a row
 *   is clicked.
 * @param props.projectId - Optional project scope for filtering.
 */
export function ConversationList({
  filters,
  selectedId,
  onSelect,
  projectId,
}: ConversationListProps) {
  const t = useTranslations("inbox.components");
  const isMentions = filters.messageType === "MENTION";

  const apiFilters: ServerInboxFilters = {
    ...(projectId !== undefined && { projectId }),
    ...(filters.provider !== "all" && { provider: filters.provider }),
    ...(filters.status !== "all" && { status: filters.status }),
    ...(filters.messageType !== "all" &&
      filters.messageType !== "MENTION" && { messageType: filters.messageType }),
  };

  const inboxQuery = useInboxMessages(apiFilters);
  const mentionsQuery = useMentions(projectId);

  const activeQuery = isMentions ? mentionsQuery : inboxQuery;
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    activeQuery;

  const allMessages = data?.pages.flatMap((p) => p.items) ?? [];

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  if (isLoading) {
    return (
      <div className="divide-y divide-gray-100">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3 animate-pulse">
            <div className="mt-1.5 h-2 w-2 rounded-full bg-gray-200 shrink-0" />
            <div className="h-7 w-7 rounded-full bg-gray-200 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-3/4 rounded bg-gray-200" />
              <div className="h-3 w-full rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <p className="text-sm text-gray-500">{t("listLoadError")}</p>
        <button
          onClick={() => void refetch()}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (allMessages.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <p className="text-sm font-medium text-gray-700">
          {isMentions ? t("emptyMentionsTitle") : t("emptyMessagesTitle")}
        </p>
        <p className="text-xs text-gray-400">
          {isMentions ? t("emptyMentionsDescription") : t("emptyMessagesDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="divide-y divide-gray-100">
        {allMessages.map((message) => (
          <ConversationCard
            key={message.id}
            message={message}
            selected={message.conversationId === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div ref={sentinelRef} className="h-4" aria-hidden="true" />

      {isFetchingNextPage && (
        <div className="py-3 text-center text-xs text-gray-400">{t("loadingMore")}</div>
      )}
    </div>
  );
}
