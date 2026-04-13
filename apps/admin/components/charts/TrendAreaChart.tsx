/**
 * @file TrendAreaChart.tsx
 * @description Time-series area chart with a gradient fill. Uses a unique
 *   linearGradient ID per instance so multiple charts render independently.
 * @layer presentation
 */
"use client";

import { useId } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useChartColors } from "@/hooks/useChartColors";
import { ChartEmptyState } from "./ChartEmptyState";

interface TrendAreaChartProps {
  data: Array<{ label: string; value: number }>;
  height?: number;
  color?: string;
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
 * @component TrendAreaChart
 * @description Time-series area chart with a gradient fill. Uses a unique linearGradient ID
 *   per instance so multiple charts render independently on the same page.
 * @param props.data - Array of data points with label and numeric value
 * @param props.color - Override color for the area fill; defaults to theme accent
 */
export function TrendAreaChart({
  data,
  height = 200,
  color,
  formatValue,
  emptyMessage = "No data available",
  className,
}: TrendAreaChartProps) {
  const gradientId = useId();
  const colors = useChartColors();
  const fillColor = color ?? colors.accent;

  if (data.length === 0) {
    return <ChartEmptyState message={emptyMessage} height={height} />;
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={fillColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.bgElevated} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: colors.textTertiary, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
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
            formatter={(value: number) => [formatValue ? formatValue(value) : value, "Value"]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={fillColor}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
