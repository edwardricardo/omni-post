/**
 * @file index.ts
 * @description Snapchat Provider - Clean Export.
 *              Exports the class-based SnapchatAdapter implementation
 *              and a convenience function for fetching analytics.
 * @layer infrastructure
 */

import { snapchatAdapter as snapchatAdapterInstance } from "./SnapchatAdapter.js";
import { ok } from "@shared/types";

// Export class and instance
export { SnapchatAdapter, snapchatAdapter } from "./SnapchatAdapter.js";

/**
 * @function fetchSnapchatAnalytics
 * @description Fetch Snapchat analytics using the SnapchatAdapter class instance.
 * @param channelId - The channel/creative ID to fetch analytics for
 * @param since - Optional start date for the analytics period
 * @param until - Optional end date for the analytics period
 * @returns Analytics result with metrics data
 */
export async function fetchSnapchatAnalytics(channelId: string, since?: Date, until?: Date) {
  return (
    snapchatAdapterInstance.fetchAnalytics?.({
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
export default snapchatAdapterInstance;
