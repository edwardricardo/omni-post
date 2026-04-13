"use client";

/**
 * @file SearchAndSortBar.tsx
 * @description Search input and sort controls bar for the content library, allowing users
 * to filter content by keyword and sort by various fields in ascending or descending order.
 */

import React from "react";
import type { SortField, SortOrder } from "./types";

interface SearchAndSortBarProps {
  searchQuery: string;
  sortBy: SortField;
  sortOrder: SortOrder;
  onSearchChange: (query: string) => void;
  onSortChange: (sortBy: SortField, sortOrder: SortOrder) => void;
}

/**
 * @component SearchAndSortBar
 * @description Search input and sort controls bar for the content library, allowing
 * keyword filtering and sorting by various fields in ascending or descending order.
 */
export function SearchAndSortBar({
  searchQuery,
  sortBy,
  sortOrder,
  onSearchChange,
  onSortChange,
}: SearchAndSortBarProps) {
  return (
    <div className="flex items-center space-x-4 mb-6">
      <div className="flex-1 max-w-md">
        <input
          type="text"
          placeholder="Search content, tags, authors..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full px-4 py-2 border rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <select
        value={`${sortBy}-${sortOrder}`}
        onChange={(e) => {
          const [field, order] = e.target.value.split("-");
          onSortChange(field as SortField, order as SortOrder);
        }}
        className="px-3 py-2 border rounded-lg text-sm"
      >
        <option value="updatedAt-desc">Recently Updated</option>
        <option value="createdAt-desc">Recently Created</option>
        <option value="performance-desc">Best Performing</option>
        <option value="status-desc">Status</option>
      </select>
    </div>
  );
}
