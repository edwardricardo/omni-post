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

  const { predictions, roiForecasts, audienceInsights, competitorData, isLoading } =
    usePredictiveData({
      accountId,
      platforms,
      timeframe: selectedTimeframe,
      ...(onPredictionUpdate !== undefined && { onPredictionUpdate }),
    });

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="bg-white rounded-lg shadow-lg">
      <AnalyticsHeader
        selectedTimeframe={selectedTimeframe}
        onTimeframeChange={setSelectedTimeframe}
      />

      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

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
