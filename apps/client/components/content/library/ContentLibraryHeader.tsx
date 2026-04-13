"use client";

/**
 * @file ContentLibraryHeader.tsx
 * @description Header component for the content library displaying the title, item count,
 * and view mode toggle buttons (grid vs list).
 */

import React from "react";
import type { ViewMode } from "./types";

interface ContentLibraryHeaderProps {
  totalItems: number;
  filteredCount: number;
  selectedCount: number;
  viewMode: ViewMode;
  showFilterPanel: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onFilterToggle: () => void;
}

/**
 * @component ContentLibraryHeader
 * @description Header for the content library displaying title, item count, selection
 * count, and view mode toggle buttons (grid vs list).
 */
export function ContentLibraryHeader({
  totalItems,
  filteredCount,
  selectedCount,
  viewMode,
  showFilterPanel,
  onViewModeChange,
  onFilterToggle,
}: ContentLibraryHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Content Library</h1>
        <p className="text-gray-600">
          {filteredCount} of {totalItems} items
          {selectedCount > 0 && ` • ${selectedCount} selected`}
        </p>
      </div>

      <div className="flex items-center space-x-4">
        {/* View mode toggle */}
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => onViewModeChange("grid")}
            className={`px-3 py-1 rounded-sm text-sm ${
              viewMode === "grid" ? "bg-white shadow-xs" : "text-gray-600"
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => onViewModeChange("list")}
            className={`px-3 py-1 rounded-sm text-sm ${
              viewMode === "list" ? "bg-white shadow-xs" : "text-gray-600"
            }`}
          >
            List
          </button>
        </div>

        {/* Filter toggle */}
        <button
          onClick={onFilterToggle}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            showFilterPanel
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Filters
        </button>
      </div>
    </div>
  );
}
