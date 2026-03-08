/**
 * @file QueueListView.tsx
 * @description List view container for the publishing queue that renders all filtered
 * queue items as QueueItemRow components in a scrollable table layout.
 */

import React from "react";
import type { QueueItem } from "./types";
import { QueueItemRow } from "./QueueItemRow";

interface QueueListViewProps {
  items: QueueItem[];
  selectedItems: string[];
  isLoading: boolean;
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  totalItems: number;
  onToggleSelect: (itemId: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onRetry: (itemId: string) => void;
  onCancel: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  onPageChange: (page: number) => void;
}

export function QueueListView({
  items,
  selectedItems,
  isLoading,
  currentPage,
  totalPages,
  itemsPerPage,
  totalItems,
  onToggleSelect,
  onToggleSelectAll,
  onRetry,
  onCancel,
  onDelete,
  onPageChange,
}: QueueListViewProps) {
  const allSelected = selectedItems.length === items.length && items.length > 0;

  return (
    <div className="bg-white rounded-lg border">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-4 text-left">
                <input
                  type="checkbox"
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                  checked={allSelected}
                />
              </th>
              <th className="p-4 text-left font-medium text-gray-900">Content</th>
              <th className="p-4 text-left font-medium text-gray-900">Platforms</th>
              <th className="p-4 text-left font-medium text-gray-900">Status</th>
              <th className="p-4 text-left font-medium text-gray-900">Priority</th>
              <th className="p-4 text-left font-medium text-gray-900">Created</th>
              <th className="p-4 text-left font-medium text-gray-900">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => (
              <QueueItemRow
                key={item.id}
                item={item}
                isSelected={selectedItems.includes(item.id)}
                isLoading={isLoading}
                onToggleSelect={onToggleSelect}
                onRetry={onRetry}
                onCancel={onCancel}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-4 border-t flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
            {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} items
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border rounded-sm text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-3 py-1 text-sm">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border rounded-sm text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
