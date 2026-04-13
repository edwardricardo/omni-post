"use client";

/**
 * @file OptimalTimesView.tsx
 * @component OptimalTimesView
 * @description View displaying AI-suggested optimal posting times per platform based on
 * audience engagement data, allowing users to schedule posts at recommended times.
 */

import React, { useMemo } from "react";
import type { OptimalTime } from "../../../types/multi-platform-scheduling";

interface OptimalTimesViewProps {
  optimalTimes: OptimalTime[];
  onScheduleAtTime: (dayOfWeek: number, hour: number) => void;
}

export function OptimalTimesView({ optimalTimes, onScheduleAtTime }: OptimalTimesViewProps) {
  // Sort by avgEngagement descending; show top slots grouped by day
  const topTimes = useMemo(() => {
    return optimalTimes.slice().sort((a, b) => b.avgEngagement - a.avgEngagement);
  }, [optimalTimes]);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6">
      {/* Best times cards */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">Best Times to Post</h3>
        <p className="text-gray-600 text-sm mb-6">
          Based on your audience engagement data from the past 30 days
        </p>

        {topTimes.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <div className="text-2xl mb-2">⏰</div>
            <div className="text-sm">No engagement data available yet</div>
            <p className="text-xs mt-2">
              Optimal posting times will appear after collecting engagement metrics
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {topTimes.slice(0, 10).map((time, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div>
                  <div className="font-medium text-gray-900">
                    {dayNames[time.dayOfWeek]} at {time.hour}:00
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {Math.round(time.avgEngagement)}% avg. engagement
                    {time.sampleSize > 0 && ` · ${time.sampleSize} samples`}
                    {time.confidence > 0 && ` · ${Math.round(time.confidence * 100)}% confidence`}
                  </div>
                </div>
                <button
                  onClick={() => onScheduleAtTime(time.dayOfWeek, time.hour)}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500"
                  aria-label={`Schedule post for ${dayNames[time.dayOfWeek]} at ${time.hour}:00`}
                >
                  Schedule
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Engagement heatmap */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">Weekly Engagement Heatmap</h3>
        <div className="overflow-x-auto">
          <div className="grid grid-cols-8 gap-1 text-xs min-w-max">
            {/* Header row */}
            <div className="p-2"></div>
            {dayNames.map((day) => (
              <div key={day} className="p-2 text-center font-medium">
                {day}
              </div>
            ))}

            {/* Hour rows */}
            {Array.from({ length: 24 }, (_, hour) => (
              <React.Fragment key={hour}>
                <div className="p-2 text-right font-medium text-gray-600">{hour}:00</div>
                {Array.from({ length: 7 }, (_, day) => {
                  const matchingTimes = optimalTimes.filter(
                    (time) => time.dayOfWeek === day && time.hour === hour
                  );
                  const avgEngagement =
                    matchingTimes.length > 0
                      ? matchingTimes.reduce((sum, time) => sum + time.avgEngagement, 0) /
                        matchingTimes.length
                      : 0;

                  return (
                    <div
                      key={day}
                      className={`p-2 text-center rounded-sm text-white text-xs font-medium ${
                        avgEngagement >= 80
                          ? "bg-green-500"
                          : avgEngagement >= 60
                            ? "bg-yellow-500"
                            : avgEngagement >= 40
                              ? "bg-orange-500"
                              : avgEngagement > 0
                                ? "bg-red-500"
                                : "bg-gray-200 text-gray-600"
                      }`}
                      title={`${Math.round(avgEngagement)}% engagement`}
                      aria-label={`${dayNames[day]} at ${hour}:00 - ${Math.round(avgEngagement)}% engagement`}
                    >
                      {avgEngagement > 0 ? Math.round(avgEngagement) : ""}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
