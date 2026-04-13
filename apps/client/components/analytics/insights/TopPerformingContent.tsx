"use client";

/**
 * @file TopPerformingContent.tsx
 * @description Renders a ranked list of the highest-scoring posts with their
 * engagement metrics, reach, and click-through rates for quick comparison.
 */

import React from "react";
import type { ContentPerformance } from "./types";

interface TopPerformingContentProps {
  content: ContentPerformance[];
  maxItems?: number;
}

/**
 * @component TopPerformingContent
 * @description Ranked list of the highest-scoring posts with engagement metrics,
 * reach, and click-through rates for quick comparison.
 * @param props.maxItems - Maximum number of top posts to display (default 3)
 */
export function TopPerformingContent({ content, maxItems = 3 }: TopPerformingContentProps) {
  const displayContent = content.slice(0, maxItems);

  return (
    <div className="bg-white rounded-lg border p-6">
      <h3 className="text-lg font-medium mb-4">🏆 Top Performing Content</h3>
      <div className="space-y-4">
        {displayContent.map((item, index) => (
          <div key={item.postId} className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex-shrink-0">
              <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm font-medium">
                {index + 1}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 mb-1">
                {item.content.slice(0, 100)}...
              </div>
              <div className="flex items-center space-x-4 text-xs text-gray-500">
                <span className="capitalize">{item.platformId}</span>
                <span>{item.publishedAt.toLocaleDateString()}</span>
                <span>{item.metrics.engagement.toLocaleString()} engagements</span>
                <span>{item.metrics.engagementRate.toFixed(1)}% rate</span>
              </div>
              {item.factors.hashtags.length > 0 && (
                <div className="mt-2">
                  {item.factors.hashtags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-block mr-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-sm"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="text-lg font-bold text-green-600">{item.score.toFixed(1)}</div>
              <div className="text-xs text-gray-500">Score</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
