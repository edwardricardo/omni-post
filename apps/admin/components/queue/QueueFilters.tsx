/**
 * @file QueueFilters.tsx
 * @description Filter controls component for the publishing queue, enabling filtering
 * by status, priority, platform, and search term to narrow down queue items.
 */

import React from "react";
import type { QueueItem, QueueFilter } from "./types";

interface QueueFiltersProps {
  filter: QueueFilter;
  onFilterChange: (filter: QueueFilter) => void;
  selectedItems: string[];
  isLoading: boolean;
  onBulkRetry: () => void;
  onBulkCancel: () => void;
}

export function QueueFilters({
  filter,
  onFilterChange,
  selectedItems,
  isLoading,
  onBulkRetry,
  onBulkCancel,
}: QueueFiltersProps) {
  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const status = e.target.value as QueueItem["status"];
    onFilterChange({
      ...filter,
      ...(status && { status: [status] }),
    });
  };

  const handlePriorityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const priority = e.target.value as QueueItem["priority"];
    onFilterChange({
      ...filter,
      ...(priority && { priority: [priority] }),
    });
  };

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value;
    onFilterChange({
      ...filter,
      ...(provider && { providers: [provider] }),
    });
  };

  return (
    <div className="bg-white rounded-lg border p-4 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <select className="px-3 py-2 border rounded-lg text-sm" onChange={handleStatusChange}>
            <option value="">All Statuses</option>
            <option value="queued">Queued</option>
            <option value="processing">Processing</option>
            <option value="published">Published</option>
            <option value="failed">Failed</option>
            <option value="retrying">Retrying</option>
          </select>

          <select className="px-3 py-2 border rounded-lg text-sm" onChange={handlePriorityChange}>
            <option value="">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select className="px-3 py-2 border rounded-lg text-sm" onChange={handleProviderChange}>
            <option value="">All Platforms</option>
            <option value="x">X/Twitter</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
          </select>
        </div>

        {/* Bulk actions */}
        {selectedItems.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={onBulkRetry}
              disabled={isLoading}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Retry Selected ({selectedItems.length})
            </button>
            <button
              onClick={onBulkCancel}
              disabled={isLoading}
              className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
            >
              Cancel Selected ({selectedItems.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
