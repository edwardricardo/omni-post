/**
 * @file PerformancePredictionCard.tsx
 * @description Card showing AI-predicted performance for a platform post, including
 * expected engagement, reach with confidence intervals, viral potential, and optimal
 * posting time recommendations.
 */

import React from "react";
import { TrendingUp, Eye, Clock } from "lucide-react";
import { PerformancePrediction } from "../types";
import { getConfidenceColor, formatNumber, getViralPotentialColor } from "../utils";

interface PerformancePredictionCardProps {
  prediction: PerformancePrediction;
}

/**
 * @component PerformancePredictionCard
 * @description Card showing AI-predicted performance for a platform post, including
 * expected engagement, reach with confidence intervals, viral potential, and optimal posting time.
 */
export const PerformancePredictionCard: React.FC<PerformancePredictionCardProps> = ({
  prediction,
}) => {
  return (
    <div className="border rounded-lg p-6 bg-linear-to-r from-gray-50 to-gray-100">
      <div className="flex items-center justify-between mb-6">
        <h4 className="text-lg font-semibold text-gray-900 capitalize flex items-center space-x-2">
          <span>{prediction.platform}</span>
          <span
            className={`px-2 py-1 rounded-full text-xs font-medium ${getConfidenceColor(prediction.expectedEngagement.confidence)}`}
          >
            {Math.round(prediction.expectedEngagement.confidence)}% confidence
          </span>
        </h4>
        <div
          className={`px-3 py-1 rounded-full text-sm font-medium ${getViralPotentialColor(prediction.viralPotential)}`}
        >
          {Math.round(prediction.viralPotential)}% viral potential
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <h5 className="font-semibold text-gray-900">Expected Engagement</h5>
          </div>
          <div className="space-y-2">
            <div className="text-2xl font-bold text-blue-600">
              {Math.round(prediction.expectedEngagement.value)}%
            </div>
            <div className="text-sm text-gray-600">
              Range: {Math.round(prediction.expectedEngagement.range.min)}% -{" "}
              {Math.round(prediction.expectedEngagement.range.max)}%
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full"
                style={{ width: `${prediction.expectedEngagement.value}%` }}
              ></div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Eye className="w-5 h-5 text-green-600" />
            <h5 className="font-semibold text-gray-900">Expected Reach</h5>
          </div>
          <div className="space-y-2">
            <div className="text-2xl font-bold text-green-600">
              {formatNumber(prediction.expectedReach.value)}
            </div>
            <div className="text-sm text-gray-600">
              Range: {formatNumber(prediction.expectedReach.range.min)} -{" "}
              {formatNumber(prediction.expectedReach.range.max)}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-600 h-2 rounded-full"
                style={{
                  width: `${Math.min((prediction.expectedReach.value / 10000) * 100, 100)}%`,
                }}
              ></div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Clock className="w-5 h-5 text-purple-600" />
            <h5 className="font-semibold text-gray-900">Optimal Timing</h5>
          </div>
          <div className="space-y-2">
            <div className="text-lg font-bold text-purple-600">
              {prediction.optimalPostingTime.hour}:00 {prediction.optimalPostingTime.timezone}
            </div>
            <div className="text-sm text-gray-600">{prediction.optimalPostingTime.day}</div>
            <div className="text-xs text-gray-500">
              {Math.round(prediction.optimalPostingTime.confidence)}% confidence
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 bg-white rounded-lg p-4">
        <h5 className="font-semibold text-gray-900 mb-3">Audience Activity Pattern</h5>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-600 block">Peak Hours:</span>
            <span className="font-medium">{prediction.audienceActivity.peak}</span>
          </div>
          <div>
            <span className="text-gray-600 block">Low Activity:</span>
            <span className="font-medium">{prediction.audienceActivity.low}</span>
          </div>
          <div>
            <span className="text-gray-600 block">Pattern:</span>
            <span className="font-medium capitalize">{prediction.audienceActivity.pattern}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
