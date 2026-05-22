/**
 * @file ShareOfVoiceChart.tsx
 * @description Grouped bar chart of brand vs market mention counts per provider,
 *   over the brand-listening corpus. Presentational — receives the per-provider
 *   breakdown from the Share-of-Voice payload.
 * @component ShareOfVoiceChart
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
import { useTranslations } from "next-intl";
import type { ProviderShare } from "@/hooks/api/useListening";

interface ShareOfVoiceChartProps {
  /** Per-provider brand/market breakdown from the SoV payload. */
  data: ProviderShare[];
}

/**
 * Renders brand vs market mention counts per provider as grouped bars.
 */
export function ShareOfVoiceChart({ data }: ShareOfVoiceChartProps) {
  const t = useTranslations("listening");

  return (
    <figure role="img" aria-label={t("sovChartAria")} className="w-full">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="provider" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="brandCount" fill="#3b82f6" name={t("brand")} />
          <Bar dataKey="marketCount" fill="#8b5cf6" name={t("market")} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
