/**
 * @file index.ts
 * @description Barrel exports for the public chart components consumed by
 *   admin pages. `ChartEmptyState` is intentionally not re-exported — it is an
 *   internal fallback rendered by the public charts when their data is empty,
 *   and they import it via relative path (no external consumers).
 * @layer infrastructure
 */
import dynamic from "next/dynamic";

export type { DonutChartDatum } from "./DonutChart.js";

export const DonutChart = dynamic(() => import("./DonutChart.js").then((m) => m.DonutChart), {
  ssr: false,
});
export const TrendAreaChart = dynamic(
  () => import("./TrendAreaChart.js").then((m) => m.TrendAreaChart),
  { ssr: false }
);
export const StackedBarChart = dynamic(
  () => import("./StackedBarChart.js").then((m) => m.StackedBarChart),
  { ssr: false }
);
export const HorizontalBarChart = dynamic(
  () => import("./HorizontalBarChart.js").then((m) => m.HorizontalBarChart),
  { ssr: false }
);
