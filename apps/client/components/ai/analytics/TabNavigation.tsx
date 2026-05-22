/**
 * @file TabNavigation.tsx
 * @description Horizontal tab bar for the PredictiveAnalytics dashboard, allowing
 * users to switch between Performance, ROI Forecast, Audience, and Competitive views.
 * @layer infrastructure
 */

import React from "react";
import { BarChart3, DollarSign, Users, Target, LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnalysisTab } from "./types";

interface TabConfig {
  id: AnalysisTab;
  labelKey: string;
  icon: LucideIcon;
}

const tabs = [
  { id: "performance", labelKey: "tabNav.performance", icon: BarChart3 },
  { id: "roi", labelKey: "tabNav.roi", icon: DollarSign },
  { id: "audience", labelKey: "tabNav.audience", icon: Users },
  { id: "competitive", labelKey: "tabNav.competitive", icon: Target },
] as const satisfies ReadonlyArray<TabConfig>;

interface TabNavigationProps {
  activeTab: AnalysisTab;
  onTabChange: (tab: AnalysisTab) => void;
}

/**
 * @component TabNavigation
 * @description Horizontal tab bar for the PredictiveAnalytics dashboard, switching
 * between Performance, ROI Forecast, Audience, and Competitive views.
 */
export const TabNavigation: React.FC<TabNavigationProps> = ({ activeTab, onTabChange }) => {
  const t = useTranslations("ai.components");
  return (
    <div className="border-b border-gray-200">
      <nav className="flex space-x-8 px-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
                activeTab === tab.id
                  ? "border-purple-500 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
