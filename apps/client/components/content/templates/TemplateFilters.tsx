"use client";

/**
 * @file TemplateFilters.tsx
 * @description Filter and view controls for the templates list, providing search input,
 * category filtering, sort options, and grid/list view mode toggle.
 * @component TemplateFilters
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Search, Grid, List } from "lucide-react";
import type { FilterOptions, SortOption, ViewMode } from "./types.js";

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

/**
 * @component TemplateFilters
 * @description Filter and view controls for the templates list, providing search input,
 * category filtering, sort options, and grid/list view mode toggle.
 */
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
  const t = useTranslations("content");
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          placeholder={t("filters.searchPlaceholder")}
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
        <option value="">{t("filters.allCategories")}</option>
        <option value="announcements">{t("filters.categoryAnnouncements")}</option>
        <option value="educational">{t("filters.categoryEducational")}</option>
        <option value="events">{t("filters.categoryEvents")}</option>
        <option value="promotional">{t("filters.categoryPromotional")}</option>
      </select>

      <select
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
      >
        <option value="newest">{t("filters.sortNewest")}</option>
        <option value="oldest">{t("filters.sortOldest")}</option>
        <option value="popular">{t("filters.sortPopular")}</option>
        <option value="performance">{t("filters.sortPerformance")}</option>
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
