/**
 * @file ReportSchema.ts
 * @description Constants and types for custom report configuration.
 *   Defines available metrics, dimensions, date range presets, and chart types
 *   that can be used when building custom reports.
 * @layer domain
 */

/**
 * Available metrics that can be selected for custom reports — the typed,
 * validated vocabulary. Every key here is computed by exactly one governed
 * definition in `MetricRegistry` (the single source of truth for formulas);
 * a parity test asserts this set never drifts from the registry. Metrics
 * that the AnalyticsDailySummary read model cannot honestly compute
 * (reach, saves, video views, watch time, follower growth, link clicks)
 * are intentionally absent rather than returning a misleading zero.
 */
export const AVAILABLE_METRICS = {
  impressions: { label: "Impressions", type: "number" },
  likes: { label: "Likes", type: "number" },
  comments: { label: "Comments", type: "number" },
  shares: { label: "Shares", type: "number" },
  engagement: { label: "Engagement", type: "number" },
  engagement_rate: { label: "Engagement Rate", type: "percentage" },
  post_count: { label: "Posts Published", type: "number" },
  avg_views_per_post: { label: "Avg Views / Post", type: "number" },
  avg_engagement_per_post: { label: "Avg Engagement / Post", type: "number" },
  records: { label: "Captured Records", type: "number" },
} as const;

/**
 * Available dimensions for grouping report data. Only dimensions derivable
 * from AnalyticsSummaryRow are listed; `post_type` / `campaign` are absent
 * because the read model carries no such columns (advertising them would
 * silently group everything by date). Parity-tested against
 * `DimensionRegistry`.
 */
export const AVAILABLE_DIMENSIONS = {
  date: { label: "Date" },
  platform: { label: "Platform" },
  channel: { label: "Channel" },
} as const;

/**
 * Preset date range options for custom reports.
 * CUSTOM requires explicit start and end dates.
 */
export const DATE_RANGE_PRESETS = [
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "LAST_90_DAYS",
  "LAST_12_MONTHS",
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_YEAR",
  "CUSTOM",
] as const;

/**
 * Valid chart types matching the Prisma ReportChartType enum.
 */
export const CHART_TYPES = ["LINE", "BAR", "AREA", "PIE", "TABLE"] as const;

/**
 * Valid report export formats matching the Prisma ReportFormat enum.
 */
export const REPORT_FORMATS = ["CSV", "JSON", "PDF", "XLSX", "XML"] as const;

export type MetricKey = keyof typeof AVAILABLE_METRICS;
export type DimensionKey = keyof typeof AVAILABLE_DIMENSIONS;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];
export type ChartType = (typeof CHART_TYPES)[number];
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/**
 * Type guard to check if a string is a valid metric key.
 */
export function isValidMetric(key: string): key is MetricKey {
  return key in AVAILABLE_METRICS;
}

/**
 * Type guard to check if a string is a valid dimension key.
 */
export function isValidDimension(key: string): key is DimensionKey {
  return key in AVAILABLE_DIMENSIONS;
}

/**
 * Type guard to check if a string is a valid date range preset.
 */
export function isValidDateRange(value: string): value is DateRangePreset {
  return (DATE_RANGE_PRESETS as readonly string[]).includes(value);
}

/**
 * Type guard to check if a string is a valid chart type.
 */
export function isValidChartType(value: string): value is ChartType {
  return (CHART_TYPES as readonly string[]).includes(value);
}

/**
 * Type guard to check if a string is a valid report format.
 */
export function isValidReportFormat(value: string): value is ReportFormat {
  return (REPORT_FORMATS as readonly string[]).includes(value);
}
