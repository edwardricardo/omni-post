/**
 * @file listening.ts
 * @description Default MSW handlers for the brand-listening endpoints
 *              (`/listening/share-of-voice` + `/listening/mentions`). Returns a
 *              deterministic populated baseline so any test that renders the
 *              listening dashboard gets a "happy" path. Tests that need empty /
 *              error payloads override per-test with `server.use(...)`.
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */

import { http, HttpResponse, type HttpHandler } from "msw";

const PROXY = "/api/backend";

export const listeningHandlers: HttpHandler[] = [
  http.get(`${PROXY}/listening/share-of-voice`, () =>
    HttpResponse.json({
      ok: true,
      data: {
        projectId: "proj-1",
        since: "2026-04-22T00:00:00.000Z",
        until: "2026-05-22T00:00:00.000Z",
        brandCount: 8,
        marketCount: 4,
        totalCount: 12,
        sov: 2,
        byProvider: [
          { provider: "X", brandCount: 5, marketCount: 2, totalCount: 7, sov: 2.5 },
          { provider: "INSTAGRAM", brandCount: 3, marketCount: 2, totalCount: 5, sov: 1.5 },
        ],
        bySentiment: { positive: 0, neutral: 0, negative: 0, unscored: 12 },
      },
    })
  ),
  http.get(`${PROXY}/listening/mentions`, () =>
    HttpResponse.json({
      ok: true,
      data: {
        items: [
          {
            id: "mention-1",
            provider: "X",
            source: "SEARCH",
            trackedTermId: "term-1",
            trackedTermKind: "BRAND",
            channelId: null,
            authorName: "Jane Fan",
            authorHandle: "janefan",
            authorAvatarUrl: null,
            authorProviderId: "u-1",
            url: "https://x.com/i/web/status/mention-1",
            body: "Loving the new launch from Acme!",
            lang: "en",
            sentimentScore: null,
            sentimentLabel: null,
            providerCreatedAt: "2026-05-20T10:00:00.000Z",
            ingestedAt: "2026-05-20T10:05:00.000Z",
            createdAt: "2026-05-20T10:05:00.000Z",
            updatedAt: "2026-05-20T10:05:00.000Z",
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
    })
  ),
];
