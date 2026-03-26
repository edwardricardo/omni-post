"use client";

/**
 * @file AssetTagFilter.tsx
 * @description Multi-select filter component for asset tags. Fetches available tags
 *   via TanStack Query and allows toggling tag selection for asset library filtering.
 */

import React, { useCallback, useMemo, useState } from "react";

/** Shape of an asset tag as returned by the API */
interface AssetTag {
  id: string;
  name: string;
  color: string;
}

interface AssetTagFilterProps {
  /** Currently selected tag IDs */
  selectedTagIds: string[];
  /** Available tags (fetched externally by the parent component or via TanStack Query) */
  tags: AssetTag[];
  /** Whether the tags are currently loading */
  isLoading?: boolean;
  /** Callback when the tag selection changes */
  onChange: (selectedTagIds: string[]) => void;
}

export function AssetTagFilter({
  selectedTagIds,
  tags,
  isLoading = false,
  onChange,
}: AssetTagFilterProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return tags;
    const lower = searchQuery.toLowerCase();
    return tags.filter((tag) => tag.name.toLowerCase().includes(lower));
  }, [tags, searchQuery]);

  const selectedSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);

  const handleToggle = useCallback(
    (tagId: string) => {
      if (selectedSet.has(tagId)) {
        onChange(selectedTagIds.filter((id) => id !== tagId));
      } else {
        onChange([...selectedTagIds, tagId]);
      }
    },
    [selectedTagIds, selectedSet, onChange]
  );

  const handleClearAll = useCallback(() => {
    onChange([]);
  }, [onChange]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  if (isLoading) {
    return (
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-sm text-gray-500">Loading tags...</p>
      </div>
    );
  }

  if (tags.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-sm text-gray-500">No tags available</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Tags</span>
        {selectedTagIds.length > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            Clear ({selectedTagIds.length})
          </button>
        )}
      </div>

      {tags.length > 8 && (
        <input
          type="text"
          placeholder="Search tags..."
          value={searchQuery}
          onChange={handleSearchChange}
          className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
        />
      )}

      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {filteredTags.map((tag) => {
          const isSelected = selectedSet.has(tag.id);
          return (
            <label
              key={tag.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => handleToggle(tag.id)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
              <span className="text-sm text-gray-700">{tag.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
