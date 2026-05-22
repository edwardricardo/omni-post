/**
 * @file SentimentBreakdownChart.tsx
 * @description Pie chart of mention counts by sentiment (positive / neutral /
 *   negative / unscored). Until the decoupled enrichment step runs, most
 *   mentions are "unscored" — that is expected and shown explicitly.
 * @component SentimentBreakdownChart
 * @layer infrastructure
 */
"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useTranslations } from "next-intl";
import type { SentimentBreakdown } from "@/hooks/api/useListening";

interface SentimentBreakdownChartProps {
  /** Mention counts grouped by sentiment label. */
  data: SentimentBreakdown;
}

const COLORS = {
  positive: "#22c55e",
  neutral: "#eab308",
  negative: "#ef4444",
  unscored: "#9ca3af",
} as const;

/**
 * Renders the sentiment distribution of mentions as a pie chart.
 */
export function SentimentBreakdownChart({ data }: SentimentBreakdownChartProps) {
  const t = useTranslations("listening");

  const slices = [
    { key: "positive", name: t("sentimentPositive"), value: data.positive },
    { key: "neutral", name: t("sentimentNeutral"), value: data.neutral },
    { key: "negative", name: t("sentimentNegative"), value: data.negative },
    { key: "unscored", name: t("sentimentUnscored"), value: data.unscored },
  ] as const;

  return (
    <figure role="img" aria-label={t("sentimentChartAria")} className="w-full">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={[...slices]}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={100}
          >
            {slices.map((slice) => (
              <Cell key={slice.key} fill={COLORS[slice.key]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </figure>
  );
}
