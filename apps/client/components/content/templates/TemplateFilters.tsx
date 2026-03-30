"use client";

/**
 * @file TemplateFilters.tsx
 * @description Filter and view controls for the templates list, providing search input,
 * category filtering, sort options, and grid/list view mode toggle.
 */

import React from "react";
import { Search, Grid, List } from "lucide-react";
import type { FilterOptions, SortOption, ViewMode } from "./types";

interface TemplateFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterBy: FilterOptions;
  onFilterChange: (filters: FilterOptions) => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export const TemplateFilters: React.FC<TemplateFiltersProps> = ({
  searchQuery,
  onSearchChange,
  filterBy,
  onFilterChange,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <select
        value={filterBy.category || ""}
        onChange={(e) =>
          onFilterChange({
            ...filterBy,
            ...(e.target.value && { category: e.target.value }),
          })
        }
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
      >
        <option value="">All Categories</option>
        <option value="announcements">Announcements</option>
        <option value="educational">Educational</option>
        <option value="events">Events</option>
        <option value="promotional">Promotional</option>
      </select>

      <select
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
      >
        <option value="newest">Newest First</option>
        <option value="oldest">Oldest First</option>
        <option value="popular">Most Popular</option>
        <option value="performance">Best Performance</option>
      </select>

      <div className="flex items-center space-x-2">
        <button
          onClick={() => onViewModeChange("grid")}
          className={`p-2 rounded-sm ${viewMode === "grid" ? "bg-blue-100 text-blue-600" : "text-gray-400 hover:text-gray-600"}`}
        >
          <Grid className="w-4 h-4" />
        </button>
        <button
          onClick={() => onViewModeChange("list")}
          className={`p-2 rounded-sm ${viewMode === "list" ? "bg-blue-100 text-blue-600" : "text-gray-400 hover:text-gray-600"}`}
        >
          <List className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
