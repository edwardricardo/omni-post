/**
 * @file AudienceInsightCard.tsx
 * @description Card component rendering a single audience segment's demographics,
 * including size, growth rate, top locations, interests, and peak activity hours.
 */

import React from "react";
import { AudienceInsight } from "../types";
import { formatNumber } from "../utils";

interface AudienceInsightCardProps {
  insight: AudienceInsight;
}

export const AudienceInsightCard: React.FC<AudienceInsightCardProps> = ({ insight }) => {
  return (
    <div className="border rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h4 className="text-lg font-semibold text-gray-900">{insight.segment}</h4>
        <div className="flex items-center space-x-4 text-sm">
          <div className="text-center">
            <div className="font-bold text-blue-600">{formatNumber(insight.size)}</div>
            <div className="text-gray-600">Audience Size</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-green-600">{insight.engagement.toFixed(1)}%</div>
            <div className="text-gray-600">Engagement</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-purple-600">+{insight.growthRate.toFixed(1)}%</div>
            <div className="text-gray-600">Growth Rate</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <h5 className="font-semibold text-gray-900 mb-3">Demographics</h5>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-600">Age Group:</span>
              <span className="ml-2 font-medium">{insight.demographics.ageGroup}</span>
            </div>
            <div>
              <span className="text-gray-600">Location:</span>
              <span className="ml-2 font-medium">{insight.demographics.location}</span>
            </div>
            <div>
              <span className="text-gray-600 block mb-1">Interests:</span>
              <div className="flex flex-wrap gap-1">
                {insight.demographics.interests.map((interest) => (
                  <span
                    key={interest}
                    className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-sm"
                  >
                    {interest}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <h5 className="font-semibold text-gray-900 mb-3">Behavior Patterns</h5>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-600">Active Hours:</span>
              <span className="ml-2 font-medium">{insight.behavior.activeHours}</span>
            </div>
            <div>
              <span className="text-gray-600 block mb-1">Preferred Content:</span>
              <div className="space-y-1">
                {insight.behavior.preferredContent.map((content) => (
                  <div key={content} className="text-gray-700">
                    • {content}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <h5 className="font-semibold text-gray-900 mb-3">Predictions</h5>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-600">Next Week Activity:</span>
              <span className="ml-2 font-medium">
                {Math.round(insight.predictions.nextWeekActivity)}%
              </span>
            </div>
            <div>
              <span className="text-gray-600 block mb-1">Seasonal Trends:</span>
              <span className="text-gray-700">{insight.predictions.seasonalTrends}</span>
            </div>
            <div>
              <span className="text-gray-600 block mb-1">Content Preferences:</span>
              <div className="flex flex-wrap gap-1">
                {insight.predictions.contentPreferences.map((pref) => (
                  <span
                    key={pref}
                    className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-sm"
                  >
                    {pref}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
