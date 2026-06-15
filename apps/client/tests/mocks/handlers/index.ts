/**
 * @file index.ts
 * @description Barrel for per-domain MSW handler arrays. New domains add a
 *              `<domain>.ts` file exporting `<domain>Handlers: HttpHandler[]`
 *              and append it here. The flat `handlers` array is consumed by
 *              `tests/mocks/server.ts`.
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */

import { notificationsHandlers } from "./notifications.js";
import { schedulingHandlers } from "./scheduling.js";
import { trendRadarHandlers } from "./trendRadar.js";
import { listeningHandlers } from "./listening.js";

export const handlers = [
  ...schedulingHandlers,
  ...notificationsHandlers,
  ...trendRadarHandlers,
  ...listeningHandlers,
];
