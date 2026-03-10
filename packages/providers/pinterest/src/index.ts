/**
 * @file index.ts
 * @description Pinterest Provider - Clean Export.
 *              Exports the class-based PinterestAdapter implementation.
 * @layer infrastructure
 */

import { pinterestAdapter as pinterestAdapterInstance } from "./PinterestAdapter.js";
import { ok } from "@shared/types";

// Export class and instance
export { PinterestAdapter, pinterestAdapter } from "./PinterestAdapter.js";

/**
 * @function fetchPinterestAnalytics
 * @description Fetch Pinterest analytics for a given channel.
 *              Uses the PinterestAdapter class instance.
 * @param channelId - The channel identifier
 * @param since - Optional start date
 * @param until - Optional end date
 */
export async function fetchPinterestAnalytics(channelId: string, since?: Date, until?: Date) {
  return (
    pinterestAdapterInstance.fetchAnalytics?.({
      channelId,
      ...(since && { since }),
      ...(until && { until }),
    }) ||
    ok({
      channelId,
      since,
      until,
      metrics: { pinCount: 0, boardCount: 0 },
    })
  );
}

// Default export
export default pinterestAdapterInstance;
