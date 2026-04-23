"use client";

/**
 * @file FilterPanel.tsx
 * @description Sidebar filter panel for the content library that allows filtering content
 * by status, type, platform, and date range using the available filter options.
 */

import React, { useId } from "react";
import type { ContentFilter, FilterOptions } from "./types";

interface FilterPanelProps {
  filter: ContentFilter;
  filterOptions: FilterOptions;
  onFilterChange: (filter: ContentFilter) => void;
  onClearFilters: () => void;
  /** All known tags across items — for the tag filter input suggestions */
  availableTags?: string[];
}

/**
 * @component FilterPanel
 * @description Sidebar filter panel for the content library allowing filtering by
 * status, type, platform, date range, and tags.
 * @param props.availableTags - Known tags across items for filter input suggestions
 */
export function FilterPanel({
  filter,
  filterOptions,
  onFilterChange,
  onClearFilters,
  availableTags = [],
}: FilterPanelProps) {
  const authorFilterId = useId();

  const handleStatusChange = (
    status: "published" | "scheduled" | "draft" | "archived",
    checked: boolean
  ) => {
    const newStatus = filter.status || [];
    if (checked) {
      onFilterChange({
        ...filter,
        status: [...newStatus, status],
      });
    } else {
      onFilterChange({
        ...filter,
        status: newStatus.filter((s) => s !== status),
      });
    }
  };

  const handlePlatformChange = (platform: string, checked: boolean) => {
    const newPlatforms = filter.platforms || [];
    if (checked) {
      onFilterChange({
        ...filter,
        platforms: [...newPlatforms, platform],
      });
    } else {
      onFilterChange({
        ...filter,
        platforms: newPlatforms.filter((p) => p !== platform),
      });
    }
  };

  const handleCategoryChange = (category: string, checked: boolean) => {
    const newCategories = filter.categories || [];
    if (checked) {
      onFilterChange({
        ...filter,
        categories: [...newCategories, category],
      });
    } else {
      onFilterChange({
        ...filter,
        categories: newCategories.filter((c) => c !== category),
      });
    }
  };

  const handleAuthorChange = (author: string) => {
    onFilterChange({
      ...filter,
      ...(author && { author }),
    });
  };

  const handleMediaFilterChange = (checked: boolean) => {
    onFilterChange({
      ...filter,
      hasMedia: checked,
    });
  };

  const handleTagClick = (tag: string) => {
    const currentTags = filter.tags ?? [];
    if (currentTags.includes(tag)) {
      onFilterChange({ ...filter, tags: currentTags.filter((t) => t !== tag) });
    } else {
      onFilterChange({ ...filter, tags: [...currentTags, tag] });
    }
  };

  return (
    <div className="bg-white border rounded-lg p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Status filter */}
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-2">Status</span>
          <div className="space-y-1">
            {(["published", "scheduled", "draft", "archived"] as const).map((status) => (
              <label key={status} className="flex items-center">
                <input
                  type="checkbox"
                  checked={filter.status?.includes(status) || false}
                  onChange={(e) => handleStatusChange(status, e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm capitalize">{status}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Platform filter */}
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-2">Platforms</span>
          <div className="space-y-1">
            {filterOptions.platforms.map((platform) => (
              <label key={platform} className="flex items-center">
                <input
                  type="checkbox"
                  checked={filter.platforms?.includes(platform) || false}
                  onChange={(e) => handlePlatformChange(platform, e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm capitalize">{platform}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Category filter */}
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-2">Categories</span>
          <div className="space-y-1">
            {filterOptions.categories.map((category) => (
              <label key={category} className="flex items-center">
                <input
                  type="checkbox"
                  checked={filter.categories?.includes(category) || false}
                  onChange={(e) => handleCategoryChange(category, e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm">{category}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Author filter */}
        <div>
          <label htmlFor={authorFilterId} className="block text-sm font-medium text-gray-700 mb-2">
            Author
          </label>
          <select
            id={authorFilterId}
            value={filter.author || ""}
            onChange={(e) => handleAuthorChange(e.target.value)}
            className="w-full px-2 py-1 border rounded-sm text-sm"
          >
            <option value="">All Authors</option>
            {filterOptions.authors.map((author) => (
              <option key={author} value={author}>
                {author}
              </option>
            ))}
          </select>
        </div>

        {/* Additional filters */}
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-2">Options</span>
          <div className="space-y-1">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={filter.hasMedia === true}
                onChange={(e) => handleMediaFilterChange(e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm">Has Media</span>
            </label>
          </div>
        </div>
      </div>

      {/* Tag filter */}
      {(availableTags.length > 0 || filterOptions.tags.length > 0) && (
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-2">Tags</span>
          <div className="flex flex-wrap gap-1">
            {(availableTags.length > 0 ? availableTags : filterOptions.tags).map((tag) => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                  filter.tags?.includes(tag)
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <button onClick={onClearFilters} className="text-sm text-gray-600 hover:text-gray-800">
          Clear All Filters
        </button>
        {(filter.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-gray-500">Active tags:</span>
            {filter.tags?.map((tag) => (
              <span
                key={tag}
                onClick={() => handleTagClick(tag)}
                className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full cursor-pointer hover:bg-blue-200"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleTagClick(tag);
                }}
              >
                {tag} ×
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
