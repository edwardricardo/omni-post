/**
 * @file ConversationList.tsx
 * @description Virtualized conversation list with infinite scroll.
 *              Uses TanStack Query infinite query + IntersectionObserver for
 *              automatic next-page loading.
 * @layer ui
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import { useInboxConversations, useMentions } from "@/hooks/api/useInbox";
import { ConversationCard } from "./ConversationCard";
import type { InboxFilters } from "./InboxSidebar";

interface ConversationListProps {
  filters: InboxFilters;
  selectedId: string | null;
  onSelect: (id: string) => void;
  projectId?: string;
}

export function ConversationList({
  filters,
  selectedId,
  onSelect,
  projectId,
}: ConversationListProps) {
  const isMentions = filters.messageType === "mentions";

  // Build API filters from UI filters — use conditional spread for exactOptionalPropertyTypes
  const apiFilters = {
    ...(projectId !== undefined && { projectId }),
    ...(filters.provider !== "all" && { provider: filters.provider }),
    ...(filters.status !== "all" && { status: filters.status }),
    ...(filters.messageType === "comments" && { messageType: "COMMENT" }),
  };

  const conversationsQuery = useInboxConversations(apiFilters);
  const mentionsQuery = useMentions(projectId);

  const activeQuery = isMentions ? mentionsQuery : conversationsQuery;
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    activeQuery;

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  // Infinite scroll sentinel
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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
        <p className="text-sm text-gray-500">Failed to load conversations</p>
        <button
          onClick={() => void refetch()}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <p className="text-sm font-medium text-gray-700">
          {isMentions ? "No mentions yet" : "No conversations yet"}
        </p>
        <p className="text-xs text-gray-400">
          {isMentions
            ? "Mentions from connected platforms will appear here."
            : "Incoming messages from connected platforms will appear here."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="divide-y divide-gray-100">
        {allItems.map((conversation) => (
          <ConversationCard
            key={conversation.id}
            conversation={conversation}
            selected={conversation.id === selectedId}
            onClick={() => onSelect(conversation.id)}
          />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-4" aria-hidden="true" />

      {isFetchingNextPage && (
        <div className="py-3 text-center text-xs text-gray-400">Loading more…</div>
      )}
    </div>
  );
}
