/**
 * @file HorizontalBarChart.tsx
 * @description Horizontal bar chart using Recharts vertical layout. Supports
 *   per-bar colors via data or falls back to the theme accent color.
 * @layer presentation
 */
"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from "recharts";
import { useChartColors } from "@/hooks/useChartColors";
import { ChartEmptyState } from "./ChartEmptyState";

interface HorizontalBarDatum {
  name: string;
  value: number;
  color?: string;
}

interface HorizontalBarChartProps {
  data: HorizontalBarDatum[];
  height?: number;
  formatValue?: (v: number) => string;
  barSize?: number;
  emptyMessage?: string;
  className?: string;
}

const TOOLTIP_CONTENT: React.CSSProperties = {
  backgroundColor: "var(--bg-surface)",
  border: "1px solid var(--text-primary)",
  borderRadius: "8px",
  fontSize: "12px",
};

const TOOLTIP_TEXT: React.CSSProperties = {
  color: "var(--text-primary)",
};

/**
 * @component HorizontalBarChart
 * @description Horizontal bar chart using Recharts vertical layout with per-bar colors
 *   and a configurable value formatter.
 * @param props.data - Array of bars with name, value, and optional color
 * @param props.formatValue - Optional formatter for tooltip and axis values
 */
export function HorizontalBarChart({
  data,
  height = 200,
  formatValue,
  barSize = 20,
  emptyMessage = "No data available",
  className,
}: HorizontalBarChartProps) {
  const colors = useChartColors();

  if (data.length === 0) {
    return <ChartEmptyState message={emptyMessage} height={height} />;
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis
            type="number"
            tick={{ fill: colors.textTertiary, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            {...(formatValue !== undefined && { tickFormatter: formatValue })}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: colors.textTertiary, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT}
            itemStyle={TOOLTIP_TEXT}
            labelStyle={TOOLTIP_TEXT}
          />
          <Bar dataKey="value" barSize={barSize} radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color ?? colors.accent} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
