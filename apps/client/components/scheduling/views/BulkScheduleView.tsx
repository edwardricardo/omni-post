"use client";

/**
 * @file BulkScheduleView.tsx
 * @description Bulk scheduling interface that allows users to create multiple scheduled
 * posts at once by selecting platforms, time slots, and content in a batch workflow.
 * @component BulkScheduleView
 * @layer infrastructure
 */

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { CSVBulkUpload } from "@/components/scheduling/CSVBulkUpload";

interface BulkScheduleViewProps {
  onBulkSchedule: (
    contents: string[],
    providers: string[],
    startDate: Date,
    frequency: "daily" | "weekly" | "monthly",
    interval: number
  ) => void;
  projectId?: string;
  timezone?: string;
}

export function BulkScheduleView({ onBulkSchedule, projectId, timezone }: BulkScheduleViewProps) {
  const t = useTranslations("scheduling.components");
  const [contentText, setContentText] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("daily");
  const [interval, setInterval] = useState(1);

  const handleSubmit = () => {
    const contents = contentText
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => line.trim());

    if (contents.length === 0 || selectedProviders.length === 0 || !startDate) {
      return;
    }

    onBulkSchedule(contents, selectedProviders, new Date(startDate), frequency, interval);
  };

  const toggleProvider = (provider: string) => {
    setSelectedProviders((prev) =>
      prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]
    );
  };

  const contentCount = contentText.split("\n").filter((line) => line.trim()).length;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">{t("bulkTitle")}</h3>
        <p className="text-gray-600 text-sm mb-6">{t("bulkSubtitle")}</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bulk schedule form */}
          <div className="space-y-4">
            <div>
              <label
                htmlFor="content-series"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t("bulkContentSeries", { count: contentCount })}
              </label>
              <textarea
                id="content-series"
                value={contentText}
                onChange={(e) => setContentText(e.target.value)}
                placeholder={t("bulkContentPlaceholder")}
                className="w-full p-3 border rounded-lg h-48 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                aria-describedby="content-help"
              />
              <p id="content-help" className="text-xs text-gray-500 mt-1">
                {t("bulkContentHelp")}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="start-date"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t("bulkStartDate")}
                </label>
                <input
                  id="start-date"
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="frequency" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("bulkFrequency")}
                </label>
                <select
                  id="frequency"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as "daily" | "weekly" | "monthly")}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="daily">{t("frequencyDaily")}</option>
                  <option value="weekly">{t("frequencyWeekly")}</option>
                  <option value="monthly">{t("frequencyMonthly")}</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="interval" className="block text-sm font-medium text-gray-700 mb-1">
                {frequency === "daily"
                  ? t("bulkIntervalDays", { count: interval })
                  : frequency === "weekly"
                    ? t("bulkIntervalWeeks", { count: interval })
                    : t("bulkIntervalMonths", { count: interval })}
              </label>
              <input
                id="interval"
                type="range"
                min="1"
                max="7"
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
                className="w-full"
                aria-valuemin={1}
                aria-valuemax={7}
                aria-valuenow={interval}
              />
            </div>

            <fieldset className="border-0 p-0 m-0 min-w-0">
              <legend className="block text-sm font-medium text-gray-700 mb-2 p-0">
                {t("bulkPlatforms")}
              </legend>
              <div className="flex flex-wrap gap-3">
                {["x", "instagram", "facebook", "linkedin"].map((provider) => (
                  <label key={provider} className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedProviders.includes(provider)}
                      onChange={() => toggleProvider(provider)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      aria-label={t("bulkScheduleToProvider", { provider })}
                    />
                    <span className="ml-2 text-sm capitalize">{provider}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <button
              onClick={handleSubmit}
              disabled={contentCount === 0 || selectedProviders.length === 0 || !startDate}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-blue-500"
            >
              {t("bulkScheduleButton", { count: contentCount })}
            </button>
          </div>

          {/* Preview */}
          <div className="border rounded-lg p-4">
            <h4 className="font-medium mb-3">{t("bulkPreviewTitle")}</h4>
            {contentCount === 0 || !startDate ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-sm">{t("bulkPreviewEmpty")}</p>
              </div>
            ) : (
              <div className="space-y-2 text-sm max-h-96 overflow-y-auto">
                {contentText
                  .split("\n")
                  .filter((line) => line.trim())
                  .slice(0, 10)
                  .map((content, index) => {
                    const date = new Date(startDate);
                    switch (frequency) {
                      case "daily":
                        date.setDate(date.getDate() + index * interval);
                        break;
                      case "weekly":
                        date.setDate(date.getDate() + index * interval * 7);
                        break;
                      case "monthly":
                        date.setMonth(date.getMonth() + index * interval);
                        break;
                    }

                    return (
                      <div key={index} className="p-2 bg-gray-50 rounded-sm">
                        <div className="font-medium text-gray-900">
                          {t("bulkPreviewPost", { number: index + 1 })}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {t("bulkPreviewDateTime", {
                            date: date.toLocaleDateString(),
                            time: date.toLocaleTimeString(),
                          })}
                        </div>
                        <div className="text-xs text-gray-500 mt-1 truncate">{content}</div>
                        <div className="text-xs text-blue-600 mt-1">
                          {selectedProviders.join(", ")}
                        </div>
                      </div>
                    );
                  })}
                {contentCount > 10 && (
                  <div className="text-xs text-gray-500 text-center py-2">
                    {t("bulkMorePosts", { count: contentCount - 10 })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CSV Bulk Upload */}
      {projectId !== undefined && (
        <div className="bg-white rounded-lg border p-6">
          <CSVBulkUpload projectId={projectId} {...(timezone !== undefined && { timezone })} />
        </div>
      )}

      {/* Templates */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">{t("templatesTitle")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(["dailyEngagement", "weeklyDigest", "productLaunch"] as const).map((templateKey) => (
            <div
              key={templateKey}
              className="border rounded-lg p-4 hover:shadow-xs transition-shadow"
            >
              <h4 className="font-medium mb-2">{t(`templates.${templateKey}.name`)}</h4>
              <p className="text-sm text-gray-600 mb-2">
                {t(`templates.${templateKey}.description`)}
              </p>
              <p className="text-xs text-gray-500 mb-3">{t(`templates.${templateKey}.schedule`)}</p>
              <button className="w-full text-blue-600 border border-blue-600 py-2 px-4 rounded-sm hover:bg-blue-50 focus:ring-2 focus:ring-blue-500">
                {t("templatesUse")}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
