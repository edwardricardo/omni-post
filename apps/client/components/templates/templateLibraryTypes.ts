/**
 * @file templateLibraryTypes.ts
 * @description Shared types and constants used by the TemplateLibrary component
 * and its sub-components (search/filters, grid, list, dialogs).
 * @layer infrastructure
 */

import type { Template } from "@/lib/templates/templateEngine";

export interface TemplateLibraryProps {
  templates: Template[];
  onTemplateSelect?: (template: Template) => void;
  onTemplateEdit?: (template: Template) => void;
  onTemplateDelete?: (template: Template) => void;
  onTemplateCreate?: () => void;
  onTemplateDuplicate?: (template: Template) => void;
  favorites?: string[];
  onToggleFavorite?: (templateId: string) => void;
  analytics?: Record<string, TemplateStats>;
  showAnalytics?: boolean;
  allowEdit?: boolean;
  allowDelete?: boolean;
}

export interface TemplateStats {
  views: number;
  uses: number;
  likes: number;
}

export interface FilterState {
  category: string;
  platform: string;
  tags: string[];
  dateRange: string;
  favorites: boolean;
}

export type ViewMode = "grid" | "list";
export type SortBy = "name" | "created" | "updated" | "category" | "popularity";

export interface TemplateLibrarySearchProps {
  searchTerm: string;
  filters: FilterState;
  sortBy: SortBy;
  viewMode: ViewMode;
  categories: string[];
  platforms: string[];
  showAnalytics: boolean;
  onSearchChange: (term: string) => void;
  onFiltersChange: (updater: (prev: FilterState) => FilterState) => void;
  onSortByChange: (sort: SortBy) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onResetFilters: () => void;
}

export interface TemplateCardActions {
  onPreview: (template: Template) => void;
  onUse: (template: Template) => void;
  onEdit?: (template: Template) => void;
  onDuplicate?: (template: Template) => void;
  onDelete?: (template: Template) => void;
  onCopy: (template: Template) => void;
  onToggleFavorite?: (template: Template) => void;
}

export interface TemplateLibraryGridProps {
  templates: Template[];
  viewMode: ViewMode;
  favorites: string[];
  analytics: Record<string, TemplateStats>;
  showAnalytics: boolean;
  allowEdit: boolean;
  allowDelete: boolean;
  actions: TemplateCardActions;
}

export interface TemplateLibraryDialogsProps {
  previewOpen: boolean;
  deleteConfirmOpen: boolean;
  selectedTemplate: Template | null;
  templateToDelete: Template | null;
  onPreviewClose: (open: boolean) => void;
  onDeleteConfirmClose: (open: boolean) => void;
  onUseTemplate: (template: Template) => void;
  onCopyTemplate: (template: Template) => void;
  onConfirmDelete: () => void;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  category: "all",
  platform: "all",
  tags: [],
  dateRange: "all",
  favorites: false,
};
