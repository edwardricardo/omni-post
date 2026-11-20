/**
 * @file usable.ts
 * @description The one rule every reader of a health status applies: a healthy or a degraded
 *              dependency can serve, since a degraded one still answers, slowly or close to a
 *              limit, and anything else cannot. The API's health routes answer 200 or 503 by it,
 *              and the workers' readiness counts a dependency ready by it. The start script
 *              (`scripts/start/platform-start.mjs`), which Node runs directly, imports this file
 *              through Node's type stripping, so it must stay erasable and import no value: no
 *              enum, no parameter property, every type-only import written with `import type`,
 *              and no import of a value, since Node does not find the `.ts` file behind a
 *              `./name.js` specifier.
 * @layer infrastructure
 */
import type { HealthStatus } from "./types.js";

const USABLE_STATUSES: ReadonlySet<string> = new Set<HealthStatus>(["healthy", "degraded"]);

/**
 * @function isUsable
 * @description Whether a status, of a dependency or of a whole report, still serves.
 * @param status - The status as a report carries it; a value outside `HealthStatus` is not usable.
 * @returns `true` for `healthy` and `degraded`, `false` for anything else.
 */
export function isUsable(status: string): boolean {
  return USABLE_STATUSES.has(status);
}
