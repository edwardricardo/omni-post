/**
 * @file QueueStatsOverview.tsx
 * @description Statistics overview panel for the publishing queue, displaying key metrics
 * such as total queued, processing, completed, and failed item counts.
 */

import React from "react";
import type { QueueStats } from "./types";

interface QueueStatsOverviewProps {
  stats: QueueStats;
}

export function QueueStatsOverview({ stats }: QueueStatsOverviewProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
        <div className="text-sm text-gray-600">Total Items</div>
      </div>
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold text-blue-600">{stats.queued}</div>
        <div className="text-sm text-gray-600">Queued</div>
      </div>
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold text-yellow-600">{stats.processing}</div>
        <div className="text-sm text-gray-600">Processing</div>
      </div>
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold text-green-600">{stats.published}</div>
        <div className="text-sm text-gray-600">Published</div>
      </div>
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
        <div className="text-sm text-gray-600">Failed</div>
      </div>
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold text-purple-600">{stats.successRate.toFixed(0)}%</div>
        <div className="text-sm text-gray-600">Success Rate</div>
      </div>
    </div>
  );
}
