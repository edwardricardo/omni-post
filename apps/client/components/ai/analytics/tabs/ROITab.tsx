/**
 * @file ROITab.tsx
 * @description Tab panel that renders an ROIForecastCard for each campaign forecast
 * returned by the analytics ROI endpoint.
 */

import React from "react";
import { ROIForecast } from "../types";
import { ROIForecastCard } from "../cards/ROIForecastCard";

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
