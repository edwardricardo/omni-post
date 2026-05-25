/**
 * @file DimensionRegistry.ts
 * @description Single source of truth for the dimensions a metric can be
 *              sliced by. Only dimensions actually derivable from
 *              `AnalyticsSummaryRow` are registered — `post_type` and
 *              `campaign` are intentionally absent because the daily-summary
 *              read model carries no such columns (advertising them would
 *              silently group everything by date, a latent lie). Pure
 *              domain logic — no I/O, no throw.
 * @layer domain
 */
import type { AnalyticsSummaryRow } from "../repositories/AnalyticsAggregationQueryPort.js";

/** One governed dimension: a stable key + the bucket key it derives. */
export interface DimensionDefinition {
  readonly key: string;
  readonly label: string;
  readonly keyOf: (row: AnalyticsSummaryRow) => string;
}

/** The dimension a report defaults to when none/unknown is requested. */
export const DEFAULT_DIMENSION_KEY = "date" as const;

export const DIMENSION_DEFINITIONS: readonly DimensionDefinition[] = [
  { key: "date", label: "Date", keyOf: (r) => r.date.toISOString().slice(0, 10) },
  { key: "platform", label: "Platform", keyOf: (r) => r.provider },
  { key: "channel", label: "Channel", keyOf: (r) => r.channelId },
] as const;

const BY_KEY: ReadonlyMap<string, DimensionDefinition> = new Map(
  DIMENSION_DEFINITIONS.map((d) => [d.key, d])
);

/**
 * @namespace dimensionRegistry
 * @description Read-only accessors over the governed dimension catalog.
 */
export const dimensionRegistry = {
  list(): readonly DimensionDefinition[] {
    return DIMENSION_DEFINITIONS;
  },
  has(key: string): boolean {
    return BY_KEY.has(key);
  },
  /** Definition for `key`, falling back to the default (`date`) dimension. */
  resolve(key: string): DimensionDefinition {
    return BY_KEY.get(key) ?? (BY_KEY.get(DEFAULT_DIMENSION_KEY) as DimensionDefinition);
  },
  /** Catalog shape `{ [key]: { label } }` for the report schema endpoint. */
  catalog(): Record<string, { label: string }> {
    const out: Record<string, { label: string }> = {};
    for (const d of DIMENSION_DEFINITIONS) {
      out[d.key] = { label: d.label };
    }
    return out;
  },
} as const;
