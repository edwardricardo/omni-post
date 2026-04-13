"use client";

/**
 * @file TemplatesHeader.tsx
 * @description Header component for the content templates section, displaying the section
 * title and action buttons for creating new templates and automation rules.
 */

import React from "react";
import { Plus, Wand2 } from "lucide-react";
import type { AutomationTemplate } from "./types";

interface TemplatesHeaderProps {
  onTemplateCreate?: () => void;
  onAutomationCreate?: (automation: Partial<AutomationTemplate>) => void;
  showAutomation?: boolean;
}

/**
 * @component TemplatesHeader
 * @description Header for the content templates section with title and action buttons
 * for creating new templates and automation rules.
 */
export const TemplatesHeader: React.FC<TemplatesHeaderProps> = ({
  onTemplateCreate,
  onAutomationCreate,
  showAutomation = true,
}) => {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-lg font-semibold text-gray-900">Content Templates & Automation</h3>
      <div className="flex items-center space-x-3">
        <button
          onClick={onTemplateCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>New Template</span>
        </button>
        {showAutomation && (
          <button
            onClick={() => onAutomationCreate?.({})}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium flex items-center space-x-2"
          >
            <Wand2 className="w-4 h-4" />
            <span>New Automation</span>
          </button>
        )}
      </div>
    </div>
  );
};
