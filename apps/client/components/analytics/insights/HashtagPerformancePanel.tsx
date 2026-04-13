"use client";

/**
 * @file HashtagPerformancePanel.tsx
 * @description Displays a ranked list of hashtags with their reach, engagement rate,
 * and trend direction to help identify high-performing tags for future posts.
 */

import React from "react";
import type { HashtagPerformance } from "./types";

interface HashtagPerformancePanelProps {
  hashtags: HashtagPerformance[];
  maxItems?: number;
}

/**
 * @component HashtagPerformancePanel
 * @description Ranked list of hashtags with their reach, engagement rate, and trend
 * direction to identify high-performing tags for future posts.
 * @param props.maxItems - Maximum number of hashtags to display (default 5)
 */
export function HashtagPerformancePanel({ hashtags, maxItems = 5 }: HashtagPerformancePanelProps) {
  const displayHashtags = hashtags.slice(0, maxItems);

  return (
    <div className="bg-white rounded-lg border p-6">
      <h4 className="font-medium mb-4">#️⃣ Top Hashtags</h4>
      <div className="space-y-3">
        {displayHashtags.map((hashtag) => (
          <div key={hashtag.hashtag} className="flex items-center justify-between">
            <div>
              <div className="font-medium">{hashtag.hashtag}</div>
              <div className="text-sm text-gray-600">
                Used {hashtag.usage} times • {hashtag.platforms.join(", ")}
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium">{hashtag.avgEngagement.toLocaleString()}</div>
              <div
                className={`text-xs ${
                  hashtag.effectiveness === "high"
                    ? "text-green-600"
                    : hashtag.effectiveness === "medium"
                      ? "text-yellow-600"
                      : "text-red-600"
                }`}
              >
                {hashtag.effectiveness} effectiveness
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
