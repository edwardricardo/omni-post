"use client";

/**
 * @file UsageMetricsPanel.tsx
 * @description Displays account usage metrics for the current billing period as
 *   progress bars with counts. Uses CSS design tokens for theming.
 * @layer presentation
 */

import React from "react";
import { useUsageMetrics } from "@/hooks/api/useUsageMetrics";

interface UsageBarProps {
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
}

function UsageBar({ label, used, limit, unit = "" }: UsageBarProps) {
  const percentage = limit ? Math.min((used / limit) * 100, 100) : 0;
  const isUnlimited = limit === null;

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-[var(--text-secondary)]">{label}</span>
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {isUnlimited
            ? `${Number(used).toLocaleString()}${unit} (unlimited)`
            : `${Number(used).toLocaleString()}${unit} / ${Number(limit!).toLocaleString()}${unit}`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="w-full bg-[var(--bg-elevated)] rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              percentage >= 90 ? "bg-[var(--error)]" : "bg-[var(--accent)]"
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
      <div className="border border-[var(--border-subtle)] bg-[var(--bg-surface)] rounded-lg p-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          Usage -- {monthName} {year}
        </h3>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="flex justify-between mb-1">
                <div className="h-4 bg-[var(--bg-elevated)] rounded w-24" />
                <div className="h-4 bg-[var(--bg-elevated)] rounded w-16" />
              </div>
              <div className="h-2 bg-[var(--bg-elevated)] rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="border border-[var(--border-subtle)] bg-[var(--bg-surface)] rounded-lg p-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
          Usage -- {monthName} {year}
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          Usage data unavailable for this period.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-[var(--border-subtle)] bg-[var(--bg-surface)] rounded-lg p-4">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
        Usage -- {monthName} {year}
      </h3>
      <p className="text-xs text-[var(--text-tertiary)] mb-4">Resets on the 1st of each month</p>

      <div className="space-y-4">
        <UsageBar label="Posts Published" used={data.postsPublished} limit={null} />
        <UsageBar label="AI Calls Used" used={data.aiCallsMade} limit={null} />
        <UsageBar
          label="Storage Used"
          used={parseFloat(Number(data.storageGb).toFixed(2))}
          limit={null}
          unit=" GB"
        />
        <UsageBar label="Team Members" used={data.teamMemberCount} limit={null} />
      </div>
    </div>
  );
}
