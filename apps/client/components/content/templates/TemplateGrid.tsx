"use client";

/**
 * @file TemplateGrid.tsx
 * @description Grid container that renders a collection of TemplateCard components or a
 * list-style fallback, displaying all filtered content templates with an empty state.
 */

import React from "react";
import { FileText } from "lucide-react";
import { TemplateCard } from "./TemplateCard";
import type { ContentTemplate, ViewMode } from "./types";

interface TemplateGridProps {
  templates: ContentTemplate[];
  viewMode: ViewMode;
  onTemplateUse: (template: ContentTemplate) => void;
  onTemplateEdit: (templateId: string) => void;
  onTemplateDuplicate: (template: ContentTemplate) => void;
  onTemplateDelete: (templateId: string) => void;
}

/**
 * @component TemplateGrid
 * @description Grid container rendering TemplateCard components or a list-style fallback,
 * displaying filtered content templates with an empty state.
 */
export const TemplateGrid: React.FC<TemplateGridProps> = ({
  templates,
  viewMode,
  onTemplateUse,
  onTemplateEdit,
  onTemplateDuplicate,
  onTemplateDelete,
}) => {
  if (templates.length === 0) {
    return (
      <div className="col-span-full text-center py-8 text-gray-500">
        <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No templates found matching your criteria</p>
      </div>
    );
  }

  return (
    <div
      className={`grid gap-4 ${viewMode === "grid" ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}
    >
      {templates.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          onUse={onTemplateUse}
          onEdit={onTemplateEdit}
          onDuplicate={onTemplateDuplicate}
          onDelete={onTemplateDelete}
        />
      ))}
    </div>
  );
};
