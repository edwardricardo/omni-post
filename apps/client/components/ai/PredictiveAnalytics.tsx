"use client";

/**
 * @file PredictiveAnalytics.tsx
 * @description Orchestrator component for the Content Intelligence dashboard.
 * Delegates rendering to sub-components under analytics/ and data fetching to
 * the usePredictiveData TanStack Query hook.
 */

import React, { useState } from "react";
import { AnalyticsHeader } from "./analytics/AnalyticsHeader";
import { LoadingState } from "./analytics/LoadingState";
import { TabNavigation } from "./analytics/TabNavigation";
import { PerformanceTab } from "./analytics/tabs/PerformanceTab";
import { ROITab } from "./analytics/tabs/ROITab";
import { AudienceTab } from "./analytics/tabs/AudienceTab";
import { CompetitiveTab } from "./analytics/tabs/CompetitiveTab";
import { usePredictiveData } from "./analytics/hooks/usePredictiveData";
import type { PerformancePrediction, AnalysisTab, Timeframe } from "./analytics/types";

interface PredictiveAnalyticsProps {
  accountId?: string;
  contentId?: string;
  platforms?: string[];
  timeframe?: Timeframe;
  analysisType?: AnalysisTab;
  onPredictionUpdate?: (predictions: PerformancePrediction[]) => void;
  showAdvanced?: boolean;
}

/**
 * @component PredictiveAnalytics
 * @description Predictive analytics dashboard with tabbed views for Performance, Audience,
 * ROI, and Competitive analysis, powered by the usePredictiveData hook.
 * @param props.platforms - Social platforms to include in the analysis
 * @param props.timeframe - Time window for predictions (7d, 30d, 90d)
 * @param props.onPredictionUpdate - Callback fired when new predictions are available
 */
const PredictiveAnalytics: React.FC<PredictiveAnalyticsProps> = ({
  accountId = "default",
  contentId: _contentId,
  platforms = ["twitter", "linkedin", "facebook", "instagram"],
  timeframe = "30d",
  analysisType = "performance",
  onPredictionUpdate,
  showAdvanced: _showAdvanced = false,
}) => {
  const [activeTab, setActiveTab] = useState<AnalysisTab>(analysisType);
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>(timeframe);

  const { predictions, roiForecasts, audienceInsights, competitorData, isLoading, isError, error } =
    usePredictiveData({
      accountId,
      platforms,
      timeframe: selectedTimeframe,
      ...(onPredictionUpdate !== undefined && { onPredictionUpdate }),
    });

  if (isLoading) {
    return <LoadingState />;
  }

  // Backend endpoints currently respond with 501 NOT_IMPLEMENTED until the
  // real ML/scoring services land. Surface that state explicitly instead of
  // rendering empty tabs (which would silently look like "no insights yet").
  const isNotImplemented =
    isError && (error?.message.includes("501") || error?.message.includes("NOT_IMPLEMENTED"));

  return (
    <div className="bg-white rounded-lg shadow-lg">
      <AnalyticsHeader
        selectedTimeframe={selectedTimeframe}
        onTimeframeChange={setSelectedTimeframe}
      />

      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      {isNotImplemented && (
        <div
          className="mx-6 mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          role="status"
        >
          <p className="font-medium">Predictive analytics: backend in development</p>
          <p className="mt-1 text-xs">
            The four predictive endpoints (timing, audience, ROI, competitive) are scaffolded but
            their implementation is pending. The dashboard will populate once the backend ships.
          </p>
        </div>
      )}

      {isError && !isNotImplemented && (
        <div
          className="mx-6 mt-4 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-medium">Failed to load predictive analytics</p>
          <p className="mt-1 text-xs break-all">
            {error?.message ?? "An unknown error occurred while contacting the backend."}
          </p>
        </div>
      )}

      <div className="p-6">
        {activeTab === "performance" && <PerformanceTab predictions={predictions} />}

        {activeTab === "roi" && <ROITab roiForecasts={roiForecasts} />}

        {activeTab === "audience" && <AudienceTab audienceInsights={audienceInsights} />}

        {activeTab === "competitive" && <CompetitiveTab competitorData={competitorData} />}
      </div>
    </div>
  );
};

export default PredictiveAnalytics;
