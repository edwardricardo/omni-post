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
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
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

### Verify MFA Token

```http
POST /auth/mfa/verify
Content-Type: application/json

{
  "userId": "uuid",
  "token": "123456"
}
```

### Disable MFA

```http
POST /auth/mfa/disable
Authorization: Bearer <jwt-token>
```

## Posts

### Create Post

```http
POST /posts
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "projectId": "uuid",
  "locale": "en",
  "title": "My Post Title",
  "body": "Full post content...",
  "tags": ["social", "marketing"],
  "scheduledAt": "2025-01-24T10:00:00Z"
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

### Publish Post

```http
POST /publish/{postId}
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "channelIds": ["x-channel-uuid"],
  "scheduledAt": "2025-01-24T15:00:00Z"
}
```

### Publish Thread

```http
POST /thread/{postId}/publish
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "channelIds": ["x-channel-uuid"],
  "threadSettings": {
    "delay": 30,
    "splitMethod": "SENTENCE"
  }
}
```

### Schedule Post

```http
POST /schedule/{postId}
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "channelIds": ["x-channel-uuid"],
  "runAt": "2025-01-24T10:00:00Z"
}
```

### Cancel Scheduled Post

```http
POST /schedule/cancel
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "dedupeKeys": ["postId:channelId:timestamp"]
}
```

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
