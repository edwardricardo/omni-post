# Phase 2: Social Inbox MVP

## Overview

The Social Inbox consolidates comments, mentions, and replies from all 5 social providers (X, Instagram, Facebook, YouTube, TikTok) into a unified inbox with the ability to respond from the dashboard.

## Architecture

### Domain Layer

- **SocialMessageAggregate** — Aggregate root for incoming social messages with status state machine (UNREAD → READ → REPLIED → ARCHIVED)
- **SocialConversation** — Entity grouping messages by thread via `rootProviderMessageId`
- **SocialOutboundReply** — Tracks replies sent through provider APIs with status tracking (PENDING → SENDING → SENT/FAILED)

### Value Objects

- `SocialMessageId`, `SocialConversationId` — Strongly-typed EntityId subclasses
- `SocialMessageType` — COMMENT, MENTION, DIRECT_MESSAGE, REPLY with predicates
- `SocialMessageStatus` — State machine with enforced transitions

### Domain Events

- `SocialMessageReceived`, `SocialMessageRead`, `SocialMessageReplied`
- `SocialMessageAssigned`, `SocialMessageArchived`
- `ConversationResolved`, `ConversationReopened`

## Data Model

### New Prisma Models

| Model                 | Purpose                          |
| --------------------- | -------------------------------- |
| `SocialMessage`       | Incoming messages from providers |
| `SocialConversation`  | Threaded conversation grouping   |
| `SocialOutboundReply` | Outbound reply tracking          |

### Deduplication

Unique constraint on `(provider, providerMessageId)` prevents duplicate ingestion from both webhooks and sync.

## API Endpoints

| Method | Route                                   | Description                                   |
| ------ | --------------------------------------- | --------------------------------------------- |
| GET    | `/api/inbox`                            | Unified inbox feed (cursor-based, filterable) |
| GET    | `/api/inbox/unread-count`               | Unread message count                          |
| GET    | `/api/inbox/mentions`                   | Mentions-only feed                            |
| GET    | `/api/inbox/conversations/:id`          | Conversation detail                           |
| GET    | `/api/inbox/conversations/:id/messages` | Messages in conversation                      |
| PATCH  | `/api/inbox/messages/:id/read`          | Mark as read                                  |
| PATCH  | `/api/inbox/messages/:id/archive`       | Archive message                               |
| PATCH  | `/api/inbox/messages/:id/assign`        | Assign to team member                         |
| POST   | `/api/inbox/messages/:id/reply`         | Send reply via provider                       |
| PATCH  | `/api/inbox/conversations/:id/resolve`  | Resolve conversation                          |
| PATCH  | `/api/inbox/conversations/:id/reopen`   | Reopen conversation                           |
| POST   | `/api/inbox/sync/:channelId`            | Manual comment sync                           |

## Use Cases

### Commands (8)

- `IngestSocialMessageUseCase` — Dedup + conversation grouping + create
- `MarkMessageReadUseCase` — UNREAD → READ
- `MarkMessageArchivedUseCase` — \* → ARCHIVED
- `AssignMessageUseCase` — Assign team member
- `SendReplyUseCase` — Create outbound reply + update status
- `ResolveConversationUseCase` — Mark conversation resolved
- `ReopenConversationUseCase` — Reopen resolved conversation
- `SyncProviderCommentsUseCase` — Fetch comments from provider API

### Queries (5)

- `GetInboxQuery` — Unified feed with filters
- `GetMentionsQuery` — Mentions-only feed
- `GetConversationQuery` — Conversation detail
- `GetConversationMessagesQuery` — Messages in conversation
- `GetUnreadInboxCountQuery` — Unread count

## Integration Points

### Webhook Bridge

`InboxWebhookBridge` connects existing webhook processors (COMMENT_RECEIVED, MENTION_RECEIVED) to the inbox pipeline without modifying processors.

### Provider API Extension

`ProviderAdapter` port extended with optional `getComments?()` and `postReply?()` methods. Each provider can implement at its own pace.

### Background Sync

`InboxSyncJob` (BullMQ repeatable) fetches comments every 15 minutes to complement webhooks.

## DI Tokens (18 new)

Repositories: `SocialMessageRepository`, `SocialMessageQueryRepository`, `SocialConversationRepository`, `SocialOutboundReplyRepository`

Commands: `IngestSocialMessageUseCase`, `MarkMessageReadUseCase`, `MarkMessageArchivedUseCase`, `AssignMessageUseCase`, `SendReplyUseCase`, `ResolveConversationUseCase`, `ReopenConversationUseCase`, `SyncProviderCommentsUseCase`

Queries: `GetInboxQuery`, `GetMentionsQuery`, `GetConversationQuery`, `GetConversationMessagesQuery`, `GetUnreadInboxCountQuery`

Handlers: `InboxEventHandlers`
