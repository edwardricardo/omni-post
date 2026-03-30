"use client";

/**
 * @file UsageMetricsPanel.tsx
 * @description Displays account usage metrics for the current billing period as
 *   progress bars with counts. Used in the admin settings/subscriptions section.
 * @layer presentation
 */

import React from "react";
import { useUsageMetrics } from "@/hooks/api/useUsageMetrics";

interface UsageBarProps {
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
  color: "blue" | "purple" | "green" | "amber";
}

const COLOR_CLASSES: Record<UsageBarProps["color"], { bar: string; text: string }> = {
  blue: { bar: "bg-blue-500", text: "text-blue-700" },
  purple: { bar: "bg-purple-500", text: "text-purple-700" },
  green: { bar: "bg-green-500", text: "text-green-700" },
  amber: { bar: "bg-amber-500", text: "text-amber-700" },
};

function UsageBar({ label, used, limit, unit = "", color }: UsageBarProps) {
  const colors = COLOR_CLASSES[color];
  const percentage = limit ? Math.min((used / limit) * 100, 100) : 0;
  const isUnlimited = limit === null;

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className={`text-sm font-semibold ${colors.text}`}>
          {isUnlimited
            ? `${used.toLocaleString()}${unit} (unlimited)`
            : `${used.toLocaleString()}${unit} / ${limit!.toLocaleString()}${unit}`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${colors.bar} ${
              percentage >= 90 ? "bg-red-500" : ""
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
    </div>
  );
}

interface UsageMetricsPanelProps {
  accountId: string;
}

/**
 * @component UsageMetricsPanel
 * @description Shows current-month usage for posts, AI calls, storage, and team members.
 */
export function UsageMetricsPanel({ accountId }: UsageMetricsPanelProps) {
  const { data, isLoading, error } = useUsageMetrics(accountId);

  const now = new Date();
  const monthName = now.toLocaleString("en-US", { month: "long" });
  const year = now.getFullYear();

  if (isLoading) {
    return (
      <div className="bg-white border rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Usage — {monthName} {year}
        </h3>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="flex justify-between mb-1">
                <div className="h-4 bg-gray-200 rounded w-24" />
                <div className="h-4 bg-gray-200 rounded w-16" />
              </div>
              <div className="h-2 bg-gray-200 rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Usage — {monthName} {year}
        </h3>
        <p className="text-sm text-gray-500">Usage data unavailable for this period.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">
        Usage — {monthName} {year}
      </h3>
      <p className="text-xs text-gray-500 mb-5">Resets on the 1st of each month</p>

      <div className="space-y-5">
        <UsageBar label="Posts Published" used={data.postsPublished} limit={null} color="blue" />
        <UsageBar label="AI Calls" used={data.aiCallsMade} limit={null} color="purple" />
        <UsageBar
          label="Storage"
          used={parseFloat(data.storageGb.toFixed(2))}
          limit={null}
          unit=" GB"
          color="green"
        />
        <UsageBar label="Team Members" used={data.teamMemberCount} limit={null} color="amber" />
      </div>
    </div>
  );
}
