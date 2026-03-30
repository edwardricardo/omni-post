"use client";

/**
 * @file EmptyState.tsx
 * @description Empty state placeholder displayed in the content library when no content
 * items match the current filters or the library contains no content yet.
 */

import React from "react";

interface EmptyStateProps {
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function EmptyState({ hasActiveFilters, onClearFilters }: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      <div className="text-4xl mb-4">📚</div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">No content found</h3>
      <p className="text-gray-600 mb-4">
        {hasActiveFilters
          ? "Try adjusting your search or filters"
          : "Start creating content to build your library"}
      </p>
      {hasActiveFilters ? (
        <button
          onClick={onClearFilters}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Clear Search & Filters
        </button>
      ) : (
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Create Content
        </button>
      )}
    </div>
  );
}
