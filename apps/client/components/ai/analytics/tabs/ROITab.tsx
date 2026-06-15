/**
 * @file ROITab.tsx
 * @description Tab panel that renders an ROIForecastCard for each campaign forecast
 * returned by the analytics ROI endpoint.
 * @component ROITab
 * @layer infrastructure
 */

import React from "react";
import { ROIForecast } from "../types.js";
import { ROIForecastCard } from "../cards/ROIForecastCard.js";

interface ROITabProps {
  roiForecasts: ROIForecast[];
}

/**
 * @component ROITab
 * @description Tab panel rendering an ROIForecastCard for each campaign forecast
 * returned by the analytics ROI endpoint.
 */
export const ROITab: React.FC<ROITabProps> = ({ roiForecasts }) => {
  return (
    <div className="space-y-6">
      {roiForecasts.map((forecast, index) => (
        <ROIForecastCard key={index} forecast={forecast} />
      ))}
    </div>
  );
};
