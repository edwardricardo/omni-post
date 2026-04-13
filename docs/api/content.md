# OmniPost — Content API Reference

## Overview

The content domain covers the full post lifecycle (create, update, schedule, delete, query), a content synchronization engine with versioning, branching, merging, and conflict detection, and platform-specific content adaptation for 8+ social media providers. The post use cases follow hexagonal architecture with CQRS separation (commands use PostRepository, queries use PostQueryRepository).

---

## API Layer (`apps/api/`) — Post Use Cases

### CreatePostUseCase

**File:** `apps/api/src/application/posts/CreatePostUseCase.ts`
**Layer:** application
**Description:** Orchestrates post creation by constructing the PostAggregate, persisting via repository within UoW, and dispatching PostCreated events.

#### Input/Output

```typescript
interface CreatePostInput {
  projectId: string;
  body: string;
  title?: string;
  summary?: string;
  tags?: string[];
  locale?: ContentLocale;
  scheduledAt?: Date;
}

interface CreatePostOutput {
  id: string;
  projectId: string;
  body: string;
  title?: string;
  tags: string[];
  locale: string;
  status: string;
  scheduledAt?: Date;
  createdAt: Date;
}
```

#### Methods

| Method    | Signature                  | Returns                                           | Description                                                                        |
| --------- | -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `execute` | `(input: CreatePostInput)` | `Promise<Result<CreatePostOutput, UseCaseError>>` | Creates post aggregate, persists within UoW, dispatches events, increments metrics |

**Has JSDoc:** ✅ Full JSDoc with `@file`, `@description`, `@layer`, `@example`.

---

### UpdatePostUseCase

**File:** `apps/api/src/application/posts/UpdatePostUseCase.ts`
**Layer:** application
**Description:** Orchestrates post content updates (body, title, summary, tags) via PostAggregate mutation, persisting within UoW and dispatching PostUpdated events. Only editable posts (draft/failed) can be updated.

#### Methods

| Method    | Signature                  | Returns                                  | Description                                                         |
| --------- | -------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `execute` | `(input: UpdatePostInput)` | `Promise<Result<PostDTO, UseCaseError>>` | Validates editability, updates content, persists, dispatches events |

**Has JSDoc:** ✅

---

### DeletePostUseCase

**File:** `apps/api/src/application/posts/DeletePostUseCase.ts`
**Layer:** application
**Description:** Orchestrates post deletion by validating post state (only draft/failed/cancelled), removing via repository within UoW, and incrementing deletion metrics.

#### Methods

| Method    | Signature                  | Returns                               | Description                                                    |
| --------- | -------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| `execute` | `(input: DeletePostInput)` | `Promise<Result<void, UseCaseError>>` | Validates deletability, deletes within UoW, increments metrics |

**Has JSDoc:** ✅

---

### SchedulePostUseCase

**File:** `apps/api/src/application/posts/SchedulePostUseCase.ts`
**Layer:** application
**Description:** Transitions a draft post to SCHEDULED status. Uses PostAggregate.schedule() which validates state transitions (only DRAFT), time constraints (>5 min from now, <1 year), and channel existence.

#### Input/Output

```typescript
interface SchedulePostInput {
  postId: string;
  channelIds: string[];
  scheduledFor: string; // ISO 8601
  timezone?: string; // IANA timezone
}

interface SchedulePostOutput {
  id: string;
  status: string; // Always "SCHEDULED"
  scheduledFor: string;
  channelIds: string[];
}
```

#### Methods

| Method    | Signature                    | Returns                                             | Description                                                             |
| --------- | ---------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| `execute` | `(input: SchedulePostInput)` | `Promise<Result<SchedulePostOutput, UseCaseError>>` | Validates post/channels, invokes domain schedule(), persists within UoW |

**Has JSDoc:** ✅ Full JSDoc with `@throws` documentation and `@example`.

---

### GetPostUseCase (Query)

**File:** `apps/api/src/application/posts/GetPostUseCase.ts`
**Layer:** application
**Description:** CQRS read-side query that retrieves a single post by ID via PostQueryRepository. Returns the read model directly (no aggregate loading overhead).

#### Methods

| Method    | Signature               | Returns                                  | Description                      |
| --------- | ----------------------- | ---------------------------------------- | -------------------------------- |
| `execute` | `(input: GetPostInput)` | `Promise<Result<PostDTO, UseCaseError>>` | Validates ID, queries read model |

**Has JSDoc:** ✅

---

### ListPostsUseCase (Query)

**File:** `apps/api/src/application/posts/ListPostsUseCase.ts`
**Layer:** application
**Description:** CQRS read-side query that lists posts for a specific project with pagination (max 100 per page) and optional sorting.

#### Methods

| Method    | Signature                 | Returns                                          | Description                                  |
| --------- | ------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `execute` | `(input: ListPostsInput)` | `Promise<Result<ListPostsOutput, UseCaseError>>` | Validates project ID, queries paginated list |

**Has JSDoc:** ✅

---

### GetPostWithThreadQuery (Query)

**File:** `apps/api/src/application/posts/GetPostWithThreadQuery.ts`
**Layer:** application
**Description:** CQRS read-side query that retrieves a post enriched with its thread data (tweets ordered by sequence) via a single optimized call.

#### Methods

| Method    | Signature                         | Returns                                                  | Description                                |
| --------- | --------------------------------- | -------------------------------------------------------- | ------------------------------------------ |
| `execute` | `(input: GetPostWithThreadInput)` | `Promise<Result<PostReadModelWithThread, UseCaseError>>` | Returns post with optional thread (tweets) |

**Has JSDoc:** ✅ Full JSDoc with `@throws` and `@example`.

---

### ListPostsGlobalQuery (Query)

**File:** `apps/api/src/application/posts/ListPostsGlobalQuery.ts`
**Layer:** application
**Description:** CQRS read-side query that lists posts across all projects with optional status filtering and pagination for admin/cross-project views.

#### Methods

| Method    | Signature                       | Returns                                                         | Description                                          |
| --------- | ------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| `execute` | `(input: ListPostsGlobalInput)` | `Promise<Result<PaginatedResult<PostReadModel>, UseCaseError>>` | Cross-project paginated post list with status filter |

**Has JSDoc:** ✅

---

## API Layer (`apps/api/`) — Content Sync System

### ContentVersionManager

**File:** `apps/api/src/content/ContentVersionManager.ts`
**Layer:** infrastructure
**Description:** Facade orchestrating the content versioning system. Delegates to VersionController, DiffCalculator, BranchManager, and MergeManager.

#### Methods

| Method                  | Signature                                                      | Returns                                        | Description                                     |
| ----------------------- | -------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| `createVersion`         | `(postId, content, adaptations, metadata)`                     | `Promise<OrchestrationResult<ContentVersion>>` | Creates a new content version snapshot          |
| `getVersionHistory`     | `(postId, branchName?, limit?)`                                | `Promise<ContentVersion[]>`                    | Gets version history for a post                 |
| `restoreVersion`        | `(versionId, restoredBy)`                                      | `Promise<OrchestrationResult<ContentVersion>>` | Restores content to a specific version          |
| `createBranch`          | `(postId, branchName, baseVersionId, createdBy, description?)` | `Promise<OrchestrationResult<VersionBranch>>`  | Creates a new content branch                    |
| `compareVersions`       | `(fromVersionId, toVersionId)`                                 | `Promise<OrchestrationResult<VersionDiff[]>>`  | Generates field-level diff between two versions |
| `createMergeRequest`    | `(postId, sourceBranch, targetBranch, requestedBy)`            | `Promise<OrchestrationResult<MergeRequest>>`   | Creates a merge request between branches        |
| `resolveMergeConflicts` | `(mergeRequestId, resolutions)`                                | `Promise<OrchestrationResult<MergeRequest>>`   | Resolves conflicts on a pending merge           |
| `executeMerge`          | `(mergeRequestId, mergedBy)`                                   | `Promise<OrchestrationResult<ContentVersion>>` | Executes an approved merge                      |

**Has JSDoc:** ⚠️ Has method descriptions but no `@method` tags.

---

### Supporting Content Services

| File                                  | Layer          | Description                                                 |
| ------------------------------------- | -------------- | ----------------------------------------------------------- |
| `VersionController.ts`                | infrastructure | CRUD operations for content versions (create, get, restore) |
| `DiffCalculator.ts`                   | infrastructure | Field-level diff calculation between versions               |
| `BranchManager.ts`                    | infrastructure | Branch CRUD and head version tracking                       |
| `MergeManager.ts`                     | infrastructure | Merge request lifecycle and 3-way merge execution           |
| `ConflictDetector.ts`                 | infrastructure | Detects and records sync conflicts                          |
| `SyncEngine.ts` / `SyncEngineImpl.ts` | infrastructure | Content synchronization orchestrator                        |
| `SyncScheduler.ts`                    | infrastructure | Scheduled sync job management                               |
| `PlatformContentAdapter.ts`           | infrastructure | Content adaptation for target providers                     |
| `PlatformContentAdapterStrategy.ts`   | infrastructure | Strategy pattern for per-provider adaptation rules          |
| `PlatformContentAdapterValidation.ts` | infrastructure | Platform-specific content validation                        |
| `PlatformContentAdapterCore.ts`       | infrastructure | Core adaptation logic shared across providers               |
| `platformContentAdapterHelpers.ts`    | infrastructure | Helper utilities for content adaptation                     |

---

## REST Endpoints (`contentRoutes.ts`)

All require `requireClientAuth`.

### Sync Operations

| Method | Path                                    | Description                   |
| ------ | --------------------------------------- | ----------------------------- |
| POST   | `/content/sync/:postId`                 | Sync a post through a channel |
| GET    | `/content/sync/metrics`                 | Global sync metrics           |
| GET    | `/content/sync/metrics/:channelId`      | Per-channel sync metrics      |
| POST   | `/content/sync/:transactionId/rollback` | Roll back a sync transaction  |

### Channel Management

| Method | Path                                      | Description                           |
| ------ | ----------------------------------------- | ------------------------------------- |
| POST   | `/content/channels`                       | Create sync channel between providers |
| POST   | `/content/channels/realtime/start`        | Start real-time sync for a post       |
| POST   | `/content/channels/realtime/stop/:postId` | Stop real-time sync for a post        |

### Version Management

| Method | Path                                           | Description                                 |
| ------ | ---------------------------------------------- | ------------------------------------------- |
| GET    | `/content/versions/:postId`                    | List version history (query: branch, limit) |
| POST   | `/content/versions/:postId`                    | Create version snapshot                     |
| POST   | `/content/versions/:postId/restore/:versionId` | Restore to a specific version               |
| POST   | `/content/versions/compare`                    | Compare two versions (diff)                 |

### Conflict Management

| Method | Path                                    | Description                    |
| ------ | --------------------------------------- | ------------------------------ |
| POST   | `/content/conflicts/resolve`            | Apply conflict resolutions     |
| GET    | `/content/conflicts/history/:channelId` | Conflict history for a channel |

### Content Transformation

| Method | Path                                 | Description                           |
| ------ | ------------------------------------ | ------------------------------------- |
| POST   | `/content/transform`                 | Adapt content for one provider        |
| POST   | `/content/transform/multi`           | Adapt for multiple providers          |
| POST   | `/content/transform/recommendations` | Get per-provider recommendations      |
| POST   | `/content/render/:provider`          | Render content preview for a provider |
| POST   | `/content/diff`                      | Diff two raw version objects          |

---

## Key Types

### Post Use Case Types

| Type                        | File                        | Description                                                              |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `CreatePostInput`           | `CreatePostUseCase.ts`      | Post creation params (projectId, body, title, tags, locale, scheduledAt) |
| `CreatePostOutput`          | `CreatePostUseCase.ts`      | Created post DTO                                                         |
| `UpdatePostInput`           | `UpdatePostUseCase.ts`      | Update params (postId, body?, title?, summary?, tags?)                   |
| `SchedulePostInput`         | `SchedulePostUseCase.ts`    | Schedule params (postId, channelIds, scheduledFor, timezone?)            |
| `SchedulePostOutput`        | `SchedulePostUseCase.ts`    | Scheduled post DTO                                                       |
| `PostDTO` / `PostReadModel` | `GetPostUseCase.ts`         | Read-side post representation                                            |
| `ListPostsOutput`           | `ListPostsUseCase.ts`       | Paginated post list with items, total, page, hasNext                     |
| `PostReadModelWithThread`   | `GetPostWithThreadQuery.ts` | Post with optional thread tweets                                         |

### Content Sync Types (`contentVersionTypes.ts`)

| Type                 | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `ContentVersion`     | Version snapshot with content, adaptations, metadata       |
| `VersionBranch`      | Branch with name, headVersionId, status                    |
| `MergeRequest`       | Merge between branches with conflicts, resolutions, status |
| `VersionConflict`    | Detected conflict between versions                         |
| `ConflictResolution` | User-supplied resolution for a conflict                    |
| `VersionDiff`        | Field-level diff entry                                     |
| `VersionMetadata`    | Version metadata (createdBy, changelog, tags)              |
| `VersionSnapshot`    | Lightweight version reference                              |

### Platform Adaptation Types (`platformContentAdapterTypes.ts`)

| Type                  | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `PlatformAdaptation`  | Adapted content with metadata, warnings, threading info  |
| `AdaptationRule`      | Provider-specific adaptation rule                        |
| `ContentPayload`      | Canonical content structure for adaptation               |
| `ProviderConstraints` | Provider limits (chars, media, capabilities, formatting) |

---

## Client Portal (`apps/client/`)

| File                                                   | Type      | Description                                                                                                             |
| ------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `components/publishing/UnifiedPublishingDashboard.tsx` | Component | Main publishing dashboard with compose, queue, schedule views                                                           |
| `components/publishing/publishingDashboardApi.ts`      | Utility   | API helpers: `fetchProviderStatuses`, `fetchProviderConstraints`, `fetchSchedules`, `publishContent`, `scheduleContent` |
| `components/campaigns/CampaignList.tsx`                | Component | Campaign list with post references                                                                                      |
| `components/campaigns/CreateCampaignModal.tsx`         | Component | Campaign creation with post selection                                                                                   |
| `components/campaigns/CampaignCard.tsx`                | Component | Campaign card with status badges                                                                                        |
| `components/scheduling/SchedulingDashboard.tsx`        | Component | Calendar-based scheduling dashboard                                                                                     |
| `components/scheduling/WeekCalendar.tsx`               | Component | Weekly calendar view for scheduled posts                                                                                |
| `components/scheduling/DayCalendar.tsx`                | Component | Daily calendar view                                                                                                     |
| `components/scheduling/CSVBulkUpload.tsx`              | Component | Bulk post creation from CSV                                                                                             |
| `components/scheduling/RecurringPostCard.tsx`          | Component | Recurring post configuration                                                                                            |

---

## Admin Portal (`apps/admin/`)

Admin references to content domain are primarily through the analytics and subscriptions pages which display post counts and publishing metrics. The admin does not directly manage content CRUD -- that is client-only.
