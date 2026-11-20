# API Architecture & Endpoints

## Overview

The API is built with **Fastify** and **TypeScript**, featuring a comprehensive multi-tenant social media management platform with production-ready monitoring, authentication, and provider integrations.

**Base URL**: `http://localhost:3000` (configurable via `PORT` environment variable)

**Route list**: this page documents some of the routes. The complete list is the generated route table, `packages/shared/src/api-generated/types.gen.ts`, which a CI gate keeps equal to the routes the API registers.

## Architecture

### Technology Stack

- **Framework**: Fastify 5.12.6 with ZodTypeProvider for type safety, in TypeScript 6.0.3
- **Authentication**: JWT with refresh tokens, MFA (TOTP), RBAC
- **Database**: PostgreSQL with Prisma 7.10.1 ORM (centralized via `@infra/prisma` with `prisma.config.ts`)
- **Queue System**: BullMQ 5.58.9 with Redis (ioredis 5.11.1)
- **Monitoring**: Prometheus metrics, Pino 10.3.1 structured logging
- **Circuit Breakers**: Opossum, failing fast on writes
- **Rate Limiting**: Token bucket per client IP and route
- **Caching**: Redis-based response caching with TTL management

### Response Patterns

The API answers in three shapes, depending on who sends the response.

| Sent by                                                                         | Success body                 | Error body                                              | `details`                                               |
| ------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| A handler built on `BaseRouteHandler` (`lib/route-handler/BaseRouteHandler.ts`) | `{ ok: true, data }`         | `{ ok: false, error: "<message>" }`                     | next to `error`, only when the handler passes an object |
| Fastify's error handler (`lib/errors/errorHandler.ts`)                          | none, it answers errors only | the problem body of [Error Handling](#error-handling)   | never                                                   |
| The saga routes (`/sagas/...`, `saga/SagaIntegration.ts`)                       | `{ success: true, data }`    | the error handler's body, as its refusals go through it | as for the error handler                                |

An error reaches Fastify's error handler when it is a schema or framework error, an `AppError` thrown by a service, or an unexpected failure. A path no route matches answers the same body, through the not-found handler.

```json
{ "ok": true, "data": { "message": "Logged out successfully" } }
```

`POST /auth/logout`, 200.

```json
{ "ok": false, "error": "Invalid email or password" }
```

`POST /auth/login` with a wrong password, 401.

```json
{
  "type": "https://omnipost.app/problems/ROUTE_NOT_FOUND",
  "title": "Route not found",
  "status": 404,
  "detail": "No route matches this method and path",
  "code": "ROUTE_NOT_FOUND",
  "correlationId": "<correlation-id>",
  "timestamp": "2026-11-20T10:30:00.000Z"
}
```

`GET /nowhere`, a path no route matches, 404, as `application/problem+json`.

A few routes send a body of their own: `GET /health` and its siblings, `GET /metrics` and the 429 of the rate limiter. Each is described with its route.

## Core API Endpoints

### Health & Monitoring

#### System Health

```http
GET /health
```

**Response**: `{ status: "healthy" | "degraded" | "unhealthy", timestamp: string, uptime?: number }`, with 200 when `status` is `healthy` and 503 otherwise, `degraded` included. `uptime` is absent until the health checks have run once.

#### Detailed Health Check

```http
GET /health/detailed
```

**Response**: 200 when the overall status is `healthy` or `degraded`, 503 when it is `unhealthy`. `ok` is `false` only when the overall status is `unhealthy`.

```json
{
  "ok": true,
  "status": "healthy",
  "score": 100,
  "timestamp": "2026-11-14T10:30:00.000Z",
  "uptime": 3600,
  "dependencies": [
    {
      "name": "<dependency-name>",
      "type": "<dependency-type>",
      "status": "healthy",
      "latency": 12,
      "message": "<message>",
      "critical": true,
      "lastChecked": "2026-11-14T10:29:55.000Z"
    }
  ],
  "metrics": {
    "memory": { "heapUsed": 0, "heapTotal": 0, "external": 0, "rss": 0 },
    "cpu": {}
  },
  "alerts": [
    {
      "id": "<alert-id>",
      "level": "<level>",
      "message": "<message>",
      "dependency": "<dependency-name>",
      "timestamp": "2026-11-14T10:29:55.000Z",
      "acknowledged": false
    }
  ]
}
```

A dependency entry also carries `details` when its check returns some.

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

`mfaToken` (6 to 8 characters of `0-9A-F`, a TOTP code or a backup code) is optional.

**Response**: the refresh token is not in the body; it is set as the HTTP-only cookie `refreshToken` (path `/auth`, `SameSite=Strict`, 7 days). The access token lives 15 minutes. `expiresAt` is not its expiry: it is when the refresh token and its session expire, 7 days after they are issued.

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "User Name",
      "role": "<role>",
      "isActive": true,
      "emailVerified": true,
      "lastLoginAt": "2026-11-14T10:00:00.000Z",
      "mfaEnabled": false
    },
    "accessToken": "<jwt-access-token>",
    "expiresAt": "2026-11-21T10:00:00.000Z"
  }
}
```

An account that has MFA enabled and sent no `mfaToken` gets `{ "ok": true, "data": { "mfaRequired": true, "userId": "uuid", "message": "MFA token required to complete login" } }` and no cookie. Refusals: 400 for an invalid body, 401 for a wrong e-mail, password or MFA token, 403 when the account is inactive, and 403 with `{ "ok": false, "error": "Password change required" }` when the account's password is marked to be changed (`mustChangePassword`): every check, the MFA token included, has passed, no session is opened and no cookie is set, and the password is changed through [`POST /admin/auth/password/change-required`](#change-a-password-that-must-be-changed) (`apps/api/src/auth/authServiceCore.ts`, `apps/api/src/auth/authRoutes.ts`).

#### Token Refresh

```http
POST /auth/refresh
```

The refresh token is read from the `refreshToken` cookie, and from the body (`{ "refreshToken": "<token>" }`) only when the cookie is absent.

**Response**: the cookie is rotated, and the body carries the new access token.

```json
{
  "ok": true,
  "data": {
    "accessToken": "<jwt-access-token>",
    "expiresAt": "2026-11-21T10:05:00.000Z"
  }
}
```

`expiresAt` is the expiry of the rotated refresh token, as in the login response. A missing token answers 401, an invalid, expired or revoked one 401 and clears the cookie, and an inactive account 403.

#### Logout

```http
POST /auth/logout
```

The refresh token is read the same way as in `POST /auth/refresh`; without one the route answers 400.

**Response**: `{ ok: true, data: { message: "Logged out successfully" } }`. The cookie is cleared, and a session that no longer exists still logs out successfully.

### Multi-Factor Authentication

#### Setup MFA

This route and `POST /auth/mfa/disable` act on the customer user of the access token.

```http
POST /auth/mfa/setup
Authorization: Bearer <jwt-token>
```

**Response**:

```json
{
  "ok": true,
  "data": {
    "setup": {
      "qrCodeUrl": "<qr-code-url>",
      "manualEntryKey": "JBSWY3DPEHPK3PXP",
      "backupCodes": ["<backup-code>"]
    },
    "instructions": {
      "step1": "Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)",
      "step2": "Or manually enter the key into your authenticator app",
      "step3": "Save the backup codes in a secure location",
      "step4": "Enter a code from your authenticator app to verify setup"
    }
  }
}
```

A user who already has MFA enabled gets 409.

#### Complete Customer Login MFA Challenge

```http
POST /auth/customer/login/mfa
Content-Type: application/json

{
  "challengeToken": "<challenge-jwt-from-step-1>",
  "code": "123456"
}
```

**Response**: `{ ok: true, data: { accessToken, refreshToken, user, account } }`. A wrong code answers 401 with `{ ok: false, error: "Invalid MFA code.", code: "INVALID_MFA_CODE" }`, and an expired, consumed or foreign challenge answers 401 with `code: "INVALID_CHALLENGE"`.

#### Disable MFA

```http
POST /auth/mfa/disable
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "token": "123456"
}
```

`token` is a TOTP code or a backup code, 6 to 8 characters.

**Response**: `{ ok: true, data: { message: "MFA has been disabled for your account", warning: "Your account is now less secure. Consider re-enabling MFA." } }`. It answers 400 when MFA is not enabled or the token is invalid.

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
GET /posts/{id}
Authorization: Bearer <jwt-token>
```

**Response**:

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "projectId": "uuid",
    "locale": "en",
    "body": "Content...",
    "title": "Post Title",
    "tags": ["tag1", "tag2"],
    "status": "DRAFT",
    "createdAt": "2025-01-23T10:00:00Z"
  }
}
```

`title` is absent when the post has none. `thread` is absent until the post has a thread; once it has one, the response carries it next to `createdAt`:

```json
"thread": {
  "id": "uuid",
  "postId": "uuid",
  "strategy": "<strategy>",
  "createdAt": "2025-01-23T10:00:00Z",
  "updatedAt": "2025-01-23T10:00:00Z",
  "tweets": [
    {
      "id": "uuid",
      "threadId": "uuid",
      "sequenceNumber": 1,
      "content": "First post of the thread",
      "media": null,
      "tweetId": null,
      "parentTweetId": null,
      "status": "<status>",
      "publishedAt": null,
      "createdAt": "2025-01-23T10:00:00Z",
      "updatedAt": "2025-01-23T10:00:00Z"
    }
  ]
}
```

`tweets` are ordered by `sequenceNumber`. An unknown post answers 404 with `"Post not found"`, and an invalid id answers 400.

#### List Posts

```http
GET /posts?projectId={uuid}&limit=20&offset=0
Authorization: Bearer <jwt-token>
```

**Query**:

| Parameter                                                  | Values                                                                                                                                                 | Default | Applies                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | -------------------------------------------------------------------- |
| `limit`                                                    | integer, 1 to 100                                                                                                                                      | 20      | always                                                               |
| `offset`                                                   | integer, 0 or more                                                                                                                                     | 0       | always                                                               |
| `projectId`                                                | a UUID                                                                                                                                                 | none    | always; without it the route lists the posts of the caller's account |
| `status`                                                   | one of `DRAFT`, `PENDING_REVIEW`, `SCHEDULED`, `PUBLISHING`, `PUBLISHED`, `FAILED`, `CANCELLED`; with `projectId`, also a comma-separated list of them | none    | always; a list only with `projectId`                                 |
| `tags`                                                     | comma-separated strings                                                                                                                                | none    | only with `projectId`                                                |
| `hasMedia`, `includeArchived`                              | `true` or `false`                                                                                                                                      | none    | only with `projectId`                                                |
| `createdFrom`, `createdTo`, `scheduledFrom`, `scheduledTo` | ISO 8601 date-times                                                                                                                                    | none    | only with `projectId`                                                |
| `searchText`                                               | string, 1 to 200 characters                                                                                                                            | none    | only with `projectId`                                                |
| `sortBy`                                                   | `createdAt`, `updatedAt`, `scheduledAt`, `publishedAt` or `status`                                                                                     | none    | only with `projectId`                                                |
| `sortDirection`                                            | `asc` or `desc`                                                                                                                                        | none    | only with `projectId`                                                |

**Response**: `{ ok: true, data: { data: [...], total, limit, offset } }`.

#### Update Post

```http
PATCH /posts/{id}
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "title": "Updated Title",
  "body": "Updated content..."
}
```

The body takes `body`, `title`, `summary` and `tags`, and an optional `expectedVersion` (a non-negative integer): when the post's version has moved past it, the route answers 409. At least one of the four content fields is required, or the route answers 400.

**Response**: `{ ok: true, data: { id, projectId, locale, body, title?, summary?, tags, status, mediaCount, createdAt, updatedAt } }`.

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

#### Real-time Analytics (Server-Sent Events)

```http
GET /analytics/stream?projectId={uuid}&postIds={uuid},{uuid}
Authorization: Bearer <jwt-token>
```

The route answers `text/event-stream`. `projectId` is optional: without it the stream covers the posts of every project of the caller's account. `postIds` is a comma-separated list, read only with `projectId`, and it is intersected with that project's posts. The stream is one-way, so a connection cannot change its scope.

The first event is `data: {"type":"connected"}`, followed by one `data:` event with the current metrics of each post in scope and then by each live update; a `: heartbeat` comment line keeps the connection open. A missing token answers 401, a project outside the caller's account 403 with `"Access denied to project"`, and an account that already holds its maximum of concurrent streams 429 with `{ ok: false, error: "Too many concurrent streams for account", maxConcurrent }`.

The routes that read stored analytics are the `/analytics/...` entries of the generated route table.

### Audit & Logging

#### Get Audit Logs

```http
GET /admin/audit/logs?userId={uuid}&action=LOGIN&limit=50
Authorization: Bearer <admin-token>
```

Requires the `AUDIT_READ` permission. **Query** (all optional): `userId`, `action`, `resource`, `resourceId`, `success`, `startDate` and `endDate` (ISO 8601 date-times), `limit` (1 to 1000, default 50) and `offset` (default 0).

**Response**: `{ ok: true, data: { logs: [...], filters } }`, where `filters` echoes the filters the route applied.

#### Get Publish Logs

```http
GET /projects/{projectId}/publish-logs
Authorization: Bearer <jwt-token>
```

Returns the project's 50 most recent publish logs, newest first, as `{ "ok": true, "data": [...] }`. The route takes no query parameters, and an unknown project answers 404.

## Admin API Endpoints

### Administrator Authentication

The two routes below are the ones a first administrator meets; the other routes under `/admin/auth/` are not listed on this page yet. Both answer in the `BaseRouteHandler` shape, with the refusal's code as `error`, and share one request limit per client address: 15 requests a minute, answered with 429, `{ "ok": false, "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "<text>" } }` and `Retry-After` (`apps/api/src/admin/auth/adminAuthRoutes.ts`, `rateLimit` in `adminAuthMiddleware.ts`).

#### Admin Login

```http
POST /admin/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "<password>"
}
```

`mfaToken` (6 digits), `rememberMe`, `deviceId` (64 hex characters) and `deviceName` are optional (`loginSchema`, `apps/api/src/admin/auth/adminAuthSchemas.ts`). An administrator with MFA enabled who sent no `mfaToken` gets 200 with `{ "ok": true, "data": { "requiresMfa": true } }`.

Refusals: 400 `Validation failed` for an invalid body, 401 `INVALID_CREDENTIALS` or `MFA_INVALID`, 403 `ACCOUNT_LOCKED` or `ACCOUNT_INACTIVE`, and 403 `PASSWORD_CHANGE_REQUIRED` when the administrator's password is marked to be changed (`mustChangePassword`), as a first administrator's single-use password is. That refusal comes once every check, the second factor included, has passed: no session or token is issued, `lastLoginAt` is not written, and one `AuditLog` row, `LOGIN_FAILED` with the error `PASSWORD_CHANGE_REQUIRED`, records it (`AdminAuthService.login`). The password is then changed through the route below. Any other code answers 500.

```json
{ "ok": false, "error": "PASSWORD_CHANGE_REQUIRED" }
```

#### Change a Password That Must Be Changed

```http
POST /admin/auth/password/change-required
Content-Type: application/json

{
  "email": "admin@example.com",
  "currentPassword": "<current-password>",
  "newPassword": "<new-password>"
}
```

No session is needed, and the route is exempt from the CSRF check. `mfaToken` (6 digits) is required when the administrator has MFA enabled. `newPassword` is at most 128 characters (`requiredPasswordChangeSchema`, `apps/api/src/admin/auth/adminAuthSchemas.ts`).

The route runs the sign-in's checks on the e-mail, the current password and the MFA token, requires the mark, and replaces the password and clears the mark in one guarded write (`AdminAuthService.changeRequiredPassword`, `PasswordService.replaceRequiredPassword`). It opens no session, ends every session of the administrator and writes one `AuditLog` row, `PASSWORD_CHANGED`; the administrator then signs in with `POST /admin/auth/login`.

**Response**: 200.

```json
{ "ok": true, "data": { "message": "Password changed. Sign in with the new password." } }
```

| Status | `error`                        | When                                                                                                                                                                       |
| ------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `Validation failed`            | The body is invalid; `details.issues` lists each field as `{ path, message }`                                                                                              |
| 400    | `PASSWORD_TOO_WEAK`            | The new password has fewer than 12 characters, or lacks a lowercase letter, an uppercase letter, a number or another character (`validatePasswordStrength`); checked first |
| 400    | `PASSWORD_REUSED`              | The new password is the current one or one of the last 5                                                                                                                   |
| 401    | `INVALID_CREDENTIALS`          | The e-mail or the current password is wrong                                                                                                                                |
| 401    | `MFA_REQUIRED`                 | The administrator has MFA enabled and no `mfaToken` was sent                                                                                                               |
| 401    | `MFA_INVALID`                  | The `mfaToken` is wrong                                                                                                                                                    |
| 403    | `ACCOUNT_LOCKED`               | The brute-force gate locked the account, or its `lockedUntil` is in the future                                                                                             |
| 403    | `ACCOUNT_INACTIVE`             | The account is inactive                                                                                                                                                    |
| 403    | `IP_NOT_ALLOWED`               | The IP allowlist of the security settings is on and the caller's address is not in it: the sign-in is exempt from it, this route is not                                    |
| 409    | `PASSWORD_CHANGE_NOT_REQUIRED` | The credentials are right and the password is not marked to be changed                                                                                                     |
| 409    | `CONCURRENT_MODIFICATION`      | The administrator changed between the read and the write; nothing was written                                                                                              |
| 429    | `RATE_LIMIT_EXCEEDED`          | The brute-force gate refuses the attempt for a reason other than a locked account, besides the request limit above                                                         |

Any other code answers 500. `IP_NOT_ALLOWED` comes from the allowlist's hook, before the route, in the body `{ "ok": false, "error": { "code": "IP_NOT_ALLOWED", "message": "Access denied: IP not in allowlist" } }` (`apps/api/src/security/ipAllowlistMiddleware.ts`); why the sign-in and the reset paths are exempt and this one is not is the plan item `ADMIN-AUTH-ROUTES-EXEMPT-FROM-THE-IP-ALLOWLIST-WITHOUT-A-REASON`.

### Dashboard Statistics

```http
GET /admin/dashboard/stats
Authorization: Bearer <admin-token>
```

Requires the `DASHBOARD_VIEW` permission.

**Response**: `subscriptions` counts the account subscriptions by status.

```json
{
  "ok": true,
  "data": {
    "stats": {
      "accounts": {
        "total": 1247,
        "active": 1134,
        "trialsActive": 89,
        "trialsExpiring": 12
      },
      "subscriptions": {
        "ACTIVE": 456,
        "GRANDFATHERED": 12
      },
      "projects": 2310,
      "activity": {
        "newAccountsToday": 12
      },
      "lastUpdated": "2025-01-23T10:30:00Z"
    }
  }
}
```

### Account Management

#### List Accounts

```http
GET /admin/accounts/summary
Authorization: Bearer <admin-token>
```

Requires the `DASHBOARD_VIEW` permission. The route takes no query parameters and returns the 100 most recently created accounts that are not deleted.

**Response**:

```json
{
  "ok": true,
  "data": {
    "accounts": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "name": "User Name",
        "isActive": true,
        "createdAt": "2025-01-23T10:00:00.000Z",
        "plan": {
          "type": "bundle",
          "name": "Pro",
          "status": "ACTIVE",
          "providers": ["X"],
          "pricePerMonth": 49
        },
        "trial": {
          "isOnTrial": false,
          "trialDaysRemaining": 0,
          "trialExpired": false,
          "autoRenewal": true
        },
        "usage": {
          "projectsUsed": 2,
          "projectsRemaining": 8,
          "utilizationPercent": 20
        }
      }
    ],
    "total": 1
  }
}
```

`phone` is present when the account has one, `trial.trialEndDate` when it has a trial end date, and `plan.type` is `bundle`, `custom` or `none`.

#### Create Admin Account

```http
POST /admin/accounts
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "email": "new@example.com",
  "password": "at-least-8-characters",
  "name": "New User",
  "role": "<role>",
  "sendWelcomeEmail": true
}
```

Requires the `ACCOUNT_MANAGE` permission. `role` and `sendWelcomeEmail` are optional, and `password` takes at least 8 characters.

**Response**: 201 with `{ ok: true, data: { account } }`. An e-mail that is already registered answers 409 with `"Email already exists"`.

#### Suspend Account

```http
POST /admin/accounts/{accountId}/suspend
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "reason": "Terms violation"
}
```

Requires the `ACCOUNT_MANAGE` permission.

**Response**: `{ ok: true, data: { message: "Account suspended successfully" } }`. An unknown account answers 404, and an account that is already suspended 409.

#### Delete Account

```http
DELETE /admin/accounts/{accountId}
Authorization: Bearer <admin-token>
```

Requires the `ACCOUNT_MANAGE` permission. The route takes no body.

**Response**: `{ ok: true, data: { message: "Account deleted successfully" } }`. An unknown account answers 404, and the caller's own account 409 with `"Cannot delete your own account"`.

### Subscription Management

#### List Subscriptions

```http
GET /admin/subscriptions/summary
Authorization: Bearer <admin-token>
```

Requires the `DASHBOARD_VIEW` permission.

**Response**: `{ ok: true, data: { subscriptions, trials, stats } }`. `subscriptions` lists up to 50 accounts that are not on a trial, and `trials` up to 50 accounts that are, each trial with a `status` of `ACTIVE`, `EXPIRING` or `EXPIRED`. `stats` holds `activeSubscriptions`, `activeTrials`, `expiringTrials`, `expiredTrials`, `totalRevenue`, `monthlyRevenue` and `conversionRate`.

#### Start Trial

```http
POST /admin/billing/accounts/{accountId}/trial/start
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "trialDays": 14
}
```

Requires the `BILLING_MANAGE` permission. The body takes `trialDays` (1 to 90, default 14) and the optional `bundleId` and `providers`.

**Response**: `{ ok: true, data: { subscription, message, timestamp } }`, where `message` reads `"14-day trial started successfully"` for a 14-day trial. An unknown account answers 404, and an account that is already on a trial, or that cannot start one, 409.

#### Convert Trial to Paid

```http
POST /admin/billing/accounts/{accountId}/trial/convert
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "billingCycle": "yearly"
}
```

Requires the `BILLING_MANAGE` permission. `billingCycle` is `monthly` (the default) or `yearly`.

**Response**: `{ ok: true, data: { subscription, message: "Trial converted to paid subscription successfully", timestamp } }`. An unknown account answers 404, and an account that is not on a trial 409.

## Provider System

### Provider Health Check

```http
GET /providers/health/all
Authorization: Bearer <jwt-token>
```

**Response**:

```json
{
  "ok": true,
  "data": {
    "summary": { "total": 1, "healthy": 1, "unhealthy": 0, "avgLatency": 120 },
    "providers": [
      { "id": "x", "name": "X", "status": "<status>", "healthy": true, "latency": 120 }
    ],
    "timestamp": "2026-11-14T10:30:00.000Z"
  }
}
```

Each entry of `providers` is the provider's `id`, `name` and `status` followed by the fields its health check returns.

## AI & Content Generation

### AI Content Generation

```http
POST /ai/generate
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "messages": [{ "role": "user", "content": "Write a social media post about AI" }],
  "options": { "maxTokens": 280 }
}
```

`messages` holds at least one entry, each with a `role` of `system`, `user` or `assistant`. `options` (`model`, `maxTokens`, `temperature`, `topP`), `provider` and `accountId` (a UUID) are optional.

**Response**: `{ ok: true, data: { success: true, content, metadata } }`. A body with no message answers 400 with `"Messages array is required"`.

### Content Optimization

```http
POST /ai/optimize
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "content": "Original post content",
  "platform": "x"
}
```

`brandVoice`, `provider` and `accountId` (a UUID) are optional.

**Response**: `{ ok: true, data: { success: true, optimization, metadata } }`. A body without `content` or `platform` answers 400 with `"Content and platform are required"`.

## Error Handling

### The error body

A failure the error handler answers, a request a route's schema refuses and a path no route matches all answer one body: an RFC 9457 problem, served as `application/problem+json; charset=utf-8` ([ADR-0047](../technical/ADR-0047-central-error-system.md)).

```json
{
  "type": "https://omnipost.app/problems/VALIDATION_FAILED",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request is not valid",
  "code": "VALIDATION_FAILED",
  "correlationId": "<correlation-id>",
  "timestamp": "2026-11-20T10:30:00.000Z",
  "issues": [
    {
      "part": "body",
      "pointer": "/email",
      "code": "invalid_format",
      "detail": "Invalid email address"
    }
  ]
}
```

| Member          | What it holds                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | `https://omnipost.app/problems/` and the code: an identifier, not a page to fetch                                                                                                                         |
| `title`         | The code in words                                                                                                                                                                                         |
| `status`        | The HTTP status                                                                                                                                                                                           |
| `detail`        | The registry's message for the code answered, worded with this occurrence's parameters; for an `AppError` whose code is not registered and that is an expected failure below 500, the error's own message |
| `code`          | The code; a front takes its user-facing text from its catalogs by this code                                                                                                                               |
| `correlationId` | The request's correlation id, or its request id when the failure comes before the hook that sets the correlation id                                                                                       |
| `timestamp`     | When the failure was answered, ISO 8601, UTC                                                                                                                                                              |
| `params`        | Only when the code declares parameters                                                                                                                                                                    |
| `issues`        | Only with `VALIDATION_FAILED`: one per refusal, its request `part`, a JSON `pointer` into it, the validator's `code` and `detail`                                                                         |

What decides the answer:

- A code in the `internal` or `configuration` category reaches the client as `INTERNAL_ERROR` at 500; its own code goes to the log.
- A refusal of the framework answers the `http` code of its status (`MALFORMED_REQUEST`, `ROUTE_NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`); one whose status no `http` code holds answers `INTERNAL_ERROR`'s code and text at that status.
- A failure that carries no registered code keeps its status: an `AppError` answers its own code, and its message only when it is an expected failure below 500; any other value answers `INTERNAL_ERROR`'s code and text, at the failure status it carries or else at 500.
- A route answers its own failures through `sendProblem` (`apps/api/src/lib/errors/index.ts`), the one function that writes the body; a route never raises to the error handler ([ADR-0006](../technical/ADR-0006-result-type-over-throws.md)).
- The OpenAPI document publishes the body as `components.schemas.Problem`.

### Routes not yet converted

A route that answers a failure itself, by hand or through a helper such as `BaseRouteHandler`, still answers the body [Response Patterns](#response-patterns) gives for it, until the sweep of its context moves it to `sendProblem`.

### Error codes

Every code, with its status, its category and its message: [docs/api/ERROR_CODES.md](../api/ERROR_CODES.md), generated from the registry in `packages/shared/src/error-registry/`.

## Rate Limiting

Rate limiting is on by default and is switched off with `ENABLE_RATE_LIMITING=false`. Each request takes one permit from a bucket keyed by client IP and route.

### Rate Limit Headers

```http
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1643723400000
```

`X-RateLimit-Reset` is the time at which the bucket is full again, in milliseconds since the Unix epoch. A denied request also carries `Retry-After`, in seconds. The limiter does not emit `X-RateLimit-Limit`; the design of the rate-limit integrity work, `docs/features/auth-rate-limit-integrity/design.md`, section "The header contract", says it is to be added.

### Rate Limit Response (429)

```json
{
  "ok": false,
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests. Please try again later.",
  "retryAfter": "2026-11-14T10:35:00.000Z"
}
```

## Streaming Endpoints

The API registers no WebSocket route. Real-time delivery uses Server-Sent Events: `GET /analytics/stream` is described under [Real-time Analytics](#real-time-analytics-server-sent-events), and `GET /notifications/stream` and `GET /webhooks/dashboard/stream` are in the generated route table.

## Security Features

### Request Validation

- A handler built on `BaseRouteHandler` validates the body, the path parameters and the query string with Zod schemas, and answers 400 when they fail (`apps/api/src/lib/route-handler/BaseRouteHandler.ts`)
- Database access goes through Prisma
- The server template engine's `sanitize` method runs DOMPurify over HTML content (`apps/api/src/lib/templates/ServerTemplateEngine.ts:190`)
- A state-changing request (any method but `GET`, `HEAD` or `OPTIONS`) to a path under `/admin/` must carry an `X-CSRF-Token` header equal to the CSRF token of the caller's most recent active admin session: a missing token answers 403 with code `CSRF_MISSING`, and a wrong one 403 with `CSRF_INVALID`. The admin login, required password change, refresh, password-reset and password-validation paths are exempt, and no path outside `/admin/` is checked (`apps/api/src/security/csrfMiddleware.ts`, registered at `apps/api/src/index.ts:540-542`)

### Security Headers

- CORS allows the origins `http://localhost` and `https://localhost` on ports 3000, 3100 and 3200, the methods `GET`, `POST`, `PUT`, `DELETE`, `PATCH` and `OPTIONS`, the request headers `Content-Type`, `Authorization` and `X-Requested-With`, and credentials, with a preflight cache of 86,400 seconds (`apps/api/src/index.ts:414-424`)
- Content-Security-Policy on every response: `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` and the other directives of `apps/api/src/index.ts:398-413`
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `Strict-Transport-Security` (one year, subdomains, preload)
- `Cache-Control: no-store` on every response whose route has not set its own policy
- `X-API-Version: 1.0`

(`apps/api/src/security/securityHeaders.ts`)

### Circuit Breakers

- Calls to external APIs go through an Opossum circuit breaker with a 10-second timeout that opens at a 50% error rate and resets after 30 seconds (`packages/adapters/external-apis/src/circuitBreaker.ts`)
- A retryable failure is retried up to 3 times with exponential backoff (1 second base, factor 2, 30-second cap) and jitter; an open circuit or a non-retryable error ends the retries at once
- A call falls back to a cached or static value only when its caller opts in; writes fail fast by default
- After the retries, a failed operation goes to the dead-letter queue when one is available, and the loss is logged when none is

---

**API Version**: 1.0
