# API Architecture & Endpoints

## Overview

The API is built with **Fastify 5.8.4** and **TypeScript 6.0.2**, featuring a comprehensive multi-tenant social media management platform with production-ready monitoring, authentication, and provider integrations.

**Base URL**: `http://localhost:3000` (configurable via `PORT` environment variable)

## Architecture

### Technology Stack

- **Framework**: Fastify 5.8.4 with ZodTypeProvider for type safety
- **Authentication**: JWT with refresh tokens, MFA (TOTP), RBAC
- **Database**: PostgreSQL with Prisma 7.5.0 ORM (centralized via `@infra/prisma` with `prisma.config.ts`)
- **Queue System**: BullMQ 5.71.1 with Redis (ioredis 5.7.0)
- **Monitoring**: Prometheus metrics, Pino 10.3.1 structured logging
- **Circuit Breakers**: Opossum with fallback strategies
- **Rate Limiting**: Sliding window with tenant isolation
- **Caching**: Redis-based response caching with TTL management

### Response Patterns

All endpoints follow consistent `Result<T, E>` patterns:

```typescript
// Success
{ ok: true, value: T }

// Error
{ ok: false, error: string, message?: string, code?: string }
```

## Core API Endpoints

### Health & Monitoring

#### System Health

```http
GET /health
```

**Response**: `{ ok: true, timestamp: string }`

#### Comprehensive Health Check

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
  },
  "timestamp": "2025-01-23T10:30:00Z"
}
```

#### Metrics Endpoint

```http
GET /metrics
```

**Response**: Prometheus metrics format

### Authentication System

#### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response**:

```json
{
  "ok": true,
  "token": "<jwt-access-token>",
  "refreshToken": "uuid-refresh-token",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "USER"
  }
}
```

#### Token Refresh

```http
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "uuid-refresh-token"
}
```

**Response**:

```json
{
  "ok": true,
  "token": "<jwt-access-token>",
  "refreshToken": "new-uuid-refresh-token"
}
```

#### Logout

```http
POST /auth/logout
Content-Type: application/json

{
  "refreshToken": "uuid-refresh-token"
}
```

**Response**: `{ ok: true }`

### Multi-Factor Authentication

#### Setup MFA

```http
POST /auth/mfa/setup
Authorization: Bearer <jwt-token>
```

**Response**:

```json
{
  "ok": true,
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "secret": "JBSWY3DPEHPK3PXP",
  "backupCodes": ["123456", "789012", "345678"]
}
```

#### Complete Customer Login MFA Challenge

```http
POST /auth/customer/login/mfa
Content-Type: application/json

{
  "challengeToken": "<challenge-jwt-from-step-1>",
  "code": "123456"
}
```

**Response**: `{ ok: true, data: { accessToken, refreshToken, user, account } }`

#### Disable MFA

```http
POST /auth/mfa/disable
Authorization: Bearer <jwt-token>
```

**Response**: `{ ok: true }`

### Role-Based Access Control (RBAC)

#### Create Role

```http
POST /auth/rbac/roles
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "name": "content-manager",
  "permissions": ["posts:read", "posts:write", "analytics:read"]
}
```

#### Assign Role to User

```http
POST /auth/rbac/assign
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "userId": "uuid",
  "roleId": "role-uuid"
}
```

### Content Management

#### Create Post

There is no `POST /posts`. The publishing saga creates posts: `mode: "draft"` creates a draft and publishes nothing, and `schedule` or `publish-now` with `locale` and `body` create the post and publish it (see [Publishing & Scheduling](#publishing--scheduling)).

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

**Response**: the saga start response below. The saga creates the post after the response; `GET /sagas/{sagaId}` returns its id as `data.postId` of the create step, the second entry of `stepResults`.

#### Get Post

```http
GET /posts/{postId}
Authorization: Bearer <jwt-token>
```

**Response**:

```json
{
  "ok": true,
  "value": {
    "id": "uuid",
    "projectId": "uuid",
    "status": "DRAFT",
    "content": [
      {
        "locale": "en",
        "title": "Post Title",
        "body": "Content...",
        "tags": ["tag1", "tag2"]
      }
    ],
    "media": [],
    "createdAt": "2025-01-23T10:00:00Z"
  }
}
```

#### List Posts

```http
GET /posts?projectId={uuid}&limit=20&offset=0
Authorization: Bearer <jwt-token>
```

#### Update Post

```http
PUT /posts/{postId}
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "title": "Updated Title",
  "body": "Updated content..."
}
```

### Media Management

#### Upload Media

```http
POST /posts/{postId}/media
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "type": "image",
  "url": "https://storage.example.com/image.jpg",
  "width": 1920,
  "height": 1080,
  "alt": "Description of image"
}
```

#### Get Signed Upload URL

```http
POST /media/sign
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "path": "uploads/image.jpg",
  "contentType": "image/jpeg",
  "sizeBytes": 1048576
}
```

### Publishing & Scheduling

Every publish and every schedule goes through the post-publishing saga: `POST /sagas/post-publishing/start` starts it and `GET /sagas/{sagaId}` reads its progress. Both require a customer token. The body is `StartPostPublishingSagaBodySchema` in `apps/api/src/saga/SagaIntegration.ts`, and its `mode` selects what the saga does. The saga validates the request, creates the post when none is given, enqueues one publish job per channel (its pivot: once the jobs are accepted, nothing rolls them back), waits for the jobs and records the final status.

#### Publish Post

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

#### Schedule Post

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

#### Get Publishing Status

```http
GET /sagas/{sagaId}
Authorization: Bearer <jwt-token>
```

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "saga-uuid",
    "definitionId": "post-publishing-saga",
    "status": "RUNNING",
    "currentStep": 3,
    "progress": 60,
    "startedAt": "2026-10-10T10:00:00.000Z",
    "retryCount": 0,
    "stepResults": [
      { "stepIndex": 0, "outcome": "succeeded", "data": { "validated": true, "mode": "schedule" } },
      {
        "stepIndex": 1,
        "outcome": "succeeded",
        "data": { "postId": "post-uuid", "initialStatus": "DRAFT" }
      },
      {
        "stepIndex": 2,
        "outcome": "succeeded",
        "data": { "jobIds": ["job-id"], "channelCount": 1 }
      },
      { "stepIndex": 3, "outcome": "waiting", "reason": "Publishing jobs still in progress" },
      { "stepIndex": 4, "outcome": "not-reached" }
    ]
  }
}
```

`status` is one of `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `COMPENSATING` or `COMPENSATED`. A `stepResults` entry carries the step's `data` when it succeeded with some, `error` when it failed and `reason` while it waits, and a step not yet run reads `not-reached`; the steps' data is defined in `packages/shared/src/saga.ts`. Only the user who started the saga can read it; anyone else gets 404.

#### Threads

There is no thread route and no thread setting. A post that becomes a thread goes through the same saga, and the provider adapter decides at publish time: the X adapter splits a body longer than one post into a thread. `GET /posts/{postId}` returns the post's `thread` once it has one.

#### Cancel or Reschedule a Scheduled Post

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

Cancel moves a `SCHEDULED` post back to `DRAFT`, clears its `scheduledAt` and marks its queued or running publish logs as `ERR`. Reschedule sets the post to `SCHEDULED` with the new `scheduledAt`, which must be in the future; with `updateChannels` (default `true`) it writes the new time into those logs. Neither route calls the publish queue, and the publish worker does not read the post's status before it publishes (`apps/workers/src/publishHandler.ts`), so neither route stops or moves a job that is already queued. `GET /admin/posts/scheduled` lists scheduled posts.

### Analytics & Insights

#### Get Analytics

```http
GET /analytics?postId={uuid}&channelId={uuid}&provider=x&since=2025-01-01&until=2025-01-31
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

#### Fetch Live Analytics

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

#### Real-time Analytics (WebSocket)

```javascript
const ws = new WebSocket("ws://localhost:3000/analytics/realtime");
ws.send(
  JSON.stringify({
    type: "subscribe",
    channels: ["x-channel-uuid"],
  })
);
```

### Audit & Logging

#### Get Audit Logs

```http
GET /audit/logs?userId={uuid}&action=LOGIN&limit=50
Authorization: Bearer <admin-token>
```

#### Get Publish Logs

```http
GET /projects/{projectId}/publish-logs
Authorization: Bearer <jwt-token>
```

Returns the project's 50 most recent publish logs, newest first, as `{ "ok": true, "data": [...] }`. The route takes no query parameters, and an unknown project answers 404.

## Admin API Endpoints

### Dashboard Statistics

```http
GET /admin/dashboard/stats
Authorization: Bearer <admin-token>
```

**Response**:

```json
{
  "ok": true,
  "value": {
    "accounts": {
      "total": 1247,
      "active": 1134,
      "trialsActive": 89,
      "trialsExpiring": 12
    },
    "subscriptions": {
      "basic": 456,
      "pro": 234,
      "enterprise": 45
    },
    "revenue": {
      "monthly": 45600,
      "yearly": 547200,
      "total": 1234567
    },
    "activity": {
      "loginsToday": 234,
      "newAccountsToday": 12,
      "subscriptionChangesToday": 3
    },
    "lastUpdated": "2025-01-23T10:30:00Z"
  }
}
```

### Account Management

#### List Accounts

```http
GET /admin/accounts/summary?limit=50&offset=0&status=active
Authorization: Bearer <admin-token>
```

#### Create Account

```http
POST /admin/accounts
Authorization: Bearer <super-admin-token>
Content-Type: application/json

{
  "email": "new@example.com",
  "name": "New User",
  "subscription": "PRO",
  "trialDays": 7
}
```

#### Suspend Account

```http
PUT /admin/accounts/{accountId}/suspend
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "reason": "Terms violation"
}
```

#### Delete Account

```http
DELETE /admin/accounts/{accountId}
Authorization: Bearer <super-admin-token>
Content-Type: application/json

{
  "reason": "User request",
  "confirmDelete": true
}
```

### Subscription Management

#### List Subscriptions

```http
GET /admin/subscriptions/summary
Authorization: Bearer <admin-token>
```

#### Start Trial

```http
POST /billing/trial/start
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "accountId": "uuid",
  "subscription": "PRO",
  "trialDays": 14
}
```

#### Convert Trial to Paid

```http
POST /billing/subscription/convert
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "accountId": "uuid",
  "billingCycle": "yearly"
}
```

## Provider System

### Provider Health Check

```http
GET /providers/health
Authorization: Bearer <jwt-token>
```

### X/Twitter Provider

```http
GET /providers/x/capabilities
Authorization: Bearer <jwt-token>
```

#### Validate X Credentials

```http
POST /providers/x/validate
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "apiKey": "your-api-key",
  "apiSecret": "your-api-secret",
  "bearerToken": "your-bearer-token"
}
```

## AI & Content Generation

### AI Content Generation

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

### Content Optimization

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

## Error Handling

### Standard Error Response

```json
{
  "ok": false,
  "error": "VALIDATION_ERROR",
  "message": "Invalid email format",
  "code": "AUTH_001"
}
```

### Common Error Codes

- `AUTH_INVALID`: Invalid credentials
- `AUTH_EXPIRED`: Token expired
- `RATE_LIMITED`: Rate limit exceeded
- `VALIDATION_ERROR`: Request validation failed
- `NOT_FOUND`: Resource not found
- `UNAUTHORIZED`: Insufficient permissions
- `UNAVAILABLE`: Service temporarily unavailable

## Rate Limiting

### Rate Limit Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1643723400
X-RateLimit-Window: 3600
```

### Rate Limit Response (429)

```json
{
  "ok": false,
  "error": "RATE_LIMITED",
  "message": "Too many requests",
  "retryAfter": 3600
}
```

## WebSocket Endpoints

### Real-time Analytics

```
ws://localhost:3000/analytics/realtime
```

### Live Dashboard Updates

```
ws://localhost:3000/admin/dashboard/live
```

## Security Features

### Request Validation

- All inputs validated with Zod schemas
- SQL injection protection via Prisma
- XSS protection with DOMPurify
- CSRF protection with tokens

### Security Headers

- CORS configured per environment
- Content Security Policy (CSP)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff

### Circuit Breakers

- Automatic fallback for external API failures
- Configurable retry policies with exponential backoff
- Dead letter queue for failed operations

---

**API Version**: 1.0
**Last Updated**: March 8, 2026
**Fastify Version**: 5.8.4
**Total Endpoints**: 85+
