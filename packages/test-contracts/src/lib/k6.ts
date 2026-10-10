/**
 * @file k6.ts
 * @description The k6 collector of the reach engine. k6 has no listing of its own: a scenario is
 *              a tracked `*.k6.js` file, and `k6 run <file>` runs exactly that file. So the
 *              collector is the glob, as one source, over the tracked files. It fails closed when
 *              the glob matches no tracked file: a glob that matches nothing read nothing.
 * @layer infrastructure
 */
import {
  COLLECTOR_ID,
  type Collector,
  type CollectorContext,
  type CollectorOutcome,
} from "./registry.js";

/** A k6 scenario, by name: the `.k6.js` tail the disk side counts as test-shaped. */
export const K6_SCENARIO = /\.k6\.js$/;

/** The source every scenario is collected by. */
const K6_SOURCE = "*.k6.js";

/**
 * Builds the k6 collector.
 *
 * @returns The collector.
 */
export function createK6Collector(): Collector {
  return {
    id: COLLECTOR_ID.K6,
    collect(context: CollectorContext): Promise<CollectorOutcome> {
      const files = context.tracked.filter((file) => K6_SCENARIO.test(file));
      if (files.length === 0) {
        return Promise.resolve({
          collections: [],
          failures: [
            {
              collector: COLLECTOR_ID.K6,
              source: K6_SOURCE,
              message: "matches no tracked file; the glob read nothing",
            },
          ],
        });
      }
      return Promise.resolve({
        collections: [{ collector: COLLECTOR_ID.K6, source: K6_SOURCE, files: [...files].sort() }],
        failures: [],
      });
    },
  };
}
