# Phase 1 — Team Workflows

## Overview

Phase 1 adds collaborative team capabilities to OmniPost: team member management, real-time notifications, content approval workflows, and in-context comments on posts.

## Data Model

### New Models

| Model                    | Purpose                                         | Key Relations                                                      |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------ |
| `TeamMember`             | Project collaborators (separate from AdminUser) | Account, ProjectMember, Notification, ApprovalRequest, PostComment |
| `ProjectMember`          | Links members to projects with permissions      | Project, TeamMember                                                |
| `Notification`           | Persistent notification records                 | TeamMember (recipient)                                             |
| `NotificationPreference` | Per-type notification opt-in/out                | —                                                                  |
| `ApprovalRequest`        | Content review requests                         | Post, TeamMember (submitter), ApprovalReview                       |
| `ApprovalReview`         | Individual reviewer decisions                   | ApprovalRequest, TeamMember (reviewer)                             |
| `PostComment`            | Threaded comments on posts                      | Post, TeamMember (author), self-ref (replies)                      |

### New Enums

- `TeamRole`: OWNER > MANAGER > MEMBER > VIEWER (hierarchical)
- `NotificationType`: APPROVAL_REQUESTED, POST_APPROVED, POST_REJECTED, COMMENT_ADDED, COMMENT_REPLY, MENTION, TEAM_INVITE
- `ApprovalStatus`: PENDING → APPROVED / REJECTED / CANCELLED
- `ReviewDecision`: APPROVED, REJECTED, CHANGES_REQUESTED

### PublishStatus Extension

Added `PENDING_REVIEW` state to the existing post state machine:

```
DRAFT → PENDING_REVIEW → SCHEDULED (approved)
                        → DRAFT (rejected)
```

## API Endpoints

### Team Management (`/team`)

| Method | Path               | Description        |
| ------ | ------------------ | ------------------ |
| GET    | `/team?accountId=` | List team members  |
| POST   | `/team/invite`     | Invite team member |
| PATCH  | `/team/:id/role`   | Update member role |
| DELETE | `/team/:id`        | Deactivate member  |

### Notifications (`/notifications`)

| Method | Path                           | Description                    |
| ------ | ------------------------------ | ------------------------------ |
| GET    | `/notifications`               | List (cursor-based pagination) |
| GET    | `/notifications/unread-count`  | Unread count                   |
| POST   | `/notifications`               | Create notification            |
| PATCH  | `/notifications/:id/read`      | Mark as read                   |
| POST   | `/notifications/mark-all-read` | Mark all as read               |
| GET    | `/notifications/stream`        | SSE real-time stream           |
| GET    | `/notifications/preferences`   | Get preferences                |
| PUT    | `/notifications/preferences`   | Update preferences             |

### Content Approval (`/approvals`, `/posts`)

| Method | Path                               | Description       |
| ------ | ---------------------------------- | ----------------- |
| POST   | `/posts/:postId/submit-for-review` | Submit for review |
| POST   | `/approvals/:id/approve`           | Approve post      |
| POST   | `/approvals/:id/reject`            | Reject post       |
| GET    | `/posts/:postId/approvals`         | Approval history  |
| GET    | `/approvals/pending?reviewerId=`   | Pending approvals |

### Comments (`/comments`, `/posts`)

| Method | Path                      | Description            |
| ------ | ------------------------- | ---------------------- |
| POST   | `/posts/:postId/comments` | Create comment         |
| GET    | `/posts/:postId/comments` | List threaded comments |
| PATCH  | `/comments/:id`           | Edit comment           |
| DELETE | `/comments/:id`           | Soft-delete comment    |

## Architecture

### Domain Layer

- **Value Objects**: TeamMemberId, TeamRole, NotificationId, NotificationType, CommentId, ApprovalRequestId, ApprovalStatus, ReviewDecision
- **Entities**: TeamMember, Notification
- **Aggregates**: PostCommentAggregate, ApprovalRequestAggregate
- **Events**: PostSubmittedForReview, PostApproved, PostRejected, CommentAdded, CommentEdited, CommentDeleted

### Application Layer

- 4 team use cases + 5 notification use cases + 5 approval use cases + 4 comment use cases
- `NotificationEventHandlers`: cross-cutting event-to-notification wiring

### Infrastructure

- `NotificationBroadcaster`: SSE + Redis pub/sub for real-time delivery
- 4 Prisma repository adapters
- 25+ DI tokens

## Design Decisions

1. **TeamMember vs AdminUser**: Separate models. AdminUser handles admin panel auth; TeamMember represents project collaborators. Future: unified identity via shared email.
2. **PENDING_REVIEW as PublishStatus**: Extends existing state machine rather than parallel approval-only status.
3. **Soft-delete for comments**: Preserves thread structure while hiding deleted content.
4. **SSE over WebSocket for notifications**: Simpler, unidirectional, follows existing RealtimeWebhookBroadcaster pattern.
5. **Cursor-based pagination**: Used consistently across notifications and comments for scalability.

## Test Coverage

| Area          | Domain Tests | Route Tests | Event Tests | Total   |
| ------------- | ------------ | ----------- | ----------- | ------- |
| Team          | 23           | 16          | —           | 39      |
| Notifications | 29           | 19          | 11          | 59      |
| Approvals     | 33           | 13          | —           | 46      |
| Comments      | 21           | 12          | —           | 33      |
| **Total**     | **106**      | **60**      | **11**      | **177** |
