# OmniPost — Master Development Plan

Generated: 2026-03-10
Audit baseline: ~49% (98 capabilities vs. mature platform reference model)
Target: ~80% (all IMPLEMENT + HOMOLOGATE items complete + Bluesky)

---

## PHASE SUMMARY TABLE

| Phase | Name                                         | Tier    | Tasks | Scope | Gate                                                                             |
| ----- | -------------------------------------------- | ------- | ----- | ----- | -------------------------------------------------------------------------------- |
| 1     | Dead Code + Foundation                       | 6+infra | 5     | S     | 0 dead-code files remain, Notification store exists                              |
| 2     | Notification Center UI                       | 1       | 3     | M     | Bell renders unread count; clicking shows dropdown                               |
| 3     | Social Inbox UI                              | 1       | 4     | L     | Inbox page at /admin/inbox; reply sends successfully                             |
| 4     | Approval Workflow UI                         | 1       | 3     | M     | Submit button visible in editor; approval queue renders                          |
| 5     | Quick Wins (AI Image, Slack/Teams, Comments) | 1       | 3     | S     | All 3 features accessible from admin nav                                         |
| 6     | Recurring Posts UI                           | 1       | 2     | M     | Create/list/deactivate recurring posts from admin                                |
| 7     | Platform Preview Extension                   | 3       | 1     | S     | All 9 provider previews render with correct limits                               |
| 8     | Bluesky Provider                             | 3       | 3     | M     | Bluesky posts publish end-to-end via existing worker                             |
| 9     | Analytics Completeness                       | 4       | 3     | S     | Scheduled reports UI; GA4 adapter wired; retention policy                        |
| 10    | API Documentation                            | 5       | 1     | S     | /api/docs renders all 41 route groups                                            |
| 11    | Homologate Gaps                              | 2       | 5     | M     | CSV bulk upload, calendar filters, DB prompt library, asset tags, usage metering |

---

## DECISIONS — RESOLVED

| #   | Decision                  | Choice                                         | Impact on plan      |
| --- | ------------------------- | ---------------------------------------------- | ------------------- |
| D1  | Optimal Timing Prediction | **Wire real analytics data**                   | Task 11.6 added     |
| D2  | Social Listening          | **Defer (post-launch backlog)**                | Added to Appendix A |
| D3  | Brand Voice Profiles      | **System prompts now; fine-tuning to backlog** | Task 11.7 added     |
| D4  | Task Assignment           | **Defer**                                      | Added to Appendix A |
| D5  | Employee Advocacy         | **Defer**                                      | Added to Appendix A |
| D6  | Post Boosting             | **Defer**                                      | Added to Appendix A |

---

## PHASE 1 — DEAD CODE REMOVAL + FOUNDATION

### Why this phase comes first

Dead code creates noise that confuses developers reading the codebase. Removing it before any new work prevents confusion. Foundation work (Notification store) is shared infrastructure — every subsequent phase depends on it.

### Entry Gate

- Genesis branch is current. Build passes (0 TS errors). All tests pass.

### Exit Gate (must ALL be true)

1. `PredictAudienceResponseUseCase.ts` does not exist on disk
2. `grep -r "createPromotedContent" packages/providers/tiktok/src/ --include="*.ts"` returns 0 real implementations (stub removed)
3. `YouTubeAdapter.ts publishCommunityPost()` is replaced with `// OUT OF SCOPE` comment and `communityPosts: false` in capabilities
4. `grep -r "PredictAudienceResponseUseCase" apps/ packages/ --include="*.ts"` returns 0 results
5. `apps/admin/lib/stores/notificationStore.ts` exists and exports `useNotificationStore`
6. Build passes with 0 errors after removals

---

### Task 1.1 — Remove PredictAudienceResponseUseCase

**What:** Delete the dead `PredictAudienceResponseUseCase.ts` use case, its DI registration, and its test file. This use case has no route wiring, no frontend consumer, and computes a heuristic "audience response score" with no real data.

**Why now:** Dead code removal is zero-risk and reduces maintenance surface before any new work begins.

**Audit reference:** Domain 6 — AI: PredictAudienceResponseUseCase (REMOVE)

**Files to delete:**

- `apps/api/src/application/ml/PredictAudienceResponseUseCase.ts`
- Any test file matching `*PredictAudienceResponse*`

**Files to modify:**

- `apps/api/src/infrastructure/container/setupUseCases.ts` — Remove DI registration for `PredictAudienceResponseUseCase`
- `apps/api/src/infrastructure/container/types.ts` — Remove `PredictAudienceResponseUseCase` token if it exists

**Prisma changes:** None

**API contract:** None

**UI specification:** None

**Library/API used:** None

**Pre-deletion verification:**

```bash
grep -r "PredictAudienceResponseUseCase" apps/ packages/ --include="*.ts" | grep -v node_modules
```

Confirm no route file or other use case imports it before deleting.

**Acceptance criteria:**

1. File `apps/api/src/application/ml/PredictAudienceResponseUseCase.ts` does not exist
2. `grep -r "PredictAudienceResponseUseCase" apps/ packages/ --include="*.ts"` returns 0 results
3. `pnpm build` completes with 0 TypeScript errors

**Tests required:** None (dead code, no coverage to maintain)

**Estimated effort:** XS (<1d)

**Depends on:** NONE

---

### Task 1.2 — Remove TikTok createPromotedContent stub

**What:** Remove the misleading `createPromotedContent()` body from `packages/providers/tiktok/src/marketingApiClient.ts`. The current implementation logs `"Marketing campaign creation not fully implemented"` and returns nothing useful, creating a false impression of functionality. Keep the file as a placeholder but replace the method body with a `throw new Error("NOT_IMPLEMENTED: TikTok Marketing API — see docs/providers/tiktok.md")`.

**Why now:** Before any new work, remove misleading stubs that could mask bugs or cause worker failures.

**Audit reference:** Domain 11 — Social Advertising: TikTok Marketing API createPromotedContent stub (REMOVE)

**Files to modify:**

- `packages/providers/tiktok/src/marketingApiClient.ts` — Replace stub body with explicit NOT_IMPLEMENTED error and add JSDoc comment explaining why

**Prisma changes:** None

**API contract:** None

**UI specification:** None

**Acceptance criteria:**

1. `createPromotedContent()` throws `Error("NOT_IMPLEMENTED: TikTok Marketing API")` instead of silently logging
2. JSDoc comment above the method states: `@deprecated NOT_IMPLEMENTED — TikTok Marketing API requires approval. See docs/providers/tiktok.md`
3. Build passes with 0 errors

**Tests required:**

- Unit: Verify `createPromotedContent()` throws `Error` with `NOT_IMPLEMENTED` message — `packages/providers/tiktok/src/__tests__/marketingApiClient.test.ts`

**Estimated effort:** XS (<1d)

**Depends on:** NONE

---

### Task 1.3 — Remove YouTube publishCommunityPost stub

**What:** Replace `publishCommunityPost()` in `YouTubeAdapter.ts` with a clear `// OUT OF SCOPE` comment and update the provider capabilities object to set `communityPosts: false`. The current implementation returns `err("VALIDATION")` which is misleading — it implies validation failure, not API unavailability.

**Why now:** Clean slate before new work.

**Audit reference:** Domain 3 — Publishing: YouTube Community Posts stub (REMOVE)

**Files to modify:**

- `packages/providers/youtube/src/YouTubeAdapter.ts` — Replace method body; update capabilities

**Prisma changes:** None

**API contract:** None

**UI specification:** None

**Acceptance criteria:**

1. `publishCommunityPost()` body contains comment: `// OUT OF SCOPE: YouTube Community Tab API requires YouTube Partner Program. Not available via standard Data API v3.`
2. Provider capabilities object has `communityPosts: false`
3. Method returns `err(new InvariantError("YouTube Community Posts are not supported via the Data API v3. YouTube Partner Program access is required."))` so callers get a clear, actionable message
4. Build passes with 0 errors

**Tests required:**

- Unit: Verify method returns `err` with correct message — `packages/providers/youtube/src/__tests__/YouTubeAdapter.test.ts`

**Estimated effort:** XS (<1d)

**Depends on:** NONE

---

### Task 1.4 — Create Notification Zustand Store

**What:** Create a client-side Zustand store for notification state. This is shared infrastructure used by the notification bell (Phase 2), the inbox unread badge (Phase 3), and any future real-time feature. The store holds: unread count, notification list, SSE connection status, and actions for marking read.

**Why now:** The notification bell (Task 2.2) and SSE hook (Task 2.1) both depend on this store. It must exist before any UI work begins.

**Audit reference:** Domain 8 — Team Collaboration: Notification Center UI

**Files to create:**

- `apps/admin/lib/stores/notificationStore.ts` — Zustand store with SSE state

**Files to modify:** None (store is consumed by Phase 2 tasks)

**Prisma changes:** None

**API contract:** None (store is client-only; it reads from the SSE stream and REST endpoints)

**UI specification:** None (this is a store, not a component)

**Library/API used:**

- Zustand is already installed in the admin app (confirm via `apps/admin/package.json`). If not installed: `pnpm --filter @apps/admin add zustand`

**Store interface:**

```typescript
interface NotificationState {
  notifications: NotificationItem[];
  unreadCount: number;
  isConnected: boolean;
  lastEventId: string | null;
  // Actions
  setNotifications: (items: NotificationItem[]) => void;
  addNotification: (item: NotificationItem) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setUnreadCount: (count: number) => void;
  setConnected: (connected: boolean) => void;
  setLastEventId: (id: string) => void;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}
```

**Acceptance criteria:**

1. File `apps/admin/lib/stores/notificationStore.ts` exists and exports `useNotificationStore`
2. Store compiles with 0 TypeScript errors
3. All state fields and actions are typed (no `any`)
4. `markRead(id)` sets `read: true` on the matching notification and decrements `unreadCount` if it was unread

**Tests required:**

- Unit: Test each action in isolation — `apps/admin/lib/stores/__tests__/notificationStore.test.ts` (vitest)

**Estimated effort:** XS (<1d)

**Depends on:** NONE (can run in parallel with Tasks 1.1–1.3)

---

### Task 1.5 — Create Admin API Proxy Routes for Inbox, Notifications, Approvals

**What:** The admin app proxies backend calls via `/api/backend/[...path]`. Verify (and create if missing) proxy route coverage for: `/api/inbox/*`, `/api/notifications/*`, `/api/approvals/*`, `/api/ai/*` (for image generation), `/api/recurring-posts/*`, `/api/external-notifications/*`, `/api/reports/*`. This ensures all Phase 2–6 UI tasks can reach the backend.

**Why now:** Every UI task in Phases 2–6 requires these proxy routes. Without them, all fetch calls fail with 404.

**Audit reference:** Cross-cutting infrastructure

**Files to check first:**

- `apps/admin/app/api/backend/[...path]/route.ts` — Read this file. If it is a catch-all proxy that forwards all paths, no new files are needed. If it only covers specific paths, each missing path needs a new route file.

**Files to create (if catch-all does not exist):**

- `apps/admin/app/api/backend/inbox/[...path]/route.ts`
- `apps/admin/app/api/backend/notifications/[...path]/route.ts`
- `apps/admin/app/api/backend/approvals/[...path]/route.ts`
- `apps/admin/app/api/backend/ai-image/[...path]/route.ts`
- `apps/admin/app/api/backend/recurring-posts/[...path]/route.ts`
- `apps/admin/app/api/backend/external-notifications/[...path]/route.ts`
- `apps/admin/app/api/backend/reports/[...path]/route.ts`

**Proxy pattern** (each route.ts follows this exact shape):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

async function proxyRequest(req: NextRequest, params: { path: string[] }) {
  const path = params.path.join('/');
  const url = new URL(req.url);
  const targetUrl = `${API_BASE}/api/${path}${url.search}`;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('admin-session')?.value;

  const response = await fetch(targetUrl, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken && { Authorization: `Bearer ${sessionToken}` }),
    },
    body: req.method !== 'GET' ? await req.text() : undefined,
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export const GET = (req: NextRequest, { params }: { params: { path: string[] } }) =>
  proxyRequest(req, params);
export const POST = ...
export const PATCH = ...
export const DELETE = ...
```

**Prisma changes:** None

**API contract:** None (this is a transparent proxy)

**Acceptance criteria:**

1. `GET /api/backend/inbox` from the admin app reaches `GET /api/inbox` on the backend and returns the response
2. `GET /api/backend/notifications/stream` does NOT break SSE — confirm the proxy either passes through streaming responses or the SSE hook connects directly to the backend URL
3. All HTTP methods (GET, POST, PATCH, DELETE) are proxied
4. 401 from backend is returned as 401 to the frontend (no swallowed errors)

**Note on SSE:** Standard Next.js proxy routes buffer the response body. SSE requires streaming. For `GET /notifications/stream`, the SSE hook should connect **directly** to the backend URL (`process.env.NEXT_PUBLIC_API_URL + '/notifications/stream'`) with the session token as a query param or cookie, bypassing the proxy. Read `notificationRoutes.ts` SSE auth pattern before implementing.

**Tests required:**

- Integration: Mock fetch in proxy route, verify forwarding behavior — `apps/admin/app/api/backend/__tests__/proxy.test.ts` (vitest)

**Estimated effort:** S (1-3d)

**Depends on:** NONE

---

## PHASE 2 — NOTIFICATION CENTER UI

### Why this phase comes before Phase 3

Notifications are the connective tissue that makes approvals (Phase 4) and inbox (Phase 3) feel real-time. The notification bell must exist in the admin header before any feature that emits notifications is exposed. Additionally, the `useNotificationStore` from Phase 1 enables the unread badge needed by the inbox (Phase 3).

### Entry Gate

All Phase 1 exit gate conditions are true.

### Exit Gate

1. Notification bell renders in admin dashboard header with a numeric unread badge
2. Clicking the bell opens a dropdown listing recent notifications
3. Clicking a notification item marks it read (badge decrements)
4. "Mark all read" button sets badge to 0
5. SSE connection is established on page load (verify via browser DevTools → Network → EventStream)
6. A new notification created via `POST /notifications` appears in the dropdown within 5 seconds without page refresh

---

### Task 2.1 — SSE Notification Stream Hook

**What:** Create `useNotificationStream` hook that opens an `EventSource` connection to the backend SSE endpoint, handles reconnection on error, and dispatches incoming events to the Zustand notification store.

**Why now:** The bell component (Task 2.2) consumes this hook. Must exist first.

**Audit reference:** Domain 8 — Notification Center UI

**Files to create:**

- `apps/admin/hooks/useNotificationStream.ts` — EventSource hook

**Files to modify:**

- `apps/admin/lib/stores/notificationStore.ts` — Add `isConnected` update from this hook (already included in Task 1.4 store design)

**Prisma changes:** None

**API contract:**

- SSE endpoint: `GET {NEXT_PUBLIC_API_URL}/notifications/stream`
- Auth: Backend reads `admin-session` cookie. EventSource sends cookies automatically if same-origin or if credentials are included.
- Event format: `data: {"id":"uuid","type":"APPROVAL_REQUESTED","title":"...","body":"...","read":false,"createdAt":"ISO"}\n\n`
- Heartbeat: `:heartbeat` every 30s (no-op, just keeps connection alive)

**Implementation:**

```typescript
"use client";
import { useEffect } from "react";
import { useNotificationStore } from "@/lib/stores/notificationStore";

const SSE_URL = `${process.env.NEXT_PUBLIC_API_URL}/notifications/stream`;
const RECONNECT_DELAY_MS = 3000;

export function useNotificationStream(enabled = true) {
  const { addNotification, setConnected } = useNotificationStore();

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource(SSE_URL, { withCredentials: true });

      es.onopen = () => setConnected(true);

      es.onmessage = (event) => {
        if (event.data === ":heartbeat") return;
        try {
          const notification = JSON.parse(event.data);
          addNotification(notification);
        } catch {
          /* ignore malformed events */
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      es?.close();
      setConnected(false);
    };
  }, [enabled, addNotification, setConnected]);
}
```

**Acceptance criteria:**

1. Hook opens EventSource to `NEXT_PUBLIC_API_URL + '/notifications/stream'`
2. Incoming `data:` events are parsed and passed to `addNotification()`
3. On error, connection closes and reconnects after 3 seconds
4. Cleanup closes EventSource on unmount
5. No TypeScript errors

**Tests required:**

- Unit: Mock EventSource, verify `addNotification` called on message, reconnect called on error — `apps/admin/hooks/__tests__/useNotificationStream.test.ts` (vitest)

**Estimated effort:** S (1-3d)

**Depends on:** Task 1.4 (store)

---

### Task 2.2 — Notification Bell Component

**What:** Create `NotificationBell` component for the admin dashboard header. Shows a bell icon with an unread count badge. On click, opens a Popover/dropdown listing recent notifications with time-ago timestamps. Includes "Mark all read" button. Each notification item links to the relevant resource (post, approval, etc.).

**Why now:** Core UI for the notification system. Wired into the dashboard layout.

**Audit reference:** Domain 8 — Notification Center UI

**Files to create:**

- `apps/admin/components/notifications/NotificationBell.tsx` — Bell + dropdown
- `apps/admin/components/notifications/NotificationItem.tsx` — Single notification row
- `apps/admin/components/notifications/index.ts` — Barrel export

**Files to modify:**

- `apps/admin/app/(dashboard)/layout.tsx` — Add `<NotificationBell />` to header, import `useNotificationStream` and call it at layout level to start SSE connection on dashboard load

**Prisma changes:** None

**API contract:**

- `GET /api/backend/notifications?limit=20` — Initial load of recent notifications
- `GET /api/backend/notifications/unread-count` — Initial unread count
- `PATCH /api/backend/notifications/:id/read` — Mark single read
- `POST /api/backend/notifications/mark-all-read` — Mark all read

**UI specification:**

- Component: `NotificationBell`
- Location: Admin dashboard header (right side, before user name)
- Bell icon: `lucide-react` `Bell` icon (already installed, v0.544.0)
- Unread badge: Red circle with count, overlapping bell icon top-right. Hidden when count = 0.
- Dropdown: Opens below bell, max-height 400px, scrollable with `ScrollArea`
- Notification list: Each item shows: colored dot by type, title (bold), body (truncated 60 chars), time-ago
- Time-ago: Use `date-fns formatDistanceToNow` (already installed v4.1.0)
- Empty state: "No notifications" centered text
- Loading state: 3 skeleton rows
- Error state: "Failed to load notifications" with retry button
- "Mark all read" button: top-right of dropdown, disabled when unreadCount = 0
- Responsive: dropdown width 360px on desktop, full-width on mobile

**Notification type → color mapping:**

- `APPROVAL_REQUESTED` → amber
- `POST_APPROVED` → green
- `POST_REJECTED` → red
- `COMMENT_ADDED` → blue
- `COMMENT_REPLY` → blue
- `MENTION` → purple
- Default → gray

**Notification type → navigation target:**

- `APPROVAL_REQUESTED` → `/admin/approvals` (Phase 4 page)
- `POST_APPROVED` / `POST_REJECTED` → `/admin/posts/{postId}` (from metadata)
- `COMMENT_ADDED` / `COMMENT_REPLY` → `/admin/posts/{postId}` (from metadata)
- `MENTION` → `/admin/posts/{postId}` (from metadata)

**Acceptance criteria:**

1. Bell icon appears in admin header
2. Unread badge shows correct count from store; hidden when 0
3. Clicking bell opens dropdown; clicking outside closes it
4. Recent notifications load on dropdown open (TanStack Query, staleTime 60s)
5. Clicking a notification marks it read (badge decrements) and navigates to target route
6. "Mark all read" clears badge and marks all items read visually
7. New SSE notification appears in dropdown without page refresh
8. Dropdown is accessible: focus-trapped, ESC closes, aria-label="Notifications"

**Tests required:**

- Unit: NotificationBell renders bell icon + badge — vitest + React Testing Library
- Unit: NotificationItem renders title, body, time-ago — vitest
- Unit: Clicking item fires markRead mutation — vitest

**Estimated effort:** M (1-2w)

**Depends on:** Task 2.1 (SSE hook), Task 1.4 (store), Task 1.5 (proxy routes)

---

### Task 2.3 — Notification Preferences Page

**What:** Add a "Notification Preferences" section to the admin settings (or add a link from the bell dropdown to `/admin/settings/notifications`). Shows a list of notification types with a toggle (enabled/disabled) for each. Persists via `PUT /notifications/preferences`.

**Why now:** Users need control over which notifications they receive before the system is in production. Completes the notification feature.

**Audit reference:** Domain 8 — Notification Center UI

**Files to create:**

- `apps/admin/app/(dashboard)/settings/notifications/page.tsx` — Preferences page
- `apps/admin/components/notifications/NotificationPreferences.tsx` — Preferences form

**Files to modify:**

- `apps/admin/components/notifications/NotificationBell.tsx` — Add "Preferences" link at bottom of dropdown

**Prisma changes:** None (preferences stored in existing `NotificationPreference` model)

**API contract:**

- `GET /api/backend/notifications/preferences` → `{ ok: true, value: [{ type: string, enabled: boolean }] }`
- `PUT /api/backend/notifications/preferences` — Body: `{ preferences: Array<{ type: string; enabled: boolean }> }`

**UI specification:**

- Page route: `/admin/settings/notifications`
- Layout: Simple list of toggles (Switch component from shadcn/ui or Radix)
- Each row: Notification type label (human-readable) + description + toggle
- Save button: Saves all preferences at once (or debounced auto-save)
- Loading: Skeleton rows
- Success toast on save

**Acceptance criteria:**

1. Page accessible at `/admin/settings/notifications`
2. Toggles render for each notification type returned by `GET /notifications/preferences`
3. Toggling and saving sends `PUT /notifications/preferences` with updated array
4. Success toast appears after save
5. Disabling a notification type prevents that type from appearing in the bell dropdown

**Tests required:**

- Unit: Toggle interaction calls PUT mutation — vitest

**Estimated effort:** S (1-3d)

**Depends on:** Task 2.2 (notification bell for the settings link)

---

## PHASE 3 — SOCIAL INBOX UI

### Why this phase comes before Phase 4

The inbox is the #1 expected feature of a social media management tool and has the highest user impact. It is independent of the approval workflow. Building it now delivers the biggest value increment.

### Entry Gate

All Phase 2 exit gate conditions are true.

### Exit Gate

1. `/admin/inbox` page is accessible from admin sidebar navigation
2. Conversation list renders at least one conversation when test data exists
3. Clicking a conversation opens the thread view with messages
4. Reply composer sends a reply (verify via `POST /api/inbox/messages/:id/reply`)
5. Unread badge in sidebar nav reflects `GET /api/inbox/unread-count`
6. Platform filter (X, Instagram, etc.) narrows the conversation list

---

### Task 3.1 — Inbox Page Shell + Conversation List

**What:** Create the main inbox page at `/admin/inbox`. Layout: left panel (filters sidebar + conversation list with virtualized scroll), right panel (empty state when no conversation selected). Conversation list items show: platform badge, sender avatar/name, message preview (truncated), timestamp, unread indicator, assignee avatar.

**Why now:** The thread view (Task 3.2) and reply composer (Task 3.3) mount inside this shell. Must exist first.

**Audit reference:** Domain 4 — Social Inbox: Unified View

**Files to create:**

- `apps/admin/app/(dashboard)/inbox/page.tsx` — Page component (Server Component wrapper)
- `apps/admin/components/inbox/InboxLayout.tsx` — Two-panel layout (client component)
- `apps/admin/components/inbox/InboxSidebar.tsx` — Filters (platform, status, type, assignee)
- `apps/admin/components/inbox/ConversationList.tsx` — Virtualized conversation list
- `apps/admin/components/inbox/ConversationCard.tsx` — Single conversation row
- `apps/admin/hooks/api/useInbox.ts` — TanStack Query hooks for inbox data

**Files to modify:**

- `apps/admin/components/shared/SidebarNav.tsx` — Add "Inbox" nav item with unread badge, route `/admin/inbox`

**Prisma changes:** None (backend complete)

**API contract:**

- `GET /api/backend/inbox?projectId=X&limit=20&cursor=Y&provider=Z&status=A&messageType=B&assigneeId=C`
  - Response: `{ ok: true, value: { items: Conversation[], nextCursor: string | null } }`
  - `Conversation`: `{ id, externalId, provider, channelId, status, assigneeId, unreadCount, lastMessage: { body, createdAt, senderName }, createdAt, updatedAt }`
- `GET /api/backend/inbox/unread-count?projectId=X`
  - Response: `{ ok: true, value: { count: number } }`

**UI specification:**

- Page: `/admin/inbox`
- Layout: 280px fixed left panel + flexible right panel, full viewport height, `overflow-hidden`
- Sidebar filters: Pills for platform (All / X / Instagram / Facebook / YouTube / LinkedIn / etc.), status (Open / Resolved / Archived), type (All / Comments / Mentions / DMs)
- Conversation list: Infinite scroll using `useInfiniteQuery` (TanStack Query v5, `initialPageParam: null`)
- Each ConversationCard: platform icon (16px) + sender name (bold) + message preview (1 line, truncated) + relative time (date-fns) + unread dot (blue, left border)
- Loading: 5 skeleton cards
- Empty state: Illustration + "No conversations yet" text + description
- Error state: Error message + retry button
- Selected conversation: highlighted background

**Acceptance criteria:**

1. Page at `/admin/inbox` renders without error
2. Conversation list populates from `GET /api/backend/inbox`
3. Infinite scroll loads next page when user scrolls to bottom
4. Platform filter sends `provider=X` query param and re-fetches
5. Status filter sends `status=X` query param and re-fetches
6. Unread dot appears on conversations with `unreadCount > 0`
7. Sidebar nav "Inbox" item shows unread count badge from `GET /api/backend/inbox/unread-count`

**Tests required:**

- Unit: ConversationCard renders sender name and platform badge — vitest
- Unit: useInbox infinite query fetches with correct params — vitest + msw

**Estimated effort:** M (1-2w)

**Depends on:** Task 1.5 (proxy routes), Task 2.2 (sidebar nav already modified — coordinate)

---

### Task 3.2 — Conversation Thread View

**What:** When a conversation is selected in the list, render the thread view in the right panel. Shows: conversation header (platform, sender, status, assignee), scrollable message list (each with sender avatar, body, timestamp, platform icon), and read state management (mark conversation messages as read on open).

**Why now:** Depends on Task 3.1 shell. This is the core reading experience.

**Audit reference:** Domain 4 — Social Inbox: Unified View + Mention Monitoring

**Files to create:**

- `apps/admin/components/inbox/ConversationThread.tsx` — Thread container
- `apps/admin/components/inbox/MessageBubble.tsx` — Single message item
- `apps/admin/components/inbox/ConversationHeader.tsx` — Header with status controls
- `apps/admin/hooks/api/useConversation.ts` — Hooks for conversation detail + messages

**Files to modify:**

- `apps/admin/components/inbox/InboxLayout.tsx` — Render `<ConversationThread />` in right panel when `selectedConversationId` is set

**Prisma changes:** None

**API contract:**

- `GET /api/backend/inbox/conversations/:id` → `{ ok: true, value: Conversation }`
- `GET /api/backend/inbox/conversations/:id/messages?cursor=Y&limit=20` → `{ ok: true, value: { items: Message[], nextCursor: string | null } }`
  - `Message`: `{ id, body, senderName, senderAvatar?, createdAt, isInternal, direction: 'INBOUND'|'OUTBOUND', read }`
- `PATCH /api/backend/inbox/messages/:id/read` — Mark message read (fire-and-forget on thread open)
- `PATCH /api/backend/inbox/conversations/:id/resolve` — Body: `{ resolvedById: string }`
- `PATCH /api/backend/inbox/conversations/:id/reopen`
- `PATCH /api/backend/inbox/messages/:id/assign` — Body: `{ assigneeId: string }`

**UI specification:**

- ConversationHeader: Platform badge + sender name + status badge (Open/Resolved) + "Resolve" button + assignee avatar picker (dropdown of team members from `GET /api/backend/team?projectId=X`)
- MessageBubble: INBOUND (left-aligned, gray bg) / OUTBOUND (right-aligned, blue bg). Shows sender name + timestamp. Supports text only for MVP.
- Message list: Scrolled to bottom on open. Reverse-chronological pagination (load older messages on scroll up).
- Assignee picker: Dropdown with team member list, avatar + name. Sends `PATCH .../assign`.
- "Resolve" button: Sends `PATCH .../resolve`, updates status badge to "Resolved", replaces with "Reopen" button.
- Loading: Full-panel skeleton
- Empty state: "No messages in this conversation"

**Acceptance criteria:**

1. Selecting a conversation in the list renders the thread in the right panel
2. Messages load from `GET /api/backend/inbox/conversations/:id/messages`
3. INBOUND and OUTBOUND messages display with correct alignment
4. Opening a conversation fires `PATCH .../read` for unread messages
5. "Resolve" button sends resolve request and updates UI status
6. Assignee picker lists team members and sends assign request on selection

**Tests required:**

- Unit: MessageBubble renders correct alignment for INBOUND vs OUTBOUND — vitest
- Unit: "Resolve" button mutation is called on click — vitest

**Estimated effort:** M (1-2w)

**Depends on:** Task 3.1

---

### Task 3.3 — Reply Composer

**What:** Inline reply composer anchored below the conversation thread. Text input (multiline), send button with loading state, optimistic update (outbound message appears immediately), error rollback. Shows which providers support reply from dashboard and disables send for unsupported providers.

**Why now:** Without reply, the inbox is read-only and loses operational value.

**Audit reference:** Domain 4 — Social Inbox: Reply from Dashboard

**Files to create:**

- `apps/admin/components/inbox/ReplyComposer.tsx` — Inline composer

**Files to modify:**

- `apps/admin/components/inbox/ConversationThread.tsx` — Mount `<ReplyComposer />` at bottom

**Prisma changes:** None

**API contract:**

- `POST /api/backend/inbox/messages/:messageId/reply` — Body: `{ body: string }` → `{ ok: true, value: { id: string, body: string, createdAt: string } }`

**Provider reply support (hardcode these in the composer):**

- Supported: X, Instagram, Facebook, YouTube, LinkedIn
- Unsupported (DM restrictions): Snapchat, Telegram, Pinterest, TikTok

**UI specification:**

- Textarea: `min-height: 80px`, max 2000 chars, auto-resize
- Send button: `lucide-react` Send icon + "Reply" label. Disabled when empty or loading.
- Character counter: Right-aligned below textarea, gray when <1800 chars, red when ≥1800
- Optimistic update: Append `MessageBubble` with `direction: 'OUTBOUND'` and greyed-out style before server confirms
- Error: Toast "Failed to send reply. Please try again." Rollback removes optimistic message.
- Provider not supported: Grey banner above composer: "Replies are not supported for [Provider] via API. Reply directly in the [Provider] app."
- Loading: Send button shows spinner, textarea disabled

**Acceptance criteria:**

1. Composer renders below thread for supported providers
2. Grey "not supported" banner renders for Snapchat, Telegram, Pinterest, TikTok
3. Send button disabled when textarea is empty
4. Clicking Send fires `POST .../reply` with `{ body: textarea.value }`
5. Optimistic message appears immediately
6. On success: textarea clears, message persisted in thread
7. On error: toast appears, optimistic message removed

**Tests required:**

- Unit: Send button disabled when textarea empty — vitest
- Unit: Optimistic message added and removed on error — vitest
- E2E: Type reply, click send, verify new message appears — Playwright (`apps/admin/e2e/inbox.spec.ts`)

**Estimated effort:** M (1-2w)

**Depends on:** Task 3.2

---

### Task 3.4 — Mentions Tab

**What:** Add a "Mentions" tab to the inbox sidebar. Uses the existing `GET /api/inbox/mentions` endpoint. Renders the same `ConversationList` component with `messageType=MENTION` filter pre-applied. This is a filtered view of the existing inbox — no new backend work.

**Why now:** Zero new backend work. Uses components from Tasks 3.1–3.2. Maximum impact for minimal effort.

**Audit reference:** Domain 4 — Social Inbox: Mention Monitoring

**Files to modify:**

- `apps/admin/components/inbox/InboxSidebar.tsx` — Add "Mentions" tab to the type filter, wire to `GET /api/backend/inbox/mentions`
- `apps/admin/hooks/api/useInbox.ts` — Add `useMentions()` hook using `GET /api/backend/inbox/mentions`

**Prisma changes:** None

**API contract:**

- `GET /api/backend/inbox/mentions?projectId=X&cursor=Y&limit=20` → Same `Conversation[]` shape as inbox

**UI specification:**

- Tabs: "All" | "Mentions" | "Comments" — filter pills in sidebar
- "Mentions" tab: Shows only conversations where `messageType = 'MENTION'`
- Renders same `ConversationList` component, passes different query

**Acceptance criteria:**

1. "Mentions" tab renders in inbox sidebar
2. Clicking "Mentions" fetches from `/api/backend/inbox/mentions`
3. Conversation list shows only mention-type conversations
4. Empty state: "No mentions yet"

**Tests required:**

- Unit: Mentions tab triggers correct API call — vitest

**Estimated effort:** XS (<1d)

**Depends on:** Task 3.1

---

## PHASE 4 — APPROVAL WORKFLOW UI

### Why this phase comes after Phase 3

The notification bell (Phase 2) already handles approval notifications. The inbox (Phase 3) provides the pattern for list + detail view. Approval queue follows the same pattern. More importantly, approval notifications navigate to the approval queue page — that page must exist.

### Entry Gate

All Phase 3 exit gate conditions are true.

### Exit Gate

1. "Submit for Review" button is visible in the post editor for users without approve permission
2. `POST /posts/:id/submit-for-review` is called when button is clicked
3. `/admin/approvals` page renders a list of pending approvals
4. Approve and Reject buttons on the review panel call the correct endpoints
5. Rejection requires a non-empty reason text
6. Notification fires when a post is submitted (verify via bell dropdown)

---

### Task 4.1 — Submit for Review Button in Post Editor

**What:** Add a "Submit for Review" button to the post detail/edit page (`/admin/posts/[id]`). Visible only when: (a) the post status is DRAFT, and (b) the current user does not have the `APPROVE_POST` permission. Sends `POST /posts/:postId/submit-for-review` with `{ submitterId, comment? }`.

**Why now:** This is the entry point that creates an ApprovalRequest. Without it, the approval queue (Task 4.2) has nothing to show.

**Audit reference:** Domain 8 — Approval Workflow UI

**Files to create:**

- `apps/admin/components/approvals/SubmitForReviewButton.tsx` — Button + optional comment dialog
- `apps/admin/hooks/api/useApprovals.ts` — TanStack mutations + queries for approvals

**Files to modify:**

- `apps/admin/app/(dashboard)/posts/[id]/page.tsx` — Add `<SubmitForReviewButton />` to post actions section

**Prisma changes:** None

**API contract:**

- `POST /api/backend/posts/:postId/submit-for-review`
  - Body: `{ submitterId: string; comment?: string }`
  - Response: `{ ok: true, value: { approvalId: string } }` or error

**UI specification:**

- Button label: "Submit for Review"
- Button style: Secondary/outline, amber color scheme
- Visible when: `post.status === 'DRAFT'` AND current user lacks `APPROVE_POST` role
- On click: Opens small Dialog asking for optional comment → "Submit" confirmation button
- Loading state: Button spinner while request in flight
- Success: Toast "Submitted for review", post status badge updates to "Pending Review"
- Error: Toast with error message

**Acceptance criteria:**

1. Button visible on DRAFT posts for non-approver users
2. Button hidden when post is not DRAFT (published, scheduled, pending review)
3. Clicking opens dialog with optional comment textarea
4. Submitting fires `POST /posts/:id/submit-for-review`
5. Success toast shown after submission
6. Post status badge updates to "Pending Review" after submission

**Tests required:**

- Unit: Button hidden when post.status !== 'DRAFT' — vitest
- Unit: Mutation called with correct body on confirm — vitest

**Estimated effort:** S (1-3d)

**Depends on:** Task 1.5 (proxy routes), Phase 1 complete

---

### Task 4.2 — Approval Queue Page

**What:** Create `/admin/approvals` page listing all posts pending review. Each card shows: content preview (truncated), submitter name + date, platform(s) targeted, and "Review" button that opens the review panel. Accessible only to users with `APPROVE_POST` permission. Uses `GET /approvals/pending?reviewerId=X`.

**Why now:** Where approvers go to take action. Notification bell (Phase 2) navigates here.

**Audit reference:** Domain 8 — Approval Workflow UI

**Files to create:**

- `apps/admin/app/(dashboard)/approvals/page.tsx` — Page (permission check + data fetch)
- `apps/admin/components/approvals/ApprovalQueue.tsx` — Queue list
- `apps/admin/components/approvals/ApprovalCard.tsx` — Single pending approval card

**Files to modify:**

- `apps/admin/components/shared/SidebarNav.tsx` — Add "Approvals" nav item (visible to approvers only), with pending count badge

**Prisma changes:** None

**API contract:**

- `GET /api/backend/approvals/pending?reviewerId=X` → `{ ok: true, value: ApprovalRequest[] }`
  - `ApprovalRequest`: `{ id, postId, postTitle, postContent, submitterId, submitterName, submittedAt, platforms: string[], status }`

**UI specification:**

- Page route: `/admin/approvals`
- Guard: Redirect non-approvers to `/admin/posts` (server-side redirect using role from session token)
- Layout: 3-column grid on desktop, 1-column on mobile
- ApprovalCard: Content preview (100 char max) + platform badges + submitter name + "X days ago" + "Review" button
- Empty state: "No pending approvals" with checkmark icon
- Loading: 3 skeleton cards
- Pending count badge: `GET /api/backend/approvals/pending?reviewerId=X` count, refreshed every 60s

**Acceptance criteria:**

1. Page at `/admin/approvals` accessible to users with approve permission
2. Non-approver users are redirected to `/admin/posts`
3. Pending approvals list loads from `GET /api/backend/approvals/pending`
4. Each card shows content preview, platform badges, and submitter info
5. "Review" button opens the review panel (Task 4.3)
6. Sidebar "Approvals" item shows pending count badge

**Tests required:**

- Unit: ApprovalCard renders correct platform badges — vitest
- Unit: Page redirects non-approvers — vitest (server component test)

**Estimated effort:** S (1-3d)

**Depends on:** Task 4.1 (for end-to-end flow), Task 1.5

---

### Task 4.3 — Review Panel (Approve/Reject + Comment Thread)

**What:** A Sheet (slide-in panel from right) that opens when "Review" is clicked on an approval card. Shows the full post content, media previews, and two action buttons: "Approve" and "Reject". Reject requires a non-empty reason. Comment thread embedded below (loads from `GET /posts/:postId/comments` — from the existing `commentRoutes.ts`).

**Why now:** Completes the approval workflow. Also exposes the comment thread feature (audit item).

**Audit reference:** Domain 8 — Approval Workflow UI + In-Post Comment Thread UI

**Files to create:**

- `apps/admin/components/approvals/ReviewPanel.tsx` — Sheet panel
- `apps/admin/components/approvals/ApproveRejectActions.tsx` — Action buttons + reject dialog
- `apps/admin/components/comments/CommentThread.tsx` — Threaded comment list
- `apps/admin/components/comments/CommentInput.tsx` — New comment input
- `apps/admin/hooks/api/useComments.ts` — TanStack hooks for comments

**Files to modify:**

- `apps/admin/components/approvals/ApprovalQueue.tsx` — Open Sheet on "Review" click, pass `approvalId` and `postId`

**Prisma changes:** None

**API contract:**

- `POST /api/backend/approvals/:id/approve` — Body: `{ reviewerId: string; comment?: string }`
- `POST /api/backend/approvals/:id/reject` — Body: `{ reviewerId: string; comment: string }` (comment required)
- `GET /api/backend/posts/:postId/comments` → `{ ok: true, value: Comment[] }`
  - `Comment`: `{ id, authorId, authorName, body, createdAt, parentId?, replies: Comment[] }`
- `POST /api/backend/posts/:postId/comments` — Body: `{ authorId: string; body: string; parentId?: string }`

**UI specification:**

- Sheet width: 600px on desktop, full-width on mobile
- Header: Post title + platform badges + submitted by + date
- Content section: Full post body text + media thumbnails (grid, same as PlatformPreview pattern)
- Actions section: Green "Approve" button + Red "Reject" button
- Reject dialog: Textarea for rejection reason (required, min 10 chars) + "Confirm Reject" button
- Comment thread: List of comments below actions. Each shows author avatar (initials), name, body, timestamp. Reply button opens inline `CommentInput`. Threaded up to 1 level.
- New comment: Textarea at bottom of comment section. "Add Comment" button.
- After approve: Sheet closes, card removed from queue, success toast
- After reject: Sheet closes, card removed from queue, toast with rejection reason

**Acceptance criteria:**

1. Sheet opens on "Review" click with post content visible
2. "Approve" sends `POST /approvals/:id/approve` with reviewerId
3. "Reject" requires non-empty comment (min 10 chars); sends `POST /approvals/:id/reject`
4. After approve/reject, card disappears from queue
5. Comment thread loads from `GET /posts/:postId/comments`
6. New comment can be added via input at bottom
7. Rejection reason is visible in the rejection toast

**Tests required:**

- Unit: "Reject" button disabled when reason is empty — vitest
- Unit: Approve mutation called on click — vitest
- E2E: Full approve flow — Playwright

**Estimated effort:** M (1-2w)

**Depends on:** Task 4.2

---

## PHASE 5 — QUICK WINS

### Why this phase comes here

These three features are S or XS scope, backend-complete, and fully independent. They deliver visible product value without blocking anything.

### Entry Gate

All Phase 4 exit gate conditions are true. (Or: Phases 1–4 gates met; these tasks don't technically depend on Phase 4 but sequential enforcement is maintained.)

### Exit Gate

1. `/admin/ai/generate` page has image generation form and gallery
2. `/admin/settings/integrations` page has Slack/Teams webhook config form
3. Review panel (Phase 4) shows comment thread (integrated in Task 4.3 — verify)

---

### Task 5.1 — AI Image Generation UI

**What:** Build the AI image generation UI on the existing `/admin/ai/generate` page. Form with: prompt textarea, size selector (1024x1024 / 1024x1792 / 1792x1024), quality selector (standard / hd), style selector (natural / vivid). Gallery of previously generated images. "Insert into post" action (copies URL to clipboard for MVP).

**Why now:** Backend is complete. S-scope UI with high visual impact.

**Audit reference:** Domain 6 — AI: Image Generation UI

**Files to create:**

- `apps/admin/components/ai/AIImageGenerator.tsx` — Main image gen component
- `apps/admin/components/ai/GeneratedImageGallery.tsx` — Image gallery grid
- `apps/admin/hooks/api/useAIImages.ts` — Generate + list hooks

**Files to modify:**

- `apps/admin/app/(dashboard)/ai/generate/page.tsx` — Add `<AIImageGenerator />` (read this file first to understand current content)

**Prisma changes:** None

**API contract:**

- `POST /api/backend/ai/generate-image` — Body: `{ projectId: string; prompt: string; size: '1024x1024'|'1024x1792'|'1792x1024'; quality: 'standard'|'hd'; style: 'natural'|'vivid' }` → `{ ok: true, value: { id: string; url: string; prompt: string; createdAt: string } }`
- `GET /api/backend/ai/generated-images?projectId=X` → `{ ok: true, value: GeneratedImage[] }`

**UI specification:**

- Form: Prompt textarea (min 20 chars hint), 3 Select dropdowns for size/quality/style, "Generate" button
- Loading: Progress indicator (DALL-E 3 can take 5-10 seconds) — animated spinner + "Generating image..." text
- Result: Image preview (400px wide max) + "Copy URL" button + "Download" button
- Gallery: Grid of previously generated images (3 columns, lazy loading), each with prompt tooltip and date
- Empty gallery state: "No images generated yet. Try the form above!"
- Error: Toast with error message

**Acceptance criteria:**

1. Form renders with prompt textarea and 3 selectors
2. "Generate" button disabled when prompt < 10 chars
3. POST fires with all form values
4. Generated image appears in preview below form
5. Gallery loads from `GET .../generated-images` on page load
6. "Copy URL" copies image URL to clipboard, shows success toast
7. All TypeScript strict — no `any`

**Tests required:**

- Unit: Generate button disabled when prompt empty — vitest
- Unit: POST called with correct body — vitest

**Estimated effort:** S (1-3d)

**Depends on:** Task 1.5 (proxy routes)

---

### Task 5.2 — Slack/Teams Notification Config UI

**What:** Build a webhook configuration form in `/admin/settings/integrations`. Users can add a Slack or Teams webhook URL, label it, choose which events to receive (post published, approval pending, crisis mode, etc.), and test it. List of configured webhooks with delete action. Uses `externalNotificationRoutes.ts` endpoints.

**Why now:** XS-scope. Backend complete. High perceived value — teams expect Slack integration.

**Audit reference:** Domain 13 — Slack/Teams Notification UI

**Files to create:**

- `apps/admin/app/(dashboard)/settings/integrations/page.tsx` — Settings page
- `apps/admin/components/settings/ExternalNotificationConfigs.tsx` — List + form
- `apps/admin/components/settings/AddWebhookForm.tsx` — Add webhook dialog
- `apps/admin/hooks/api/useExternalNotifications.ts` — CRUD hooks

**Prisma changes:** None

**API contract:**

- `GET /api/backend/external-notifications?projectId=X` → `{ ok: true, value: ExternalNotificationConfig[] }`
  - `ExternalNotificationConfig`: `{ id, channel: 'slack'|'teams', webhookUrl, label, events: string[], createdAt }`
- `POST /api/backend/external-notifications` — Body: `{ projectId, channel, webhookUrl, label, events: string[] }`
- `DELETE /api/backend/external-notifications/:id`
- `POST /api/backend/external-notifications/:id/test` → `{ ok: true, value: { sent: boolean } }`

**UI specification:**

- Page route: `/admin/settings/integrations`
- Section header: "External Notifications" with "Add Webhook" button
- Existing configs: Table/list with: channel icon (Slack 🟢 / Teams 🔵), label, event count, Test button, Delete button
- "Add Webhook" dialog: Channel selector (Slack / Teams), label input, webhook URL input (HTTPS required), events checkboxes (post_published, approval_pending, crisis_mode, post_failed — at minimum)
- "Test" button: Sends test notification, shows "Test sent!" or error toast
- Delete: Confirmation dialog before delete

**Events to support:**
`post_published`, `post_failed`, `approval_pending`, `approval_approved`, `approval_rejected`, `crisis_mode_entered`, `crisis_mode_exited`

**Acceptance criteria:**

1. Page at `/admin/settings/integrations` renders configured webhooks
2. "Add Webhook" opens dialog with all required fields
3. Webhook URL validated as HTTPS before submit
4. At least 1 event must be selected (validation)
5. Test button fires test endpoint and shows result toast
6. Delete removes webhook with confirmation
7. Slack and Teams icons distinguish the channel type

**Tests required:**

- Unit: HTTPS validation rejects HTTP URLs — vitest
- Unit: At-least-1-event validation — vitest

**Estimated effort:** S (1-3d)

**Depends on:** Task 1.5 (proxy routes)

---

## PHASE 6 — RECURRING POSTS UI

### Why this phase comes here

Power-user feature. Backend is production-ready with BullMQ repeatable jobs. UI requires a cron expression interface — slightly more complex than previous phases, hence its own phase.

### Entry Gate

All Phase 5 exit gate conditions are true.

### Exit Gate

1. `/admin/scheduling/recurring` page accessible from scheduling section
2. User can create a recurring post with human-friendly recurrence selector
3. User can deactivate a recurring post
4. List shows all active recurring posts with next occurrence date

---

### Task 6.1 — Recurring Posts List Page

**What:** Create `/admin/scheduling/recurring` page listing all recurring posts for a project. Each item shows: name, channel(s), next occurrence, status (active/inactive), content variation type, actions (edit, deactivate).

**Why now:** Foundation for the create form (Task 6.2).

**Audit reference:** Domain 2 — Scheduling: Recurring Posts UI

**Files to create:**

- `apps/admin/app/(dashboard)/scheduling/recurring/page.tsx`
- `apps/admin/components/scheduling/RecurringPostsList.tsx`
- `apps/admin/components/scheduling/RecurringPostCard.tsx`
- `apps/admin/hooks/api/useRecurringPosts.ts`

**Files to modify:**

- `apps/admin/app/(dashboard)/scheduling/page.tsx` — Add link to `/scheduling/recurring`

**Prisma changes:** None

**API contract:**

- `GET /api/backend/recurring-posts?projectId=X` → `{ ok: true, value: RecurringPost[] }`
  - `RecurringPost`: `{ id, name, cronExpression, timezone, channels: string[], contentVariation, isActive, nextOccurrenceAt, maxOccurrences?, endDate? }`
- `DELETE /api/backend/recurring-posts/:id` — Deactivate

**UI specification:**

- Table: Name | Channels | Recurrence (human-readable from cron) | Next Occurrence | Status badge | Actions
- Cron → human: use `cronstrue` library (translate cron expression to English) — `pnpm --filter @apps/admin add cronstrue`
- Status badge: Active (green) / Inactive (gray)
- "Create Recurring Post" button → opens create form page
- Deactivate: `DELETE /recurring-posts/:id` with confirmation dialog

**Acceptance criteria:**

1. Page at `/admin/scheduling/recurring` renders list
2. Cron expression shown as human-readable (e.g., "Every Monday at 9:00 AM")
3. Deactivate button fires DELETE with confirmation
4. Active/Inactive status badge displays correctly

**Tests required:**

- Unit: Cron expression renders human-readable — vitest

**Estimated effort:** S (1-3d)

**Depends on:** Task 1.5

---

### Task 6.2 — Create/Edit Recurring Post Form

**What:** Form to create or edit a recurring post. Human-friendly recurrence selector (Daily / Weekly / Monthly / Custom cron). Channel selector, content variation type, optional max occurrences and end date.

**Audit reference:** Domain 2 — Scheduling: Recurring Posts UI

**Files to create:**

- `apps/admin/app/(dashboard)/scheduling/recurring/new/page.tsx`
- `apps/admin/app/(dashboard)/scheduling/recurring/[id]/edit/page.tsx`
- `apps/admin/components/scheduling/RecurringPostForm.tsx`
- `apps/admin/components/scheduling/RecurrenceSelector.tsx` — Friendly recurrence picker

**Prisma changes:** None

**API contract:**

- `POST /api/backend/recurring-posts` — Body:
  ```typescript
  {
    projectId: string;
    templatePostId: string;        // Reference post to repeat
    name: string;
    cronExpression: string;        // "0 9 * * 1" for every Monday at 9am
    timezone: string;              // "America/New_York"
    channels: string[];            // channelIds
    contentVariation: 'EXACT' | 'ROTATED' | 'AI_GENERATED';
    maxOccurrences?: number;
    endDate?: string;              // ISO date
  }
  ```
- `PATCH /api/backend/recurring-posts/:id` — Same body, partial

**UI specification:**

- RecurrenceSelector: Radio buttons: Daily / Weekly (day picker) / Monthly (day-of-month picker) / Custom (raw cron input)
- Frequency selection auto-generates the cron expression
- Timezone: Select from IANA timezone list (use `Intl.supportedValuesOf('timeZone')`)
- Content variation: Radio: Exact same content / Rotate from library / AI regenerate each time
- Template post: Search/select from existing posts (Combobox)
- Max occurrences: Optional number input
- End date: Optional date picker (use browser native `<input type="date">` for MVP)

**Acceptance criteria:**

1. "Daily" selection generates `0 {hour} * * *` cron
2. "Weekly" with Monday+Wednesday selected generates `0 {hour} * * 1,3`
3. "Custom" raw cron input validates before submit (use `cron-validator` package or regex)
4. Form submits POST with generated cron expression
5. Edit form pre-fills from existing recurring post data
6. Validation error shown when no channels selected

**Tests required:**

- Unit: Daily → correct cron expression — vitest
- Unit: Weekly multi-day → correct cron expression — vitest

**Estimated effort:** M (1-2w)

**Depends on:** Task 6.1

---

## PHASE 7 — PLATFORM PREVIEW EXTENSION

### Why this phase comes here

The platform preview is in the client app (not admin). It is independent of all admin UI work. Placed here to avoid interrupting the admin UI sprint.

### Entry Gate

All Phase 6 exit gate conditions are true.

### Exit Gate

1. `PlatformPreview.tsx` renders previews for all 9 providers
2. Each preview respects the platform's character limit and truncates correctly
3. Facebook, TikTok, YouTube previews show platform-specific UI conventions

---

### Task 7.1 — Extend PlatformPreview to All 9 Providers

**What:** Extend `apps/client/components/editor/PlatformPreview.tsx` to render platform-specific previews for the 6 currently missing providers: Facebook, TikTok, YouTube, Snapchat, Pinterest, Telegram. Each preview must reflect actual platform UI conventions and character limits.

**Why now:** Users cannot see how their content looks on 6 of 9 connected platforms. Core "preview before you post" value proposition is broken.

**Audit reference:** Domain 1 — Composer: Platform Preview for Missing Providers

**Files to modify:**

- `apps/client/components/editor/PlatformPreview.tsx` — Add 6 new platform renderers
- `apps/client/components/editor/platformPreviewUtils.ts` — Create or update with per-platform limit constants

**Platform specs to implement:**

**Facebook** (limit: 63,206 chars; optimal: 40-80)

- Preview: Card with Page avatar (circle) + page name + "Just now" + post text + image (if any) + Reaction bar (👍 Like · 💬 Comment · ↗️ Share)
- Truncate preview text at 400 chars with "See more" toggle

**TikTok** (limit: 4,000 chars for caption)

- Preview: Dark background, bottom-aligned overlay, caption text (white, left-aligned), username (@handle), hashtags highlighted in cyan, emoji support
- Vertical 9:16 video placeholder (if no media)

**YouTube** (title: 70 chars, description: up to 5000 chars shown)

- Preview: Video thumbnail placeholder (16:9 black rectangle with play button), video title (bold, max 70 chars, clipped), channel name, view count placeholder, description text (first 3 lines visible)

**Snapchat** (limit: 80 chars)

- Preview: Dark background, centered white text (large), snap timer icon, friend avatar top-left
- Show warning if text > 80 chars

**Pinterest** (limit: 200 chars optimal)

- Preview: 2:3 portrait image placeholder, pin title below (bold), description text (truncated at 200 chars), board name, Save button

**Telegram** (limit: 4,096 chars; media caption: 1,024 chars)

- Preview: Chat bubble style (white bubble on light gray bg, left-aligned), sender name (bold, colored), message text, timestamp bottom-right, "Delivered" indicator

**Acceptance criteria:**

1. Platform switcher buttons show all 9 providers
2. Facebook preview renders reaction bar with Like/Comment/Share
3. TikTok preview shows dark background with caption overlay
4. YouTube preview shows 16:9 placeholder + title (truncated at 70 chars)
5. Snapchat preview shows warning when caption > 80 chars
6. Pinterest preview shows 2:3 portrait layout
7. Telegram preview shows chat bubble UI
8. Existing X, Instagram, LinkedIn previews are unchanged
9. All previews compile with 0 TypeScript errors

**Tests required:**

- Unit: Each new platform renderer renders with correct structure — vitest + React Testing Library

**Estimated effort:** S (1-3d)

**Depends on:** NONE (client app; independent of admin UI phases)

---

## PHASE 8 — BLUESKY PROVIDER

### Why this phase comes here

New provider — requires both backend adapter and worker integration. Independent of all UI work. Placed after UI phases to maintain frontend momentum.

### Entry Gate

All Phase 7 exit gate conditions are true.

### Exit Gate

1. `packages/providers/bluesky/src/BlueskyAdapter.ts` exists
2. Bluesky provider appears in `ProviderRegistry`
3. A test post can be published end-to-end to a real Bluesky account (or verified via unit tests with mocked AtpAgent)
4. Provider capabilities object correctly declares `communityPosts: false`, `reels: false`, `stories: false`

---

### Task 8.1 — Bluesky Provider Package

**What:** Create `packages/providers/bluesky/` package following the exact pattern of existing providers (e.g., `packages/providers/x/`). Implement `BlueskyAdapter` extending `AbstractProviderAdapter`. Publish text posts, text+image posts, and link cards. Auth via App Password.

**Audit reference:** Domain 3 — Publishing: Bluesky Provider

**Files to create:**

- `packages/providers/bluesky/package.json`
- `packages/providers/bluesky/tsconfig.json`
- `packages/providers/bluesky/src/BlueskyAdapter.ts` — Main adapter
- `packages/providers/bluesky/src/BlueskyClient.ts` — AtpAgent wrapper
- `packages/providers/bluesky/src/BlueskyCapabilities.ts` — Provider capabilities
- `packages/providers/bluesky/src/index.ts` — Barrel export
- `packages/providers/bluesky/src/__tests__/BlueskyAdapter.test.ts`

**Library/API used:**

- `@atproto/api` v0.19.0 — `pnpm --filter @providers/bluesky add @atproto/api`
- Docs: https://docs.bsky.app/docs/advanced-guides/atproto

**API contract (internal):**

```typescript
// BlueskyAdapter implements ProviderAdapter
interface BlueskyCredentials {
  identifier: string;    // handle e.g. "user.bsky.social"
  appPassword: string;   // Format: xxxx-xxxx-xxxx-xxxx
}

// Capabilities
{
  maxTextLength: 300,
  supportsImages: true,
  maxImages: 4,
  supportsVideo: false,
  supportsStories: false,
  supportsReels: false,
  communityPosts: false,
  linkCards: true,
}
```

**Implementation notes:**

- `login()`: Call `agent.login({ identifier, password: appPassword })`
- Store `accessJwt` and `refreshJwt` in `ProviderConnection.credentials` (encrypted at rest — follow existing pattern)
- `publishPost()`: Use `agent.repo.putRecord()` with `app.bsky.feed.post` collection
- Text > 300 chars: Return `ValidationError` (do not truncate silently)
- Images: Upload via `agent.uploadBlob()`, max 4 images, then embed in post record
- Facets: Parse URLs in text and add `app.bsky.richtext.facet#link` facets automatically
- Token refresh: On 401, use `agent.refreshSession()` and retry once

**Acceptance criteria:**

1. `BlueskyAdapter` extends `AbstractProviderAdapter`
2. `publishPost({ text })` returns `ok({ externalId: string })` on success
3. Text > 300 chars returns `err(ValidationError)`
4. Image upload creates correct `embed.images` record
5. Invalid App Password returns `err(AuthError)` (not throws)
6. Provider capabilities object has all fields set

**Tests required:**

- Unit: Mock AtpAgent, verify `publishPost` calls correct methods — node:test
- Unit: Text > 300 chars returns ValidationError — node:test
- Coverage: ≥75% per CLAUDE.md provider requirement

**Estimated effort:** M (1-2w)

**Depends on:** NONE

---

### Task 8.2 — Register Bluesky in Worker + ProviderRegistry

**What:** Register `BlueskyAdapter` in the worker's `ProviderRegistry` (multi-provider registry pattern from existing workers). Add Bluesky to the `ProviderConnection` enum in Prisma.

**Audit reference:** Domain 3 — Publishing: Bluesky Provider

**Files to modify:**

- `apps/workers/src/providers/registry.ts` (or equivalent) — Add Bluesky import + registration
- `apps/api/src/infrastructure/container/Container.ts` — Register `BlueskyAdapter` in DI
- `infra/prisma/schema.prisma` — Add `BLUESKY` to `Provider` enum (if not already there)

**Prisma changes:**

```prisma
enum Provider {
  X
  INSTAGRAM
  FACEBOOK
  YOUTUBE
  TIKTOK
  SNAPCHAT
  TELEGRAM
  PINTEREST
  LINKEDIN
  BLUESKY  // ← add this
}
```

Migration: `pnpm db:migrate` — creates `20260310_add_bluesky_provider` migration

**Acceptance criteria:**

1. `Provider.BLUESKY` exists in Prisma enum
2. Migration runs without error
3. ProviderRegistry can resolve BlueskyAdapter for provider = 'BLUESKY'
4. Existing providers unaffected

**Tests required:**

- Unit: ProviderRegistry.get('BLUESKY') returns BlueskyAdapter instance — node:test

**Estimated effort:** S (1-3d)

**Depends on:** Task 8.1

---

### Task 8.3 — Bluesky OAuth Flow (App Password)

**What:** Add Bluesky to the channel connection UI in the client app. Bluesky uses App Password auth (not standard OAuth). The connection flow should: prompt for Bluesky handle + app password, validate credentials by calling the backend which calls `agent.login()`, then store encrypted credentials.

**Why:** Without a connection UI, users cannot connect their Bluesky accounts.

**Audit reference:** Domain 3 — Publishing: Bluesky Provider

**Files to modify:**

- `apps/client/components/providers/ProviderConnectionCard.tsx` (or equivalent) — Add Bluesky option with custom App Password form instead of OAuth redirect
- `apps/api/src/channels/channelRoutes.ts` — Add `POST /channels/bluesky/connect` endpoint that validates credentials and stores them

**UI specification:**

- Special UI note: "Bluesky uses App Passwords instead of OAuth. Generate one at bsky.app/settings/app-passwords"
- Form: Handle input (e.g., yourname.bsky.social) + App Password input (type="password")
- "Connect" button calls `POST /api/channels/bluesky/connect`
- On success: Channel connected state, shows handle
- Link: "Get an App Password →" links to Bluesky settings page

**Acceptance criteria:**

1. Bluesky appears in provider connection list
2. Clicking connect shows App Password form (not OAuth redirect)
3. Invalid credentials show error: "Invalid handle or App Password"
4. Valid credentials create a connected ProviderConnection with BLUESKY provider
5. App password is encrypted at rest (follow existing CredentialManager pattern)

**Estimated effort:** S (1-3d)

**Depends on:** Task 8.2

---

## PHASE 9 — ANALYTICS COMPLETENESS

### Entry Gate

All Phase 8 exit gate conditions are true.

### Exit Gate

1. `/admin/analytics/reports` page accessible with scheduled reports list
2. Create scheduled report form submits to `POST /api/reports`
3. GA4 adapter implementation confirmed or documented as explicitly missing
4. Aggregation worker cron schedule documented

---

### Task 9.1 — Scheduled Reports Management UI

**What:** Build the scheduled reports management panel in the analytics section. List active report schedules, create new schedules (frequency, metrics, email recipients), manual generate button.

**Audit reference:** Domain 7 — Analytics: Scheduled Reports UI

**Files to create:**

- `apps/admin/app/(dashboard)/analytics/reports/page.tsx`
- `apps/admin/components/analytics/ScheduledReportsList.tsx`
- `apps/admin/components/analytics/CreateReportForm.tsx`
- `apps/admin/hooks/api/useReports.ts`

**API contract:**

- `GET /api/backend/reports?projectId=X` → `{ ok: true, value: ScheduledReport[] }`
  - `ScheduledReport`: `{ id, name, cronSchedule, format: 'CSV'|'JSON', recipients: string[], createdAt }`
- `POST /api/backend/reports` — Body: `{ projectId, name, cronSchedule, recipients, format, filters? }`
- `DELETE /api/backend/reports/:id`
- `POST /api/backend/reports/:id/generate` — Manual trigger

**UI specification:**

- Table: Name | Schedule (human-readable cron via `cronstrue`) | Format | Recipients | Actions
- "Create Report" button → opens Dialog with form: name, cron (friendly picker + raw option), format (CSV/JSON), recipient emails (tag input)
- "Generate Now" button: Fires immediate report generation, shows "Report queued" toast
- Delete with confirmation

**Acceptance criteria:**

1. Page at `/admin/analytics/reports` renders report list
2. "Create Report" form submits POST with all required fields
3. Email validation on recipients field
4. "Generate Now" fires POST `/:id/generate` and shows toast
5. Delete removes report with confirmation

**Tests required:** Unit: email validation — vitest

**Estimated effort:** S (1-3d)

**Depends on:** Task 1.5

---

### Task 9.2 — GA4 Adapter Audit and Implementation

**What:** Determine if `GA4TrackingPort` has a concrete implementation. If not, implement `GA4MeasurementProtocolAdapter` using Google Analytics Measurement Protocol v2. Wire it to tracked link clicks (when `RedirectAndTrackClickUseCase` fires, the GA4 adapter should send an event).

**Audit reference:** Domain 7 — Analytics: GA4/UTM Integration

**Pre-task audit:**

```bash
grep -r "GA4TrackingPort\|GA4Adapter\|MeasurementProtocol" apps/ packages/ --include="*.ts" | grep -v node_modules | grep -v test
```

**Files to create (if no implementation found):**

- `packages/adapters/ga4/src/GA4MeasurementProtocolAdapter.ts`
- `packages/adapters/ga4/src/index.ts`
- `packages/adapters/ga4/package.json`

**Files to modify:**

- `apps/api/src/infrastructure/container/setupServices.ts` — Register GA4 adapter if not already registered
- `apps/api/src/application/links/RedirectAndTrackClickUseCase.ts` — Wire GA4 adapter call after click recorded

**Library/API used:**

- Google Analytics Measurement Protocol v2: `POST https://www.google-analytics.com/mp/collect?measurement_id=G-XXXX&api_secret=XXXX`
- No npm package needed — plain fetch

**Acceptance criteria:**

1. If implementation exists: document it (add JSDoc) and verify it fires on link click
2. If missing: New adapter calls Measurement Protocol on click event
3. GA4 `measurement_id` and `api_secret` read from environment variables: `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`
4. Missing credentials: adapter logs warning and returns without error (graceful degradation)

**Estimated effort:** S (1-3d)

**Depends on:** NONE

---

### Task 9.3 — Analytics Aggregation: 12-Month Retention Policy

**What:** Confirm that `analyticsAggregationWorker.ts` runs on a daily cron schedule. Add explicit 12-month retention policy: after aggregation, delete `AnalyticsDailySummary` records older than 365 days and archive to `AnalyticsMonthlySummary`. Document the retention policy.

**Audit reference:** Domain 7 — Analytics: 12-Month Historical Tracking

**Files to modify:**

- `apps/workers/src/analytics/analyticsAggregationWorker.ts` — Add retention cleanup step after aggregation
- `apps/workers/src/index.ts` — Verify repeatable job cron schedule (`0 2 * * *` = 2am daily)

**Prisma changes:** None (models already exist)

**Implementation:**

```typescript
// After daily aggregation completes:
const cutoffDate = new Date();
cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);

await prisma.analyticsDailySummary.deleteMany({
  where: { date: { lt: cutoffDate } },
});
```

**Acceptance criteria:**

1. Aggregation worker has a BullMQ repeatable job set to run daily (`every: 86400000` ms or cron `'0 2 * * *'`)
2. Worker deletes `AnalyticsDailySummary` records older than 365 days after each aggregation run
3. `AnalyticsMonthlySummary` records are preserved (not deleted)
4. Worker logs: "Retention cleanup: deleted N daily summaries older than 365 days"

**Tests required:** Unit: Retention cleanup deletes correct records — node:test

**Estimated effort:** XS (<1d)

**Depends on:** NONE

---

## PHASE 10 — API DOCUMENTATION

### Entry Gate

All Phase 9 exit gate conditions are true.

### Exit Gate

1. `GET /api/docs` returns a Scalar UI HTML page in the browser
2. All 41+ route files are reflected in the OpenAPI schema
3. Auth endpoints show the Bearer token requirement

---

### Task 10.1 — Swagger + Scalar API Documentation

**What:** Add `@fastify/swagger` and `@scalar/fastify-api-reference` to the API. Generate OpenAPI 3.1 schema from existing route definitions. Mount Scalar UI at `/api/docs`. Add schema definitions for common types (Notification, InboxConversation, Post, etc.).

**Audit reference:** Domain 13 — Interactive API Documentation

**Files to modify:**

- `apps/api/src/index.ts` — Register `@fastify/swagger` and `@scalar/fastify-api-reference` plugins before routes
- `apps/api/package.json` — Add `@fastify/swagger`, `@scalar/fastify-api-reference`

**Libraries:**

- `@fastify/swagger` — Current version: check `npm view @fastify/swagger version` before adding; ~9.x as of 2026
- `@scalar/fastify-api-reference` — Current version: ~1.x

**Installation:**

```bash
pnpm --filter @apps/api add @fastify/swagger @scalar/fastify-api-reference
```

**Implementation (in `index.ts`, before route registration):**

```typescript
import fastifySwagger from "@fastify/swagger";
import scalarPlugin from "@scalar/fastify-api-reference";

await fastify.register(fastifySwagger, {
  openapi: {
    openapi: "3.1.0",
    info: {
      title: "OmniPost API",
      version: "1.0.0",
      description: "Multi-channel social media CMS API",
    },
    servers: [{ url: "http://localhost:3000", description: "Development" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [{ bearerAuth: [] }],
  },
});

await fastify.register(scalarPlugin, {
  routePrefix: "/api/docs",
  configuration: { spec: { url: "/api/docs/json" } },
});
```

**Acceptance criteria:**

1. `GET http://localhost:3000/api/docs` returns Scalar UI HTML
2. `GET http://localhost:3000/api/docs/json` returns valid OpenAPI JSON
3. All route groups appear in the schema (inbox, notifications, approvals, etc.)
4. Bearer auth security requirement shown on protected endpoints
5. No breaking changes to existing routes

**Tests required:** Integration: GET /api/docs returns 200 — node:test

**Estimated effort:** S (1-3d)

**Depends on:** NONE (can be done any time, placed last as it has zero functional risk)

---

## PHASE 11 — HOMOLOGATE GAPS

### Entry Gate

All Phase 10 exit gate conditions are true.

### Exit Gate

1. CSV bulk upload works on BulkScheduleView
2. Calendar has platform + campaign + assignee filters
3. AI prompt templates stored in DB, user-editable
4. PostMedia model has tags field
5. Usage metering records posts/month per account

---

### Task 11.1 — Bulk Scheduling via CSV

**What:** Add CSV template download and bulk upload to the existing `BulkScheduleView.tsx`. CSV columns: `date,time,timezone,platform,copy,media_url,campaign`. Parse uploaded CSV, validate rows, and call `POST /api/scheduling/slots/bulk` for valid rows. Show per-row validation errors inline.

**Audit reference:** Domain 2 — Scheduling: Bulk Scheduling via CSV

**Files to create:**

- `apps/admin/components/scheduling/CSVBulkUpload.tsx` — Upload zone + results table
- `apps/admin/lib/csv/schedulingCsvParser.ts` — CSV parsing + validation

**Files to modify:**

- `apps/admin/components/scheduling/BulkScheduleView.tsx` — Add `<CSVBulkUpload />` section

**CSV column schema:**

```
date        YYYY-MM-DD
time        HH:MM (24h)
timezone    IANA timezone (e.g. America/New_York)
platform    x|instagram|facebook|youtube|tiktok|snapchat|telegram|pinterest|linkedin
copy        Post text (respect platform char limits)
media_url   Optional URL
campaign    Optional campaign name or ID
```

**Library:** `papaparse` v5 — `pnpm --filter @apps/admin add papaparse @types/papaparse`

**Acceptance criteria:**

1. "Download Template" button downloads `scheduling_template.csv` with headers + 2 example rows
2. File input accepts `.csv` files only
3. Parsed rows show in a preview table before submit
4. Rows with invalid date/time/platform show inline error (red row)
5. "Schedule All Valid Rows" button submits only valid rows via `useBulkCreateSchedules()` hook
6. Import results: "X of Y rows scheduled successfully"

**Estimated effort:** S (1-3d)

**Depends on:** Task 6.1 (same scheduling section)

---

### Task 11.2 — Calendar Multi-Dimension Filters

**What:** Add platform, campaign, and assignee filter pills to `SchedulingDashboardSidebar.tsx`. Existing filter model supports `platforms[]` but campaign and assignee filters are not wired. Add campaign selector (from existing Campaign API) and assignee selector (from existing Team API) to filter state and query params.

**Audit reference:** Domain 2 — Scheduling: Calendar Filtering

**Files to modify:**

- `apps/admin/components/scheduling/SchedulingDashboardSidebar.tsx` — Add Campaign + Assignee filter sections
- `apps/admin/components/scheduling/useSchedulingDashboard.ts` — Add `campaignId` and `assigneeId` to filter state
- `apps/admin/hooks/api/useScheduledPosts.ts` — Add `campaignId` and `assigneeId` to query params

**API contract (existing):**

- `GET /api/backend/campaigns?projectId=X` — List campaigns (already exists)
- `GET /api/backend/team?projectId=X` — List team members (already exists)

**Acceptance criteria:**

1. Campaign filter dropdown lists projects' campaigns
2. Selecting a campaign filters the calendar to show only that campaign's posts
3. Assignee filter dropdown lists team members
4. Selecting an assignee filters to posts assigned to them
5. Multiple filters can be active simultaneously
6. "Clear filters" button resets all filters

**Estimated effort:** S (1-3d)

**Depends on:** Task 6.1

---

### Task 11.3 — DB-Backed AI Prompt Library

**What:** Move AI prompt templates from `apps/admin/lib/ai-content-templates.ts` (hardcoded) to a Prisma `AIPromptTemplate` model. Add CRUD endpoints. UI: template library page where users can create, edit, and delete custom templates in addition to system templates.

**Audit reference:** Domain 6 — AI: Prompt Library (Make User-Editable)

**Prisma changes:**

```prisma
model AIPromptTemplate {
  id          String   @id @default(uuid())
  accountId   String?  // null = global system template
  name        String
  category    String
  platforms   String[] // array of platform strings
  prompt      String   @db.Text
  variables   Json     // TemplateVariable[] serialized
  tone        String[]
  isSystem    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  account     Account? @relation(fields: [accountId], references: [id])

  @@index([accountId])
}
```

Migration: `pnpm db:migrate`

**Files to create:**

- Use cases: `CreateAIPromptTemplateUseCase.ts`, `UpdateAIPromptTemplateUseCase.ts`, `DeleteAIPromptTemplateUseCase.ts`, `ListAIPromptTemplatesQuery.ts`
- Route: `apps/api/src/ai/promptTemplateRoutes.ts`
- UI: `apps/admin/app/(dashboard)/ai/templates/page.tsx`
- UI: `apps/admin/components/ai/PromptTemplateManager.tsx`

**Files to modify:**

- `apps/admin/components/ai/AITemplateSelector.tsx` — Load from API instead of hardcoded array
- Seed script: Move existing 6 hardcoded templates to DB seed as system templates

**Acceptance criteria:**

1. `GET /api/ai-templates?accountId=X` returns system templates + account-specific templates
2. Users can create a custom template via the UI form
3. System templates (isSystem=true) cannot be deleted by users
4. `AITemplateSelector` loads templates from API, not hardcoded array
5. Migration runs without error on existing data

**Estimated effort:** M (1-2w)

**Depends on:** Phase 1 complete

---

### Task 11.4 — Asset Library Media Tags

**What:** Add a `tags` string array field to the `PostMedia` model (or equivalent media model). Update `ContentLibrary` search to filter by tag. Allow users to add/remove tags on individual media items.

**Audit reference:** Domain 9 — Asset Library: Search and Tag Support

**Prisma changes:**

```prisma
// Find the existing media/PostMedia model and add:
tags  String[]  @default([])
```

**Files to modify:**

- `infra/prisma/schema.prisma` — Add `tags` field
- `apps/api/src/content/contentRoutes.ts` — Add `tags` to create/update endpoints; add `tags=` filter to list endpoint
- `apps/admin/components/content/library/FilterPanel.tsx` — Add tag filter input
- `apps/admin/components/content/library/ContentGridView.tsx` — Show tag chips on each item, click to edit tags

**Acceptance criteria:**

1. Migration adds `tags String[]` to media model
2. `GET /api/content?tags=marketing,q4` returns only media with those tags
3. Tags render as chips on media cards
4. Clicking a tag chip in the filter panel filters the library
5. Inline tag editor (click to add tag, X to remove) saves via PATCH

**Estimated effort:** S (1-3d)

**Depends on:** Phase 1 complete

---

### Task 11.6 — Wire Real Analytics Data to PredictOptimalTimingUseCase

**What:** Replace the rule-based heuristic inside `PredictOptimalTimingUseCase.ts` with real per-account analytics data. Read `AnalyticsDailySummary` records for the account grouped by hour-of-day and day-of-week, compute the average engagement rate per slot, and return the top 3 time slots. The use case already injects `AnalyticsReadRepository` — this is a pure implementation change inside the use case, no new endpoints needed.

**Why now:** Decision confirmed. Data already exists in `AnalyticsDailySummary`. The use case already reads `AnalyticsReadRepository`. The change is fully contained.

**Audit reference:** Domain 2 — Scheduling: Optimal Timing Prediction (DECIDE → resolved: wire real data)

**Files to modify:**

- `apps/api/src/application/ml/PredictOptimalTimingUseCase.ts` — Replace heuristic with aggregation query over `AnalyticsDailySummary`

**Prisma changes:** None (models already exist)

**Implementation approach:**

```typescript
// Query: group AnalyticsDailySummary by dayOfWeek + hour
// Compute: avg(engagementRate) per slot
// Return: top 3 slots sorted by avg engagement desc
// Fallback: if < 14 days of data, return generic heuristic slots with isEstimated: true
```

**Acceptance criteria:**

1. Use case reads `AnalyticsDailySummary` for the account via `AnalyticsReadRepository`
2. Returns top 3 time slots sorted by avg engagement rate descending
3. When account has < 14 days of data, returns generic heuristic with `isEstimated: true` flag in response
4. Response includes `sampleSize` (number of data points used) so the UI can show confidence
5. No `any` — fully typed
6. Unit tests updated to reflect new behavior

**Tests required:**

- Unit: With mock analytics data → returns correct top 3 slots — node:test
- Unit: With < 14 days data → returns heuristic with `isEstimated: true` — node:test

**Estimated effort:** S (1-3d)

**Depends on:** Task 9.3 (analytics aggregation worker must be running to have data)

---

### Task 11.7 — Brand Voice Profiles (System Prompt approach)

**What:** Add a per-account `BrandVoice` model storing a custom system prompt string injected into every AI request for that account. UI: a form in admin settings where account owners paste their brand voice description (tone, style, examples). Backend: a new `BrandVoice` model, CRUD use case, and injection into `AIService`.

**Why now:** Decision confirmed (system prompts). Unlocks meaningful AI personalization with S scope.

**Audit reference:** Domain 6 — AI: Brand Voice Profiles (DECIDE → resolved: system prompts)

**Prisma changes:**

```prisma
model BrandVoice {
  id          String   @id @default(uuid())
  accountId   String   @unique
  name        String
  systemPrompt String  @db.Text
  tone        String[]
  examples    String[] @db.Text
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  account     Account @relation(fields: [accountId], references: [id], onDelete: Cascade)
}
```

Migration: `pnpm db:migrate`

**Files to create:**

- `apps/api/src/domain/ai/BrandVoice.ts` — Domain entity
- `apps/api/src/application/ai/CreateBrandVoiceUseCase.ts`
- `apps/api/src/application/ai/UpdateBrandVoiceUseCase.ts`
- `apps/api/src/application/ai/GetBrandVoiceQuery.ts`
- Route additions to `apps/api/src/ai/routes.ts` — GET/POST/PUT `/ai/brand-voice`
- `apps/admin/app/(dashboard)/settings/brand-voice/page.tsx`
- `apps/admin/components/settings/BrandVoiceForm.tsx`

**Files to modify:**

- `apps/api/src/infrastructure/services/AIService.ts` — Before each generate call, load `BrandVoice` for the account and prepend `systemPrompt` to the OpenAI/Gemini request system message

**API contract:**

- `GET /api/backend/ai/brand-voice?accountId=X` → `{ ok: true, value: BrandVoice | null }`
- `POST /api/backend/ai/brand-voice` — Body: `{ accountId, name, systemPrompt, tone: string[], examples: string[] }`
- `PUT /api/backend/ai/brand-voice/:id` — Same body, partial

**UI specification:**

- Page route: `/admin/settings/brand-voice`
- Form fields: Name (text), System prompt textarea (min 50 chars recommended, show example), Tone chips (Professional / Casual / Witty / Authoritative / Friendly), Example posts (up to 3 textarea inputs)
- Helper text: "This prompt is prepended to every AI content generation request for your account"
- Save button: Updates or creates brand voice
- Preview: "Test" button sends a sample generate request with brand voice applied, shows result inline

**Acceptance criteria:**

1. `BrandVoice` model created in schema and migration runs cleanly
2. `GET /ai/brand-voice?accountId=X` returns existing brand voice or null
3. Saving form creates/updates brand voice
4. `AIService` injects `systemPrompt` into every AI call when `BrandVoice` exists for the account
5. When no brand voice configured, AI requests are unchanged (graceful no-op)
6. System prompt max 2000 chars (validated on API)

**Tests required:**

- Unit: AIService injects systemPrompt when BrandVoice present — node:test
- Unit: AIService sends no systemPrompt when BrandVoice absent — node:test

**Estimated effort:** S (1-3d) backend + S (1-3d) UI = M total

**Depends on:** Phase 1 complete

---

### Task 11.5 — Usage Metering per Tier

**What:** Add a `UsageMetric` model that tracks posts/month, AI calls/month, storage GB, and team members per account per month. Increment on each billable event. Add `GET /accounts/:id/usage` endpoint. Show usage bar in admin settings.

**Audit reference:** Domain 12 — Multi-Tenant: Detailed Usage Metering

**Prisma changes:**

```prisma
model UsageMetric {
  id            String   @id @default(uuid())
  accountId     String
  periodYear    Int
  periodMonth   Int      // 1-12
  postsPublished   Int   @default(0)
  aiCallsMade      Int   @default(0)
  storageGb        Float @default(0)
  teamMemberCount  Int   @default(0)
  updatedAt     DateTime @updatedAt

  account       Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, periodYear, periodMonth])
  @@index([accountId, periodYear, periodMonth])
}
```

**Files to create:**

- `apps/api/src/application/usage/IncrementUsageUseCase.ts`
- `apps/api/src/application/usage/GetUsageUseCase.ts`
- Route: add to `subscriptionRoutes.ts` or new `usageRoutes.ts`

**Files to modify:**

- `CreatePostUseCase.ts` — Call `IncrementUsageUseCase` after successful post publish
- `GenerateImageUseCase.ts` — Increment `aiCallsMade` after generation
- Admin settings page — Add usage bar component

**Acceptance criteria:**

1. `UsageMetric` row created/updated on each post publish
2. `GET /accounts/:id/usage?year=2026&month=3` returns current month metrics
3. Admin settings shows usage bars: Posts (X of Y), AI Calls (X of Y), Storage (X of Y GB)
4. Metrics reset conceptually each month (new row per month; old rows preserved)

**Estimated effort:** M (1-2w)

**Depends on:** Phase 1 complete

---

## APPENDIX A — OUT OF SCOPE (DEFER)

> **Post-implementation review:** Once this plan is complete, review this list as candidates for the next sprint. Target file for that review: `.planning/NEXT_SPRINT_BACKLOG.md` (create at plan completion).

The following capabilities from the audit are explicitly excluded from this plan. They are not silently omitted.

| Capability                            | Domain | Reason                                                                                             |
| ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Emoji Picker                          | D1     | Low priority; OS paste works. Add post-launch.                                                     |
| Canva/Adobe Express Integration       | D1     | Partnership/API approval required.                                                                 |
| @Mention Autocomplete                 | D1     | Requires Social Inbox contact data first.                                                          |
| Social Listening (keyword monitoring) | D5     | Confirmed defer. Post-launch backlog. Platform APIs rate-limited; not worth the effort for launch. |
| Sentiment Analysis                    | D5     | Blocked on Social Listening.                                                                       |
| Competitor Tracking                   | D5     | XL scope, requires external data.                                                                  |
| Custom Report Builder                 | D7     | L scope; static dashboards cover 90% of need.                                                      |
| Industry Benchmark Data               | D7     | Requires large account base or paid license.                                                       |
| Multi-Level Approval Chains           | D8     | Enterprise-only. Build after single-level proven.                                                  |
| Task Assignment                       | D8     | Confirmed defer. Approval workflow covers team coordination needs for launch.                      |
| Employee Advocacy                     | D10    | Confirmed defer. XL scope, enterprise-only. Not in target market for current phase.                |
| Brand Kit (Colors, Fonts, Logos)      | D9     | M scope; no BrandKit model. Post-launch.                                                           |
| Google Drive/Dropbox Import           | D9     | Convenience feature. Not blocking.                                                                 |
| Post Boosting (Social Advertising)    | D11    | Confirmed defer. Meta API approval timeline unknown. Cannot plan around it.                        |
| Full Ad Management                    | D11    | Separate product category. XL scope.                                                               |
| SSO / SAML / OIDC                     | D12    | Enterprise-only. Add when first customer requires.                                                 |
| CRM Integration                       | D13    | Enterprise feature. L scope per CRM.                                                               |
| Zapier / Make Connector               | D13    | Depends on API docs (Phase 10). Post-launch.                                                       |
| Integration Marketplace               | D13    | Premature until 10+ integrations exist.                                                            |
| Internal Notes on Conversations       | D4     | New Prisma model needed. Add to Phase 11 backlog.                                                  |

---

## APPENDIX B — REMOVE (DEAD CODE)

| Item                              | File                                                            | Task     |
| --------------------------------- | --------------------------------------------------------------- | -------- |
| PredictAudienceResponseUseCase    | `apps/api/src/application/ml/PredictAudienceResponseUseCase.ts` | Task 1.1 |
| TikTok createPromotedContent stub | `packages/providers/tiktok/src/marketingApiClient.ts`           | Task 1.2 |
| YouTube publishCommunityPost stub | `packages/providers/youtube/src/YouTubeAdapter.ts`              | Task 1.3 |

---

## PLAN METRICS

| Metric                                 | Value                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total tasks                            | 30                                                                                                                                                                                                                     |
| Total estimated effort                 | ~18-26 weeks (1 developer)                                                                                                                                                                                             |
| Capabilities addressed                 | 23 IMPLEMENT/HOMOLOGATE + 2 DECIDE resolved as IMPLEMENT                                                                                                                                                               |
| DECIDE items pending                   | 0 (all 6 resolved)                                                                                                                                                                                                     |
| REMOVE tasks                           | 3 (Phase 1)                                                                                                                                                                                                            |
| New Prisma models required             | 4 (AIPromptTemplate, UsageMetric, BrandVoice, Bluesky enum value)                                                                                                                                                      |
| New Prisma fields                      | 1 (PostMedia.tags)                                                                                                                                                                                                     |
| New API endpoints required             | ~16 (promptTemplates CRUD, usage, bluesky connect, ga4 adapter, brand-voice CRUD, optimal-timing update)                                                                                                               |
| New frontend pages required            | 13 (inbox, approvals, settings/notifications, settings/integrations, ai/templates, ai/brand-voice, analytics/reports, scheduling/recurring, scheduling/recurring/new, scheduling/recurring/[id]/edit, plus expansions) |
| Audit score at plan completion         | ~82-85% (from ~49%)                                                                                                                                                                                                    |
| Pending DECIDE decisions blocking plan | 0                                                                                                                                                                                                                      |

---

## VERIFICATION PROTOCOL (per phase)

Each phase is verified as follows:

1. Run `pnpm build` — must complete with 0 errors
2. Run `pnpm lint` — must complete with 0 errors, 0 warnings
3. Run `pnpm --filter @apps/api test` — must show 0 cancelled, 0 failed
4. Run `pnpm --filter @apps/admin test` — 0 failed
5. Manually verify each exit gate condition listed in the phase header
6. Phase is CLOSED only when ALL conditions in the exit gate are literally true
