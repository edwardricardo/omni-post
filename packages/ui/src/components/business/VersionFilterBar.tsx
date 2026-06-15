/**
 * @file VersionFilterBar.tsx
 * @description Advanced filter controls (author, change type, status, sort) and selection action
 *              bar for ContentVersioning.
 * @component VersionFilterBar
 * @layer infrastructure
 */

"use client";

import { useId } from "react";

import type { ContentVersion } from "./contentVersioningTypes";
import { getAuthorName } from "./contentVersioningTypes";
import type { VersionFilter, SortMode } from "./useContentVersioning";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VersionFilterBarProps {
  versions: ContentVersion[];
  filterBy: VersionFilter;
  sortBy: SortMode;
  showPerformanceData: boolean;
  onFilterChange: (filter: VersionFilter) => void;
  onSortChange: (sort: SortMode) => void;
}

export interface VersionSelectionBarProps {
  selectedCount: number;
  selectedVersionIds: Set<string>;
  onCompareSelected?: ((id1: string, id2: string) => void) | undefined;
  onClearSelection: () => void;
}

// ---------------------------------------------------------------------------
// Filter Bar
// ---------------------------------------------------------------------------

export function VersionFilterBar({
  versions,
  filterBy,
  sortBy,
  showPerformanceData,
  onFilterChange,
  onSortChange,
}: VersionFilterBarProps) {
  const authorFilterId = useId();
  const changeTypeFilterId = useId();
  const statusFilterId = useId();
  const sortById = useId();

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div>
        <label htmlFor={authorFilterId} className="block text-sm font-medium text-gray-700 mb-1">
          Filter by Author
        </label>
        <select
          id={authorFilterId}
          value={filterBy.author || ""}
          onChange={(e) =>
            onFilterChange({
              ...filterBy,
              ...(e.target.value && { author: e.target.value }),
            })
          }
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Authors</option>
          {Array.from(new Set(versions.map((v) => getAuthorName(v)))).map((author) => (
            <option key={author} value={author}>
              {author}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor={changeTypeFilterId}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Filter by Change Type
        </label>
        <select
          id={changeTypeFilterId}
          value={filterBy.changeType || ""}
          onChange={(e) =>
            onFilterChange({
              ...filterBy,
              ...(e.target.value && { changeType: e.target.value }),
            })
          }
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Changes</option>
          <option value="created">Created</option>
          <option value="edited">Edited</option>
          <option value="media_added">Media Added</option>
          <option value="published">Published</option>
        </select>
      </div>

      <div>
        <label htmlFor={statusFilterId} className="block text-sm font-medium text-gray-700 mb-1">
          Filter by Status
        </label>
        <select
          id={statusFilterId}
          value={filterBy.status || ""}
          onChange={(e) =>
            onFilterChange({
              ...filterBy,
              ...(e.target.value && { status: e.target.value }),
            })
          }
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <div>
        <label htmlFor={sortById} className="block text-sm font-medium text-gray-700 mb-1">
          Sort By
        </label>
        <select
          id={sortById}
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          {showPerformanceData && <option value="performance">Best Performance</option>}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selection Bar
// ---------------------------------------------------------------------------

export function VersionSelectionBar({
  selectedCount,
  selectedVersionIds,
  onCompareSelected,
  onClearSelection,
}: VersionSelectionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between">
        <span className="text-sm text-blue-800">
          {selectedCount} version{selectedCount !== 1 ? "s" : ""} selected
        </span>
        <div className="flex space-x-2">
          {selectedCount === 2 && onCompareSelected && (
            <button
              onClick={() => {
                const selected = Array.from(selectedVersionIds);
                if (selected[0] && selected[1]) {
                  onCompareSelected(selected[0], selected[1]);
                }
              }}
              className="px-3 py-1 bg-blue-600 text-white rounded-sm text-sm hover:bg-blue-700"
            >
              Compare Selected
            </button>
          )}
          <button
            onClick={onClearSelection}
            className="px-3 py-1 bg-gray-600 text-white rounded-sm text-sm hover:bg-gray-700"
          >
            Clear Selection
          </button>
        </div>
      </div>
    </div>
  );
}
