/**
 * X/Twitter Provider - Clean Export
 *
 * Exports the class-based XAdapter implementation
 */

import { xAdapter as xAdapterInstance } from "./XAdapter.js";

// Export class and instance
export { XAdapter, xAdapter } from "./XAdapter.js";

/**
 * Fetch X/Twitter analytics via API v2 public_metrics
 */
export async function fetchXAnalytics(channelId: string, since?: Date, until?: Date) {
  return xAdapterInstance.fetchAnalytics({
    channelId,
    ...(since && { since }),
    ...(until && { until }),
  });
}

// Default export
export default xAdapterInstance;
