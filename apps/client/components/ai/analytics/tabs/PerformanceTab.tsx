/**
 * @file PerformanceTab.tsx
 * @description Tab panel that renders a PerformancePredictionCard for each platform
 * prediction returned by the AI timing-prediction endpoint.
 * @component PerformanceTab
 * @layer infrastructure
 */

import React from "react";
import { PerformancePrediction } from "../types.js";
import { PerformancePredictionCard } from "../cards/PerformancePredictionCard.js";

interface PerformanceTabProps {
  predictions: PerformancePrediction[];
}

/**
 * @component PerformanceTab
 * @description Tab panel rendering a PerformancePredictionCard for each platform
 * prediction returned by the AI timing-prediction endpoint.
 */
export const PerformanceTab: React.FC<PerformanceTabProps> = ({ predictions }) => {
  return (
    <div className="space-y-6">
      <div className="grid gap-6">
        {predictions.map((prediction) => (
          <PerformancePredictionCard key={prediction.platform} prediction={prediction} />
        ))}
      </div>
    </div>
  );
};
