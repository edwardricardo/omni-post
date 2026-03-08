"use client";

/**
 * @file BulkActionsBar.tsx
 * @description Bulk actions toolbar that appears when one or more content items are selected,
 * providing options to publish, archive, or delete the selected items in batch.
 */

import React from "react";

interface BulkActionsBarProps {
  selectedCount: number;
  onBulkAction: (action: string) => void;
}

export function BulkActionsBar({ selectedCount, onBulkAction }: BulkActionsBarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-blue-800">
          {selectedCount} item{selectedCount > 1 ? "s" : ""} selected
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => onBulkAction("duplicate")}
            className="px-3 py-1 bg-white border border-blue-300 text-blue-700 rounded-sm text-sm hover:bg-blue-50"
          >
            Duplicate
          </button>
          <button
            onClick={() => onBulkAction("archive")}
            className="px-3 py-1 bg-white border border-blue-300 text-blue-700 rounded-sm text-sm hover:bg-blue-50"
          >
            Archive
          </button>
          <button
            onClick={() => onBulkAction("delete")}
            className="px-3 py-1 bg-red-600 text-white rounded-sm text-sm hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
