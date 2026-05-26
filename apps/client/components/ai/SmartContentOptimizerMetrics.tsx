"use client";

/**
 * @file SmartContentOptimizerMetrics.tsx
 * @description Advanced metrics tab for the SmartContentOptimizer, showing platform
 * optimization scores and engagement predictions when enabled.
 */

import React from "react";
import { useTranslations } from "next-intl";

interface SmartContentOptimizerMetricsProps {
  platforms: string[];
}

/**
 * @component SmartContentOptimizerMetrics
 * @description Advanced metrics tab showing per-platform optimization scores and
 * engagement predictions when the advanced analysis feature is enabled.
 */
export function SmartContentOptimizerMetrics({ platforms }: SmartContentOptimizerMetricsProps) {
  const t = useTranslations("ai.components");
  return (
    <div className="space-y-6">
      <h4 className="text-lg font-semibold text-gray-900">{t("metrics.title")}</h4>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-linear-to-br from-purple-50 to-blue-50 rounded-lg p-6">
          <h5 className="font-semibold text-gray-900 mb-4">{t("metrics.platformOptimization")}</h5>
          <div className="space-y-3">
            {platforms.map((platform) => {
              // Placeholder score; backend API provides real optimization scores per platform
              const score = 0;
              return (
                <div key={platform} className="flex items-center justify-between">
                  <span className="capitalize text-gray-700">{platform}</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-24 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-purple-600 h-2 rounded-full"
                        style={{ width: `${score}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium w-12">{Math.round(score)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-linear-to-br from-green-50 to-teal-50 rounded-lg p-6">
          <h5 className="font-semibold text-gray-900 mb-4">{t("metrics.engagementPredictions")}</h5>
          <div className="space-y-3 text-sm">
            {/* Placeholder values; real predictions come from the AI backend */}
            <div className="flex justify-between">
              <span className="text-gray-600">{t("metrics.expectedLikes")}</span>
              <span className="font-medium">-</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">{t("metrics.expectedComments")}</span>
              <span className="font-medium">-</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">{t("metrics.expectedShares")}</span>
              <span className="font-medium">-</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">{t("metrics.estimatedReach")}</span>
              <span className="font-medium">-</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
