"use client";

/**
 * @file SmartContentOptimizerHashtags.tsx
 * @description Hashtags tab for the SmartContentOptimizer, displaying hashtag analysis
 * with relevance scores, popularity indices, competition levels, and trend indicators.
 */

import React from "react";
import { TrendingUp, Eye } from "lucide-react";
import type { HashtagAnalysis } from "./smartContentOptimizerUtils";

interface SmartContentOptimizerHashtagsProps {
  hashtagAnalysis: HashtagAnalysis[];
}

function getTrendIcon(status: string) {
  switch (status) {
    case "rising":
      return <TrendingUp className="w-4 h-4 text-green-500" />;
    case "declining":
      return <TrendingUp className="w-4 h-4 text-red-500 rotate-180" />;
    default:
      return <Eye className="w-4 h-4 text-blue-500" />;
  }
}

/**
 * @component SmartContentOptimizerHashtags
 * @description Hashtag analysis tab displaying relevance scores, popularity indices,
 * competition levels, and trend indicators for recommended hashtags.
 */
export function SmartContentOptimizerHashtags({
  hashtagAnalysis,
}: SmartContentOptimizerHashtagsProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-gray-900">Hashtag Analysis & Recommendations</h4>
        <div className="text-sm text-gray-600">Based on current trends and relevance</div>
      </div>

      <div className="grid gap-4">
        {hashtagAnalysis.map((hashtag) => (
          <div key={hashtag.hashtag} className="border rounded-lg p-4 hover:bg-gray-50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <span className="text-lg font-semibold text-blue-600">{hashtag.hashtag}</span>
                {getTrendIcon(hashtag.trendingStatus)}
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                    hashtag.competitionLevel === "low"
                      ? "bg-green-100 text-green-800"
                      : hashtag.competitionLevel === "medium"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-red-100 text-red-800"
                  }`}
                >
                  {hashtag.competitionLevel} competition
                </span>
              </div>
              <button className="px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                Add to Content
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Relevance:</span>
                <div className="flex items-center space-x-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: `${hashtag.relevanceScore}%` }}
                    ></div>
                  </div>
                  <span className="font-medium">{hashtag.relevanceScore}%</span>
                </div>
              </div>

              <div>
                <span className="text-gray-600">Popularity:</span>
                <div className="flex items-center space-x-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full"
                      style={{ width: `${hashtag.popularityIndex * 10}%` }}
                    ></div>
                  </div>
                  <span className="font-medium">{hashtag.popularityIndex}/10</span>
                </div>
              </div>

              <div>
                <span className="text-gray-600 block">Expected Reach:</span>
                <span className="font-medium">{hashtag.expectedReach.toLocaleString()}</span>
              </div>

              <div>
                <span className="text-gray-600 block">Platforms:</span>
                <div className="flex flex-wrap gap-1">
                  {hashtag.platforms.map((platform) => (
                    <span
                      key={platform}
                      className="px-1 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-sm"
                    >
                      {platform}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
