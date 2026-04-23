/**
 * @file StackedBarChart.tsx
 * @description Stacked vertical bar chart for multi-series timeline data.
 *   Each series is rendered as a stacked Bar with its own color.
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
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useChartColors } from "@/hooks/useChartColors";
import { ChartEmptyState } from "./ChartEmptyState";

interface StackedBarDatum {
  label: string;
  [key: string]: string | number;
}

interface StackedBarSeries {
  key: string;
  color: string;
  name: string;
}

interface StackedBarChartProps {
  data: StackedBarDatum[];
  series: StackedBarSeries[];
  height?: number;
  formatLabel?: (label: string) => string;
  formatValue?: (v: number) => string;
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
 * @component StackedBarChart
 * @description Stacked vertical bar chart for multi-series timeline data. Each series
 *   is rendered as a stacked bar with its own color and legend entry.
 * @param props.data - Array of data points with a label and numeric values per series key
 * @param props.series - Series definitions with key, color, and display name
 */
export function StackedBarChart({
  data,
  series,
  height = 256,
  formatLabel,
  formatValue,
  emptyMessage = "No data available",
  className,
}: StackedBarChartProps) {
  const colors = useChartColors();

  if (data.length === 0) {
    return <ChartEmptyState message={emptyMessage} height={height} />;
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.bgElevated} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: colors.textTertiary, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            {...(formatLabel !== undefined && { tickFormatter: formatLabel })}
          />
          <YAxis
            tick={{ fill: colors.textTertiary, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            {...(formatValue !== undefined && { tickFormatter: formatValue })}
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT}
            itemStyle={TOOLTIP_TEXT}
            labelStyle={TOOLTIP_TEXT}
          />
          <Legend
            wrapperStyle={{ fontSize: "12px", color: colors.textSecondary }}
            iconType="circle"
            iconSize={8}
          />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId="stack" fill={s.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
