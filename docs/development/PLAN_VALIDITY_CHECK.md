# Master Development Plan — Validity Check

Date: 2026-03-25
Plan generated: 2026-03-10
Checked after: Testing Sessions A-F (2026-03-25)

---

## Overall Verdict

**PLAN NEEDS SIGNIFICANT REVISION — Phases 1-4 are largely already implemented.**

The codebase advanced significantly between plan generation (2026-03-10) and this check (2026-03-25). Phases 1-4 UI components, backend endpoints, and infrastructure are already in place. The plan should be revised to start from Phase 5 (Quick Wins) or focus on integration testing and polishing existing implementations.

---

## Phase 1 Task Status

| Task                                      | Plan Says                                     | Current State                                                                                           | Action |
| ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| 1.1 Remove PredictAudienceResponseUseCase | File exists, needs removal                    | ALREADY DONE — no files or references found                                                             | Skip   |
| 1.2 TikTok createPromotedContent          | Logs message, needs throw                     | ALREADY DONE — throws NOT_IMPLEMENTED with @deprecated JSDoc                                            | Skip   |
| 1.3 YouTube publishCommunityPost          | Returns err("VALIDATION"), needs OUT_OF_SCOPE | ALREADY DONE — has OUT_OF_SCOPE comment, communityPosts: false, returns clear error message             | Skip   |
| 1.4 Notification Zustand store            | Does not exist                                | ALREADY DONE — `apps/admin/lib/stores/notificationStore.ts` exists with full interface (Zustand 5.0.11) | Skip   |
| 1.5 Admin proxy routes                    | Needs verification                            | ALREADY DONE — catch-all proxy at `apps/admin/app/api/backend/[...path]/route.ts` handles all paths     | Skip   |

**Phase 1 verdict: 5/5 tasks ALREADY DONE. Skip entire phase.**

---

## Phase 2 Backend Dependencies

| Dependency                               | Expected | Actual                                                                | Plan Valid? |
| ---------------------------------------- | -------- | --------------------------------------------------------------------- | ----------- |
| Notification SSE endpoint                | EXISTS   | EXISTS (webhook broadcaster infra; notification-specific SSE partial) | Partial     |
| GET /notifications endpoint              | EXISTS   | EXISTS — notificationRoutes.ts with pagination                        | Yes         |
| PATCH /notifications/:id/read            | EXISTS   | EXISTS — mark single read                                             | Yes         |
| POST /notifications/mark-all-read        | EXISTS   | EXISTS — mark all read                                                | Yes         |
| Notification entity with type/title/body | EXISTS   | EXISTS — Notification.ts, NotificationType.ts, NotificationId.ts      | Yes         |

**Phase 2 UI Status:**

- NotificationBell.tsx: **EXISTS** — integrated in dashboard layout
- NotificationItem.tsx: **EXISTS**
- NotificationPreferences.tsx: **EXISTS**
- useNotificationStream.ts: **EXISTS** — SSE hook with test
- Notification preferences page: **EXISTS** at `/admin/settings/notifications`

**Phase 2 verdict: ALL UI components and backend already implemented. Skip entire phase.**

---

## Phase 3 Backend Dependencies

| Dependency                                 | Expected | Actual                                                         | Plan Valid? |
| ------------------------------------------ | -------- | -------------------------------------------------------------- | ----------- |
| GET /api/inbox                             | EXISTS   | EXISTS — inboxRoutes.ts                                        | Yes         |
| GET /api/inbox/unread-count                | EXISTS   | EXISTS                                                         | Yes         |
| POST /api/inbox/messages/:id/reply         | EXISTS   | EXISTS — SendReplyUseCase (provider call deferred to "Step 7") | Partial     |
| PATCH /api/inbox/conversations/:id/resolve | EXISTS   | EXISTS — ResolveConversationUseCase                            | Yes         |
| GET /api/inbox/mentions                    | EXISTS   | EXISTS — GetMentionsQuery                                      | Yes         |

**Phase 3 UI Status:**

- InboxLayout.tsx: **EXISTS**
- InboxSidebar.tsx: **EXISTS**
- ConversationList.tsx: **EXISTS**
- ConversationCard.tsx: **EXISTS**
- ConversationThread.tsx: **EXISTS**
- ConversationHeader.tsx: **EXISTS**
- MessageBubble.tsx: **EXISTS**
- ReplyComposer.tsx: **EXISTS**
- Inbox page at `/admin/inbox`: **EXISTS**

**Phase 3 verdict: ALL 8 UI components and backend already implemented. Skip entire phase.** Note: SendReplyUseCase needs provider API wiring (deferred "Step 7").

---

## Phase 4 Backend Dependencies

| Dependency                            | Expected | Actual                                                   | Plan Valid? |
| ------------------------------------- | -------- | -------------------------------------------------------- | ----------- |
| POST /api/posts/:id/submit-for-review | EXISTS   | EXISTS — SubmitForReviewUseCase                          | Yes         |
| GET /api/approvals/pending            | EXISTS   | EXISTS — GetPendingApprovalsQuery                        | Yes         |
| POST /api/approvals/:id/approve       | EXISTS   | EXISTS — ApprovePostUseCase                              | Yes         |
| POST /api/approvals/:id/reject        | EXISTS   | EXISTS — RejectPostUseCase + GetApprovalHistoryQuery     | Yes         |
| PublishStatus.PENDING_REVIEW          | EXISTS   | EXISTS — line 16 of PublishStatus.ts, full state machine | Yes         |

**Phase 4 UI Status:**

- ApprovalCard.tsx: **EXISTS**
- ApprovalQueue.tsx: **EXISTS**
- ReviewPanel.tsx: **EXISTS**
- SubmitForReviewButton.tsx: **EXISTS**
- Approvals page at `/admin/approvals`: **EXISTS**

**Phase 4 verdict: ALL UI components and backend already implemented. Skip entire phase.**

---

## Tech Stack Assumptions

| Assumption        | Plan Expected | Current                                                        | Match?               |
| ----------------- | ------------- | -------------------------------------------------------------- | -------------------- |
| Next.js (admin)   | Current       | 16.1.6                                                         | Yes                  |
| Next.js (client)  | Current       | 16.1.6                                                         | Yes                  |
| Fastify 5.x       | Current       | 5.6.1                                                          | Yes                  |
| TanStack Query v5 | Installed     | 5.90.2                                                         | Yes                  |
| Zustand           | Installed     | 5.0.11 (apps/admin)                                            | Yes                  |
| shadcn/ui         | Available     | In packages/ui/src/components/ (not apps/admin/components/ui/) | Yes (different path) |
| lucide-react      | Installed     | 0.544.0                                                        | Yes                  |
| date-fns          | Installed     | 4.1.0                                                          | Yes                  |

---

## Pages That Must Not Exist Yet (per plan)

| Page                  | Plan Expected  | Actual State                   | Impact          |
| --------------------- | -------------- | ------------------------------ | --------------- |
| /admin/inbox          | Does not exist | **EXISTS** with 8 components   | Phase 3 is DONE |
| /admin/approvals      | Does not exist | **EXISTS** with 4 components   | Phase 4 is DONE |
| NotificationBell      | Does not exist | **EXISTS** in dashboard layout | Phase 2 is DONE |
| SSE notification hook | Does not exist | **EXISTS** with test file      | Phase 2 is DONE |

---

## Build and Test State

| Metric            | Expected | Actual     |
| ----------------- | -------- | ---------- |
| TypeScript errors | 0        | 0          |
| Test failures     | 0        | 0          |
| API tests         | —        | 6,401 pass |
| Admin tests       | —        | 136 pass   |
| Client tests      | —        | 353 pass   |

---

## Impact of Testing Sessions on Plan

Changes made during testing sessions A-F that affect the plan:

1. **Phase 1 dead code**: All 3 items already cleaned during provider audit sessions
2. **Notification store**: Created during Phase 1 implementation (pre-testing sessions)
3. **UI components**: All Phase 2-4 UI components were built before testing sessions began
4. **fastify-plugin**: Added to cache-redis adapter in Session A2
5. **aws-sdk-client-mock**: Added to storage-s3 in Session A2
6. **61 Stryker configs**: Created across sessions B-F
7. **~1,266 new tests**: Written across all sessions
8. **Nightly CI**: Stryker step added, Node 24 pinned in Session F5-F6

---

## Recommended Adjustments

### Skip Phases 1-4 entirely

All tasks are implemented. No execution needed.

### Remaining open items from Phases 1-4:

1. **SendReplyUseCase provider wiring** — backend creates reply record but doesn't call provider API yet. Needs `providerAdapter.postReply()` integration.
2. **Notification SSE** — webhook broadcaster infrastructure exists but notification-specific SSE may need dedicated implementation or verification.

### Resume from Phase 5:

The plan should resume at **Phase 5 (Quick Wins)** which covers:

- AI Image Generation UI
- Slack/Teams notification dispatch UI
- Comments on posts UI

### Verify Phases 5-11 assumptions before executing:

Each remaining phase should get a similar validity check before execution.

---

## Gate for Proceeding

- [x] Build passes (0 TypeScript errors)
- [x] All tests pass (0 failures)
- [x] Phase 2/3/4 pages already exist (**plan assumption invalidated**)
- [x] All backend dependencies for Phase 2-4 confirmed present
- [ ] Plan revised to skip Phases 1-4 and start from Phase 5
