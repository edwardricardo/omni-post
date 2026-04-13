"use client";

/**
 * @file AITemplateSelector.tsx
 * @description Grid of selectable AI content templates, highlighting the active
 * selection and allowing users to pick a template to drive the generation workflow.
 */

import React from "react";
import { TrendingUp } from "lucide-react";
import type { ContentTemplate } from "../../types/ai-content";

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
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-gray-900">Choose a Template</h4>
        <div className="text-sm text-gray-600">{templates.length} templates available</div>
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
            aria-label={`Select ${template.name} template`}
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

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{template.variables.length} variables</span>
                <div className="flex items-center space-x-1">
                  <TrendingUp className="w-3 h-3 text-green-600" aria-hidden="true" />
                  <span className="text-green-600 font-medium">
                    {template.estimatedEngagement}% engagement
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
