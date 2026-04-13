"use client";

/**
 * @file AudienceInsightsPanel.tsx
 * @description Presents demographic and behavioral audience insight cards,
 * including age distribution, top locations, and peak activity windows.
 */

import React from "react";
import type { AudienceInsight } from "./types";

interface AudienceInsightsPanelProps {
  insights: AudienceInsight[];
}

/**
 * @component AudienceInsightsPanel
 * @description Demographic and behavioral audience insight cards showing age distribution,
 * top locations, and peak activity windows per platform.
 */
export function AudienceInsightsPanel({ insights }: AudienceInsightsPanelProps) {
  return (
    <div className="bg-white rounded-lg border p-6">
      <h4 className="font-medium mb-4">👥 Audience Insights</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {insights.map((insight) => (
          <div key={insight.platformId} className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h5 className="font-medium capitalize">{insight.platformId}</h5>
              <span className="text-sm text-green-600">
                +{insight.growthRate.toFixed(1)}% growth
              </span>
            </div>

            <div className="text-sm text-gray-600 mb-3">
              {insight.totalFollowers.toLocaleString()} followers •{" "}
              {insight.engagement.avgRate.toFixed(1)}% engagement rate
            </div>

            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">Peak times:</span>{" "}
                {insight.engagement.peakTimes.join(", ")}
              </div>
              <div>
                <span className="font-medium">Top interests:</span>{" "}
                {insight.demographics.interests.slice(0, 3).join(", ")}
              </div>
              <div>
                <span className="font-medium">Prefers:</span>{" "}
                {insight.engagement.contentPreferences.slice(0, 2).join(", ")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
