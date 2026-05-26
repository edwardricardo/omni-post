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

#### Verify MFA Token

```http
POST /auth/mfa/verify
Content-Type: application/json

{
  "userId": "uuid",
  "token": "123456"
}
```

**Response**: `{ ok: true, verified: true }`

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

```http
POST /posts
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "projectId": "uuid",
  "locale": "en",
  "title": "My Post Title",
  "summary": "Brief summary",
  "body": "Full post content...",
  "tags": ["social", "marketing"],
  "scheduledAt": "2025-01-24T10:00:00Z"
}
```

**Response**: `{ ok: true, value: { id: "post-uuid" } }`

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

#### Publish Post

```http
POST /publish/{postId}
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "channelIds": ["x-channel-uuid"],
  "scheduledAt": "2025-01-24T15:00:00Z"
}
```

**Response**:

```json
{
  "ok": true,
  "jobs": [
    {
      "channelId": "x-channel-uuid",
      "result": { "ok": true, "value": { "id": "job-uuid" } }
    }
  ]
}
```

#### Publish Thread

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

#### Schedule Post

```http
POST /schedule/{postId}
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "channelIds": ["x-channel-uuid"],
  "runAt": "2025-01-24T10:00:00Z"
}
```

#### Cancel Scheduled Post

```http
POST /schedule/cancel
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "dedupeKeys": ["postId:channelId:timestamp"]
}
```

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
GET /logs?postId={uuid}&status=SUCCESS&limit=50
Authorization: Bearer <jwt-token>
```

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
