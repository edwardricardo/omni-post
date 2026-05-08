/**
 * @file scheduling.ts
 * @description MSW v2 handlers for the scheduling-domain endpoints consumed
 *              by `useSchedulingDashboardSidebar` (PR-51.A POC). Default
 *              responses match the canonical envelope shape produced by
 *              `BaseRouteHandler.sendSuccess` (`{ ok: true, data: T }`) so
 *              that consumer hooks see what the real backend would send.
 *              Per-test scenarios (4xx/5xx, missing data, etc.) override
 *              these via `server.use(...)` inside the failing-case `it()`.
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */

import { http, HttpResponse } from "msw";

const PROXY = "/api/backend";

export const schedulingHandlers = [
  http.get(`${PROXY}/campaigns`, () => {
    return HttpResponse.json({
      ok: true,
      data: [{ id: "c1", name: "Default Campaign" }],
    });
  }),

  http.get(`${PROXY}/team`, () => {
    return HttpResponse.json({
      ok: true,
      data: { members: [{ id: "u1", name: "Default User" }] },
    });
  }),
];
