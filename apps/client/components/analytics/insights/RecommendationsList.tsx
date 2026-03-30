"use client";

/**
 * @file RecommendationsList.tsx
 * @description Filterable list of AI-generated content recommendations, grouped by
 * category (timing, content, hashtags, audience) with one-click apply actions.
 */

import React, { useMemo, useCallback } from "react";
import type { Recommendation, RecommendationCategory } from "./types";

interface RecommendationsListProps {
  recommendations: Recommendation[];
  selectedCategory: RecommendationCategory;
  onCategoryChange: (category: RecommendationCategory) => void;
  onApplyRecommendation?: (recommendation: Recommendation) => void;
}

export function RecommendationsList({
  recommendations,
  selectedCategory,
  onCategoryChange,
  onApplyRecommendation,
}: RecommendationsListProps) {
  const filteredRecommendations = useMemo(() => {
    if (selectedCategory === "all") return recommendations;
    return recommendations.filter((rec) => rec.type === selectedCategory);
  }, [recommendations, selectedCategory]);

  const handleApplyRecommendation = useCallback(
    (recommendation: Recommendation) => {
      onApplyRecommendation?.(recommendation);
    },
    [onApplyRecommendation]
  );

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium">🎯 AI Recommendations</h3>
        <div className="flex space-x-2">
          {(["all", "timing", "content", "hashtags", "audience"] as const).map((category) => (
            <button
              key={category}
              onClick={() => onCategoryChange(category)}
              className={`px-3 py-1 rounded-sm text-sm font-medium capitalize ${
                selectedCategory === category
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {filteredRecommendations.map((recommendation) => (
          <div
            key={recommendation.id}
            className={`border rounded-lg p-4 ${
              recommendation.priority === "high"
                ? "border-red-200 bg-red-50"
                : recommendation.priority === "medium"
                  ? "border-yellow-200 bg-yellow-50"
                  : "border-blue-200 bg-blue-50"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center mb-2">
                  <h4 className="font-medium text-gray-900 mr-3">{recommendation.title}</h4>
                  <span
                    className={`px-2 py-1 rounded-sm text-xs font-medium ${
                      recommendation.priority === "high"
                        ? "bg-red-100 text-red-800"
                        : recommendation.priority === "medium"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {recommendation.priority} priority
                  </span>
                  <span className="ml-2 px-2 py-1 bg-gray-100 text-gray-700 rounded-sm text-xs">
                    {(recommendation.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
                <p className="text-gray-700 mb-2">{recommendation.description}</p>
                <div className="text-sm text-green-700 font-medium mb-3">
                  Expected impact: {recommendation.expectedImpact}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900 mb-1">Action items:</div>
                  <ul className="text-sm text-gray-700 space-y-1">
                    {recommendation.actionItems.map((item, index) => (
                      <li key={index} className="flex items-start">
                        <span className="text-blue-600 mr-2">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <button
                onClick={() => handleApplyRecommendation(recommendation)}
                className="ml-4 px-3 py-1 bg-white border border-gray-300 rounded-sm text-sm hover:bg-gray-50"
              >
                Apply
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredRecommendations.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <div className="text-2xl mb-2">✨</div>
          <div>No recommendations for this category</div>
          <div className="text-sm mt-1">Your performance is already optimized!</div>
        </div>
      )}
    </div>
  );
}
