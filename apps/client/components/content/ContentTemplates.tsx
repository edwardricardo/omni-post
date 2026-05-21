"use client";

/**
 * @file ContentTemplates.tsx
 * @description Main content templates management component that orchestrates sub-components
 * for template browsing, filtering, automation management, and template variable filling.
 *
 * Sub-components are located in ./templates/ and handle their own rendering logic:
 * - TemplatesHeader: Title + create buttons
 * - TemplatesTabs: Templates / Automation tab navigation
 * - TemplateFilters: Search, category, sort, and view mode controls
 * - TemplateGrid: Grid/list layout of TemplateCard items
 * - AutomationList: List of AutomationCard items with empty state
 * - TemplateVariableModal: Modal for filling template variable placeholders
 * - TemplatesLoadingSkeleton: Loading placeholder
 * - useTemplateData: Data fetching, filtering, and sorting hook
 */

import React, { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  TemplatesHeader,
  TemplatesTabs,
  TemplateFilters,
  TemplateGrid,
  AutomationList,
  TemplateVariableModal,
  TemplatesLoadingSkeleton,
  useTemplateData,
} from "./templates";
import type {
  ContentTemplate,
  AutomationTemplate,
  FilterOptions,
  SortOption,
  ViewMode,
  TabOption,
} from "./templates";

/**
 * @component ContentTemplates
 * @description Content templates management orchestrator composing sub-components for
 * template browsing, filtering, automation management, and template variable filling.
 */

interface ContentTemplatesProps {
  projectId?: string;
  onTemplateSelect?: (template: ContentTemplate) => void;
  onTemplateCreate?: () => void;
  onTemplateEdit?: (templateId: string) => void;
  onTemplateDelete?: (templateId: string) => void;
  onTemplateUse?: (templateId: string, variables: Record<string, string>) => void;
  onAutomationCreate?: (automation: Partial<AutomationTemplate>) => void;
  onAutomationToggle?: (automationId: string, active: boolean) => void;
  showAutomation?: boolean;
  maxTemplates?: number;
}

const ContentTemplates: React.FC<ContentTemplatesProps> = ({
  projectId = "default",
  onTemplateSelect: _onTemplateSelect,
  onTemplateCreate,
  onTemplateEdit,
  onTemplateDelete,
  onTemplateUse,
  onAutomationCreate,
  onAutomationToggle,
  showAutomation = true,
  maxTemplates: _maxTemplates = 50,
}) => {
  const t = useTranslations("content");
  // ---------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [activeTab, setActiveTab] = useState<TabOption>("templates");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBy, setFilterBy] = useState<FilterOptions>({});
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [showVariableModal, setShowVariableModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ContentTemplate | null>(null);

  // ---------------------------------------------------------------
  // Data (fetching + filtering + sorting delegated to the hook)
  // ---------------------------------------------------------------
  const { templates, setTemplates, automations, sortedTemplates, isLoading } = useTemplateData(
    projectId,
    searchQuery,
    filterBy,
    sortBy
  );

  // ---------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------
  const handleTemplateUse = useCallback((template: ContentTemplate) => {
    setSelectedTemplate(template);
    setShowVariableModal(true);
  }, []);

  const handleVariableSubmit = useCallback(
    (templateId: string, variables: Record<string, string>) => {
      onTemplateUse?.(templateId, variables);
      setShowVariableModal(false);
      setSelectedTemplate(null);
    },
    [onTemplateUse]
  );

  const handleDuplicate = useCallback(
    (template: ContentTemplate) => {
      const newTemplate: ContentTemplate = {
        ...template,
        id: `${template.id}_copy`,
        name: t("copySuffix", { name: template.name }),
      };
      setTemplates((prev) => [...prev, newTemplate]);
    },
    [setTemplates, t]
  );

  const handleEdit = useCallback(
    (templateId: string) => {
      onTemplateEdit?.(templateId);
    },
    [onTemplateEdit]
  );

  const handleDelete = useCallback(
    (templateId: string) => {
      onTemplateDelete?.(templateId);
    },
    [onTemplateDelete]
  );

  const handleAutomationToggle = useCallback(
    (automationId: string, active: boolean) => {
      onAutomationToggle?.(automationId, active);
    },
    [onAutomationToggle]
  );

  const handleAutomationCreate = useCallback(
    (automation: Partial<AutomationTemplate>) => {
      onAutomationCreate?.(automation);
    },
    [onAutomationCreate]
  );

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  if (isLoading) {
    return <TemplatesLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      <TemplatesHeader
        {...(onTemplateCreate !== undefined && { onTemplateCreate })}
        {...(onAutomationCreate !== undefined && { onAutomationCreate })}
        showAutomation={showAutomation}
      />

      {showAutomation && (
        <TemplatesTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          templatesCount={templates.length}
          automationsCount={automations.length}
        />
      )}

      {activeTab === "templates" && (
        <>
          <TemplateFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterBy={filterBy}
            onFilterChange={setFilterBy}
            sortBy={sortBy}
            onSortChange={setSortBy}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />

          <TemplateGrid
            templates={sortedTemplates}
            viewMode={viewMode}
            onTemplateUse={handleTemplateUse}
            onTemplateEdit={handleEdit}
            onTemplateDuplicate={handleDuplicate}
            onTemplateDelete={handleDelete}
          />
        </>
      )}

      {activeTab === "automation" && showAutomation && (
        <AutomationList
          automations={automations}
          onAutomationToggle={handleAutomationToggle}
          onAutomationCreate={handleAutomationCreate}
        />
      )}

      <TemplateVariableModal
        template={selectedTemplate}
        isOpen={showVariableModal}
        onClose={() => {
          setShowVariableModal(false);
          setSelectedTemplate(null);
        }}
        onSubmit={handleVariableSubmit}
      />
    </div>
  );
};

export default ContentTemplates;
