/**
 * @file MetricRegistry.ts
 * @description Single source of truth for analytics metric definitions
 *              (governed-metrics / semantic-layer principle: one metric =
 *              one definition with a stable key, label, and aggregation
 *              formula). Every metric is computed exclusively from
 *              `AnalyticsSummaryRow` (the AnalyticsDailySummary read model),
 *              so the catalog never advertises a metric it cannot honestly
 *              compute. Pure domain logic — no Prisma, no I/O, no throw.
 * @layer domain
 */
import type { AnalyticsSummaryRow } from "../repositories/AnalyticsAggregationQueryPort.js";

/** Formatting hint consumed by report builders / connectors. */
export type MetricValueType = "number" | "percentage";

/**
 * One governed metric. `aggregate` collapses a bucket of summary rows (a
 * dimension group) into a single value — additive (Σ), ratio, or distinct
 * count — so ratio/average metrics are correct, not row-summed.
 */
export interface MetricDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: MetricValueType;
  readonly aggregate: (rows: readonly AnalyticsSummaryRow[]) => number;
}

const sum = (
  rows: readonly AnalyticsSummaryRow[],
  pick: (r: AnalyticsSummaryRow) => number
): number => rows.reduce((acc, r) => acc + pick(r), 0);

const distinctPostCount = (rows: readonly AnalyticsSummaryRow[]): number =>
  new Set(rows.filter((r) => r.postId !== null).map((r) => r.postId as string)).size;

const engagementOf = (r: AnalyticsSummaryRow): number => r.likes + r.comments + r.shares;

/**
 * The governed metric catalog. Each entry computable from
 * `AnalyticsSummaryRow` alone — metrics that would require un-modeled data
 * (reach, saves, watch time, follower growth, link clicks) are deliberately
 * absent rather than returning a misleading zero.
 */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    key: "impressions",
    label: "Impressions",
    type: "number",
    aggregate: (r) => sum(r, (x) => x.views),
  },
  { key: "likes", label: "Likes", type: "number", aggregate: (r) => sum(r, (x) => x.likes) },
  {
    key: "comments",
    label: "Comments",
    type: "number",
    aggregate: (r) => sum(r, (x) => x.comments),
  },
  { key: "shares", label: "Shares", type: "number", aggregate: (r) => sum(r, (x) => x.shares) },
  {
    key: "engagement",
    label: "Engagement",
    type: "number",
    aggregate: (r) => sum(r, engagementOf),
  },
  {
    key: "engagement_rate",
    label: "Engagement Rate",
    type: "percentage",
    aggregate: (r) => {
      const views = sum(r, (x) => x.views);
      return views > 0 ? (sum(r, engagementOf) / views) * 100 : 0;
    },
  },
  { key: "post_count", label: "Posts Published", type: "number", aggregate: distinctPostCount },
  {
    key: "avg_views_per_post",
    label: "Avg Views / Post",
    type: "number",
    aggregate: (r) => {
      const posts = distinctPostCount(r);
      return posts > 0 ? sum(r, (x) => x.views) / posts : 0;
    },
  },
  {
    key: "avg_engagement_per_post",
    label: "Avg Engagement / Post",
    type: "number",
    aggregate: (r) => {
      const posts = distinctPostCount(r);
      return posts > 0 ? sum(r, engagementOf) / posts : 0;
    },
  },
  {
    key: "records",
    label: "Captured Records",
    type: "number",
    aggregate: (r) => sum(r, (x) => x.records),
  },
] as const;

const BY_KEY: ReadonlyMap<string, MetricDefinition> = new Map(
  METRIC_DEFINITIONS.map((m) => [m.key, m])
);

/**
 * @namespace metricRegistry
 * @description Read-only accessors over the governed metric catalog.
 */
export const metricRegistry = {
  /** All definitions (stable order). */
  list(): readonly MetricDefinition[] {
    return METRIC_DEFINITIONS;
  },
  /** True if `key` is a governed metric. */
  has(key: string): boolean {
    return BY_KEY.has(key);
  },
  /** Definition for `key`, or undefined when not governed. */
  get(key: string): MetricDefinition | undefined {
    return BY_KEY.get(key);
  },
  /**
   * Catalog shape `{ [key]: { label, type } }` consumed by the report
   * schema endpoint and the `MetricKey` type guard.
   */
  catalog(): Record<string, { label: string; type: MetricValueType }> {
    const out: Record<string, { label: string; type: MetricValueType }> = {};
    for (const m of METRIC_DEFINITIONS) {
      out[m.key] = { label: m.label, type: m.type };
    }
    return out;
  },
} as const;
