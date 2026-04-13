/**
 * @file AnalyticsHeader.tsx
 * @description Header bar for the PredictiveAnalytics dashboard containing the
 * title, description, and a timeframe selector (7d / 30d / 90d).
 */

import React from "react";
import { Brain, Sparkles } from "lucide-react";
import { Timeframe } from "./types";

interface AnalyticsHeaderProps {
  selectedTimeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
}

/**
 * @component AnalyticsHeader
 * @description Header bar for the PredictiveAnalytics dashboard with title, description,
 * and a timeframe selector (7d / 30d / 90d).
 */
export const AnalyticsHeader: React.FC<AnalyticsHeaderProps> = ({
  selectedTimeframe,
  onTimeframeChange,
}) => {
  return (
    <div className="border-b border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-linear-to-r from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Content Intelligence</h3>
            <p className="text-sm text-gray-600">Performance insights and trend analysis</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <select
            value={selectedTimeframe}
            onChange={(e) => onTimeframeChange(e.target.value as Timeframe)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="7d">7 Days</option>
            <option value="30d">30 Days</option>
            <option value="90d">90 Days</option>
          </select>
          <div className="flex items-center space-x-1 text-sm text-gray-600">
            <Sparkles className="w-4 h-4" />
            <span>Confidence: 85%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
