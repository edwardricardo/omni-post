/**
 * @file PerformanceTab.tsx
 * @description Tab panel that renders a PerformancePredictionCard for each platform
 * prediction returned by the AI timing-prediction endpoint.
 */

import React from "react";
import { PerformancePrediction } from "../types";
import { PerformancePredictionCard } from "../cards/PerformancePredictionCard";

interface PerformanceTabProps {
  predictions: PerformancePrediction[];
}

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
