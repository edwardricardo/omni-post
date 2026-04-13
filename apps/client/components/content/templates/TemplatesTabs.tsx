"use client";

/**
 * @file TemplatesTabs.tsx
 * @description Tab navigation component for the templates section, switching between
 * the templates list and the automation rules list tabs.
 */

import React from "react";
import type { TabOption } from "./types";

interface TemplatesTabsProps {
  activeTab: TabOption;
  onTabChange: (tab: TabOption) => void;
  templatesCount: number;
  automationsCount: number;
}

/**
 * @component TemplatesTabs
 * @description Tab navigation switching between the templates list and the
 * automation rules list, with item counts per tab.
 */
export const TemplatesTabs: React.FC<TemplatesTabsProps> = ({
  activeTab,
  onTabChange,
  templatesCount,
  automationsCount,
}) => {
  return (
    <div className="border-b">
      <nav className="flex space-x-8">
        <button
          onClick={() => onTabChange("templates")}
          className={`py-2 px-1 border-b-2 font-medium text-sm ${
            activeTab === "templates"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Templates ({templatesCount})
        </button>
        <button
          onClick={() => onTabChange("automation")}
          className={`py-2 px-1 border-b-2 font-medium text-sm ${
            activeTab === "automation"
              ? "border-purple-500 text-purple-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Automation ({automationsCount})
        </button>
      </nav>
    </div>
  );
};
