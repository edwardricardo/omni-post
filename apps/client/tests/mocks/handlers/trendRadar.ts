/**
 * @file trendRadar.ts
 * @description Default MSW handlers for the AI trend radar endpoint.
 *              Returns a single-row success page so any test that simply
 *              renders `useTrendRadar` / `TrendsPage` gets a deterministic
 *              "happy" baseline. Tests that need empty / error / large
 *              payloads override per-test with `server.use(...)`.
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */

import { http, HttpResponse, type HttpHandler } from "msw";

const PROXY = "/api/backend";

export const trendRadarHandlers: HttpHandler[] = [
  http.get(`${PROXY}/trends/radar`, () =>
    HttpResponse.json({
      ok: true,
      data: {
        scored: [
          {
            topic: "#DefaultTrend",
            platform: "TIKTOK",
            source: "PERPLEXITY_WEB",
            sourceUrl: null,
            relevanceScore: 8,
            postIdea: "Default fixture idea",
            bestPlatform: "TIKTOK",
            urgency: "TODAY",
            volume: 100,
            fetchedAt: "2026-05-20T00:00:00.000Z",
          },
        ],
        total: 1,
      },
    })
  ),
];
