# Database Schema

OmniPost uses **PostgreSQL 16** with **Prisma 7.5.0** ORM.

## Schema Location

`infra/prisma/schema.prisma`

## Entity Relationship Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Account   │────▶│   Project   │────▶│    Post     │
│             │     │             │     │             │
│ - billing   │     │ - channels  │     │ - content   │
│ - trial     │     │ - posts     │     │ - media     │
│ - limits    │     │ - settings  │     │ - status    │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
            ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
            │ PostContent │           │  PostMedia  │           │ PublishLog  │
            │             │           │             │           │             │
            │ - locale    │           │ - type      │           │ - status    │
            │ - text      │           │ - url       │           │ - provider  │
            │ - version   │           │ - metadata  │           │ - timestamp │
            └─────────────┘           └─────────────┘           └─────────────┘
```

## Core Models

### Account

Multi-tenant account with subscription management.

```prisma
model Account {
  id                   String           @id @default(uuid())
  email                String           @unique
  name                 String
  subscription         SubscriptionTier @default(BASIC)
  maxProjects          Int              @default(1)
  isOnTrial            Boolean          @default(true)
  trialStartDate       DateTime         @default(now())
  trialEndDate         DateTime?
  billingCycle         String           @default("monthly")
  stripeCustomerId     String?
  stripeSubscriptionId String?
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt
  deletedAt            DateTime?        // Soft delete — null means active

  projects             Project[]
  apiKeys              ApiKey[]
  providerConnections  ProviderConnection[]

  @@index([isOnTrial, trialEndDate])
  @@index([nextBillingDate])
  @@index([deletedAt])
}

enum SubscriptionTier {
  BASIC
  PRO
  ENTERPRISE
}
```

### AdminUser

Admin users with roles and MFA support.

```prisma
model AdminUser {
  id                    String    @id @default(uuid())
  email                 String    @unique
  passwordHash          String
  name                  String
  role                  AdminRole @default(ADMIN)
  isActive              Boolean   @default(true)

  // MFA
  mfaEnabled            Boolean   @default(false)
  mfaSecret             String?
  mfaBackupCodes        String[]  @default([])

  // Security
  failedLoginAttempts   Int       @default(0)
  lockedUntil           DateTime?
  passwordChangedAt     DateTime  @default(now())
  maxConcurrentSessions Int       @default(3)

  sessions              AdminSession[]
  auditLogs             AuditLog[]
  permissions           AdminUserPermission[]
}

enum AdminRole {
  SUPER_ADMIN
  ADMIN
  MODERATOR
}
```

### Project

Content container for posts and channels.

```prisma
model Project {
  id          String    @id @default(uuid())
  accountId   String
  name        String
  description String?
  timezone    String    @default("UTC")
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime? // Soft delete — null means active

  account     Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  posts       Post[]
  channels    Channel[]
  trackedLinks TrackedLink[]

  @@unique([accountId, name])
  @@index([accountId])
  @@index([createdAt])
  @@index([deletedAt])
}
```

### Post

Canonical content model.

```prisma
model Post {
  id          String    @id @default(uuid())
  projectId   String
  status      String    @default("DRAFT")
  scheduledAt DateTime?
  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime? // Soft delete — null means active

  project     Project       @relation(fields: [projectId], references: [id])
  contents    PostContent[]
  media       PostMedia[]
  publishLogs PublishLog[]
  analytics   Analytics[]

  @@index([projectId, status])
  @@index([projectId, createdAt])
  @@index([projectId, scheduledAt, status])
  @@index([deletedAt])
}
```

### PostContent

Localized content with revision support.

```prisma
model PostContent {
  id        String   @id @default(uuid())
  postId    String
  locale    String   @default("en")
  title     String?
  body      String
  tags      String[] @default([])
  version   Int      @default(1)
  createdAt DateTime @default(now())

  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@unique([postId, locale, version])
}
```

### Channel

Social media account credentials.

```prisma
model Channel {
  id          String    @id @default(uuid())
  projectId   String
  provider    Provider
  handle      String
  credentials Json      // Encrypted OAuth tokens
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime? // Soft delete — null means active

  project     Project     @relation(fields: [projectId], references: [id])
  publishLogs PublishLog[]
  analytics   Analytics[]

  @@index([projectId])
  @@index([projectId, provider])
  @@index([provider])
  @@index([deletedAt])
}

enum Provider {
  X
  INSTAGRAM
  FACEBOOK
  TIKTOK
  YOUTUBE
}
```

## Soft Delete Pattern (FASE H12)

All four main aggregates (`Account`, `Project`, `Channel`, `Post`) implement soft delete via `deletedAt DateTime?`.

| Operation                | Behavior                                                        |
| ------------------------ | --------------------------------------------------------------- |
| `DELETE /xxx/:id`        | Soft delete: `update({ data: { deletedAt: new Date() } })`      |
| `DELETE /xxx/:id/hard`   | Hard delete: physical row removal — requires `SUPER_ADMIN` role |
| `findMany` / `findFirst` | Always filtered: `where: { deletedAt: null }`                   |

The `@@index([deletedAt])` on each model ensures soft-delete filter queries are fast.

### PublishLog

Audit trail for publication attempts.

```prisma
model PublishLog {
  id               String        @id @default(uuid())
  postId           String
  channelId        String
  status           PublishStatus
  providerPostId   String?       // ID from social platform
  errorMessage     String?
  publishedAt      DateTime?
  createdAt        DateTime      @default(now())

  post             Post          @relation(fields: [postId], references: [id], onDelete: Cascade)
  channel          Channel       @relation(fields: [channelId], references: [id], onDelete: Cascade)
}

enum PublishStatus {
  PENDING
  PROCESSING
  SUCCESS
  FAILED
  CANCELLED
}
```

### Analytics

Performance metrics per post/channel.

```prisma
model Analytics {
  id         String   @id @default(uuid())
  postId     String
  channelId  String
  views      Int      @default(0)
  likes      Int      @default(0)
  comments   Int      @default(0)
  shares     Int      @default(0)
  clicks     Int      @default(0)
  capturedAt DateTime @default(now())

  post       Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  channel    Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@index([postId, channelId, capturedAt])
}
```

### ProviderConnection

OAuth credentials for social platforms.

```prisma
model ProviderConnection {
  id           String   @id @default(uuid())
  accountId    String
  provider     Provider
  accessToken  String   // Should be encrypted
  refreshToken String?
  expiresAt    DateTime?
  scope        String[]
  metadata     Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  account      Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, provider])
}
```

### TrackedLink

Short-link tracking for posts (Sprint 19 — Link Tracking).

```prisma
model TrackedLink {
  id          String   @id @default(uuid())
  projectId   String
  originalUrl String
  shortCode   String   @unique
  vanitySlug  String?
  clicks      Int      @default(0)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project    Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  linkClicks LinkClick[]

  @@index([projectId, isActive])
  @@index([shortCode])
  @@index([vanitySlug])
  @@index([clicks])
}
```

### LinkClick

Individual click events for tracked links.

```prisma
model LinkClick {
  id            String   @id @default(uuid())
  trackedLinkId String
  timestamp     DateTime @default(now())
  referrer      String?
  userAgent     String?
  ipAddress     String?
  country       String?
  city          String?

  trackedLink TrackedLink @relation(fields: [trackedLinkId], references: [id], onDelete: Cascade)

  @@index([trackedLinkId, timestamp])
  @@index([country])
  @@index([timestamp])
}
```

## Database Commands

```bash
# Generate Prisma client
pnpm --filter @infra/prisma prisma generate

# Create migration
pnpm --filter @infra/prisma prisma migrate dev --name migration_name

# Apply migrations
pnpm --filter @infra/prisma prisma migrate deploy

# Reset database
pnpm --filter @infra/prisma prisma migrate reset

# Open Prisma Studio
pnpm --filter @infra/prisma prisma studio

# Seed database
pnpm --filter @infra/prisma prisma db seed
```

## Indexes

Key indexes for query performance:

```prisma
// Account
@@index([isOnTrial, trialEndDate])
@@index([nextBillingDate])
@@index([deletedAt])

// AdminUser
@@index([role, isActive])
@@index([lastLoginAt])

// Project
@@index([accountId])
@@index([deletedAt])

// Post
@@index([projectId, status])
@@index([projectId, createdAt])
@@index([projectId, scheduledAt, status])
@@index([deletedAt])

// Channel
@@index([projectId, provider])
@@index([deletedAt])

// Analytics
@@index([postId, provider, capturedAt])
@@index([channelId, capturedAt])

// TrackedLink
@@index([projectId, isActive])
@@index([shortCode])

// LinkClick
@@index([trackedLinkId, timestamp])
@@index([timestamp])
```

## Migrations

Applied migrations (in order):

| Migration                                                     | Description                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `20250927063140_complete_schema_with_webhooks`                | Initial complete schema with webhook models                           |
| `20250930012724_phase5_optimized_schema_with_reduced_indexes` | Phase 5: index optimisation, removed low-value indexes                |
| `20250930151603_phase1_add_relationships_fix_n1_queries`      | Phase 1: add missing FK relationships to fix N+1 queries              |
| `20251003042719_phase4_add_composite_indexes`                 | Phase 4: composite indexes for scheduled-post queries                 |
| `20251015225050_enhance_admin_auth_security`                  | Enhanced admin auth: MFA, brute-force, session management             |
| `20251127014014_init`                                         | Schema consolidation init                                             |
| `20251130075555_sprint19_link_tracking_crisis_mode`           | Sprint 19: TrackedLink, LinkClick, Project crisis mode                |
| `20260219025040_init`                                         | Init migration for clean-main branch baseline                         |
| `20260222154747_init`                                         | Universal soft delete: `deletedAt` on Account, Project, Channel, Post |

---

_Last updated: March 2026_
