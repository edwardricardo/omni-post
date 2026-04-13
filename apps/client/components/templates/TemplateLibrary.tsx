"use client";

/**
 * @file TemplateLibrary.tsx
 * @component TemplateLibrary
 * @description Orchestrator component for the template library. Manages search, filtering,
 * sorting, view mode, and dialog state, delegating rendering to TemplateLibrarySearch,
 * TemplateLibraryGrid, and TemplateLibraryDialogs.
 */

import React, { useState, useMemo, useCallback } from "react";
import { Button } from "@packages/ui";
import { Plus } from "lucide-react";
import Fuse from "fuse.js";
import type { Template } from "@/lib/templates/templateEngine";
import { useToast } from "@packages/ui";
import type {
  TemplateLibraryProps,
  FilterState,
  ViewMode,
  SortBy,
  TemplateCardActions,
} from "./templateLibraryTypes";
import { DEFAULT_FILTER_STATE } from "./templateLibraryTypes";
import { TemplateLibrarySearch } from "./TemplateLibrarySearch";
import { TemplateLibraryGrid } from "./TemplateLibraryGrid";
import { TemplateLibraryDialogs } from "./TemplateLibraryDialogs";

export function TemplateLibrary({
  templates,
  onTemplateSelect,
  onTemplateEdit,
  onTemplateDelete,
  onTemplateCreate,
  onTemplateDuplicate,
  favorites = [],
  onToggleFavorite,
  analytics = {},
  showAnalytics = false,
  allowEdit = true,
  allowDelete = true,
}: TemplateLibraryProps) {
  const { success, error } = useToast();

  // -- State ------------------------------------------------------------------

  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortBy>("updated");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER_STATE);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null);

  // -- Derived data -----------------------------------------------------------

  const fuse = useMemo(() => {
    return new Fuse(templates, {
      keys: [
        { name: "name", weight: 0.4 },
        { name: "description", weight: 0.3 },
        { name: "category", weight: 0.2 },
        { name: "tags", weight: 0.1 },
      ],
      threshold: 0.4,
      includeScore: true,
    });
  }, [templates]);

  const categories = useMemo(() => {
    const cats = [...new Set(templates.map((t) => t.category))];
    return ["all", ...cats];
  }, [templates]);

  const platforms = useMemo(() => {
    const plats = [...new Set(templates.flatMap((t) => t.platforms))];
    return ["all", ...plats];
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    let result = templates;

    // Text search
    if (searchTerm.trim()) {
      const searchResults = fuse.search(searchTerm);
      result = searchResults.map((r) => r.item);
    }

    // Category filter
    if (filters.category !== "all") {
      result = result.filter((t) => t.category === filters.category);
    }

    // Platform filter
    if (filters.platform !== "all") {
      result = result.filter((t) => t.platforms.includes(filters.platform));
    }

    // Tags filter
    if (filters.tags.length > 0) {
      result = result.filter((t) => filters.tags.some((tag) => t.tags?.includes(tag)));
    }

    // Favorites filter
    if (filters.favorites) {
      result = result.filter((t) => favorites.includes(t.id));
    }

    // Date range filter
    if (filters.dateRange !== "all") {
      const now = new Date();
      const cutoff = new Date();

      switch (filters.dateRange) {
        case "week":
          cutoff.setDate(now.getDate() - 7);
          break;
        case "month":
          cutoff.setMonth(now.getMonth() - 1);
          break;
        case "quarter":
          cutoff.setMonth(now.getMonth() - 3);
          break;
      }

      result = result.filter((t) => t.updatedAt && new Date(t.updatedAt) > cutoff);
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "category":
          return a.category.localeCompare(b.category);
        case "created":
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        case "updated":
          return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
        case "popularity": {
          const aPopularity = analytics[a.id]?.uses || 0;
          const bPopularity = analytics[b.id]?.uses || 0;
          return bPopularity - aPopularity;
        }
        default:
          return 0;
      }
    });

    return result;
  }, [templates, searchTerm, filters, sortBy, fuse, favorites, analytics]);

  // -- Callbacks --------------------------------------------------------------

  const handleTemplatePreview = useCallback((template: Template) => {
    setSelectedTemplate(template);
    setPreviewOpen(true);
  }, []);

  const handleTemplateUse = useCallback(
    (template: Template) => {
      onTemplateSelect?.(template);
      success({ description: `Selected template: ${template.name}` });
    },
    [onTemplateSelect, success]
  );

  const handleTemplateEdit = useCallback(
    (template: Template) => {
      onTemplateEdit?.(template);
    },
    [onTemplateEdit]
  );

  const handleTemplateDuplicate = useCallback(
    async (template: Template) => {
      try {
        const duplicatedTemplate: Template = {
          ...template,
          id: `${template.id}-copy-${Date.now()}`,
          name: `${template.name} (Copy)`,
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1,
        };

        onTemplateDuplicate?.(duplicatedTemplate);
        success({ description: `Duplicated template: ${template.name}` });
      } catch {
        error({ description: "Failed to duplicate template" });
      }
    },
    [onTemplateDuplicate, success, error]
  );

  const handleTemplateDelete = useCallback((template: Template) => {
    setTemplateToDelete(template);
    setDeleteConfirmOpen(true);
  }, []);

  const confirmDelete = useCallback(() => {
    if (templateToDelete) {
      onTemplateDelete?.(templateToDelete);
      success({ description: `Deleted template: ${templateToDelete.name}` });
    }
    setDeleteConfirmOpen(false);
    setTemplateToDelete(null);
  }, [templateToDelete, onTemplateDelete, success]);

  const handleToggleFavorite = useCallback(
    (template: Template) => {
      onToggleFavorite?.(template.id);
      const isFavorite = favorites.includes(template.id);
      success({
        description: isFavorite
          ? `Removed ${template.name} from favorites`
          : `Added ${template.name} to favorites`,
      });
    },
    [favorites, onToggleFavorite, success]
  );

  const handleCopyTemplate = useCallback(
    async (template: Template) => {
      try {
        await navigator.clipboard.writeText(template.content);
        success({ description: "Template content copied to clipboard!" });
      } catch {
        error({ description: "Failed to copy to clipboard" });
      }
    },
    [success, error]
  );

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTER_STATE);
    setSearchTerm("");
  }, []);

  // -- Card action props for the grid -----------------------------------------

  const cardActions: TemplateCardActions = useMemo(
    () => ({
      onPreview: handleTemplatePreview,
      onUse: handleTemplateUse,
      ...(allowEdit && onTemplateEdit && { onEdit: handleTemplateEdit }),
      ...(onTemplateDuplicate && { onDuplicate: handleTemplateDuplicate }),
      ...(allowDelete && onTemplateDelete && { onDelete: handleTemplateDelete }),
      onCopy: handleCopyTemplate,
      ...(onToggleFavorite && { onToggleFavorite: handleToggleFavorite }),
    }),
    [
      handleTemplatePreview,
      handleTemplateUse,
      handleTemplateEdit,
      handleTemplateDuplicate,
      handleTemplateDelete,
      handleCopyTemplate,
      handleToggleFavorite,
      allowEdit,
      allowDelete,
      onTemplateEdit,
      onTemplateDelete,
      onTemplateDuplicate,
      onToggleFavorite,
    ]
  );

  // -- Render -----------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Template Library</h2>
          <p className="text-muted-foreground">
            {filteredTemplates.length} of {templates.length} templates
          </p>
        </div>
        {onTemplateCreate && (
          <Button onClick={onTemplateCreate} className="flex items-center space-x-1">
            <Plus className="h-4 w-4" />
            <span>Create Template</span>
          </Button>
        )}
      </div>

      {/* Search and Filters */}
      <TemplateLibrarySearch
        searchTerm={searchTerm}
        filters={filters}
        sortBy={sortBy}
        viewMode={viewMode}
        categories={categories}
        platforms={platforms}
        showAnalytics={showAnalytics}
        onSearchChange={setSearchTerm}
        onFiltersChange={setFilters}
        onSortByChange={setSortBy}
        onViewModeChange={setViewMode}
        onResetFilters={resetFilters}
      />

      {/* Templates Grid/List */}
      <div className="space-y-4">
        <TemplateLibraryGrid
          templates={filteredTemplates}
          viewMode={viewMode}
          favorites={favorites}
          analytics={analytics}
          showAnalytics={showAnalytics}
          allowEdit={allowEdit}
          allowDelete={allowDelete}
          actions={cardActions}
        />
      </div>

      {/* Dialogs */}
      <TemplateLibraryDialogs
        previewOpen={previewOpen}
        deleteConfirmOpen={deleteConfirmOpen}
        selectedTemplate={selectedTemplate}
        templateToDelete={templateToDelete}
        onPreviewClose={setPreviewOpen}
        onDeleteConfirmClose={setDeleteConfirmOpen}
        onUseTemplate={handleTemplateUse}
        onCopyTemplate={handleCopyTemplate}
        onConfirmDelete={confirmDelete}
      />
    </div>
  );
}
