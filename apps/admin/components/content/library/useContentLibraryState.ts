"use client";

/**
 * @file useContentLibraryState.ts
 * @description Custom hook encapsulating all local state management, filtering,
 * sorting, pagination, and bulk-selection logic for the ContentLibrary component.
 */

import type React from "react";
import { useState, useEffect, useCallback } from "react";
import type {
  ContentItem,
  ContentFilter,
  FilterOptions,
  SortField,
  SortOrder,
  ViewMode,
} from "./types";

const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  platforms: ["x", "instagram", "facebook", "youtube", "tiktok"],
  categories: ["Product Updates", "Behind the Scenes", "Educational", "Promotional", "Community"],
  tags: ["#Innovation", "#TeamWork", "#ProductUpdate", "#BehindTheScenes", "#Tips", "#News"],
  authors: [],
};

export interface UseContentLibraryStateReturn {
  // Data
  contentItems: ContentItem[];
  filteredItems: ContentItem[];
  paginatedItems: ContentItem[];

  // Loading
  isLoading: boolean;

  // View
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Sort
  sortBy: SortField;
  sortOrder: SortOrder;
  setSortBy: (field: SortField) => void;
  setSortOrder: (order: SortOrder) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Filter
  filter: ContentFilter;
  setFilter: React.Dispatch<React.SetStateAction<ContentFilter>>;
  filterOptions: FilterOptions;
  showFilterPanel: boolean;
  setShowFilterPanel: (show: boolean) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;

  // Pagination
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  setCurrentPage: (page: number) => void;

  // Selection
  selectedItems: string[];
  handleSelectAll: () => void;
  handleItemSelect: (itemId: string) => void;
  handleBulkAction: (action: string) => void;
}

interface UseContentLibraryStateOptions {
  onBulkAction?: (action: string, contentIds: string[]) => void;
}

export function useContentLibraryState(
  options: UseContentLibraryStateOptions = {}
): UseContentLibraryStateReturn {
  const { onBulkAction } = options;

  // State management
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<ContentItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortField>("updatedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [filter, setFilter] = useState<ContentFilter>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = viewMode === "grid" ? 12 : 20;

  // Filter options
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(DEFAULT_FILTER_OPTIONS);

  const loadContentItems = useCallback(async () => {
    setIsLoading(true);
    try {
      // Initial load returns empty; the useContentLibrary API hook
      // (hooks/api/useContentLibrary.ts) should be wired in by the parent
      // component to provide real data via GET /api/backend/posts.
      const emptyItems: ContentItem[] = [];

      setContentItems(emptyItems);
      setFilterOptions((prev) => ({ ...prev, authors: [] }));
    } catch {
      // Failed to load content items — empty state will be shown
    } finally {
      setIsLoading(false);
    }
  }, []);

  const applyFiltersAndSearch = useCallback(() => {
    let filtered = [...contentItems];

    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(
        (item) =>
          item.content.text.toLowerCase().includes(query) ||
          item.title?.toLowerCase().includes(query) ||
          item.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          item.category?.toLowerCase().includes(query) ||
          item.author.name.toLowerCase().includes(query)
      );
    }

    // Apply filters
    if (filter.status?.length) {
      filtered = filtered.filter((item) => filter.status!.includes(item.status));
    }

    if (filter.platforms?.length) {
      filtered = filtered.filter((item) =>
        item.platforms.some((platform) => filter.platforms!.includes(platform))
      );
    }

    if (filter.tags?.length) {
      filtered = filtered.filter((item) => item.tags.some((tag) => filter.tags!.includes(tag)));
    }

    if (filter.categories?.length) {
      filtered = filtered.filter(
        (item) => item.category && filter.categories!.includes(item.category)
      );
    }

    if (filter.author) {
      filtered = filtered.filter((item) => item.author.name === filter.author);
    }

    if (filter.hasMedia !== undefined) {
      filtered = filtered.filter((item) =>
        filter.hasMedia ? item.content.media?.length : !item.content.media?.length
      );
    }

    if (filter.performanceThreshold !== undefined && filter.performanceThreshold > 0) {
      filtered = filtered.filter(
        (item) => item.performance && item.performance.score >= filter.performanceThreshold!
      );
    }

    if (filter.dateRange) {
      filtered = filtered.filter(
        (item) =>
          item.createdAt >= filter.dateRange!.start && item.createdAt <= filter.dateRange!.end
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: number;
      let bValue: number;

      switch (sortBy) {
        case "createdAt":
          aValue = a.createdAt.getTime();
          bValue = b.createdAt.getTime();
          break;
        case "updatedAt":
          aValue = a.updatedAt.getTime();
          bValue = b.updatedAt.getTime();
          break;
        case "performance":
          aValue = a.performance?.score ?? 0;
          bValue = b.performance?.score ?? 0;
          break;
        case "status": {
          const statusOrder = { published: 4, scheduled: 3, draft: 2, archived: 1 };
          aValue = statusOrder[a.status];
          bValue = statusOrder[b.status];
          break;
        }
        default:
          aValue = a.updatedAt.getTime();
          bValue = b.updatedAt.getTime();
      }

      return sortOrder === "desc" ? bValue - aValue : aValue - bValue;
    });

    setFilteredItems(filtered);
    setCurrentPage(1);
  }, [contentItems, filter, searchQuery, sortBy, sortOrder]);

  // Load content items
  useEffect(() => {
    loadContentItems();
  }, [loadContentItems]);

  // Apply filters and search
  useEffect(() => {
    applyFiltersAndSearch();
  }, [applyFiltersAndSearch]);

  // Pagination
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Bulk actions
  const handleSelectAll = useCallback(() => {
    if (selectedItems.length === paginatedItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(paginatedItems.map((item) => item.id));
    }
  }, [selectedItems.length, paginatedItems]);

  const handleItemSelect = useCallback((itemId: string) => {
    setSelectedItems((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  }, []);

  const handleBulkAction = useCallback(
    (action: string) => {
      if (selectedItems.length === 0) return;
      onBulkAction?.(action, selectedItems);
      setSelectedItems([]);
    },
    [selectedItems, onBulkAction]
  );

  const clearFilters = useCallback(() => {
    setFilter({});
    setSearchQuery("");
  }, []);

  const hasActiveFilters = searchQuery.trim().length > 0 || Object.keys(filter).length > 0;

  return {
    contentItems,
    filteredItems,
    paginatedItems,
    isLoading,
    viewMode,
    setViewMode,
    sortBy,
    sortOrder,
    setSortBy,
    setSortOrder,
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    filterOptions,
    showFilterPanel,
    setShowFilterPanel,
    clearFilters,
    hasActiveFilters,
    currentPage,
    totalPages,
    itemsPerPage,
    setCurrentPage,
    selectedItems,
    handleSelectAll,
    handleItemSelect,
    handleBulkAction,
  };
}
