/**
 * @file PlatformMetricsChart.tsx
 * @description Engagement-by-platform bar chart (recharts), split out so the
 * recharts bundle is lazy-loaded by the analytics page instead of shipping in
 * its initial chunk.
 * @component PlatformMetricsChart
 * @layer infrastructure
 */
"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { AnalyticsPlatformMetrics } from "@/hooks/api/useAnalytics";

interface PlatformMetricsChartProps {
  /** Per-platform metrics rows to plot. */
  data: AnalyticsPlatformMetrics[];
}

/**
 * @component PlatformMetricsChart
 * @description Renders engagement and reach per platform as a responsive bar chart.
 */
export function PlatformMetricsChart({ data }: PlatformMetricsChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="platformName" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="totalEngagement" fill="#3B82F6" name="Engagement" />
        <Bar dataKey="totalReach" fill="#10B981" name="Reach" />
      </BarChart>
    </ResponsiveContainer>
  );
}
