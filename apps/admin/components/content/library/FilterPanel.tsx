"use client";

/**
 * @file FilterPanel.tsx
 * @description Sidebar filter panel for the content library that allows filtering content
 * by status, type, platform, and date range using the available filter options.
 */

import React from "react";
import type { ContentFilter, FilterOptions } from "./types";

interface FilterPanelProps {
  filter: ContentFilter;
  filterOptions: FilterOptions;
  onFilterChange: (filter: ContentFilter) => void;
  onClearFilters: () => void;
}

export function FilterPanel({
  filter,
  filterOptions,
  onFilterChange,
  onClearFilters,
}: FilterPanelProps) {
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

  return (
    <div className="bg-white border rounded-lg p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Status filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
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
          <label className="block text-sm font-medium text-gray-700 mb-2">Platforms</label>
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
          <label className="block text-sm font-medium text-gray-700 mb-2">Categories</label>
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
          <label className="block text-sm font-medium text-gray-700 mb-2">Author</label>
          <select
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
          <label className="block text-sm font-medium text-gray-700 mb-2">Options</label>
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

      <div className="flex items-center justify-between mt-4">
        <button onClick={onClearFilters} className="text-sm text-gray-600 hover:text-gray-800">
          Clear All Filters
        </button>
      </div>
    </div>
  );
}
