/**
 * @file InboxLayout.tsx
 * @description Two-panel inbox layout. Left: filter sidebar + conversation list.
 *              Right: conversation thread or empty state when none selected.
 * @layer infrastructure
 */

"use client";

import { useState } from "react";
import { InboxSidebar } from "./InboxSidebar";
import type { InboxFilters } from "./InboxSidebar";
import { ConversationList } from "./ConversationList";
import { ConversationThread } from "./ConversationThread";

interface InboxLayoutProps {
  projectId?: string;
  userId: string;
}

const DEFAULT_FILTERS: InboxFilters = {
  provider: "all",
  status: "all",
  messageType: "all",
};

/**
 * @component InboxLayout
 * @description Two-panel inbox layout. Left panel contains the filter sidebar and
 *              conversation list; right panel shows the selected conversation thread
 *              or an empty-state prompt.
 * @param props.userId - ID of the current user for thread actions
 * @param props.projectId - Optional project scope for conversation filtering
 */
export function InboxLayout({ projectId, userId }: InboxLayoutProps) {
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_FILTERS);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Left panel: filters + conversation list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-gray-200">
        <InboxSidebar filters={filters} onChange={setFilters} />
        <ConversationList
          filters={filters}
          selectedId={selectedConversationId}
          onSelect={setSelectedConversationId}
          {...(projectId !== undefined && { projectId })}
        />
      </div>

      {/* Right panel: thread or empty state */}
      <div className="flex flex-1 flex-col">
        {selectedConversationId ? (
          <ConversationThread conversationId={selectedConversationId} userId={userId} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center px-8">
            <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <span className="text-3xl" aria-hidden="true">
                💬
              </span>
            </div>
            <h3 className="text-sm font-semibold text-gray-900">Select a conversation</h3>
            <p className="mt-1 text-xs text-gray-500">
              Choose a conversation from the left panel to view the thread and reply.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
