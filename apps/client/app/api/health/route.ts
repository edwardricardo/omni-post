/**
 * @file route.ts
 * @description Liveness endpoint for the client portal container. Same defect,
 *              same fix as the admin portal: the Dockerfile HEALTHCHECK has
 *              always requested `/api/health` and this route did not exist, so
 *              every client container reported `unhealthy` for its whole life.
 * @layer infrastructure
 */

import { NextResponse } from "next/server";

/**
 * Never prerendered: a statically generated response would be served from disk
 * and would answer 200 for a process that had stopped working.
 */
export const dynamic = "force-dynamic";

/**
 * @method GET
 * @description Reports that this Node process is up and serving. It deliberately
 *              reaches NOTHING — not the backend API, not a database, not a
 *              cache. This is the container's LIVENESS probe, and a liveness
 *              probe that depends on a downstream service converts that
 *              service's outage into a restart loop of a portal that is fine.
 * @returns 200 with the service name, so a human reading a probe log can tell
 *          WHICH container answered rather than just that something did.
 */
export function GET(): NextResponse {
  return NextResponse.json({ status: "ok", service: "omnipost-client" }, { status: 200 });
}
