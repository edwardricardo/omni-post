"use client";

/**
 * @file TemplatesHeader.tsx
 * @description Header component for the content templates section, displaying the section
 * title and action buttons for creating new templates and automation rules.
 * @component TemplatesHeader
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("content");
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-lg font-semibold text-gray-900">{t("header.title")}</h3>
      <div className="flex items-center space-x-3">
        <button
          onClick={onTemplateCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>{t("header.newTemplate")}</span>
        </button>
        {showAutomation && (
          <button
            onClick={() => onAutomationCreate?.({})}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium flex items-center space-x-2"
          >
            <Wand2 className="w-4 h-4" />
            <span>{t("header.newAutomation")}</span>
          </button>
        )}
      </div>
    </div>
  );
};
