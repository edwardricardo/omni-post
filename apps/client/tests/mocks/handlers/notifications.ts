/**
 * @file notifications.ts
 * @description MSW v2 handlers for the notifications-domain endpoints
 *              consumed by `useNotificationsApi`. Returns the canonical
 *              `{ ok: true, data: T }` envelope shape per backend's
 *              `BaseRouteHandler.sendSuccess`. Per-test scenarios (errors,
 *              edge cases) override these via `server.use(http.X(...))`
 *              inside individual `it()` blocks.
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */

import { http, HttpResponse } from "msw";

const PROXY = "/api/backend";

export const notificationsHandlers = [
  http.get(`${PROXY}/notifications`, () => {
    return HttpResponse.json({
      ok: true,
      data: {
        items: [
          {
            id: "n1",
            type: "APPROVAL_REQUESTED",
            title: "Default notification",
            body: "Default body",
            read: false,
            createdAt: "2026-05-07T00:00:00.000Z",
          },
        ],
      },
    });
  }),

  http.get(`${PROXY}/notifications/unread-count`, () => {
    return HttpResponse.json({ ok: true, data: { count: 1 } });
  }),

  http.post(`${PROXY}/notifications/mark-all-read`, () => {
    return HttpResponse.json({ ok: true, data: { marked: 1 } });
  }),

  http.patch(`${PROXY}/notifications/:id/read`, () => {
    return HttpResponse.json({ ok: true, data: { read: true } });
  }),

  http.get(`${PROXY}/notifications/preferences`, () => {
    return HttpResponse.json({
      ok: true,
      data: [
        { type: "APPROVAL_REQUESTED", enabled: true },
        { type: "POST_APPROVED", enabled: true },
        { type: "MENTION", enabled: false },
      ],
    });
  }),

  http.put(`${PROXY}/notifications/preferences`, () => {
    return HttpResponse.json({
      ok: true,
      data: [
        { type: "APPROVAL_REQUESTED", enabled: true },
        { type: "POST_APPROVED", enabled: true },
        { type: "MENTION", enabled: false },
      ],
    });
  }),
];
