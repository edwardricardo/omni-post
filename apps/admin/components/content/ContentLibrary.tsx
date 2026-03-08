"use client";

/**
 * @file ContentLibrary.tsx
 * @description Main ContentLibrary component that composes sub-components from the library/
 * directory. All local state management is delegated to useContentLibraryState, and UI
 * sections are rendered by dedicated sub-components.
 */

import React from "react";
import type { ContentItem, SortField, SortOrder, ViewMode } from "./library/types";
import { useContentLibraryState } from "./library/useContentLibraryState";
import { ContentLibraryHeader } from "./library/ContentLibraryHeader";
import { SearchAndSortBar } from "./library/SearchAndSortBar";
import { FilterPanel } from "./library/FilterPanel";
import { BulkActionsBar } from "./library/BulkActionsBar";
import { ContentGridView } from "./library/ContentGridView";
import { ContentListView } from "./library/ContentListView";
import { EmptyState } from "./library/EmptyState";
import { Pagination } from "./library/Pagination";
import { LoadingSkeleton } from "./library/LoadingSkeleton";

// Re-export types so existing consumers are not broken
export type { ContentItem, ContentFilter } from "./library/types";

interface ContentLibraryProps {
  accountId: string;
  projectId: string;
  onContentSelect?: (content: ContentItem) => void;
  onContentEdit?: (content: ContentItem) => void;
  onContentDelete?: (contentId: string) => void;
  onBulkAction?: (action: string, contentIds: string[]) => void;
  enableBulkActions?: boolean;
}

export function ContentLibrary({
  accountId: _accountId,
  projectId: _projectId,
  onContentSelect,
  onContentEdit,
  onContentDelete,
  onBulkAction,
  enableBulkActions = true,
}: ContentLibraryProps) {
  const state = useContentLibraryState({
    ...(onBulkAction !== undefined && { onBulkAction }),
  });

  const handleSortChange = (field: SortField, order: SortOrder) => {
    state.setSortBy(field);
    state.setSortOrder(order);
  };

  const handleFilterToggle = () => {
    state.setShowFilterPanel(!state.showFilterPanel);
  };

  const handleViewModeChange = (mode: ViewMode) => {
    state.setViewMode(mode);
  };

  const handleContentSelect = (item: ContentItem) => {
    onContentSelect?.(item);
  };

  const handleContentEdit = (item: ContentItem) => {
    onContentEdit?.(item);
  };

  const handleContentDelete = (itemId: string) => {
    onContentDelete?.(itemId);
  };

  if (state.isLoading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="content-library max-w-7xl mx-auto p-6">
      <ContentLibraryHeader
        totalItems={state.contentItems.length}
        filteredCount={state.filteredItems.length}
        selectedCount={state.selectedItems.length}
        viewMode={state.viewMode}
        showFilterPanel={state.showFilterPanel}
        onViewModeChange={handleViewModeChange}
        onFilterToggle={handleFilterToggle}
      />

      <SearchAndSortBar
        searchQuery={state.searchQuery}
        sortBy={state.sortBy}
        sortOrder={state.sortOrder}
        onSearchChange={state.setSearchQuery}
        onSortChange={handleSortChange}
      />

      {state.showFilterPanel && (
        <FilterPanel
          filter={state.filter}
          filterOptions={state.filterOptions}
          onFilterChange={state.setFilter}
          onClearFilters={() => state.setFilter({})}
        />
      )}

      {enableBulkActions && (
        <BulkActionsBar
          selectedCount={state.selectedItems.length}
          onBulkAction={state.handleBulkAction}
        />
      )}

      {state.filteredItems.length === 0 ? (
        <EmptyState hasActiveFilters={state.hasActiveFilters} onClearFilters={state.clearFilters} />
      ) : (
        <>
          {state.viewMode === "grid" ? (
            <ContentGridView
              items={state.paginatedItems}
              selectedItems={state.selectedItems}
              enableBulkActions={enableBulkActions}
              onItemSelect={state.handleItemSelect}
              onItemClick={handleContentSelect}
            />
          ) : (
            <ContentListView
              items={state.paginatedItems}
              selectedItems={state.selectedItems}
              enableBulkActions={enableBulkActions}
              onItemSelect={state.handleItemSelect}
              onSelectAll={state.handleSelectAll}
              onEdit={handleContentEdit}
              onDelete={handleContentDelete}
            />
          )}

          <Pagination
            currentPage={state.currentPage}
            totalPages={state.totalPages}
            totalItems={state.filteredItems.length}
            itemsPerPage={state.itemsPerPage}
            onPageChange={state.setCurrentPage}
          />
        </>
      )}
    </div>
  );
}
