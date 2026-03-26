"use client";

/**
 * @file AssetTagManager.tsx
 * @description Inline tag editor for asset detail view. Allows adding and removing
 *   tags from a media asset. Displays current tags as badges and provides a dropdown
 *   to add more tags from the account's available tags.
 */

import React, { useCallback, useMemo, useState } from "react";
import { AssetTagBadge } from "./AssetTagBadge";

/** Shape of an asset tag as returned by the API */
interface AssetTag {
  id: string;
  name: string;
  color: string;
}

interface AssetTagManagerProps {
  /** Currently assigned tag IDs on this asset */
  assignedTagIds: string[];
  /** All available tags for the account */
  availableTags: AssetTag[];
  /** Whether changes are currently being saved */
  isSaving?: boolean;
  /** Callback when the set of assigned tags changes */
  onTagsChange: (tagIds: string[]) => void;
}

export function AssetTagManager({
  assignedTagIds,
  availableTags,
  isSaving = false,
  onTagsChange,
}: AssetTagManagerProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownSearch, setDropdownSearch] = useState("");

  const assignedSet = useMemo(() => new Set(assignedTagIds), [assignedTagIds]);

  const assignedTags = useMemo(
    () => availableTags.filter((tag) => assignedSet.has(tag.id)),
    [availableTags, assignedSet]
  );

  const unassignedTags = useMemo(() => {
    const filtered = availableTags.filter((tag) => !assignedSet.has(tag.id));
    if (!dropdownSearch.trim()) return filtered;
    const lower = dropdownSearch.toLowerCase();
    return filtered.filter((tag) => tag.name.toLowerCase().includes(lower));
  }, [availableTags, assignedSet, dropdownSearch]);

  const handleRemoveTag = useCallback(
    (tagId: string) => {
      onTagsChange(assignedTagIds.filter((id) => id !== tagId));
    },
    [assignedTagIds, onTagsChange]
  );

  const handleAddTag = useCallback(
    (tagId: string) => {
      onTagsChange([...assignedTagIds, tagId]);
      setDropdownSearch("");
      setShowDropdown(false);
    },
    [assignedTagIds, onTagsChange]
  );

  const handleToggleDropdown = useCallback(() => {
    setShowDropdown((prev) => !prev);
    setDropdownSearch("");
  }, []);

  const handleDropdownSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDropdownSearch(e.target.value);
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Tags</span>
        {isSaving && <span className="text-xs text-gray-400">Saving...</span>}
      </div>

      {/* Current tags */}
      <div className="flex flex-wrap gap-1.5">
        {assignedTags.map((tag) => (
          <AssetTagBadge
            key={tag.id}
            id={tag.id}
            name={tag.name}
            color={tag.color}
            removable
            onRemove={handleRemoveTag}
          />
        ))}

        {assignedTags.length === 0 && (
          <span className="text-sm text-gray-400">No tags assigned</span>
        )}
      </div>

      {/* Add tag button + dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={handleToggleDropdown}
          disabled={isSaving}
          className="inline-flex items-center gap-1 rounded border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-500 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add tag
        </button>

        {showDropdown && (
          <div className="absolute left-0 z-10 mt-1 w-56 rounded-md border border-gray-200 bg-white shadow-lg">
            {availableTags.length > 5 && (
              <div className="border-b border-gray-100 p-2">
                <input
                  type="text"
                  placeholder="Search tags..."
                  value={dropdownSearch}
                  onChange={handleDropdownSearchChange}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
                  autoFocus
                />
              </div>
            )}

            <div className="max-h-40 overflow-y-auto p-1">
              {unassignedTags.length === 0 ? (
                <p className="px-2 py-1 text-sm text-gray-400">
                  {dropdownSearch ? "No matching tags" : "All tags assigned"}
                </p>
              ) : (
                unassignedTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleAddTag(tag.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-gray-50"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
