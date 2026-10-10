# API Documentation

## Overview

The API is built with **Fastify 5.6.1** and **TypeScript 5.9.2**.

**Base URL**: `http://localhost:3000`

## Response Format

All endpoints follow the `Result<T, E>` pattern:

```typescript
// Success
{ "ok": true, "value": T }

// Error
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Human readable message" } }
```

## Health & Monitoring

### Health Check

```http
GET /health
```

**Response**: `{ "ok": true, "timestamp": "2025-01-23T10:30:00Z" }`

### Full Health Check

```http
GET /health/full
```

**Response**:

```json
{
  "ok": true,
  "dependencies": {
    "database": { "ok": true, "latency": 12 },
    "redis": { "ok": true, "latency": 3 },
    "queue": { "ok": true, "waiting": 0, "active": 2 }
  }
}
```

### Prometheus Metrics

```http
GET /metrics
```

## Authentication

### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response** (Client App - httpOnly cookie set):

```json
{
  "ok": true,
  "value": {
    "accessToken": "<jwt-access-token>",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "USER"
    }
  }
}
```

**Note**: The client app (`apps/client/`) uses httpOnly cookies with Server Actions. The API sets a `session` cookie (httpOnly) on login. The browser never sees the JWT. API calls go through a Next.js Route Handler proxy (`/api/backend/[...path]/route.ts`) which reads the cookie and adds the `Authorization: Bearer <token>` header automatically.

### Logout

```http
POST /auth/logout
Authorization: Bearer <jwt-token>
```

**Response**:

```json
{
  "ok": true,
  "value": {}
}
```

**Note**: For the client app, always use the `logoutAction()` Server Action which clears the httpOnly cookie. Direct API calls alone will not clear the session.

## Multi-Factor Authentication

### Setup MFA

```http
POST /auth/mfa/setup
Authorization: Bearer <jwt-token>
```

**Response**:

```json
{
  "ok": true,
  "value": {
    "qrCode": "data:image/png;base64,...",
    "secret": "JBSWY3DPEHPK3PXP",
    "backupCodes": ["123456", "789012", "345678"]
  }
}
```

### Complete Customer Login MFA Challenge

```http
POST /auth/customer/login/mfa
Content-Type: application/json

{
  "challengeToken": "<challenge-jwt-from-step-1>",
  "code": "123456"
}
```

### Disable MFA

```http
POST /auth/mfa/disable
Authorization: Bearer <jwt-token>
```

## Posts

### Create Post

There is no `POST /posts`. The publishing saga creates posts: `mode: "draft"` creates a draft and publishes nothing, and `schedule` or `publish-now` with `locale` and `body` create the post and publish it (see [Publishing](#publishing)).

```http
POST /sagas/post-publishing/start
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "mode": "draft",
  "projectId": "project-uuid",
  "locale": "en",
  "title": "My Post Title",
  "body": "Full post content...",
  "tags": ["social", "marketing"]
}
```

### Get Post

```http
GET /posts/{postId}
Authorization: Bearer <jwt-token>
```

### List Posts

```http
GET /posts?projectId={uuid}&limit=20&offset=0
Authorization: Bearer <jwt-token>
```

### Update Post

```http
PUT /posts/{postId}
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "title": "Updated Title",
  "body": "Updated content..."
}
```

### Delete Post

```http
DELETE /posts/{postId}
Authorization: Bearer <jwt-token>
```

## Publishing

Every publish and every schedule goes through the post-publishing saga: `POST /sagas/post-publishing/start` starts it and `GET /sagas/{sagaId}` reads its progress. Both require a customer token. The body is `StartPostPublishingSagaBodySchema` in `apps/api/src/saga/SagaIntegration.ts`, and its `mode` selects what the saga does.

### Publish Post

```http
POST /sagas/post-publishing/start
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "mode": "publish-now",
  "projectId": "project-uuid",
  "postId": "draft-post-uuid",
  "channelIds": ["channel-uuid"]
}
```

### Schedule Post

```http
POST /sagas/post-publishing/start
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "mode": "schedule",
  "projectId": "project-uuid",
  "postId": "draft-post-uuid",
  "channelIds": ["channel-uuid"],
  "scheduledAt": "2026-10-24T15:00:00Z"
}
```

**Body fields**:

| Field         | Modes                                               | Rule                                                             |
| ------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `mode`        | all                                                 | `draft`, `schedule` or `publish-now`                             |
| `projectId`   | all                                                 | UUID of a project of the caller's account                        |
| `postId`      | `schedule`, `publish-now`                           | UUID of a `DRAFT` post of that project                           |
| `channelIds`  | `schedule`, `publish-now`                           | at least one UUID, each a channel of that project                |
| `scheduledAt` | `schedule`                                          | ISO 8601 date-time                                               |
| `locale`      | `draft` (required); otherwise only without `postId` | 2 to 5 characters                                                |
| `body`        | `draft` (required); otherwise only without `postId` | 1 to 10,000 characters                                           |
| `title`       | all, optional                                       | 1 to 256 characters                                              |
| `tags`        | all, optional                                       | array of strings, default `[]`; read only when a post is created |
| `mediaIds`    | all, optional                                       | array of UUIDs, default `[]`; read only when a post is created   |

In `schedule` and `publish-now`, send either `postId` (publish that draft) or `locale` and `body` (create the post, then publish it), never both and never neither.

**Response**:

```json
{
  "success": true,
  "data": {
    "sagaId": "saga-uuid",
    "status": "PENDING",
    "mode": "schedule",
    "correlationId": "post-publish-<uuid>",
    "startedAt": "2026-10-10T10:00:00.000Z"
  }
}
```

The saga runs after the response. A body that fails the schema answers 400, a project, channel or post outside the caller's account answers 404, and a `postId` whose post is not in `DRAFT` answers 400.

### Get Publishing Status

```http
GET /sagas/{sagaId}
Authorization: Bearer <jwt-token>
```

Returns the saga's `status` (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `COMPENSATING` or `COMPENSATED`), `currentStep`, `progress`, `error` and one `stepResults` entry per step. Only the user who started the saga can read it; anyone else gets 404.

### Threads

There is no thread route and no thread setting. A post that becomes a thread goes through the same saga, and the provider adapter decides at publish time: the X adapter splits a body longer than one post into a thread. `GET /posts/{postId}` returns the post's `thread` once it has one.

### Cancel or Reschedule a Scheduled Post

A customer has no route for either. Admin has two, both requiring the `post:manage` permission:

```http
POST /admin/posts/{id}/cancel
Authorization: Bearer <admin-token>
```

```http
POST /admin/posts/{id}/reschedule
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "scheduledAt": "2026-10-25T09:00:00Z",
  "timezone": "UTC",
  "updateChannels": true
}
```

Cancel moves a `SCHEDULED` post back to `DRAFT`, clears its `scheduledAt` and marks its queued or running publish logs as `ERR`. Reschedule sets the post to `SCHEDULED` with the new `scheduledAt`, which must be in the future; with `updateChannels` (default `true`) it writes the new time into those logs. Neither route calls the publish queue, and the publish worker does not read the post's status before it publishes (`apps/workers/src/publishHandler.ts`), so neither route stops or moves a job that is already queued.

## Analytics

### Get Analytics

```http
GET /analytics?postId={uuid}&channelId={uuid}&since=2025-01-01&until=2025-01-31
Authorization: Bearer <jwt-token>
```

**Response**:

```json
{
  "ok": true,
  "value": [
    {
      "postId": "uuid",
      "channelId": "uuid",
      "provider": "X",
      "views": 1250,
      "likes": 89,
      "comments": 12,
      "shares": 5,
      "capturedAt": "2025-01-23T10:00:00Z"
    }
  ]
}
```

### Fetch Live Analytics

```http
POST /analytics/fetch
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "channelId": "x-channel-uuid",
  "provider": "x",
  "since": "2025-01-20T00:00:00Z"
}
```

## AI Content Generation

### Generate Content

```http
POST /ai/generate
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "provider": "openai",
  "prompt": "Write a social media post about AI",
  "targetProvider": "x",
  "maxLength": 280
}
```

### Optimize Content

```http
POST /ai/optimize
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "content": "Original post content",
  "targetProvider": "x",
  "goal": "engagement"
}
```

## Admin Endpoints

### Dashboard Statistics

```http
GET /admin/dashboard/stats
Authorization: Bearer <admin-token>
```

### List Accounts

```http
GET /admin/accounts/summary?limit=50&offset=0&status=active
Authorization: Bearer <admin-token>
```

### Suspend Account

```http
PUT /admin/accounts/{accountId}/suspend
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "reason": "Terms violation"
}
```

## Error Codes

| Code               | Description                     |
| ------------------ | ------------------------------- |
| `AUTH_INVALID`     | Invalid credentials             |
| `AUTH_EXPIRED`     | Token expired                   |
| `RATE_LIMITED`     | Rate limit exceeded             |
| `VALIDATION_ERROR` | Request validation failed       |
| `NOT_FOUND`        | Resource not found              |
| `UNAUTHORIZED`     | Insufficient permissions        |
| `UNAVAILABLE`      | Service temporarily unavailable |

## Rate Limiting

Rate limits are enforced per endpoint:

| Endpoint Type | Limit       | Window     |
| ------------- | ----------- | ---------- |
| Auth          | 5 requests  | 15 minutes |
| API           | 60 requests | 1 minute   |
| Upload        | 10 requests | 5 minutes  |

**Rate Limit Headers**:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1643723400
```

---

<!-- markdownlint-disable-next-line MD036 -->

_Last updated: March 2026_
