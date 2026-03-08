"use client";

/**
 * @file PublishingQueueManager.tsx
 * @description Main orchestrator component for the publishing queue. Composes
 * sub-components (stats, filters, list, details, analytics views) and delegates
 * state management to the useQueueManager hook which fetches real BullMQ data.
 */

import React, { useState, useCallback } from "react";
import type { PublishingQueueManagerProps, ViewType } from "./types";
import { useQueueManager } from "./useQueueManager";
import { QueueStatsOverview } from "./QueueStatsOverview";
import { QueueFilters } from "./QueueFilters";
import { QueueListView } from "./QueueListView";
import { QueueDetailsView } from "./QueueDetailsView";
import { QueueAnalyticsView } from "./QueueAnalyticsView";

const ITEMS_PER_PAGE = 20;

export function PublishingQueueManager({
  accountId: _accountId,
  projectId: _projectId,
  onQueueUpdate,
  onItemUpdate: _onItemUpdate,
  onError,
}: PublishingQueueManagerProps) {
  // --- View & selection state ---
  const [view, setView] = useState<ViewType>("list");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  // --- Queue data from BullMQ API ---
  const { filteredItems, stats, filter, setFilter, isLoading, retryItem, cancelItem, deleteItem } =
    useQueueManager({
      ...(onQueueUpdate !== undefined && { onQueueUpdate }),
      ...(onError !== undefined && { onError }),
    });

  // --- Pagination ---
  const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // --- Selection handlers ---
  const handleToggleSelect = useCallback((itemId: string, checked: boolean) => {
    if (checked) {
      setSelectedItems((prev) => [...prev, itemId]);
    } else {
      setSelectedItems((prev) => prev.filter((id) => id !== itemId));
    }
  }, []);

  const handleToggleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedItems(paginatedItems.map((item) => item.id));
      } else {
        setSelectedItems([]);
      }
    },
    [paginatedItems]
  );

  // --- Bulk operations ---
  const handleBulkRetry = useCallback(async () => {
    const retryable = selectedItems.filter((id) => {
      const item = filteredItems.find((q) => q.id === id);
      return item?.status === "failed" && item.attempts < item.maxAttempts;
    });

    for (const itemId of retryable) {
      await retryItem(itemId);
    }
    setSelectedItems([]);
  }, [selectedItems, filteredItems, retryItem]);

  const handleBulkCancel = useCallback(async () => {
    const cancellable = selectedItems.filter((id) => {
      const item = filteredItems.find((q) => q.id === id);
      return item?.status === "queued" || item?.status === "processing";
    });

    for (const itemId of cancellable) {
      await cancelItem(itemId);
    }
    setSelectedItems([]);
  }, [selectedItems, filteredItems, cancelItem]);

  // --- Page change handler ---
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  return (
    <div className="publishing-queue-manager">
      {/* Header with view toggle */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Publishing Queue</h2>
          <div className="flex space-x-2">
            {(["list", "details", "analytics"] as const).map((viewOption) => (
              <button
                key={viewOption}
                onClick={() => setView(viewOption)}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize
                  ${
                    view === viewOption
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }
                `}
              >
                {viewOption}
              </button>
            ))}
          </div>
        </div>

        {/* Stats overview */}
        <QueueStatsOverview stats={stats} />
      </div>

      {/* Filters and bulk actions */}
      <QueueFilters
        filter={filter}
        onFilterChange={setFilter}
        selectedItems={selectedItems}
        isLoading={isLoading}
        onBulkRetry={handleBulkRetry}
        onBulkCancel={handleBulkCancel}
      />

      {/* List view */}
      {view === "list" && (
        <QueueListView
          items={paginatedItems}
          selectedItems={selectedItems}
          isLoading={isLoading}
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={ITEMS_PER_PAGE}
          totalItems={filteredItems.length}
          onToggleSelect={handleToggleSelect}
          onToggleSelectAll={handleToggleSelectAll}
          onRetry={retryItem}
          onCancel={cancelItem}
          onDelete={deleteItem}
          onPageChange={handlePageChange}
        />
      )}

      {/* Detailed view */}
      {view === "details" && (
        <QueueDetailsView items={paginatedItems} onRetry={retryItem} onCancel={cancelItem} />
      )}

      {/* Analytics view */}
      {view === "analytics" && <QueueAnalyticsView stats={stats} />}
    </div>
  );
}
