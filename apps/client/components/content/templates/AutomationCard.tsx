"use client";

/**
 * @file AutomationCard.tsx
 * @description Card component representing a single automation rule, displaying its name,
 * trigger, schedule, status, and controls to toggle active state or edit settings.
 * @component AutomationCard
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Play, Pause, Settings, Wand2 } from "lucide-react";
import type { AutomationTemplate } from "./types";

interface AutomationCardProps {
  automation: AutomationTemplate;
  onToggle: (automationId: string, active: boolean) => void;
}

/**
 * @component AutomationCard
 * @description Card representing a single automation rule, displaying name, trigger,
 * schedule, status, and controls to toggle active state or edit settings.
 */
export const AutomationCard: React.FC<AutomationCardProps> = ({ automation, onToggle }) => {
  const t = useTranslations("content");
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="border rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1">
            <h3 className="font-medium text-gray-900">{automation.name}</h3>
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                automation.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
              }`}
            >
              {automation.isActive ? t("automation.active") : t("automation.inactive")}
            </span>
          </div>
          <p className="text-sm text-gray-600 mb-2">{automation.description}</p>
          <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
            <div>
              <span className="font-medium">{t("automation.successRate")}</span>{" "}
              {Math.round((automation.stats.successfulRuns / automation.stats.totalRuns) * 100)}%
            </div>
            <div>
              <span className="font-medium">{t("automation.totalRuns")}</span>{" "}
              {automation.stats.totalRuns}
            </div>
            {automation.nextRun && (
              <div>
                <span className="font-medium">{t("automation.nextRun")}</span>{" "}
                {formatDate(automation.nextRun)}
              </div>
            )}
            {automation.lastRun && (
              <div>
                <span className="font-medium">{t("automation.lastRun")}</span>{" "}
                {formatDate(automation.lastRun)}
              </div>
            )}
          </div>
        </div>

        <div className="flex space-x-1">
          <button
            type="button"
            onClick={() => onToggle(automation.id, !automation.isActive)}
            className={`p-2 rounded-sm ${
              automation.isActive
                ? "text-orange-600 hover:bg-orange-100"
                : "text-green-600 hover:bg-green-100"
            }`}
            aria-label={
              automation.isActive ? t("automation.pauseLabel") : t("automation.startLabel")
            }
            title={automation.isActive ? t("automation.pauseTitle") : t("automation.startTitle")}
          >
            {automation.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            type="button"
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-sm"
            aria-label={t("automation.configureLabel")}
            title={t("automation.configureTitle")}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {automation.platforms.map((platform, idx) => (
            <span
              key={idx}
              className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-sm capitalize"
            >
              {platform}
            </span>
          ))}
        </div>

        <div className="bg-purple-50 p-3 rounded-sm text-sm">
          <div className="flex items-center space-x-2 mb-1">
            <Wand2 className="w-4 h-4 text-purple-600" />
            <span className="font-medium text-purple-800">{t("automation.triggerLabel")}</span>
          </div>
          <p className="text-purple-700">
            {automation.trigger.type === "schedule"
              ? t("automation.triggerSchedule")
              : automation.trigger.type === "performance"
                ? t("automation.triggerPerformance")
                : automation.trigger.type === "keyword"
                  ? t("automation.triggerKeyword")
                  : t("automation.triggerEvent")}
          </p>
        </div>
      </div>
    </div>
  );
};
