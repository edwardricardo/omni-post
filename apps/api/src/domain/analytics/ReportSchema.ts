/**
 * @file ReportSchema.ts
 * @description Constants and types for custom report configuration.
 *   Defines available metrics, dimensions, date range presets, and chart types
 *   that can be used when building custom reports.
 * @layer domain
 */

/**
 * Available metrics that can be selected for custom reports.
 * Each metric has a display label and a value type for formatting.
 */
export const AVAILABLE_METRICS = {
  impressions: { label: "Impressions", type: "number" },
  reach: { label: "Reach", type: "number" },
  engagement_rate: { label: "Engagement Rate", type: "percentage" },
  likes: { label: "Likes", type: "number" },
  comments: { label: "Comments", type: "number" },
  shares: { label: "Shares", type: "number" },
  saves: { label: "Saves", type: "number" },
  video_views: { label: "Video Views", type: "number" },
  watch_time: { label: "Watch Time (min)", type: "number" },
  follower_growth: { label: "Follower Growth", type: "number" },
  link_clicks: { label: "Link Clicks", type: "number" },
  post_count: { label: "Posts Published", type: "number" },
} as const;

/**
 * Available dimensions for grouping report data.
 */
export const AVAILABLE_DIMENSIONS = {
  date: { label: "Date" },
  platform: { label: "Platform" },
  post_type: { label: "Post Type" },
  campaign: { label: "Campaign" },
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
