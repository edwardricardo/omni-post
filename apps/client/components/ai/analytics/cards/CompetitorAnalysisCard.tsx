/**
 * @file CompetitorAnalysisCard.tsx
 * @description Card component displaying a competitor account's engagement rate,
 * follower growth, content strategy metrics, and performance comparison indicators.
 */

import React from "react";
import { TrendingUp, Eye, CheckCircle, AlertTriangle } from "lucide-react";
import { CompetitorAnalysis } from "../types";

interface CompetitorAnalysisCardProps {
  competitor: CompetitorAnalysis;
}

const getPerformanceIcon = (value: string) => {
  switch (value) {
    case "above":
      return <TrendingUp className="w-4 h-4 text-green-500" />;
    case "below":
      return <TrendingUp className="w-4 h-4 text-red-500 rotate-180" />;
    default:
      return <Eye className="w-4 h-4 text-blue-500" />;
  }
};

/**
 * @component CompetitorAnalysisCard
 * @description Card displaying a competitor account's engagement rate, follower growth,
 * content strategy metrics, and performance comparison indicators.
 */
export const CompetitorAnalysisCard: React.FC<CompetitorAnalysisCardProps> = ({ competitor }) => {
  return (
    <div className="border rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h4 className="text-lg font-semibold text-gray-900">{competitor.competitor}</h4>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Engagement:</span>
            {getPerformanceIcon(competitor.benchmarkComparison.engagement)}
            <span className="text-sm font-medium">{competitor.benchmarkComparison.engagement}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Reach:</span>
            {getPerformanceIcon(competitor.benchmarkComparison.reach)}
            <span className="text-sm font-medium">{competitor.benchmarkComparison.reach}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Growth:</span>
            {getPerformanceIcon(competitor.benchmarkComparison.growth)}
            <span className="text-sm font-medium">{competitor.benchmarkComparison.growth}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <h5 className="font-semibold text-gray-900 mb-3">Performance Metrics</h5>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Avg Engagement:</span>
              <span className="font-medium">{competitor.performance.avgEngagement}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Post Frequency:</span>
              <span className="font-medium">{competitor.performance.postFrequency}/week</span>
            </div>
            <div>
              <span className="text-gray-600 block mb-1">Top Content Types:</span>
              <div className="space-y-1">
                {competitor.performance.topContentTypes.map((type) => (
                  <div key={type} className="text-gray-700">
                    • {type}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <h5 className="font-semibold text-gray-900 mb-3 flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>Opportunities</span>
          </h5>
          <div className="space-y-2 text-sm">
            {competitor.opportunities.map((opportunity, idx) => (
              <div key={idx} className="flex items-start space-x-2">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                <span className="text-gray-700">{opportunity}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h5 className="font-semibold text-gray-900 mb-3 flex items-center space-x-2">
            <AlertTriangle aria-hidden="true" className="w-4 h-4 text-red-600" />
            <span>Threats</span>
          </h5>
          <div className="space-y-2 text-sm">
            {competitor.threats.map((threat, idx) => (
              <div key={idx} className="flex items-start space-x-2">
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                <span className="text-gray-700">{threat}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
