"use client";

/**
 * @file AITemplateSelector.tsx
 * @description Grid of selectable AI content templates, highlighting the active
 * selection and allowing users to pick a template to drive the generation workflow.
 * @component AITemplateSelector
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
import type { ContentTemplate } from "../../types/ai-content.js";

interface AITemplateSelectorProps {
  templates: ContentTemplate[];
  selectedTemplateId: string;
  onTemplateSelect: (templateId: string) => void;
}

/**
 * @component AITemplateSelector
 * @description Grid of selectable AI content templates, highlighting the active selection
 * and allowing users to pick a template to drive the generation workflow.
 */
export function AITemplateSelector({
  templates,
  selectedTemplateId,
  onTemplateSelect,
}: AITemplateSelectorProps) {
  const t = useTranslations("ai.components");
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-gray-900">{t("templateSelector.title")}</h4>
        <div className="text-sm text-gray-600">
          {t("templateSelector.available", { count: templates.length })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((template) => (
          <div
            key={template.id}
            onClick={() => onTemplateSelect(template.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTemplateSelect(template.id);
              }
            }}
            className={`border rounded-lg p-4 cursor-pointer transition-all focus-within:ring-2 focus-within:ring-purple-500 ${
              selectedTemplateId === template.id
                ? "border-purple-500 bg-purple-50"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
            role="button"
            tabIndex={0}
            aria-pressed={selectedTemplateId === template.id}
            aria-label={t("templateSelector.selectAria", { name: template.name })}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h5 className="font-semibold text-gray-900">{template.name}</h5>
                <p className="text-sm text-gray-600 mt-1">{template.description}</p>
              </div>
              <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
                {template.category}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {template.platforms.map((platform) => (
                  <span
                    key={platform}
                    className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-sm capitalize"
                  >
                    {platform}
                  </span>
                ))}
              </div>

              <div className="flex items-center text-sm">
                <span className="text-gray-600">
                  {t("templateSelector.variables", { count: template.variables.length })}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
