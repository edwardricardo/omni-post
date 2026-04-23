/**
 * @file StatCard.tsx
 * @description Compact statistic card with label, value, optional trend indicator,
 *              and optional icon. Uses CSS custom-property tokens for theming.
 * @layer infrastructure
 */

import React from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: { value: number; isPositive: boolean };
  icon?: React.ReactNode;
}

function TrendIndicator({ value, isPositive }: { value: number; isPositive: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-0.5 text-xs font-medium",
        isPositive ? "text-[var(--success)]" : "text-[var(--error)]",
      ].join(" ")}
      aria-label={`${isPositive ? "Up" : "Down"} ${Math.abs(value)}%`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className={["h-3 w-3", isPositive ? "" : "rotate-180"].join(" ")}
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8 3.293l4.354 4.354-.708.707L8.5 5.207V13h-1V5.207L4.354 8.354l-.708-.707L8 3.293z"
          clipRule="evenodd"
        />
      </svg>
      {Math.abs(value)}%
    </span>
  );
}

/**
 * @component StatCard
 * @description Compact statistic card displaying a label, value, optional trend arrow,
 *   and optional icon. Used in dashboard summary grids.
 * @param props.label - Metric name shown as uppercase caption
 * @param props.value - Primary metric value
 * @param props.trend - Optional trend indicator with percentage and direction
 * @param props.icon - Optional icon rendered in the top-right corner
 */
export function StatCard({ label, value, trend, icon }: StatCardProps) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          {label}
        </span>
        {icon && (
          <span className="text-[var(--text-tertiary)]" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-end gap-2">
        <span className="text-xl font-semibold text-[var(--text-primary)]">{value}</span>
        {trend && <TrendIndicator value={trend.value} isPositive={trend.isPositive} />}
      </div>
    </div>
  );
}
