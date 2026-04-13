# OmniPost -- Notifications, Inbox, Comments & Approvals API Reference

## Overview

This document covers the notification and communication subsystems of OmniPost: in-app notifications with SSE real-time streaming, the Social Inbox for managing inbound messages across platforms, threaded in-context comments on posts, content approval workflows, external notification integrations (Slack/Teams), and first-comment scheduling. All API routes delegate to application-layer use cases via DI, following hexagonal architecture.

---

## 1. Notifications

### API Routes

**File:** `apps/api/src/notifications/notificationRoutes.ts`
**Type:** Fastify plugin
**Description:** Registers notification management endpoints with cursor pagination, SSE streaming, preferences management, and CRUD operations. All operations delegate to DI-resolved use cases.

| Method  | Endpoint                       | Description                                                                |
| ------- | ------------------------------ | -------------------------------------------------------------------------- |
| `GET`   | `/notifications`               | List notifications with cursor pagination (limit 1-100, unreadOnly filter) |
| `GET`   | `/notifications/unread-count`  | Get unread notification count for authenticated user                       |
| `PATCH` | `/notifications/:id/read`      | Mark a single notification as read                                         |
| `POST`  | `/notifications/mark-all-read` | Mark all notifications as read for authenticated user                      |
| `POST`  | `/notifications`               | Create a new notification (internal/admin use)                             |
| `GET`   | `/notifications/preferences`   | Get notification type preferences                                          |
| `PUT`   | `/notifications/preferences`   | Update notification type preferences (array of type/enabled pairs)         |
| `GET`   | `/notifications/stream`        | SSE endpoint for real-time notification delivery                           |

**Auth:** All endpoints require `requireClientAuth`.
**Has JSDoc:** Yes

### NotificationBroadcaster

**File:** `apps/api/src/services/NotificationBroadcaster.ts`
**Type:** service class
**Description:** SSE broadcaster for real-time notification delivery. Uses Redis pub/sub for cross-server communication and in-memory subscriptions for local SSE connections. Supports subscribe, unsubscribe, broadcast, and heartbeat management.

| Export                     | Type      | Description                                                             |
| -------------------------- | --------- | ----------------------------------------------------------------------- |
| `NotificationBroadcaster`  | class     | Manages SSE subscriptions and Redis pub/sub for real-time notifications |
| `NotificationEventPayload` | interface | Payload shape for notification SSE events                               |

**Has JSDoc:** Yes

### Application Use Cases

**File:** `apps/api/src/application/notifications/CreateNotificationUseCase.ts`
**Type:** use case
**Description:** Creates a new notification aggregate and persists it transactionally.

**File:** `apps/api/src/application/notifications/GetNotificationsQuery.ts`
**Type:** query
**Description:** Fetches paginated notifications for a recipient.

**File:** `apps/api/src/application/notifications/MarkNotificationReadUseCase.ts`
**Type:** use case
**Description:** Marks a single notification as read. Also exports `MarkAllNotificationsReadUseCase`.

**File:** `apps/api/src/application/notifications/GetUnreadCountQuery.ts`
**Type:** query
**Description:** Returns unread notification count for a recipient.

**File:** `apps/api/src/application/notifications/SendEmailNotificationService.ts`
**Type:** service
**Description:** Sends email notifications for supported notification types.

**File:** `apps/api/src/application/notifications/handlers/NotificationEventHandlers.ts`
**Type:** event handlers
**Description:** Domain event handlers that create notifications in response to domain events (approvals, comments, mentions).

### Client Components

#### NotificationBell

**File:** `apps/client/components/notifications/NotificationBell.tsx`
**Type:** component
**Description:** Notification bell icon with unread badge, Radix popover dropdown listing recent notifications, "Mark all read" action. Integrates with Zustand notification store and TanStack Query. Starts SSE stream via `useNotificationStream`.

| Export             | Type      | Description                                                 |
| ------------------ | --------- | ----------------------------------------------------------- |
| `NotificationBell` | component | Bell icon with unread count badge and notification dropdown |

**Has JSDoc:** Yes

#### NotificationItem

**File:** `apps/client/components/notifications/NotificationItem.tsx`
**Type:** component
**Description:** Single notification row in the bell dropdown. Shows colored type dot, title, truncated body, time-ago, and navigates to the relevant resource on click. Color-coded by notification type (APPROVAL_REQUESTED, POST_APPROVED, POST_REJECTED, COMMENT_ADDED, COMMENT_REPLY, MENTION).

| Export             | Type      | Description                                               |
| ------------------ | --------- | --------------------------------------------------------- |
| `NotificationItem` | component | Single notification row with type coloring and navigation |

**Has JSDoc:** Yes

#### NotificationPreferences

**File:** `apps/client/components/notifications/NotificationPreferences.tsx`
**Type:** component
**Description:** Notification preferences form with toggles for each notification type (approvals, comments, mentions). Persists via PUT /notifications/preferences. Uses TanStack Query for fetch/save.

| Export                    | Type      | Description                                   |
| ------------------------- | --------- | --------------------------------------------- |
| `NotificationPreferences` | component | Toggle form for notification type preferences |

**Has JSDoc:** Yes

### Client Hooks

#### useNotificationStream

**File:** `apps/client/hooks/useNotificationStream.ts`
**Type:** hook
**Description:** Opens a persistent SSE EventSource connection to the backend notification stream. Handles automatic reconnection on error (3s delay) and dispatches incoming events to the Zustand notification store. Connects directly to `NEXT_PUBLIC_API_URL` (bypasses Next.js proxy due to SSE buffering).

| Export                  | Type | Description                                           |
| ----------------------- | ---- | ----------------------------------------------------- |
| `useNotificationStream` | hook | SSE real-time notification stream with auto-reconnect |

**Has JSDoc:** Yes

---

## 2. Social Inbox

### API Routes

**File:** `apps/api/src/inbox/inboxRoutes.ts`
**Type:** Fastify plugin
**Description:** Registers Social Inbox endpoints covering conversation listing, unread counts, mentions, message lifecycle (read, archive, assign, reply), conversation lifecycle (resolve, reopen), and provider comment synchronization. All with cursor-based pagination.

| Method  | Endpoint                                | Description                                                                             |
| ------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`   | `/api/inbox`                            | List inbox messages with filters (provider, channelId, messageType, status, assigneeId) |
| `GET`   | `/api/inbox/unread-count`               | Get unread message count, optionally filtered by project                                |
| `GET`   | `/api/inbox/mentions`                   | List mention messages with cursor pagination                                            |
| `GET`   | `/api/inbox/conversations/:id`          | Get conversation by ID                                                                  |
| `GET`   | `/api/inbox/conversations/:id/messages` | Get conversation messages with cursor pagination                                        |
| `PATCH` | `/api/inbox/messages/:id/read`          | Mark message as read                                                                    |
| `PATCH` | `/api/inbox/messages/:id/archive`       | Archive a message                                                                       |
| `PATCH` | `/api/inbox/messages/:id/assign`        | Assign message to team member                                                           |
| `POST`  | `/api/inbox/messages/:id/reply`         | Send reply to a message                                                                 |
| `PATCH` | `/api/inbox/conversations/:id/resolve`  | Resolve a conversation                                                                  |
| `PATCH` | `/api/inbox/conversations/:id/reopen`   | Reopen a resolved conversation                                                          |
| `POST`  | `/api/inbox/sync/:channelId`            | Trigger provider comment synchronization for a channel                                  |

**Auth:** All endpoints require `requireClientAuth`.
**Has JSDoc:** Yes

### Conversation Notes API Routes

**File:** `apps/api/src/inbox/conversationNoteRoutes.ts`
**Type:** Fastify plugin
**Description:** CRUD endpoints for internal conversation notes. Supports listing, adding, and soft-deleting notes on conversations. Only the author may delete their own notes.

| Method   | Endpoint                                                 | Description                            |
| -------- | -------------------------------------------------------- | -------------------------------------- |
| `GET`    | `/api/inbox/conversations/:id/notes`                     | List notes for a conversation          |
| `POST`   | `/api/inbox/conversations/:id/notes`                     | Add a conversation note (1-5000 chars) |
| `DELETE` | `/api/inbox/conversations/:conversationId/notes/:noteId` | Soft-delete a note (author only)       |

**Has JSDoc:** Yes

### Client Components

#### InboxLayout

**File:** `apps/client/components/inbox/InboxLayout.tsx`
**Type:** component
**Description:** Two-panel inbox layout. Left panel: filter sidebar + conversation list. Right panel: conversation thread or empty state. Manages filter state and selected conversation ID.

| Export        | Type      | Description                                |
| ------------- | --------- | ------------------------------------------ |
| `InboxLayout` | component | Main inbox container with two-panel layout |

**Has JSDoc:** Yes

#### InboxSidebar

**File:** `apps/client/components/inbox/InboxSidebar.tsx`
**Type:** component
**Description:** Filter sidebar for the Social Inbox with platform pills (9 providers + all), status filters (Open, Resolved, Archived, All), and message type filters (All, Mentions, Comments).

| Export         | Type      | Description                                          |
| -------------- | --------- | ---------------------------------------------------- |
| `InboxSidebar` | component | Filter sidebar with platform, status, and type pills |
| `InboxFilters` | interface | Filter state shape (provider, status, messageType)   |

**Has JSDoc:** Yes

#### ConversationList

**File:** `apps/client/components/inbox/ConversationList.tsx`
**Type:** component
**Description:** Virtualized conversation list with infinite scroll using IntersectionObserver. Supports switching between conversations and mentions queries based on active filters.

| Export             | Type      | Description                                                 |
| ------------------ | --------- | ----------------------------------------------------------- |
| `ConversationList` | component | Infinite-scroll conversation list with IntersectionObserver |

**Has JSDoc:** Yes

#### ConversationCard

**File:** `apps/client/components/inbox/ConversationCard.tsx`
**Type:** component
**Description:** Single conversation row showing platform badge, sender name, message preview, relative time, unread dot, priority indicator, and message type badge (COMPLAINT, LEAD, QUESTION, SPAM, FEEDBACK).

| Export             | Type      | Description                                               |
| ------------------ | --------- | --------------------------------------------------------- |
| `ConversationCard` | component | Single conversation row with platform and priority badges |

**Has JSDoc:** Yes

#### ConversationThread

**File:** `apps/client/components/inbox/ConversationThread.tsx`
**Type:** component
**Description:** Conversation thread panel showing message list, auto-scrolls to bottom, marks unread inbound messages as read on open, and mounts ReplyComposer at the bottom. Supports AI suggested reply forwarding.

| Export               | Type      | Description                                                |
| -------------------- | --------- | ---------------------------------------------------------- |
| `ConversationThread` | component | Full conversation thread with auto-read and reply composer |

**Has JSDoc:** Yes

#### ConversationHeader

**File:** `apps/client/components/inbox/ConversationHeader.tsx`
**Type:** component
**Description:** Header bar for conversation thread showing platform name, sender, status badge, and Resolve/Reopen button.

| Export               | Type      | Description                                     |
| -------------------- | --------- | ----------------------------------------------- |
| `ConversationHeader` | component | Conversation header with resolve/reopen actions |

**Has JSDoc:** Yes

#### MessageBubble

**File:** `apps/client/components/inbox/MessageBubble.tsx`
**Type:** component
**Description:** Single message row. INBOUND: left-aligned gray bubble with initials avatar. OUTBOUND: right-aligned blue bubble. Shows AI suggested reply chips for inbound messages.

| Export          | Type      | Description                                                   |
| --------------- | --------- | ------------------------------------------------------------- |
| `MessageBubble` | component | Chat bubble with direction-aware alignment and AI reply chips |

**Has JSDoc:** Yes

#### ReplyComposer

**File:** `apps/client/components/inbox/ReplyComposer.tsx`
**Type:** component
**Description:** Inline reply composer with character counter (2000 max, warning at 1800), provider capability check (x, instagram, facebook, youtube, linkedin supported), auto-resize textarea, Ctrl+Enter to send, and suggested text pre-fill support.

| Export          | Type      | Description                                                    |
| --------------- | --------- | -------------------------------------------------------------- |
| `ReplyComposer` | component | Reply textarea with char counter and provider capability check |

**Has JSDoc:** Yes

### Client Hook: useInbox

**File:** `apps/client/hooks/api/useInbox.ts`
**Type:** hook module
**Description:** TanStack Query hooks for Social Inbox data. Covers conversation list (infinite query), unread count, conversation detail, messages (infinite), and mutations (reply, resolve, reopen, assign, mark read).

| Export                    | Type | Description                                                       |
| ------------------------- | ---- | ----------------------------------------------------------------- |
| `useInboxConversations`   | hook | Infinite query for paginated inbox conversations with filters     |
| `useMentions`             | hook | Infinite query for mentions, optionally filtered by project       |
| `useConversation`         | hook | Single conversation query by ID                                   |
| `useConversationMessages` | hook | Infinite query for conversation messages                          |
| `useSendReply`            | hook | Mutation to send a reply to a message                             |
| `useResolveConversation`  | hook | Mutation to resolve a conversation                                |
| `useReopenConversation`   | hook | Mutation to reopen a conversation                                 |
| `useAssignMessage`        | hook | Mutation to assign a message to a team member                     |
| `useMarkMessageRead`      | hook | Mutation to mark a message as read                                |
| `ConversationListItem`    | type | Shape of a conversation in the list                               |
| `Conversation`            | type | Full conversation shape                                           |
| `Message`                 | type | Shape of a message (with suggestedReplies, priority, messageType) |

**Has JSDoc:** Yes

---

## 3. Comments

### API Routes

**File:** `apps/api/src/comments/commentRoutes.ts`
**Type:** Fastify plugin
**Description:** In-context comment endpoints supporting threaded comments with cursor-based pagination. Supports create (with optional parentId for replies), list (with parentOnly filter), edit, and soft-delete.

| Method   | Endpoint                  | Description                                                     |
| -------- | ------------------------- | --------------------------------------------------------------- |
| `POST`   | `/posts/:postId/comments` | Create a comment on a post (supports threading via parentId)    |
| `GET`    | `/posts/:postId/comments` | List comments for a post (cursor pagination, parentOnly filter) |
| `PATCH`  | `/comments/:id`           | Edit a comment body                                             |
| `DELETE` | `/comments/:id`           | Soft-delete a comment (admin bypass available)                  |

**Auth:** All endpoints require `requireClientAuth`.
**Has JSDoc:** Yes

### Client Component: CommentThread

**File:** `apps/client/components/comments/CommentThread.tsx`
**Type:** component
**Description:** Threaded comment list for the post review panel. Supports 1-level nesting (replies), shows author initials avatar, name, body, timestamp. Includes inline reply/new comment input with reply-to indicator.

| Export          | Type      | Description                                   |
| --------------- | --------- | --------------------------------------------- |
| `CommentThread` | component | Threaded comment list with inline reply input |

**Has JSDoc:** Yes

### Client Hook: useComments

**File:** `apps/client/hooks/api/useComments.ts`
**Type:** hook module
**Description:** TanStack Query hooks for post comment threads.

| Export          | Type | Description                                               |
| --------------- | ---- | --------------------------------------------------------- |
| `useComments`   | hook | Query for comments on a post                              |
| `useAddComment` | hook | Mutation to add a comment (supports parentId for replies) |
| `Comment`       | type | Comment shape with nested replies array                   |

**Has JSDoc:** Yes

---

## 4. Approvals

### API Routes

**File:** `apps/api/src/approvals/approvalRoutes.ts`
**Type:** Fastify plugin
**Description:** Content approval workflow endpoints. Submit posts for review, approve/reject with optional comments, get approval history per post, and list pending approvals for a reviewer.

| Method | Endpoint                           | Description                                                   |
| ------ | ---------------------------------- | ------------------------------------------------------------- |
| `POST` | `/posts/:postId/submit-for-review` | Submit a post for content review                              |
| `POST` | `/approvals/:id/approve`           | Approve an approval request                                   |
| `POST` | `/approvals/:id/reject`            | Reject an approval request                                    |
| `GET`  | `/posts/:postId/approvals`         | Get approval history for a post                               |
| `GET`  | `/approvals/pending`               | Get pending approvals for a reviewer (reviewerId query param) |

**Has JSDoc:** Yes

### Approval Workflow CRUD Routes

**File:** `apps/api/src/approvals/approvalWorkflowRoutes.ts`
**Type:** Fastify plugin
**Description:** Multi-level approval workflow CRUD. Workflows have 1-10 levels, each with optional role, assigneeId, and requireAll flag. Supports default workflow designation per account.

| Method   | Endpoint                  | Description                                         |
| -------- | ------------------------- | --------------------------------------------------- |
| `GET`    | `/approval-workflows`     | List workflows for an account                       |
| `POST`   | `/approval-workflows`     | Create a new workflow (1-10 levels)                 |
| `GET`    | `/approval-workflows/:id` | Get workflow by ID with levels                      |
| `PATCH`  | `/approval-workflows/:id` | Update workflow (name, levels, isDefault, isActive) |
| `DELETE` | `/approval-workflows/:id` | Delete a workflow                                   |

**Has JSDoc:** Yes

### Client Components

#### ApprovalQueue

**File:** `apps/client/components/approvals/ApprovalQueue.tsx`
**Type:** component
**Description:** Grid of pending approval cards with ReviewPanel sheet integration. Shows loading skeletons, empty state, and error handling with retry.

| Export          | Type      | Description                               |
| --------------- | --------- | ----------------------------------------- |
| `ApprovalQueue` | component | Responsive grid of pending approval cards |

**Has JSDoc:** Yes

#### ApprovalCard

**File:** `apps/client/components/approvals/ApprovalCard.tsx`
**Type:** component
**Description:** Single pending approval card showing content preview (100 chars), platform badges, submitter name, relative time, and "Review" button.

| Export         | Type      | Description                                          |
| -------------- | --------- | ---------------------------------------------------- |
| `ApprovalCard` | component | Approval card with platform badges and review button |

**Has JSDoc:** Yes

#### ReviewPanel

**File:** `apps/client/components/approvals/ReviewPanel.tsx`
**Type:** component
**Description:** Slide-in sheet panel for reviewing a pending approval. Shows full post content, platform badges, approve/reject actions, rejection dialog with minimum 10-character reason, and an embedded CommentThread.

| Export        | Type      | Description                                                  |
| ------------- | --------- | ------------------------------------------------------------ |
| `ReviewPanel` | component | Slide-in review panel with approve/reject and comment thread |

**Has JSDoc:** Yes

### Client Hook: useApprovals

**File:** `apps/client/hooks/api/useApprovals.ts`
**Type:** hook module
**Description:** TanStack Query hooks for the approval workflow. Covers pending approvals list, submit for review, approve, and reject mutations.

| Export                | Type | Description                                            |
| --------------------- | ---- | ------------------------------------------------------ |
| `usePendingApprovals` | hook | Query for pending approvals (auto-refetches every 60s) |
| `useSubmitForReview`  | hook | Mutation to submit a post for review                   |
| `useApprovePost`      | hook | Mutation to approve a post                             |
| `useRejectPost`       | hook | Mutation to reject a post with reason                  |
| `ApprovalRequest`     | type | Approval request shape (PENDING/APPROVED/REJECTED)     |

**Has JSDoc:** Yes

---

## 5. External Notifications (Slack/Teams)

### API Routes

**File:** `apps/api/src/external-notifications/externalNotificationRoutes.ts`
**Type:** Fastify plugin
**Description:** REST endpoints for external notification webhook configuration management. Supports creating Slack/Teams webhook configs, listing, deleting, and sending test notifications.

| Method   | Endpoint                               | Description                                                            |
| -------- | -------------------------------------- | ---------------------------------------------------------------------- |
| `POST`   | `/api/external-notifications`          | Create webhook config (channel: slack/teams, HTTPS URL, events, label) |
| `GET`    | `/api/external-notifications`          | List configs for a project (projectId query)                           |
| `DELETE` | `/api/external-notifications/:id`      | Delete a config                                                        |
| `POST`   | `/api/external-notifications/:id/test` | Send test notification through configured webhook                      |

**Has JSDoc:** Yes

### Client Components

#### ExternalNotificationConfigs

**File:** `apps/client/components/settings/ExternalNotificationConfigs.tsx`
**Type:** component
**Description:** List and management of Slack/Teams webhook configurations. Add, test, and delete webhook integrations with toast feedback and delete confirmation dialog.

| Export                        | Type      | Description                                      |
| ----------------------------- | --------- | ------------------------------------------------ |
| `ExternalNotificationConfigs` | component | Webhook config list with add/test/delete actions |

**Has JSDoc:** Yes

#### AddWebhookForm

**File:** `apps/client/components/settings/AddWebhookForm.tsx`
**Type:** component
**Description:** Dialog form for adding a new Slack or Teams webhook. Validates HTTPS URL, requires at least 1 event selected from 7 supported events (post_published, post_failed, approval_pending, approval_approved, approval_rejected, crisis_mode_entered, crisis_mode_exited).

| Export           | Type      | Description                                  |
| ---------------- | --------- | -------------------------------------------- |
| `AddWebhookForm` | component | Modal form for creating webhook integrations |

**Has JSDoc:** Yes

### Client Hook: useExternalNotifications

**File:** `apps/client/hooks/api/useExternalNotifications.ts`
**Type:** hook module
**Description:** TanStack Query hooks for Slack/Teams external notification webhook configuration.

| Export                           | Type | Description                                       |
| -------------------------------- | ---- | ------------------------------------------------- |
| `useExternalNotificationConfigs` | hook | Query for webhook configs by project              |
| `useCreateWebhook`               | hook | Mutation to create a new webhook config           |
| `useDeleteWebhook`               | hook | Mutation to delete a webhook config               |
| `useTestWebhook`                 | hook | Mutation to send a test notification              |
| `ExternalNotificationConfig`     | type | Config shape (channel, webhookUrl, label, events) |
| `CreateWebhookParams`            | type | Creation input params                             |

**Has JSDoc:** Yes

---

## 6. First Comment Scheduling

### API Routes

**File:** `apps/api/src/first-comment/firstCommentRoutes.ts`
**Type:** Fastify plugin
**Description:** First comment scheduling endpoints. Allows setting, getting, and removing a first comment that is automatically published after a post goes live.

| Method   | Endpoint                       | Description                                    |
| -------- | ------------------------------ | ---------------------------------------------- |
| `PUT`    | `/posts/:postId/first-comment` | Set or update the first comment (1-2000 chars) |
| `GET`    | `/posts/:postId/first-comment` | Get the first comment for a post               |
| `DELETE` | `/posts/:postId/first-comment` | Remove the first comment                       |

**Auth:** All endpoints require `requireClientAuth`.
**Has JSDoc:** Yes

---

## Domain Model

### Key Domain Entities and Aggregates

| File                                                         | Type      | Description                       |
| ------------------------------------------------------------ | --------- | --------------------------------- |
| `apps/api/src/domain/aggregates/SocialMessageAggregate.ts`   | aggregate | Social inbox message aggregate    |
| `apps/api/src/domain/aggregates/PostCommentAggregate.ts`     | aggregate | In-context post comment aggregate |
| `apps/api/src/domain/aggregates/ApprovalRequestAggregate.ts` | aggregate | Approval request aggregate        |
| `apps/api/src/domain/entities/Notification.ts`               | entity    | Notification entity               |
| `apps/api/src/domain/entities/ApprovalWorkflow.ts`           | entity    | Multi-level approval workflow     |
| `apps/api/src/domain/entities/SocialConversation.ts`         | entity    | Social conversation entity        |
| `apps/api/src/domain/entities/ConversationNote.ts`           | entity    | Internal conversation note        |

### Key Value Objects

| File                                                       | Description                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/api/src/domain/value-objects/NotificationId.ts`      | Typed notification ID                                            |
| `apps/api/src/domain/value-objects/NotificationType.ts`    | Notification type enum (APPROVAL_REQUESTED, POST_APPROVED, etc.) |
| `apps/api/src/domain/value-objects/CommentId.ts`           | Typed comment ID                                                 |
| `apps/api/src/domain/value-objects/ApprovalRequestId.ts`   | Typed approval request ID                                        |
| `apps/api/src/domain/value-objects/ApprovalStatus.ts`      | Approval status values                                           |
| `apps/api/src/domain/value-objects/ReviewDecision.ts`      | Review decision values                                           |
| `apps/api/src/domain/value-objects/SocialMessageStatus.ts` | Social message status                                            |
| `apps/api/src/domain/value-objects/SocialMessageType.ts`   | Social message type                                              |

### Key Repository Ports

| File                                                                       | Description                                |
| -------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/api/src/domain/repositories/NotificationRepository.ts`               | Notification + preference repository ports |
| `apps/api/src/domain/repositories/PostCommentRepository.ts`                | Post comment repository port               |
| `apps/api/src/domain/repositories/ApprovalRequestRepository.ts`            | Approval request repository port           |
| `apps/api/src/domain/repositories/ApprovalWorkflowRepository.ts`           | Approval workflow repository port          |
| `apps/api/src/domain/repositories/SocialMessageRepository.ts`              | Social message repository port             |
| `apps/api/src/domain/repositories/SocialMessageQueryRepository.ts`         | Social message query repository port       |
| `apps/api/src/domain/repositories/FirstCommentRepository.ts`               | First comment repository port              |
| `apps/api/src/domain/repositories/ExternalNotificationConfigRepository.ts` | External notification config port          |
| `apps/api/src/domain/repositories/ExternalNotifierPort.ts`                 | External notifier (Slack/Teams) port       |
