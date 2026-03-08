/**
 * @file QueueAnalyticsView.tsx
 * @description Analytics view for the publishing queue showing performance charts,
 * success rates, failure breakdowns, and throughput trends over time.
 */

import React from "react";
import type { QueueStats } from "./types";

interface QueueAnalyticsViewProps {
  stats: QueueStats;
}

export function QueueAnalyticsView({ stats }: QueueAnalyticsViewProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">Processing Performance</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Average processing time</span>
              <span>{stats.avgProcessingTime.toFixed(1)} minutes</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: "75%" }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Success rate</span>
              <span>{stats.successRate.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-600 h-2 rounded-full"
                style={{ width: `${stats.successRate}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">Queue Health</h3>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-sm text-gray-600">Items in queue</span>
            <span className="font-medium">{stats.queued}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-600">Currently processing</span>
            <span className="font-medium">{stats.processing}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-600">Failed items</span>
            <span className="font-medium text-red-600">{stats.failed}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-600">Published today</span>
            <span className="font-medium text-green-600">{stats.published}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
