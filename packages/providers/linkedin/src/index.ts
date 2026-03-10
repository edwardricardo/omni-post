/**
 * @file index.ts
 * @description LinkedIn Provider - Clean Export.
 *              Exports the class-based LinkedInAdapter implementation.
 * @layer infrastructure
 */

import { linkedInAdapter as linkedInAdapterInstance } from "./LinkedInAdapter.js";
import { ok } from "@shared/types";

// Export class and instance
export { LinkedInAdapter, linkedInAdapter } from "./LinkedInAdapter.js";

/**
 * @function fetchLinkedInAnalytics
 * @description Fetch LinkedIn analytics using the adapter instance.
 */
export async function fetchLinkedInAnalytics(channelId: string, since?: Date, until?: Date) {
  return (
    linkedInAdapterInstance.fetchAnalytics?.({
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
export default linkedInAdapterInstance;
