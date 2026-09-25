/**
 * @file route.ts
 * @description Liveness endpoint for the admin portal container. The Dockerfile
 *              HEALTHCHECK has always requested `/api/health` and this route did
 *              not exist, so every admin container reported `unhealthy` for its
 *              whole life — an orchestrator reading that signal would restart a
 *              process that was serving correctly.
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
 *              Readiness of the API is the API's own `/health` to report.
 * @returns 200 with the service name, so a human reading a probe log can tell
 *          WHICH container answered rather than just that something did.
 */
export function GET(): NextResponse {
  return NextResponse.json({ status: "ok", service: "omnipost-admin" }, { status: 200 });
}
