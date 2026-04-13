"use client";

/**
 * @file OptimalTimingPanel.tsx
 * @description Shows AI-recommended optimal posting windows per platform,
 * including best day-of-week and time-of-day with expected engagement scores.
 */

import React, { useCallback } from "react";
import type { OptimalTiming } from "./types";

interface OptimalTimingPanelProps {
  timings: OptimalTiming[];
}

/**
 * @component OptimalTimingPanel
 * @description Shows AI-recommended optimal posting windows per platform, including
 * best day-of-week and time-of-day with expected engagement multipliers.
 */
export function OptimalTimingPanel({ timings }: OptimalTimingPanelProps) {
  const getDayName = useCallback((dayOfWeek: number): string => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[dayOfWeek] ?? "Unknown";
  }, []);

  return (
    <div className="bg-white rounded-lg border p-6">
      <h4 className="font-medium mb-4">⏰ Optimal Posting Times</h4>
      <div className="space-y-3">
        {timings.map((timing) => (
          <div
            key={`${timing.platformId}-${timing.dayOfWeek}-${timing.hour}`}
            className="flex items-center justify-between"
          >
            <div>
              <div className="font-medium capitalize">{timing.platformId}</div>
              <div className="text-sm text-gray-600">
                {getDayName(timing.dayOfWeek)} at {timing.hour}:00
              </div>
            </div>
            <div className="text-right">
              <div className="text-green-600 font-medium">
                {timing.engagementMultiplier.toFixed(1)}x
              </div>
              <div className="text-xs text-gray-500">
                {(timing.confidence * 100).toFixed(0)}% confidence
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
