/**
 * @file DonutChart.tsx
 * @description Reusable donut/pie chart with a custom vertical legend showing
 *   name, count, and percentage for each slice. Uses Recharts PieChart.
 * @layer infrastructure
 */
"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { ChartEmptyState } from "./ChartEmptyState";

export interface DonutChartDatum {
  name: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutChartDatum[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  showLegend?: boolean;
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
 * @component DonutChart
 * @description Reusable donut/pie chart with a custom vertical legend showing name, count,
 *   and percentage for each slice. Falls back to ChartEmptyState when data is empty.
 * @param props.data - Array of slices with name, value, and color
 * @param props.showLegend - Whether to render the vertical legend below the chart
 */
export function DonutChart({
  data,
  height = 280,
  innerRadius = 55,
  outerRadius = 85,
  showLegend = true,
  emptyMessage = "No data available",
  className,
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (data.length === 0 || total === 0) {
    return <ChartEmptyState message={emptyMessage} height={height} />;
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height * 0.65}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            strokeWidth={0}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_CONTENT}
            itemStyle={TOOLTIP_TEXT}
            labelStyle={TOOLTIP_TEXT}
            formatter={(value: number, name: string) => [
              `${value} (${((value / total) * 100).toFixed(1)}%)`,
              name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>

      {showLegend && (
        <div className="mt-2 space-y-1.5 px-2">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2 text-sm">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-[var(--text-secondary)] flex-1 truncate">{entry.name}</span>
              <span className="font-medium text-[var(--text-primary)]">{entry.value}</span>
              <span className="text-[var(--text-tertiary)] w-12 text-right">
                {((entry.value / total) * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
