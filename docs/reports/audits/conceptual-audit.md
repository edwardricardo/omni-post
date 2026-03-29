# OmniPost — Conceptual Feature Audit

> Deep comparison between OmniPost codebase and the feature model of a full-spectrum
> social media management platform.
> **Generated:** 2026-03-10 | **Codebase:** Genesis branch (post Phase 1 + Phase 4)
> **Method:** Exhaustive codebase exploration — 41 route files, 90+ use cases, 65 Prisma models,
> 9 provider packages, 160+ frontend components audited before writing a single line.

---

## EXECUTIVE SUMMARY

### Domain Completion Scores

| Domain                                | Implemented | Partial | Missing | Score   | Status                          |
| ------------------------------------- | ----------- | ------- | ------- | ------- | ------------------------------- |
| D1: Unified Content Composer          | 2/6         | 3/6     | 1/6     | **58%** | 🟡 Parcial                      |
| D2: Scheduling & Content Calendar     | 3/6         | 3/6     | 0/6     | **75%** | 🟡 Parcial                      |
| D3: Multi-Platform Publishing Engine  | 8/14        | 5/14    | 1/14    | **75%** | 🟡 Parcial                      |
| D4: Social Inbox (Unified Engagement) | 0/7         | 6/7     | 1/7     | **43%** | 🟡 Backend only, 0% UI          |
| D5: Social Listening                  | 0/8         | 1/8     | 7/8     | **6%**  | 🔴 Mínimo                       |
| D6: AI-Assisted Content Creation      | 2/8         | 2/8     | 4/8     | **38%** | 🟡 Parcial                      |
| D7: Analytics & Reporting             | 4/10        | 5/10    | 1/10    | **65%** | 🟡 Parcial                      |
| D8: Team Collaboration & Approvals    | 2/6         | 4/6     | 0/6     | **67%** | 🟡 Backend complete, UI missing |
| D9: Asset Library & Content Storage   | 0/6         | 4/6     | 2/6     | **33%** | 🔴 Básico                       |
| D10: Employee Advocacy                | 0/5         | 0/5     | 5/5     | **0%**  | 🔴 No existe                    |
| D11: Social Advertising               | 0/5         | 1/5     | 4/5     | **10%** | 🔴 Mínimo                       |
| D12: Multi-Tenant Account Management  | 4/6         | 1/6     | 1/6     | **75%** | 🟡 Parcial                      |
| D13: Integrations & Extensibility     | 2/7         | 1/7     | 4/7     | **36%** | 🟡 Parcial                      |

**Overall: ~49% (across 98 individual capabilities)**

---

### Top 3 Strengths

1. **Architecture — Hexagonal + DDD + CQRS + Saga** — The technical foundation exceeds
   any commercial reference platform. Domain layer is fully clean (no Prisma, no Fastify,
   no BullMQ), 28 repository ports, Unit of Work with atomic event dispatch, dual-persistence
   Saga orchestration with compensating transactions. This is production-grade architecture
   rarely seen at this development stage.

2. **Multi-Platform Publishing Pipeline** — 9 active providers (X, Instagram, Facebook, YouTube,
   TikTok, LinkedIn, Pinterest, Snapchat, Telegram), all with real API calls (no stubs in
   publish path). Video transcoding pipeline, chunked upload with retry, circuit breaker
   protection, Dead Letter Queue, deduplication, rate-limit awareness. Exceeds reference model
   in Snapchat (model says listening-only) and Telegram (not in model).

3. **Security & Identity Layer** — MFA (TOTP + backup codes), RBAC with granular permissions
   per resource/action, argon2id password hashing, brute force protection, device fingerprinting,
   session management with concurrent limits, audit log middleware, credential encryption per
   provider. Exceeds commercial reference in auth maturity.

---

### Top 3 Critical Gaps

1. **Social Inbox UI (D4)** — The backend is 100% complete: Social Inbox module with 15 use cases
   (`IngestSocialMessage`, `SyncProviderComments`, `AssignMessage`, `SendReply`, `MarkRead`,
   `Archive`, `ResolveConversation`, `Reopen`, `GetInbox`, `GetConversation`, `GetMessages`,
   `GetMentions`, `GetUnreadCount`), `SocialMessageAggregate`, `SocialConversation` domain entities,
   `inboxRoutes.ts`. Zero frontend UI exists for any of this. This is the #1 feature users expect
   from a social media management platform.

2. **Approval Workflow UI + Team Collaboration UI (D8)** — Backend fully implemented in Phase 1:
   `ApprovalRequest` aggregate, `SubmitForReview/Approve/Reject` use cases, `PostComment` aggregate,
   `Notification` entity with SSE broadcaster, team member invite/remove/role management.
   Zero frontend UI exists for any approval flow, comment system, or notification center.

3. **Social Listening (D5)** — Near-total gap. Only `trendAnalysisService.ts` exists (trend analysis
   from TikTok trends API). No keyword monitoring, no brand mention alerts, no sentiment analysis,
   no competitor tracking, no alert system. These require either provider search APIs or a third-party
   listening service.

---

### Capabilities That Exceed the Reference Model

| Capability                          | Location                                                              | Description                                                                               |
| ----------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Telegram provider**               | `packages/providers/telegram/`                                        | Bot API publishing, text/photo/video/poll/media group. Not in reference model.            |
| **Snapchat publishing**             | `packages/providers/snapchat/`                                        | Reference model says "listening only." OmniPost publishes Stories/Spotlight.              |
| **Crisis Mode Management**          | `apps/api/src/application/crisis/`, `projects/crisisRoutes.ts`        | Enter/Exit/History crisis mode per project, pauses scheduled publishing.                  |
| **Content Versioning (git-like)**   | `apps/api/src/content/DiffCalculator.ts`, `ContentVersionManager.ts`  | Branch, merge, diff, conflict detection, commit history for content. Exceptional.         |
| **A/B Testing for Templates**       | `apps/client/components/templates/ABTestManager.tsx`, Prisma `ABTest` | Full A/B test manager with variant tracking and results analysis.                         |
| **Link Click Tracking**             | `apps/api/src/application/links/`, Prisma `TrackedLink`, `LinkClick`  | Branded tracked links with click analytics and referrer data.                             |
| **Saga Orchestration**              | `infra/prisma/schema.prisma` (SagaInstance), saga domain modules      | Distributed transaction coordination with automatic compensation.                         |
| **Multi-provider AI Orchestration** | `apps/api/src/ai/orchestrator.ts`                                     | Fallback chain across OpenAI, Gemini, Perplexity with caching and metrics.                |
| **MFA + Device Fingerprinting**     | `apps/api/src/auth/mfaRoutes.ts`, `authServiceCore.ts`                | TOTP + backup codes + device-level session management. Exceeds typical SaaS auth.         |
| **Recurring Posts (cron-based)**    | `apps/api/src/application/recurring/`, domain `RecurringPost` entity  | CronExpression VO, BullMQ repeatable jobs, content rotation (EXACT/ROTATED/AI_GENERATED). |

---

### Dead Weight

| File / Module                                                                    | Evidence                                                                                                           | Recommendation                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `apps/api/src/application/ml/PredictAudienceResponseUseCase.ts`                  | Rule-based heuristic. No frontend consumer. No evidence it is wired to any route.                                  | **REMOVE**                                                                |
| `packages/providers/tiktok/src/marketingApiClient.ts` `.createPromotedContent()` | Logs `"Marketing campaign creation not fully implemented"` but doesn't fail. Dead stub that confuses the pipeline. | **REMOVE or IMPLEMENT**                                                   |
| `packages/providers/youtube/src/` community posts in `publishCommunityPost()`    | Returns hardcoded `err("VALIDATION")` — YouTube Community Tab API requires partner-level access not grantable.     | **DOCUMENT and REMOVE stub** — replace with clear `⚫ OUT OF SCOPE` note. |

---

### Recommended Next Sprint Focus

Based on the full audit, the 7 highest-leverage items:

1. **D4 — Social Inbox UI** (XL) — Backend 100% ready. Build admin inbox view: conversation list, message thread, reply composer, assignment, resolution. This unlocks the core engagement loop.
2. **D8 — Approval Workflow UI** (M) — Backend 100% ready. Add approval panel to post editor: submit-for-review button, reviewer interface, approve/reject actions with comment. Unblocks team collaboration.
3. **D8 — Notification Center UI** (M) — Backend 100% ready. Add notification bell to admin header with dropdown, SSE listener for real-time updates.
4. **D6 — AI Image Generation UI** (S) — Backend complete (DALL-E 3 via `GenerateImageUseCase`). Build generation form in admin AI section, output gallery, insert-to-editor action.
5. **D2 — Recurring Posts UI** (M) — Backend complete. Build CRUD UI for recurring post schedules with cron picker, content rotation config.
6. **D1 — Platform Preview expansion** (S) — Current preview covers X, Instagram, LinkedIn. Extend to Facebook, TikTok, YouTube, Snapchat, Pinterest, Telegram.
7. **D3 — Bluesky provider** (M) — The last major missing provider. AT Protocol is open, no API key approval required. Unlocks growing audience.

---

## DOMAIN-BY-DOMAIN AUDIT MATRIX

### Status Codes

| Code             | Meaning                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| ✅ IMPLEMENTED   | Fully working end-to-end: UI → use case → adapter → platform API. Not mocked.                  |
| 🟡 PARTIAL       | Exists in code but incomplete: missing UI, mocked data, stub, or wired to only some platforms. |
| 🔴 MISSING       | No evidence of this capability anywhere in the codebase.                                       |
| ⚫ OUT OF SCOPE  | Deliberately excluded from OmniPost's product vision.                                          |
| 🔵 EXCEEDS MODEL | OmniPost has a capability that the reference model does not describe.                          |

---

### DOMAIN 1 — UNIFIED CONTENT COMPOSER

> Reference: Single composer interface for multi-platform post creation with per-platform preview,
> customization, emoji/hashtag/link insertion, design tool integration, all media types,
> publish-now and schedule-later paths.

| #   | Capability                                                     | Status         | Evidence                                                                                                                                                                                                               | Notes / What's Missing                                                                                    |
| --- | -------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1.1 | Platform-specific preview per channel                          | 🟡 PARTIAL     | `apps/client/components/editor/PlatformPreview.tsx` — renders X/Twitter, Instagram, LinkedIn thread segments                                                                                                           | Missing preview for Facebook, TikTok, YouTube, Snapchat, Pinterest, Telegram (6 of 9 providers uncovered) |
| 1.2 | Per-platform copy and media customization                      | ✅ IMPLEMENTED | `apps/api/src/content/PlatformContentAdapter.ts` (+ Core, Strategy, Validation splits); `apps/admin/components/editor/ProviderAdaptationEngine.tsx`                                                                    | Adapts content per provider: char limits, hashtag strategy, media format                                  |
| 1.3 | Emoji, hashtag, and shortened link insertion                   | 🟡 PARTIAL     | Hashtag: `SmartContentOptimizerHashtags.tsx`, AI generation via `aiService.ts`. Links: `apps/api/src/application/links/CreateTrackedLinkUseCase.ts`, `utm/GenerateUTMLinksUseCase.ts`                                  | No emoji picker component. Hashtag insertion via AI suggestion, not inline picker.                        |
| 1.4 | Inline design tool integration (Canva, Adobe)                  | 🔴 MISSING     | No file found.                                                                                                                                                                                                         | No Canva Connect API, no Adobe Express embed integration.                                                 |
| 1.5 | All media types: images, video, carousels, PDFs, link previews | 🟡 PARTIAL     | Images/video: `apps/admin/components/instagram/MediaUploadZone.tsx`, Prisma `PostMedia`. Carousels: Instagram/LinkedIn adapters. PDFs: LinkedIn `LinkedInAdapter.ts` `uploadDocument()`. Link previews: no file found. | Link preview/unfurling (OG tag fetch) does not exist in editor. PDF support limited to LinkedIn.          |
| 1.6 | Publish now + schedule for later from same interface           | ✅ IMPLEMENTED | `apps/client/app/(dashboard)/posts/new/page.tsx`, `apps/client/components/publishing/PublishingInterface.tsx`, `apps/client/components/editor/SchedulePicker.tsx`                                                      | Both publish paths wired to same creation flow.                                                           |

**Score: 2 ✅ + 3 🟡 + 1 🔴 = ~58%**

---

### DOMAIN 2 — SCHEDULING & CONTENT CALENDAR

> Reference: Individual scheduling, bulk CSV scheduling, visual drag-and-drop calendar,
> filtered views, queue-based auto-scheduling, preview in calendar.

| #   | Capability                                                  | Status         | Evidence                                                                                                                    | Notes / What's Missing                                                                                                   |
| --- | ----------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | Individual post scheduling with date/time picker            | ✅ IMPLEMENTED | `apps/client/components/editor/SchedulePicker.tsx`, `apps/api/src/application/posts/SchedulePostUseCase.ts`                 | Date/time picker, transitions post to SCHEDULED status.                                                                  |
| 2.2 | Bulk scheduling via CSV or batch mechanism                  | 🟡 PARTIAL     | `apps/admin/components/scheduling/SchedulingDashboard.tsx` (`BulkScheduleView` tab), `MultiPlatformSchedulerRefactored.tsx` | Bulk scheduling UI exists. CSV import not confirmed — bulk form may require manual entry per post.                       |
| 2.3 | Visual calendar with drag-and-drop rescheduling             | ✅ IMPLEMENTED | `apps/admin/components/scheduling/SchedulingDashboardCalendar.tsx`, `CalendarView.tsx`                                      | Calendar with day/week/month views, drag-and-drop rescheduling confirmed.                                                |
| 2.4 | Calendar filtered by platform, account, team, tag, campaign | 🟡 PARTIAL     | `apps/admin/components/scheduling/SchedulingDashboardSidebar.tsx`, `RulesView.tsx`                                          | Scheduling rules exist. Full multi-dimension filtering (platform + campaign + team member simultaneously) not confirmed. |
| 2.5 | Queue-based auto-scheduling                                 | ✅ IMPLEMENTED | Prisma `PublishingQueue`, `apps/admin/components/queue/PublishingQueueManager.tsx`, `apps/workers/src/publishWorker.ts`     | BullMQ workers publish from queue. Priority, retry, DLQ all wired.                                                       |
| 2.6 | Post preview in calendar view before publishing             | 🟡 PARTIAL     | `apps/admin/components/scheduling/SchedulingDashboardPostModal.tsx`                                                         | Post modal exists on calendar. Full rich preview (rendered per platform) not confirmed in calendar view.                 |

**Score: 3 ✅ + 3 🟡 + 0 🔴 = ~75%**

---

### DOMAIN 3 — MULTI-PLATFORM PUBLISHING ENGINE

> Reference: X, Instagram (Feed/Stories/Reels/Carousel), Facebook (Page/Stories/Reels),
> YouTube (Videos/Shorts/Community), TikTok, LinkedIn, Pinterest, Bluesky, Snapchat (listening only).
> Format enforcement, transcoding, chunked upload, retry, rate limiting.

| #    | Capability                                | Status           | Evidence                                                                                                                                                                                                   | Notes / What's Missing                                                                                                        |
| ---- | ----------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | X / Twitter publishing                    | ✅ IMPLEMENTED   | `packages/providers/x/src/XAdapter.ts` — calls POST /2/tweets, media upload, thread support                                                                                                                | Threading, media upload, analytics all real API calls.                                                                        |
| 3.2  | Instagram: Feed, Stories, Reels, Carousel | ✅ IMPLEMENTED   | `packages/providers/instagram/src/InstagramAdapter.ts` — routes to `publishFeedPost()`, `publishStory()`, `publishReel()`, `publishCarousel()`                                                             | Each content type has dedicated API path. Reels validated ≤90s.                                                               |
| 3.3  | Facebook: Page posts, Stories, Reels      | ✅ IMPLEMENTED   | `packages/providers/facebook/src/FacebookAdapter.ts` — `publishPost()`, `publishStory()` via `FacebookStoriesApi`, `publishReel()` via `FacebookReelsApi`                                                  | Real API calls. Stories support interactive elements.                                                                         |
| 3.4  | YouTube: Videos, Shorts, Community posts  | 🟡 PARTIAL       | `packages/providers/youtube/src/YouTubeAdapter.ts` — `publishVideo()`, `publishShort()` via `YouTubeShortsService`, `publishLiveStream()`. `publishCommunityPost()` returns hardcoded `err("VALIDATION")`. | Community posts API requires YouTube Partner Program — currently a stub returning error.                                      |
| 3.5  | TikTok: Videos                            | ✅ IMPLEMENTED   | `packages/providers/tiktok/src/TikTokAdapter.ts` — routes to `publishPhotoPost()` (images) or `apiClient.uploadVideo()` (video)                                                                            | Real API. Photo/video posts confirmed.                                                                                        |
| 3.6  | LinkedIn: Posts, Articles                 | 🟡 PARTIAL       | `packages/providers/linkedin/src/LinkedInAdapter.ts` — `apiClient.createPost()`, 2-step media upload, org post support                                                                                     | Posts confirmed real. LinkedIn Articles API requires separate `w_member_social` scope and different endpoint — not confirmed. |
| 3.7  | Pinterest                                 | ✅ IMPLEMENTED   | `packages/providers/pinterest/src/PinterestAdapter.ts` — `apiClient.createPin()` via POST /v5/pins. Images via `image_url`, video via `video_id`.                                                          | Pins + boards. 100 calls/s/user rate limit noted.                                                                             |
| 3.8  | Bluesky                                   | 🔴 MISSING       | No file found.                                                                                                                                                                                             | AT Protocol provider does not exist.                                                                                          |
| 3.9  | Snapchat                                  | 🔵 EXCEEDS MODEL | `packages/providers/snapchat/src/SnapchatAdapter.ts` — `apiClient.uploadMedia()` + `apiClient.createStory()`. Reference says "listening only."                                                             | OmniPost publishes Stories/Spotlight — exceeds the reference model's scope for Snapchat.                                      |
| 3.10 | Per-platform format enforcement           | ✅ IMPLEMENTED   | `packages/ports/src/ProviderAdapter.ts` (`ProviderLimits`: maxChars, maxHashtags, maxMediaPerPost, aspectRatios, maxVideoDuration, etc.), `apps/api/src/providers/providerConstraintValidator.ts`          | Validation on render + before publish. Enforced per provider.                                                                 |
| 3.11 | Media transcoding / processing pipeline   | ✅ IMPLEMENTED   | `apps/api/src/video/videoProcessor.ts`, `thumbnailGenerator.ts`, `uploadPipeline.ts`, `packages/providers/instagram/src/mediaProcessor.ts`                                                                 | Transcode, thumbnail generation, video segment splitting, format optimization.                                                |
| 3.12 | Chunked media upload for large video      | ✅ IMPLEMENTED   | `packages/providers/shared/src/AbstractProviderAdapter.ts` — `uploadMediaWithRetry()` (3 retries, exponential backoff), `uploadMediaBatch()`                                                               | Sequential upload with fallback on first failure.                                                                             |
| 3.13 | Retry and error handling per platform     | ✅ IMPLEMENTED   | `packages/adapters/dead-letter-queue/` (DLQ with Knuth hash jitter), `packages/adapters/fallback-strategies/` (circuit breaker), `packages/monitoring/`                                                    | Per-platform failure reported to DLQ. Circuit breaker prevents cascade failures.                                              |
| 3.14 | Rate limit awareness and backoff          | 🟡 PARTIAL       | `packages/ports/src/ProviderAdapter.ts` (`rateLimitHints: { burst, perSeconds }` in ProviderLimits)                                                                                                        | Rate limit metadata declared per provider. Actual backoff strategy at worker level not confirmed as per-platform adaptive.    |

**Score: 8 ✅ + 5 🟡 + 1 🔴 = ~75%**
_(Exceeds model with Snapchat publishing and Telegram provider — see D3-Telegram below.)_

🔵 **EXCEEDS MODEL — Telegram provider:** `packages/providers/telegram/src/TelegramAdapter.ts` —
Bot API, text/photo/video/poll/media group. Not mentioned in reference model. Real API calls via
`sendMessage`, `sendPhoto`, `sendVideo`, `sendMediaGroup`, `sendPoll`.

---

### DOMAIN 4 — SOCIAL INBOX (UNIFIED ENGAGEMENT)

> Reference: All inbound interactions unified (DMs, comments, replies, mentions), platform coverage
> including TikTok Business Messaging + YouTube comments, conversation assignment, ticket tagging,
> filtering/search, internal notes, read/unread state.

**Critical Finding:** The backend implementation is **fully complete** (Phase 2 implementation).
The frontend UI has **zero components**. Every row below reflects this asymmetry.

| #   | Capability                                    | Status     | Evidence                                                                                                                                                                                                     | Notes / What's Missing                            |
| --- | --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 4.1 | All inbound interactions in one view          | 🟡 PARTIAL | Backend: `apps/api/src/inbox/inboxRoutes.ts`, `GetInboxQuery.ts` (cursor-paginated), `SocialConversation` entity, Prisma `SocialMessage` + `SocialConversation`                                              | **UI: No inbox page exists in admin or client.**  |
| 4.2 | Platform coverage (TikTok, YouTube included)  | 🟡 PARTIAL | Backend: `SyncProviderCommentsUseCase.ts`, webhook processors for all 9 providers. Provider `getComments()` implemented for X, Instagram, Facebook, YouTube, LinkedIn. TikTok: `comments: false` in adapter. | TikTok Business Messaging not implemented. No UI. |
| 4.3 | Conversation assignment to team members       | 🟡 PARTIAL | Backend: `AssignMessageUseCase.ts`, `SocialMessageAggregate` — `assignTo(memberId)` method                                                                                                                   | No UI.                                            |
| 4.4 | Ticket tagging and resolution status tracking | 🟡 PARTIAL | Backend: `ResolveConversationUseCase.ts`, `ReopenConversationUseCase.ts`, `MarkMessageArchivedUseCase.ts`, Prisma `SocialConversation.status`                                                                | No UI.                                            |
| 4.5 | Filtering and search within inbox             | 🟡 PARTIAL | Backend: `GetInboxQuery.ts` — supports filter by status, platform, assignee, unread. `GetMentionsQuery.ts` — filter by type:mention                                                                          | No UI.                                            |
| 4.6 | Internal notes on conversations               | 🔴 MISSING | No `AddInternalNoteUseCase` or `InternalNote` model found.                                                                                                                                                   | Not implemented in backend either.                |
| 4.7 | Read/unread state management                  | 🟡 PARTIAL | Backend: `MarkMessageReadUseCase.ts`, `GetUnreadInboxCountQuery.ts`, Prisma `SocialMessage.isRead`                                                                                                           | No UI.                                            |

**Score: 0 ✅ + 6 🟡 + 1 🔴 = ~43% (0% from end-user product perspective)**

---

### DOMAIN 5 — SOCIAL LISTENING

> Reference: Real-time keyword/hashtag/brand mention monitoring across platforms and web.
> Sentiment analysis, trending detection, volume tracking, conversation clustering, alert system,
> multi-source data, AI-assisted creation triggered from listening data.

| #   | Capability                                    | Status     | Evidence                                                                                                           | Notes / What's Missing                                                                 |
| --- | --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 5.1 | Real-time keyword/hashtag monitoring          | 🔴 MISSING | No file found.                                                                                                     | No keyword subscription model, no monitoring service.                                  |
| 5.2 | Brand mention alerts                          | 🔴 MISSING | No file found.                                                                                                     | Webhook processors receive inbound events but no mention detection service exists.     |
| 5.3 | Sentiment analysis per mention/topic          | 🔴 MISSING | No file found in `apps/api/src/ai/` or elsewhere.                                                                  | AI service exists but not wired to sentiment pipeline.                                 |
| 5.4 | Trending topic detection                      | 🟡 PARTIAL | `apps/api/src/trends/trendAnalysisService.ts`, `trendRoutes.ts`. Integrates TikTok Trends API via circuit breaker. | Source: TikTok API only. No multi-platform trend aggregation. No real-time monitoring. |
| 5.5 | Volume tracking over time for monitored terms | 🔴 MISSING | No file found.                                                                                                     | Requires keyword subscription + time-series storage.                                   |
| 5.6 | Conversation clustering by topic/keyword      | 🔴 MISSING | No file found.                                                                                                     |                                                                                        |
| 5.7 | Alert system when keywords spike              | 🔴 MISSING | No file found.                                                                                                     |                                                                                        |
| 5.8 | AI-assisted creation from listening data      | 🔴 MISSING | No connection between `trendAnalysisService.ts` and the composer/AI content generator.                             |                                                                                        |

**Score: 0 ✅ + 1 🟡 + 7 🔴 = ~6%**

---

### DOMAIN 6 — AI-ASSISTED CONTENT CREATION

> Reference: AI caption generator, hashtag generator, post repurposing, web-to-social,
> persistent AI writing assistant side panel, prompt library, collaborative whiteboard,
> content suggestions from listening data.

| #   | Capability                                    | Status         | Evidence                                                                                                                                                                                                                                                     | Notes / What's Missing                                                                              |
| --- | --------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 6.1 | AI caption generator inside composer          | ✅ IMPLEMENTED | `apps/api/src/ai/aiService.ts`, `apps/api/src/ai/orchestrator.ts` (OpenAI + Gemini + Perplexity), `apps/admin/components/ai/AIContentGenerator.tsx`, `AIPromptForm.tsx`, `AIContentResults.tsx`                                                              | Multi-provider LLM. Real API calls. Content generation, tone analysis, readability.                 |
| 6.2 | Hashtag generator                             | ✅ IMPLEMENTED | `apps/admin/components/ai/SmartContentOptimizerHashtags.tsx`, `aiService.ts` — dedicated hashtag generation method                                                                                                                                           | Real API calls. Platform-aware hashtag suggestions.                                                 |
| 6.3 | Post repurposing (transform existing content) | 🔴 MISSING     | No `RepurposeContentUseCase` or equivalent found.                                                                                                                                                                                                            | AI providers exist and could support this; no orchestration exists for the repurposing flow.        |
| 6.4 | Web-to-social (URL/article → social post)     | 🔴 MISSING     | No file found.                                                                                                                                                                                                                                               | No URL scraping + LLM transform pipeline.                                                           |
| 6.5 | AI writing assistant as persistent side panel | 🟡 PARTIAL     | `apps/admin/components/ai/SmartContentOptimizer.tsx` (5 sub-components: Overview, Suggestions, Hashtags, Metrics, Tone) exists in admin. `apps/client/components/editor/ClientContentEditor.tsx` — does not appear to include the optimizer as a side panel. | Exists in admin optimizer page, not embedded in client post composer as persistent side panel.      |
| 6.6 | Prompt library with pre-built templates       | 🟡 PARTIAL     | `apps/admin/components/ai/ai-content-templates.ts` — pre-built prompt templates in code. `AITemplateSelector.tsx` — UI for selection.                                                                                                                        | Hardcoded in source file. Not user-editable, not stored in DB, not extensible without code changes. |
| 6.7 | Collaborative whiteboard for brainstorming    | 🔴 MISSING     | No file found.                                                                                                                                                                                                                                               | No whiteboard component or multi-user ideation feature.                                             |
| 6.8 | Content suggestions from listening data       | 🔴 MISSING     | No connection between `trendAnalysisService.ts` and AI content generation pipeline.                                                                                                                                                                          | D5 listening capabilities are near-zero, so this has no data source to draw from.                   |

**Score: 2 ✅ + 2 🟡 + 4 🔴 = ~38%**

🔵 **EXCEEDS MODEL — AI Image Generation:**
`apps/api/src/application/ai-image/GenerateImageUseCase.ts` — DALL-E 3 via `aiService.ts`/OpenAI provider.
Sizes: 1024×1024, 1792×1024, 1024×1792. Results stored in Prisma `GeneratedImage` + S3.
`apps/api/src/ai-image/aiImageRoutes.ts` (2 endpoints). **Backend complete. UI not yet built.**

🔵 **EXCEEDS MODEL — Multi-provider AI orchestration:**
`apps/api/src/ai/orchestrator.ts` — Fallback chain (OpenAI → Gemini → Perplexity), per-request caching (TTL), usage metrics, automatic provider health checks. Not in reference model.

---

### DOMAIN 7 — ANALYTICS & REPORTING

> Reference: Per-post metrics, 12-month metric tracking post-publish, audience growth, best-time
> recommendations, custom report builder, exportable reports, GA4 integration, campaign tagging,
> ad ROI tracking, platform-specific metrics.

| #    | Capability                                                              | Status         | Evidence                                                                                                                                                                                                    | Notes / What's Missing                                                                                                                                     |
| ---- | ----------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1  | Per-post performance metrics                                            | ✅ IMPLEMENTED | Prisma `Analytics`, `apps/api/src/analytics/analyticsRoutes.ts`, `apps/admin/components/analytics/UniversalAnalyticsDashboard.tsx`                                                                          | Likes, shares, comments, impressions, reach per post.                                                                                                      |
| 7.2  | Metrics updated up to 12 months post-publish                            | 🟡 PARTIAL     | Prisma `AnalyticsDailySummary` + `AnalyticsMonthlySummary`, `apps/api/src/application/analytics/GetHistoricalAnalyticsQuery.ts`, `apps/workers/src/analyticsAggregationWorker.ts`                           | Infrastructure for aggregation exists. 12-month specific retention policy / scheduled pull not confirmed.                                                  |
| 7.3  | Audience growth metrics per platform                                    | ✅ IMPLEMENTED | All 9 provider `fetchAnalytics()` implementations return follower/subscriber counts. `GetCrossPlatformAnalyticsUseCase.ts`                                                                                  | Real API data per provider.                                                                                                                                |
| 7.4  | Best time to publish recommendations                                    | 🟡 PARTIAL     | `apps/api/src/application/ml/PredictOptimalTimingUseCase.ts`, `apps/admin/components/scheduling/SchedulingDashboard.tsx` (`OptimalTimesView.tsx`)                                                           | Rule-based heuristic using `AnalyticsReadRepository`. Uses historical data but not ML. Functional as a feature.                                            |
| 7.5  | Custom report builder with configurable metrics                         | 🔴 MISSING     | Dashboards in admin are statically built components. No drag-and-drop report builder exists.                                                                                                                |                                                                                                                                                            |
| 7.6  | Exportable reports (CSV, PDF)                                           | 🟡 PARTIAL     | `packages/api-common/src/utils/csvExport.ts` (CSV confirmed). `apps/api/src/application/reports/GenerateReportUseCase.ts`, `CreateScheduledReportUseCase.ts`, `apps/workers/src/reportGenerationWorker.ts`. | CSV confirmed. PDF export format not confirmed. Scheduled reports backend complete. UI not confirmed.                                                      |
| 7.7  | Integration with external analytics (GA4)                               | 🟡 PARTIAL     | `apps/api/src/domain/repositories/GA4TrackingPort.ts` (domain port), `apps/api/src/utm/utmRoutes.ts` + `GenerateUTMLinksUseCase.ts`                                                                         | UTM parameter generation confirmed. GA4 Measurement Protocol adapter implementation not confirmed. The port exists but the concrete adapter may be a stub. |
| 7.8  | Post tagging for campaign-level reporting                               | ✅ IMPLEMENTED | Prisma `Campaign` + `CampaignPost`, `apps/api/src/application/campaigns/TagPostWithCampaignUseCase.ts`, `UntagPostFromCampaignUseCase.ts`, `GetCampaignAnalyticsUseCase.ts`, `campaignRoutes.ts`            | Full campaign model: create, tag posts, analytics per campaign, archive.                                                                                   |
| 7.9  | Social advertising ROI tracking                                         | 🟡 PARTIAL     | `apps/api/src/application/analytics/CalculateROIUseCase.ts`, `apps/api/src/analytics/roiCalculator.ts`, `apps/api/src/analytics/roi/`                                                                       | ROI calculation exists but for organic content. No paid ad tracking.                                                                                       |
| 7.10 | Platform-specific metrics (Reels views, watch time, TikTok completions) | ✅ IMPLEMENTED | Each provider `fetchAnalytics()` returns platform-native metrics. Instagram: impressions/reach/profile_views. YouTube: views/likes/comments/shares/watch time. TikTok: follower count + basic metrics.      | TikTok analytics limited by basic API tier. Others comprehensive.                                                                                          |

**Score: 4 ✅ + 5 🟡 + 1 🔴 = ~65%**

🔵 **EXCEEDS MODEL — Link click tracking:**
`apps/api/src/application/links/` (CreateTrackedLink, GetLinkStats, RedirectAndTrackClick),
Prisma `TrackedLink` + `LinkClick`. Branded short links with click analytics, referrer tracking.
Not in reference model.

---

### DOMAIN 8 — TEAM COLLABORATION & APPROVAL WORKFLOWS

> Reference: Multi-user RBAC (admin, editor, approver, viewer), approval workflow
> (draft→review→approved→scheduled), in-workflow commenting, notification system for state changes,
> audit log, content assignment.

**Critical Finding:** Backend fully implemented in Phase 1. Frontend UI has zero implementation
for approvals, comments, and notifications.

| #   | Capability                                     | Status         | Evidence                                                                                                                                                                                                                                   | Notes / What's Missing                                                                                                                                                                                 |
| --- | ---------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8.1 | Multi-user workspace with RBAC                 | ✅ IMPLEMENTED | `apps/api/src/auth/rbacService.ts`, `rbacMiddleware.ts`, `rbacRoutes.ts`, `apps/admin/components/security/RbacManager.tsx`                                                                                                                 | Granular permissions per resource/action. Admin UI for role management. Roles: SUPER_ADMIN, ADMIN, SUPPORT. Team roles: OWNER, MANAGER, MEMBER, VIEWER.                                                |
| 8.2 | Content approval workflow                      | 🟡 PARTIAL     | Backend: `apps/api/src/application/approvals/` (5 use cases: SubmitForReview, Approve, Reject, GetPending, GetHistory). `ApprovalRequestAggregate.ts`. `PublishStatus.PENDING_REVIEW`. `approvalRoutes.ts`.                                | **No frontend UI.** No submit-for-review button, no reviewer interface in admin or client.                                                                                                             |
| 8.3 | In-workflow commenting and annotation          | 🟡 PARTIAL     | Backend: `apps/api/src/application/comments/` (4 use cases: Create, Edit, Delete, GetPostComments). `PostCommentAggregate.ts` with threaded replies. `commentRoutes.ts`.                                                                   | **No frontend UI.** No comment thread in post editor or review view.                                                                                                                                   |
| 8.4 | Notification system for workflow state changes | 🟡 PARTIAL     | Backend: `apps/api/src/application/notifications/` (5 use cases + event handlers). `Notification` entity. SSE broadcaster via Redis pub/sub. `notificationRoutes.ts`. `NotificationEventHandlers.ts` wires domain events to notifications. | **No frontend UI.** No notification bell, no notification center, no SSE listener in client.                                                                                                           |
| 8.5 | Audit log                                      | ✅ IMPLEMENTED | `apps/api/src/audit/auditMiddleware.ts` (Fastify middleware, auto-logs all authenticated requests), `auditRoutes.ts`, `apps/api/src/audit/activityFeedRoutes.ts` + `activityFeedService.ts`                                                | Audit log complete. Activity feed with cursor pagination also implemented. Admin `/(dashboard)/logs/page.tsx` exists.                                                                                  |
| 8.6 | Content assignment between team members        | 🟡 PARTIAL     | Backend: `apps/api/src/application/team/` (4 use cases: Invite, Remove, UpdateRole, GetMembers). `TeamMember` entity + `TeamRole` VO. Social Inbox has `AssignMessageUseCase`.                                                             | Team member model exists. Direct post-to-member assignment (e.g., "this draft is assigned to Person X for editing") not explicitly confirmed. Approval submission to a reviewer is the closest analog. |

**Score: 2 ✅ + 4 🟡 + 0 🔴 = ~67%**

🔵 **EXCEEDS MODEL — Content Versioning (git-like):**
`apps/api/src/content/DiffCalculator.ts`, `ContentVersionManager.ts`, Prisma `ContentVersion`, `TemplateCommit`, `TemplateCollaboration`.
Branch, merge, diff comparison, conflict detection, commit history. Not described in reference model.

---

### DOMAIN 9 — ASSET LIBRARY & CONTENT STORAGE

> Reference: Centralized media library with folders/tags/search, brand asset management
> (logos, colors, templates), content reuse in composer, asset expiry/archiving,
> external storage integration (Google Drive, Dropbox, OneDrive).

| #   | Capability                                            | Status     | Evidence                                                                                                                                                                           | Notes / What's Missing                                                                                                     |
| --- | ----------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 9.1 | Centralized media library                             | 🟡 PARTIAL | `apps/admin/components/content/ContentLibrary.tsx` (+ 11 sub-components: Header, SearchBar, FilterPanel, GridView, ListView, BulkActions, Pagination, EmptyState, LoadingSkeleton) | Library is for content/posts, not pure media assets. Images stored in S3/Cloudinary but no media-first browsing interface. |
| 9.2 | Folders, tags, and search                             | 🟡 PARTIAL | `apps/admin/components/content/library/SearchAndSortBar.tsx`, `FilterPanel.tsx`                                                                                                    | Search and sort exist. Folder-based organization not confirmed. Tags for media (vs. post tags) not confirmed.              |
| 9.3 | Brand asset management (logos, colors, templates)     | 🔴 MISSING | No `BrandKit` Prisma model found. No brand colors/fonts UI.                                                                                                                        | Content templates exist but no brand kit / brand guidelines storage.                                                       |
| 9.4 | Content reuse: pull assets from library into composer | 🟡 PARTIAL | `apps/client/components/editor/TemplateSelector.tsx` — pulls templates into editor. `apps/client/components/editor/ClientContentEditor.tsx`                                        | Templates reusable. Media asset library → composer integration not confirmed.                                              |
| 9.5 | Asset expiry or archiving policies                    | 🔴 MISSING | No `expiresAt` or `archivedAt` field on media models found.                                                                                                                        |                                                                                                                            |
| 9.6 | External storage integration (Google Drive, Dropbox)  | 🟡 PARTIAL | `packages/adapters/storage-s3/` (S3-compatible internal storage), `packages/adapters/storage-cloudinary/` (Cloudinary for images/video)                                            | Internal S3/Cloudinary confirmed. Google Drive, Dropbox, OneDrive import: no file found.                                   |

**Score: 0 ✅ + 4 🟡 + 2 🔴 = ~33%**

🔵 **EXCEEDS MODEL — Template versioning with git-like history:**
Prisma `Template`, `TemplateVersion`, `TemplateCommit`, `TemplateCollaboration`. Content templates
have version control, branching, and collaboration tracking — not in reference model.

---

### DOMAIN 10 — EMPLOYEE ADVOCACY MODULE

> Reference: Push calendar content to advocacy feed, employee sharing to personal accounts,
> reach tracking from advocate activity, advocate management, share-only permissions.

| #    | Capability                                            | Status     | Evidence       | Notes / What's Missing |
| ---- | ----------------------------------------------------- | ---------- | -------------- | ---------------------- |
| 10.1 | Push approved content to advocacy feed                | 🔴 MISSING | No file found. |                        |
| 10.2 | Employees share approved content to personal accounts | 🔴 MISSING | No file found. |                        |
| 10.3 | Tracking of reach driven by advocate activity         | 🔴 MISSING | No file found. |                        |
| 10.4 | Advocate management (invite, onboard, report)         | 🔴 MISSING | No file found. |                        |
| 10.5 | Permission controls (share-only, not edit)            | 🔴 MISSING | No file found. |                        |

**Score: 0 ✅ + 0 🟡 + 5 🔴 = 0%**

---

### DOMAIN 11 — SOCIAL ADVERTISING

> Reference: Create/manage paid ads, boost organic posts on LinkedIn/Facebook/Instagram,
> automated boosting rules, ad spend tracking and ROI, Meta Ads + LinkedIn Campaign Manager API.

| #    | Capability                                 | Status     | Evidence                                                                                                                                                        | Notes / What's Missing                                                                      |
| ---- | ------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 11.1 | Create and manage paid social ads          | 🔴 MISSING | No file found.                                                                                                                                                  |                                                                                             |
| 11.2 | Boost organic posts on supported platforms | 🔴 MISSING | No file found.                                                                                                                                                  |                                                                                             |
| 11.3 | Automated boosting rules                   | 🔴 MISSING | No file found.                                                                                                                                                  |                                                                                             |
| 11.4 | Ad spend tracking and ROI reporting        | 🔴 MISSING | No file found.                                                                                                                                                  | ROI calculator exists for organic; no paid ad tracking.                                     |
| 11.5 | Platform ad API integration                | 🟡 PARTIAL | `packages/providers/tiktok/src/marketingApiClient.ts` — `createPromotedContent()` logs `"Marketing campaign creation not fully implemented"` and returns error. | Dead stub. No Meta Ads, no LinkedIn Campaign Manager, no TikTok Ads functional integration. |

**Score: 0 ✅ + 1 🟡 + 4 🔴 = ~10%**

---

### DOMAIN 12 — MULTI-TENANT ACCOUNT MANAGEMENT

> Reference: Organization-level workspace isolation, multiple social accounts per tenant,
> workspace settings for posting/approval/notification defaults, SSO (SAML/OAuth),
> per-tenant API keys, usage quotas per tier.

| #    | Capability                                            | Status         | Evidence                                                                                                                                                                                                 | Notes / What's Missing                                                                                                    |
| ---- | ----------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 12.1 | Organization-level workspace isolation                | ✅ IMPLEMENTED | Prisma `Account` → `Project` → `Channel` hierarchy. `apps/api/src/accounts/accountRoutes.ts`. Multi-tenant from ground up.                                                                               | Full tenant isolation. Soft-delete with `deletedAt` timestamp.                                                            |
| 12.2 | Multiple social accounts per tenant                   | ✅ IMPLEMENTED | Multiple `Project` per `Account`, multiple `Channel` per `Project`. `ProviderConnection` table for OAuth tokens.                                                                                         | One brand can have multiple IG accounts via multiple projects.                                                            |
| 12.3 | Workspace-level posting and notification defaults     | ✅ IMPLEMENTED | Prisma `SchedulingRule` per project. `apps/api/src/admin/schedulingRoutes.ts`. Project-level locale, crisis mode, defaults.                                                                              | Scheduling rules per project.                                                                                             |
| 12.4 | SSO and enterprise authentication (SAML, OAuth login) | 🔴 MISSING     | No SAML provider, no Keycloak/Auth0 integration found.                                                                                                                                                   | OAuth-based social login exists for provider connections (publishing auth), not for enterprise employee SSO.              |
| 12.5 | Per-tenant API keys                                   | ✅ IMPLEMENTED | Prisma `ApiKey` (scoped to Account), `apps/api/src/auth/apiKeyRoutes.ts`, `apps/api/src/application/apiKeys/ApiKeyUseCases.ts`                                                                           | API key generation, rotation, revocation per account.                                                                     |
| 12.6 | Usage quotas and limits per tenant tier               | 🟡 PARTIAL     | Prisma `Account.maxProjects`, `Account.subscription` (`SubscriptionTier`: BASIC, PRO, ENTERPRISE). `apps/api/src/security/advancedRateLimit.ts`. `apps/api/src/billing/subscriptionService.ts` (Stripe). | maxProjects enforced. Rate limiting per tenant. No detailed usage metering (posts/month, API calls, storage GB) per tier. |

**Score: 4 ✅ + 1 🟡 + 1 🔴 = ~75%**

---

### DOMAIN 13 — INTEGRATIONS & EXTENSIBILITY

> Reference: Canva/Adobe Express, Google Drive/Dropbox storage, CRM integrations, GA4,
> app marketplace (100+ integrations), public API, outbound webhooks.

| #    | Capability                                             | Status         | Evidence                                                                                                                            | Notes / What's Missing                                                                                                                      |
| ---- | ------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 13.1 | Native design tool integrations (Canva, Adobe Express) | 🔴 MISSING     | No file found.                                                                                                                      |                                                                                                                                             |
| 13.2 | Native storage integrations (Google Drive, Dropbox)    | 🔴 MISSING     | No file found.                                                                                                                      | S3/Cloudinary are internal storage, not user-facing cloud storage import.                                                                   |
| 13.3 | Native CRM integrations                                | 🔴 MISSING     | No file found.                                                                                                                      |                                                                                                                                             |
| 13.4 | GA4 analytics integration                              | 🟡 PARTIAL     | `apps/api/src/domain/repositories/GA4TrackingPort.ts` (domain port), `apps/api/src/utm/utmRoutes.ts`, `GenerateUTMLinksUseCase.ts`  | UTM link generation confirmed. GA4 Measurement Protocol concrete adapter implementation not confirmed. Port exists but adapter may be stub. |
| 13.5 | App marketplace or integration directory               | 🔴 MISSING     | No file found.                                                                                                                      |                                                                                                                                             |
| 13.6 | Public API for external automation                     | ✅ IMPLEMENTED | 41 route files, 90+ endpoints, API key auth (`ApiKey` model), rate limiting (`advancedRateLimit.ts`, `slidingWindowRateLimit.ts`)   | Full REST API available for external consumers with API key authentication.                                                                 |
| 13.7 | Webhook support for outbound event notifications       | ✅ IMPLEMENTED | `apps/api/src/webhooks/webhookManager.ts`, `webhookHandler.ts`, Prisma `WebhookSubscription` + `WebhookEvent` + `WebhookDeadLetter` | Subscription-based outbound webhooks. Events with DLQ, retry. Admin UI for config: `apps/admin/app/(dashboard)/webhooks/page.tsx`.          |

**Score: 2 ✅ + 1 🟡 + 4 🔴 = ~36%**

🔵 **EXCEEDS MODEL — Slack/Teams notifications:**
`apps/api/src/infrastructure/adapters/SlackNotifierAdapter.ts` + `TeamsNotifierAdapter.ts` +
`ExternalNotificationDispatcher.ts`. Webhook-based, Slack Block Kit + Teams Adaptive Cards.
`apps/api/src/external-notifications/externalNotificationRoutes.ts` (4 endpoints: configure, delete, test, list).
Prisma `ExternalNotificationConfig`. Backend complete. No UI.

🔵 **EXCEEDS MODEL — First Comment Scheduling:**
`apps/api/src/application/first-comment/` (Set, Remove, Get, Publish use cases).
Auto-posts a comment 5s after publish. Supported providers: X, Instagram, Facebook, YouTube, LinkedIn.
Prisma `FirstComment` model. Backend complete. No UI.

---

## PLATFORM COVERAGE MATRIX

Coverage across all connected platforms for each publishing and engagement capability.

| Capability                        | X/Twitter | Instagram     | Facebook | YouTube   | TikTok   | LinkedIn    | Pinterest         | Snapchat | Telegram             | Bluesky |
| --------------------------------- | --------- | ------------- | -------- | --------- | -------- | ----------- | ----------------- | -------- | -------------------- | ------- |
| **Publish post**                  | ✅        | ✅            | ✅       | ✅        | ✅       | ✅          | ✅                | ✅       | ✅                   | 🔴      |
| **Stories**                       | 🔴 N/A    | ✅            | ✅       | 🔴 N/A    | 🔴 N/A   | 🔴 N/A      | 🔴 N/A            | ✅       | 🔴 N/A               | 🔴 N/A  |
| **Reels / Shorts**                | 🔴 N/A    | ✅            | ✅       | ✅ Shorts | 🔴 N/A   | 🔴 N/A      | 🔴 N/A            | 🔴 N/A   | 🔴 N/A               | 🔴 N/A  |
| **Carousel**                      | 🔴 N/A    | ✅            | 🔴       | 🔴 N/A    | 🔴       | 🟡 (images) | 🔴 N/A            | 🔴 N/A   | 🟡 (media group)     | 🔴 N/A  |
| **Video upload**                  | 🔴        | ✅            | ✅       | ✅        | ✅       | ✅          | 🟡 (via video_id) | ✅       | ✅                   | 🔴      |
| **Threads / long-form**           | ✅        | 🟡 (carousel) | 🔴       | 🔴        | 🔴       | 🔴          | 🔴                | 🔴       | 🔴                   | 🔴      |
| **Analytics pull**                | ✅        | ✅            | ✅       | ✅        | 🟡 basic | ✅          | ✅                | ✅       | 🟡 member count only | 🔴      |
| **Comment reading (getComments)** | ✅        | ✅            | ✅       | ✅        | 🔴       | ✅          | 🔴                | 🔴       | 🔴                   | 🔴      |
| **Reply posting (postReply)**     | ✅        | ✅            | ✅       | ✅        | 🔴       | ✅          | 🔴                | 🔴       | 🔴                   | 🔴      |
| **DM / Inbox**                    | 🔴        | 🔴            | 🔴       | 🔴        | 🔴       | 🔴          | 🔴                | 🔴       | 🔴                   | 🔴      |
| **Webhook inbound**               | ✅        | ✅            | ✅       | ✅        | ✅       | ✅          | ✅                | ✅       | 🔴                   | 🔴      |
| **OAuth / token management**      | ✅        | ✅            | ✅       | ✅        | ✅       | ✅          | ✅                | ✅       | 🟡 Bot token         | 🔴      |

### Provider-Specific Unique Capabilities

| Provider  | Unique Feature                                                                       | Status |
| --------- | ------------------------------------------------------------------------------------ | ------ |
| X         | Thread publishing (planThread + publishThread, up to 25 tweets), PKCE S256           | ✅     |
| Instagram | Stories editor, carousel, Reels (≤90s), media container polling                      | ✅     |
| Facebook  | Stories with interactive elements, Reels with music/effects, Shop, Events, Community | ✅     |
| YouTube   | Shorts service, live streaming, playlist management, community posts\*               | 🟡     |
| TikTok    | Hashtag manager, research API, marketing API placeholder                             | 🟡     |
| LinkedIn  | 2-step media upload, org posts, document upload (.pdf/.pptx), polls                  | ✅     |
| Pinterest | API v5, pins + boards, 100 calls/s/user rate limit                                   | ✅     |
| Snapchat  | Stories/Spotlight, 9:16 vertical, ≤60s video                                         | ✅     |
| Telegram  | Text/Photo/Video/Poll/MediaGroup, Bot token auth                                     | ✅     |

\*YouTube Community posts: stub returning error — YouTube Partner Program API required.

---

## AI CAPABILITIES INVENTORY

| Capability                             | Status         | Backend File(s)                                                                       | Frontend File(s)                                                                              | AI Provider(s)                        | Type                                                |
| -------------------------------------- | -------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| Text / caption generation              | ✅ IMPLEMENTED | `apps/api/src/ai/aiService.ts`, `orchestrator.ts`                                     | `apps/admin/components/ai/AIContentGenerator.tsx`, `AIPromptForm.tsx`, `AIContentResults.tsx` | OpenAI, Gemini, Perplexity            | LLM API (real)                                      |
| Content optimization suggestions       | ✅ IMPLEMENTED | `apps/api/src/ai/aiService.ts`                                                        | `SmartContentOptimizer.tsx` (5 sub-components)                                                | OpenAI, Gemini                        | LLM API (real)                                      |
| Hashtag generation                     | ✅ IMPLEMENTED | `apps/api/src/ai/aiService.ts`                                                        | `SmartContentOptimizerHashtags.tsx`                                                           | OpenAI, Gemini                        | LLM API (real)                                      |
| Tone analysis and adjustment           | ✅ IMPLEMENTED | `apps/api/src/ai/aiService.ts`                                                        | `SmartContentOptimizerTone.tsx`                                                               | OpenAI, Gemini                        | LLM API (real)                                      |
| Readability scoring                    | ✅ IMPLEMENTED | `apps/api/src/ai/aiService.ts`                                                        | `SmartContentOptimizerMetrics.tsx`                                                            | OpenAI, Gemini                        | LLM API (real)                                      |
| Engagement prediction                  | 🟡 PARTIAL     | `apps/api/src/analytics/engagementPredictor.ts` (+config, factors, scoring)           | `apps/admin/components/ai/PredictiveAnalytics.tsx` (AudienceTab, PerformancePredictionCard)   | —                                     | Rule-based heuristic (no ML)                        |
| Optimal timing prediction              | 🟡 PARTIAL     | `apps/api/src/application/ml/PredictOptimalTimingUseCase.ts`                          | `apps/admin/components/scheduling/SchedulingDashboard.tsx` (OptimalTimesView)                 | —                                     | Rule-based heuristic (uses AnalyticsReadRepository) |
| Audience response prediction           | 🟡 PARTIAL     | `apps/api/src/application/ml/PredictAudienceResponseUseCase.ts`                       | No frontend consumer found                                                                    | —                                     | Rule-based heuristic (dead — no route wired)        |
| Content optimization scoring           | 🟡 PARTIAL     | `apps/api/src/application/ml/OptimizeContentUseCase.ts`                               | —                                                                                             | OpenAI/Gemini with fallback heuristic | Hybrid (real AI with heuristic fallback)            |
| Multi-provider AI orchestration        | 🔵 EXCEEDS     | `apps/api/src/ai/orchestrator.ts`                                                     | —                                                                                             | OpenAI, Gemini, Perplexity            | Fallback chain with caching + metrics               |
| AI template selection                  | ✅ IMPLEMENTED | —                                                                                     | `apps/admin/components/ai/AITemplateSelector.tsx`                                             | —                                     | UI helper                                           |
| AI image generation (DALL-E 3)         | 🟡 PARTIAL     | `apps/api/src/application/ai-image/GenerateImageUseCase.ts`, `ai/providers/openai.ts` | **No UI built yet**                                                                           | OpenAI (DALL-E 3)                     | Real API — backend complete, UI missing             |
| Caption generation for images (vision) | 🔴 MISSING     | No file found                                                                         | No file found                                                                                 | —                                     | —                                                   |
| Post repurposing                       | 🔴 MISSING     | No file found                                                                         | No file found                                                                                 | —                                     | —                                                   |
| Web-to-social transformation           | 🔴 MISSING     | No file found                                                                         | No file found                                                                                 | —                                     | —                                                   |
| Sentiment analysis (NLP)               | 🔴 MISSING     | No file found                                                                         | No file found                                                                                 | —                                     | —                                                   |
| Brand voice fine-tuning / profiles     | 🔴 MISSING     | No file found                                                                         | No file found                                                                                 | —                                     | —                                                   |
| Trend-aware content suggestion         | 🟡 PARTIAL     | `apps/api/src/trends/trendAnalysisService.ts`                                         | —                                                                                             | TikTok Trends API + `aiService.ts`    | Real trend data but not connected to composer       |

### AI Provider Configuration

| Provider        | Package                                   | Capabilities Used                                                      |
| --------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| OpenAI (GPT-4o) | `apps/api/src/ai/providers/openai.ts`     | Text generation, content optimization, tone, hashtags, DALL-E 3 images |
| Google Gemini   | `apps/api/src/ai/providers/gemini.ts`     | Text generation, content optimization, tone                            |
| Perplexity      | `apps/api/src/ai/providers/perplexity.ts` | Research-grounded generation, trend-aware content                      |
