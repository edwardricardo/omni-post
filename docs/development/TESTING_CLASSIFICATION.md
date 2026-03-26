# OmniPost — Untested Files Classification

Date: 2026-03-24

## Summary

| Category                  | Count     | %    | Action                      |
| ------------------------- | --------- | ---- | --------------------------- |
| A — Unit testable now     | 233       | 22%  | Write tests in F3+          |
| B — Integration testable  | 349       | 33%  | Add to integration backlog  |
| C — E2E only              | 264       | 25%  | Add to Playwright backlog   |
| D — Exempt (no logic)     | 203       | 19%  | Exclude from Stryker        |
| E — Blocked by constraint | 10        | 1%   | Document + refactor backlog |
| **Total untested**        | **1,059** | 100% |                             |

## By App/Package

| Location    | A       | B       | C       | D       | E      | Total     |
| ----------- | ------- | ------- | ------- | ------- | ------ | --------- |
| apps/api    | 131     | 205     | 0       | 59      | 7      | 404       |
| apps/admin  | 18      | 36      | 166     | 12      | 0      | 232       |
| apps/client | 12      | 13      | 79      | 12      | 0      | 116       |
| packages/\* | 72      | 95      | 19      | 120     | 3      | 309       |
| **Total**   | **233** | **349** | **264** | **203** | **10** | **1,059** |

---

## Category A — Unit Testable Now (233 files)

### apps/api — Application Use Cases (85 files)

All in `src/application/`. Pure use cases with injectable repository deps.

| Subdirectory                                                                             | Files | Key Use Cases                                                                                 |
| ---------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| posts                                                                                    | 7     | CreatePost, UpdatePost, DeletePost, SchedulePost, ApprovePost, ListPosts, GetPost             |
| campaigns                                                                                | 7     | Create, Update, Archive, TagPost, UntagPost, GetCampaign, ListCampaigns                       |
| inbox                                                                                    | 13    | IngestMessage, MarkRead, AssignMessage, SendReply, ResolveConversation, GetInbox, GetUnread   |
| comments                                                                                 | 4     | CreateComment, EditComment, DeleteComment, GetPostComments                                    |
| crisis                                                                                   | 3     | EnterCrisisMode, ExitCrisisMode, GetCrisisStatus                                              |
| notifications                                                                            | 6     | Create, MarkRead, GetNotifications, GetUnreadCount, MarkAllRead, Subscribe                    |
| recurring                                                                                | 5     | Create, Update, Deactivate, Process, GetRecurring                                             |
| reports                                                                                  | 5     | CreateScheduled, GenerateReport, DeleteScheduled, UpdateScheduled, ListReports                |
| team                                                                                     | 5     | InviteTeamMember, RemoveTeamMember, UpdateRole, GetTeamMembers, AcceptInvitation              |
| analytics                                                                                | 6     | GetDashboard, GetPostAnalytics, GetChannelAnalytics, ComparePerformance, GetROI, ExportReport |
| approvals                                                                                | 5     | SubmitForReview, Approve, Reject, GetPendingApprovals, GetApprovalHistory                     |
| links                                                                                    | 4     | CreateTrackedLink, GetLinkAnalytics, ListLinks, GenerateShortCode                             |
| ML                                                                                       | 4     | PredictEngagement, OptimizeContent, AnalyzeAudience, DetectTrends                             |
| aiPromptTemplates                                                                        | 3     | Create, Update, ListPromptTemplates                                                           |
| other (brand-voice, events, external-notifications, first-comment, usage, utm, ai-image) | 8     | Various CRUD use cases                                                                        |

### apps/api — Domain Layer (44 files)

| Sublayer      | Files | Key Items                                                                                                                                                                                                                                                                                                            |
| ------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aggregates    | 5     | AggregateRoot, ApprovalRequestAggregate, PostAggregate, PostCommentAggregate, SocialMessageAggregate                                                                                                                                                                                                                 |
| Entities      | 11    | Account, Campaign, Channel, LinkClick, Notification, Project, RecurringPost, ScheduledReport, SocialConversation, TeamMember, TrackedLink                                                                                                                                                                            |
| Value Objects | 27    | ApprovalRequestId, CampaignStatus, CommentId, Content, EntityId, MediaAttachment, NotificationId, NotificationType, Provider, PublishStatus, ReviewDecision, ScheduledTime, ShortCode, SocialConversationId, SocialMessageId, SocialMessageStatus, SocialMessageType, TeamMemberId, TeamRole, UTMParameters + 7 more |
| Errors        | 1     | DomainError                                                                                                                                                                                                                                                                                                          |

### packages — Pure Logic (72 files)

| Package               | Files | Key Items                                                                                                          |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| shared/src            | 10    | CQRS base, events, errors, saga, orchestration, analytics, client DTOs, templates                                  |
| providers/facebook    | 8     | insightsHelpers, marketingHelpers, community, reels, stories, shop.catalog, shop.management, videoProcessorHelpers |
| providers/youtube     | 3     | communityFeatures, playlistAnalyticsHelpers, shortsHelpers                                                         |
| providers/snapchat    | 1     | responseParsers                                                                                                    |
| providers/shared      | 2     | AbstractProviderAdapter, ProviderError                                                                             |
| adapters/cache-redis  | 6     | access-patterns, cache-manager, invalidation, l1-cache, metrics, factory                                           |
| adapters/queue-bullmq | 1     | resilience                                                                                                         |
| adapters/db-prisma    | 1     | resilience                                                                                                         |
| core/threading        | 1     | threadPlanner                                                                                                      |
| observability         | 2     | businessMetrics, correlationTracking                                                                               |
| ui/src                | 1     | lib/utils (clsx+tw-merge)                                                                                          |

### apps/admin — Pure Utilities (18 files)

| File                                              | What to test                                               |
| ------------------------------------------------- | ---------------------------------------------------------- |
| lib/csv/schedulingCsvParser.ts                    | CSV parsing, row validation, timezone handling             |
| lib/ai-content-utils.ts                           | Color mappers, character limits, hashtag generation        |
| components/content/library/utils.ts               | Status colors, date formatting, text truncation            |
| components/scheduling/schedulingDashboardUtils.ts | Status badges, priority colors, date formatting            |
| components/ai/analytics/utils.ts                  | Analytics data transformation                              |
| components/instagram/stories/utils.ts             | Video duration, segment splitting                          |
| 12 type definition files                          | Type definitions (actually D, but counted as borderline A) |

### apps/client — Pure Utilities (12 files)

| File                                  | What to test                        |
| ------------------------------------- | ----------------------------------- |
| lib/utils/providerMapper.ts           | Provider → ProviderMetadata mapping |
| lib/templates/templateEngine.ts       | Template variable substitution      |
| lib/templates/ClientTemplateEngine.ts | Template engine implementation      |
| lib/templates/postTemplates.ts        | Static template data                |
| lib/providers/registry.ts             | Provider registry lookups           |
| 7 type/re-export files                | Type definitions (borderline D)     |

---

## Category B — Integration Testable (349 files)

### apps/api — Infrastructure (205 files)

| Sublayer                     | Files | Infrastructure Needed                       |
| ---------------------------- | ----- | ------------------------------------------- |
| Prisma Repositories          | 23    | Real PostgreSQL + Prisma                    |
| Auth & Security              | 10    | Redis sessions, OAuth endpoints             |
| Orchestrators                | 8     | Multi-service coordination, DB transactions |
| Saga Management              | 4     | Distributed transactions, DB state          |
| Infrastructure Adapters      | 8     | External APIs (GA4, Slack, Teams, email)    |
| Analytics Services           | 28    | Historical metrics data, real DB            |
| Domain Repository Interfaces | 33    | Actual tests on Prisma adapters             |
| Event Services               | 2     | Event store (DB)                            |
| Webhook Processors           | 3     | Message queue, provider endpoints           |
| Route Handlers (with logic)  | 20+   | Fastify request/response                    |
| Other infrastructure         | 66    | Various real service deps                   |

### packages — API Clients & Adapters (95 files)

| Package                           | Files | Infrastructure Needed     |
| --------------------------------- | ----- | ------------------------- |
| Provider apiClients (9 providers) | 11    | HTTP + provider APIs      |
| Provider adapters (main)          | 9     | Already tested, some gaps |
| db-prisma repositories            | 7     | Real PostgreSQL           |
| health-check checkers             | 6     | Real DB, Redis, storage   |
| Other adapters                    | 5     | Redis, BullMQ             |
| workers                           | 7     | BullMQ, PostgreSQL, Redis |
| Various                           | 50    | Mixed infrastructure      |

### apps/admin — API Hooks (36 files)

27 TanStack Query hooks in `hooks/api/use*.ts` + HTTP clients + stores.

### apps/client — API Layer (13 files)

API hooks, context providers, HTTP client, auth API.

---

## Category C — E2E Only (264 files)

### apps/admin — React Components + Pages (166 files)

| Area                    | Files | Description                                            |
| ----------------------- | ----- | ------------------------------------------------------ |
| Dashboard pages         | 36    | All pages under `app/(dashboard)/`                     |
| AI components           | 12    | AIContentGenerator, SmartContentOptimizer, etc.        |
| Analytics components    | 10    | PerformanceInsights, UniversalAnalytics, etc.          |
| Content components      | 14    | ContentLibrary, templates, library views               |
| Editor components       | 3     | AdminContentEditor, ContentPreview, ProviderAdaptation |
| Inbox components        | 8     | ConversationCard, Thread, ReplyComposer, etc.          |
| Instagram components    | 7     | StoriesEditor, MediaUpload, VideoSplitPreview          |
| Queue components        | 9     | PublishingQueueManager, views, filters                 |
| Scheduling components   | 14    | Dashboard, Calendar, RecurrenceSelector, etc.          |
| Security components     | 2     | MfaManager, RbacManager                                |
| Settings components     | 4     | BrandVoiceForm, WebhookForm, etc.                      |
| Webhooks components     | 5     | DeadLetterQueue, EventsList, Metrics, etc.             |
| Approval components     | 4     | ApprovalCard, Queue, ReviewPanel, etc.                 |
| Auth components         | 2     | login-form, logout-button                              |
| Shared components       | 4     | LoadingSpinner, SidebarNav, SkipLink, VisuallyHidden   |
| Notification components | 3     | NotificationBell, Item, Preferences                    |
| Custom hooks            | 6     | useAIContentGenerator, useFocusTrap, etc.              |
| Publishing components   | 2     | publishingDashboardApi, UnifiedPublishingDashboard     |

### apps/client — React Components + Pages (79 files)

| Area                  | Files | Description                                                            |
| --------------------- | ----- | ---------------------------------------------------------------------- |
| Dashboard pages       | 8     | All pages under `app/dashboard/`                                       |
| Auth pages            | 3     | login, register, error pages                                           |
| Editor components     | 4     | ClientContentEditor, PlatformPreview, SchedulePicker, TemplateSelector |
| Template components   | 22    | ABTestManager, TemplateEditor, VersionControl, etc.                    |
| Publishing components | 2     | PublishDialog, PublishingInterface                                     |
| Provider components   | 1     | ProviderCard                                                           |
| Custom hooks          | 2     | useABTestManager, useTemplateVersionControl                            |
| Other                 | 37    | Storybook stories, E2E infrastructure                                  |

### packages/ui — Business Components (19 files)

| Component                   | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| ContentEditorCore.tsx       | Rich content editor                                        |
| ContentVersioning.tsx       | Version management UI                                      |
| TipTapContentEditor.tsx     | TipTap editor wrapper                                      |
| ValidationContentEditor.tsx | Validated editor                                           |
| VirtualScrollList.tsx       | Virtual scroll container                                   |
| Version\*.tsx (5 files)     | Version views (Compact, Compare, Detail, Filter, Timeline) |
| useContentEditor.ts         | Content editor hook                                        |
| useContentVersioning.ts     | Version control hook                                       |
| useProviderConstraints.ts   | Provider constraints hook                                  |
| usePublishingEngine.ts      | Publishing engine hook                                     |

---

## Category D — Exempt (203 files)

| Pattern                                   | Count | Reason                                |
| ----------------------------------------- | ----- | ------------------------------------- |
| index.ts re-exports                       | ~45   | No logic, barrel exports              |
| types.ts / interfaces                     | ~40   | Type definitions only                 |
| Constants / enums                         | ~15   | Static data                           |
| Config files                              | ~12   | Vitest, Playwright, Storybook configs |
| DI container setup (20 files in apps/api) | 20    | Composition root, no logic            |
| Route handlers (thin wrappers)            | 20    | Delegate to use cases                 |
| Layout/error/loading pages                | ~12   | Framework pages                       |
| Storybook stories                         | ~15   | Documentation files                   |
| E2E test infrastructure                   | ~12   | Page objects, fixtures                |
| Radix UI wrappers (packages/ui)           | 25    | Thin wrappers over Radix primitives   |

---

## Category E — Blocked by Constraint (10 files)

### apps/api — Admin Services (7 files)

| File                                      | Constraint                | Fix                          | Effort |
| ----------------------------------------- | ------------------------- | ---------------------------- | ------ |
| src/admin/accountLifecycleQueryService.ts | Imports `prisma` directly | Inject PostRepository        | S      |
| src/admin/AccountSessionService.ts        | Hardcoded `prisma` calls  | Inject repos via constructor | S      |
| src/admin/auth/AdminAuthService.ts        | Direct Prisma usage       | Inject AdminUserRepository   | M      |
| src/admin/auth/MfaService.ts              | Direct Prisma             | Inject MFA repo              | S      |
| src/admin/auth/PasswordService.ts         | Direct Prisma             | Inject account repo          | S      |
| src/admin/auth/TokenService.ts            | Direct Prisma for tokens  | Inject token repo            | S      |
| src/admin/dashboardService.ts             | Direct Prisma             | Inject query repos           | M      |

### packages — Hardcoded Infrastructure (3 files)

| File                                                     | Constraint                | Fix                    | Effort |
| -------------------------------------------------------- | ------------------------- | ---------------------- | ------ |
| providers/facebook/src/apiClient.ts                      | Hardcoded circuit breaker | Inject ICircuitBreaker | M      |
| observability/opentelemetry/src/customInstrumentation.ts | Hardcoded OTel SDK        | Inject tracer provider | M      |
| adapters/dead-letter-queue/src/index.ts                  | Hardcoded Prisma          | Inject via constructor | S      |

**Total effort estimate:** ~2 days to refactor all 10 files → Category A.

---

## Highest Priority Class A Files

Top 10 files ordered by estimated business impact:

| #   | File                                                | LOC Est. | Priority |
| --- | --------------------------------------------------- | -------- | -------- |
| 1   | apps/api/src/application/posts/\* (7 use cases)     | ~700     | CRITICAL |
| 2   | apps/api/src/application/inbox/\* (13 use cases)    | ~1,500   | HIGH     |
| 3   | apps/api/src/domain/aggregates/PostAggregate.ts     | ~400     | HIGH     |
| 4   | apps/api/src/application/campaigns/\* (7 use cases) | ~500     | HIGH     |
| 5   | apps/api/src/application/recurring/\* (5 use cases) | ~330     | HIGH     |
| 6   | apps/api/src/application/ML/\* (4 use cases)        | ~900     | MEDIUM   |
| 7   | packages/shared/src/cqrs.ts                         | ~200     | MEDIUM   |
| 8   | packages/shared/src/saga.ts                         | ~200     | MEDIUM   |
| 9   | apps/api/src/domain/entities/Campaign.ts            | ~200     | MEDIUM   |
| 10  | apps/admin/lib/csv/schedulingCsvParser.ts           | ~150     | MEDIUM   |

---

## packages/ui Assessment

45 source files total:

- **25 Radix wrappers** (D — exempt): button, input, select, dialog, etc. Thin `forwardRef` wrappers with className prop.
- **14 Business components** (C — E2E): ContentEditorCore, ContentVersioning, TipTapEditor, Version views. Complex React components with state, effects, and user interaction.
- **5 Hooks** (C — E2E): useContentEditor, useContentVersioning, useProviderConstraints, usePublishingEngine, useProviderConstraints.
- **1 Utility** (A — unit testable): `lib/utils.ts` — `cn()` function (clsx + tailwind-merge).

---

## packages/shared Assessment

13 source files total:

- **10 Pure logic** (A): CQRS bus, events, errors, saga state machine, orchestration, analytics, client DTOs, templates, provider config, logger.
- **2 Type files** (D): types.ts, templates/types.ts.
- **1 Re-export** (D): index.ts.

---

## packages/ports Assessment

5 source files — all **D (exempt)**:

- ProviderAdapter.ts, QueuePort.ts, RepoPort.ts, StoragePort.ts, index.ts.
- Pure TypeScript interfaces with zero logic.

---

## Circuit Breaker Constraint Detail

The custom CircuitBreaker in `packages/monitoring/circuit-breaker/` is used by:

- All 9 provider `apiClient.ts` files (Bluesky, Facebook, Instagram, LinkedIn, Pinterest, Snapchat, Telegram, TikTok, X, YouTube)
- `packages/adapters/storage-s3/src/index.ts`
- `packages/adapters/external-apis/src/circuitBreaker.ts`

**Note:** grep found 0 direct `opossum` imports — the project uses a custom CircuitBreaker, not the opossum npm package.

Only Facebook's apiClient is classified as E (blocked) because it instantiates CircuitBreaker internally. The other providers were already excluded from Stryker scope in Sessions Batch 2-3 and moved to integration test stubs.

**Options to fix testability:**

1. **Inject ICircuitBreaker via constructor** — each apiClient accepts a circuit breaker interface instead of creating one internally. Effort: S per file, but 10+ files affected.
2. **Accept current ceiling** — apiClient files are integration scope. Unit tests cover the adapter layer above them. The circuit breaker plumbing is tested via `packages/monitoring/circuit-breaker/tests/`.

**Recommendation:** Option 2 — the circuit breaker itself is tested. The apiClient files are integration scope and already have `.todo()` integration test stubs.
