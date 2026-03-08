/**
 * X/Twitter Provider - Clean Export
 *
 * Exports the class-based XAdapter implementation
 */

import { xAdapter as xAdapterInstance } from "./XAdapter.js";
import { ok } from "@shared/types";

// Export class and instance
export { XAdapter, xAdapter } from "./XAdapter.js";

/**
 * Fetch X/Twitter analytics
 * Uses the XAdapter class instance
 */
export async function fetchXAnalytics(channelId: string, since?: Date, until?: Date) {
  return (
    xAdapterInstance.fetchAnalytics?.({
      channelId,
      ...(since && { since }),
      ...(until && { until }),
    }) ||
    ok({
      channelId,
      since,
      until,
      metrics: { views: 0, likes: 0, shares: 0, comments: 0 },
    })
  );
}

// Default export
export default xAdapterInstance;
