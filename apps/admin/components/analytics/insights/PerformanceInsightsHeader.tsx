"use client";

/**
 * @file PerformanceInsightsHeader.tsx
 * @description Header bar for the Performance Insights panel displaying the last
 * analysis timestamp and a refresh button to trigger a new analysis run.
 */

import React from "react";

interface PerformanceInsightsHeaderProps {
  lastAnalysisAt: Date | null;
  isAnalyzing: boolean;
  onRefresh: () => void;
}

export function PerformanceInsightsHeader({
  lastAnalysisAt,
  isAnalyzing,
  onRefresh,
}: PerformanceInsightsHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Performance Insights</h2>
        <p className="text-gray-600">
          AI-driven recommendations to improve your content performance
          {lastAnalysisAt && (
            <span className="ml-2 text-sm">• Last analyzed {lastAnalysisAt.toLocaleString()}</span>
          )}
        </p>
      </div>
      <button
        onClick={onRefresh}
        disabled={isAnalyzing}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {isAnalyzing ? "Analyzing..." : "Refresh Analysis"}
      </button>
    </div>
  );
}
