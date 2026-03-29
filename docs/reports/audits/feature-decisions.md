# OmniPost — Feature Decisions

> One decision block per non-fully-implemented capability, sorted by recommendation type.
> Generated: 2026-03-10 | Feeds directly into sprint planning.
> Every IMPLEMENT or HOMOLOGATE entry is independently actionable by a developer.

---

## IMPLEMENT — Build this capability. Core value proposition.

---

### DOMAIN 4 — Social Inbox: Unified View (All Platforms)

**Current status:** 🟡 PARTIAL — Backend 100% complete (15 use cases, SocialMessageAggregate, SocialConversation entity, inboxRoutes.ts, cursor-paginated GetInboxQuery). Zero frontend UI.

**Recommendation:** IMPLEMENT — Build the UI.

**Rationale:** This is the #1 feature users expect from a social media management tool. The backend is production-ready. Only the frontend is missing. An admin inbox page with conversation list, platform filter, and message thread view would make this feature fully usable.

**Estimated scope:** L (2-4 weeks)

**Dependencies:** Backend already complete. No additional backend work needed for MVP inbox.

**Open questions:** Start with read-only (comments + mentions) or include DM support in v1? TikTok and Telegram DM APIs have access restrictions — recommend starting with comment/mention threads for X, Instagram, Facebook, YouTube, LinkedIn.

---

### DOMAIN 4 — Social Inbox: Reply from Dashboard

**Current status:** 🟡 PARTIAL — Backend: `SendReplyUseCase.ts` complete, calls provider `postReply()` for X, Instagram, Facebook, YouTube, LinkedIn. No UI.

**Recommendation:** IMPLEMENT — Build reply composer in inbox UI.

**Rationale:** Without reply capability the inbox is read-only and loses its operational value. Should be part of the same sprint as inbox view.

**Estimated scope:** M (1-2 weeks)

**Dependencies:** Inbox unified view (D4.1 above), provider `postReply()` already implemented for 5 providers.

**Open questions:** Inline reply vs. reply modal — recommend inline composer anchored below the conversation thread.

---

### DOMAIN 4 — Social Inbox: Conversation Assignment UI

**Current status:** 🟡 PARTIAL — Backend: `AssignMessageUseCase.ts` complete. No UI.

**Recommendation:** IMPLEMENT — Add assignee picker to conversation view.

**Rationale:** Teams need to distribute engagement work. The backend is trivial to wire. Depends on team member list from D8.

**Estimated scope:** S (1-3 days)

**Dependencies:** Inbox unified view, team member list API (already exists in teamRoutes.ts).

**Open questions:** None.

---

### DOMAIN 4 — Social Inbox: Mention Monitoring

**Current status:** 🟡 PARTIAL — Backend: `GetMentionsQuery.ts` exists, filters by `type: 'MENTION'`. Webhook processors for all providers can ingest mentions. No UI entry point.

**Recommendation:** IMPLEMENT — Add "Mentions" tab to inbox UI.

**Rationale:** High-value feature for brand monitoring. Zero new backend work required — just a filtered view of the inbox.

**Estimated scope:** XS (< 1 day)

**Dependencies:** Inbox unified view.

**Open questions:** None.

---

### DOMAIN 8 — Team Collaboration: Approval Workflow UI

**Current status:** 🟡 PARTIAL — Backend: full approval pipeline (`SubmitForReviewUseCase`, `ApprovePostUseCase`, `RejectPostUseCase`, `GetPendingApprovalsQuery`, `GetApprovalHistoryQuery`). `ApprovalRequestAggregate` with state machine. `PENDING_REVIEW` publish status. No UI.

**Recommendation:** IMPLEMENT — Add approval flow to post editor and a reviewer dashboard.

**Rationale:** Enterprise and agency teams require content approval before publishing. The entire state machine is built. This is purely UI work: a "Submit for Review" button in the post editor, a pending approvals panel in admin, and approve/reject actions with optional rejection comment.

**Estimated scope:** M (1-2 weeks)

**Dependencies:** None — backend complete.

**Open questions:** Should rejected posts return to DRAFT or go to FAILED? (Recommend DRAFT with rejection comment shown in editor.)

---

### DOMAIN 8 — Team Collaboration: Notification Center UI

**Current status:** 🟡 PARTIAL — Backend: `Notification` entity, SSE broadcaster via Redis pub/sub, 5 use cases (`CreateNotification`, `MarkRead`, `GetNotifications`, `GetUnreadCount`, `NotificationEventHandlers` wired to domain events). `notificationRoutes.ts`. No UI.

**Recommendation:** IMPLEMENT — Add notification bell to admin header with dropdown and SSE connection.

**Rationale:** Notifications are the connective tissue that makes approvals, inbox, and team collaboration feel real-time. The SSE endpoint exists. A simple bell icon + dropdown showing unread notifications + "mark all read" is all that's needed.

**Estimated scope:** M (1-2 weeks)

**Dependencies:** None — backend complete.

**Open questions:** Web push notifications (browser) vs SSE only — recommend SSE for MVP.

---

### DOMAIN 8 — Team Collaboration: In-Post Comment Thread UI

**Current status:** 🟡 PARTIAL — Backend: `PostCommentAggregate` with threaded replies, 4 use cases (Create, Edit, Delete, GetPostComments). `commentRoutes.ts`. No UI.

**Recommendation:** IMPLEMENT — Add comment panel to post detail / review view.

**Rationale:** In-context commenting enables the review conversation that makes approval workflows actionable. Builds on the approval UI (same view).

**Estimated scope:** S (1-3 days)

**Dependencies:** Approval workflow UI — comment panel lives inside the review view.

**Open questions:** Markdown support in comments? Recommend plain text for MVP.

---

### DOMAIN 6 — AI: Image Generation UI

**Current status:** 🟡 PARTIAL — Backend: `GenerateImageUseCase.ts` (DALL-E 3 via OpenAI), `ListGeneratedImagesQuery.ts`. Prisma `GeneratedImage` + S3 storage. `aiImageRoutes.ts` (2 endpoints). No UI.

**Recommendation:** IMPLEMENT — Build generation form in AI section + insert-to-editor action.

**Rationale:** The backend integration is complete and tested. A simple form (prompt input, size selector, generate button) + a gallery of previously generated images + "Insert into post" action is all that's missing. High visual impact, low effort.

**Estimated scope:** S (1-3 days)

**Dependencies:** None — backend complete.

**Open questions:** Watermarking before insert? Usage limits per tier? Recommend adding to usage metering (D12.6).

---

### DOMAIN 2 — Scheduling: Recurring Posts UI

**Current status:** 🟡 PARTIAL — Backend: `RecurringPost` domain entity with `CronExpression` VO, 6 use cases (Create, Update, Deactivate, Process, Get, List), `recurringPostRoutes.ts` (5 endpoints), BullMQ repeatable jobs. No UI.

**Recommendation:** IMPLEMENT — Build recurring post CRUD UI in scheduling section.

**Rationale:** Power users expect this. Backend is production-ready. UI needs: cron picker (or human-friendly recurrence selector), content rotation config (EXACT / ROTATED / AI_GENERATED), max occurrences, end date, pause/resume toggle.

**Estimated scope:** M (1-2 weeks)

**Dependencies:** None — backend complete.

**Open questions:** Expose raw cron expression or build friendly UI (every day / every week / every month)? Recommend friendly UI with cron as advanced option.

---

### DOMAIN 3 — Publishing: Bluesky Provider

**Current status:** 🔴 MISSING — No Bluesky provider exists.

**Recommendation:** IMPLEMENT — Build AT Protocol provider adapter.

**Rationale:** Bluesky is the fastest-growing alternative social platform (AT Protocol). The API is fully open — no approval process, no API key required for basic publishing. It accepts posts, images, and link cards. Its users skew tech-savvy, making it high-value for early adopters of a tool like OmniPost.

**Estimated scope:** M (1-2 weeks)

**Dependencies:** `AbstractProviderAdapter` base class already defined. Pattern established by existing 9 providers.

**Open questions:** Does AT Protocol support OAuth or is it login-based? Bluesky uses App Passwords for third-party auth — need to document in OAuth flow.

---

### DOMAIN 1 — Composer: Platform Preview for Missing Providers

**Current status:** 🟡 PARTIAL — `PlatformPreview.tsx` renders X, Instagram, LinkedIn. Missing: Facebook, TikTok, YouTube, Snapchat, Pinterest, Telegram (6 of 9 providers).

**Recommendation:** IMPLEMENT — Extend PlatformPreview with all active providers.

**Rationale:** Users cannot see how their content will look on 6 of 9 connected platforms before publishing. This breaks the core "preview before you post" value proposition.

**Estimated scope:** S (1-3 days)

**Dependencies:** None.

**Open questions:** For Telegram (text channel), should preview show a simulated chat bubble UI or just a text rendering?

---

### DOMAIN 7 — Analytics: Scheduled Reports UI

**Current status:** 🟡 PARTIAL — Backend: `CreateScheduledReportUseCase`, `GenerateReportUseCase`, `ScheduledReport` entity, `reportGenerationWorker.ts`, `reportRoutes.ts`. CSV export via `csvExport.ts`. No UI confirmed for scheduled reports management.

**Recommendation:** IMPLEMENT — Build scheduled reports management panel in analytics section.

**Rationale:** Scheduled reports close the analytics loop. Stakeholders need automated exports. The BullMQ cron infrastructure is in place. UI needs: create report form (frequency, metrics, email destination), list of active schedules, manual generate button.

**Estimated scope:** S (1-3 days)

**Dependencies:** None — backend complete.

**Open questions:** PDF export vs CSV only? Recommend CSV for MVP.

---

### DOMAIN 13 — Integrations: Interactive API Documentation

**Current status:** 🔴 MISSING — No Swagger/Scalar UI. 41 route files with 90+ endpoints exist but are undocumented for external consumers.

**Recommendation:** IMPLEMENT — Add `@fastify/swagger` + `@scalar/fastify-api-reference` to the API.

**Rationale:** Developer adoption requires documentation. The API already exists and is well-structured. Swagger/Scalar auto-generates from route schemas. This is a 1-day task with high leverage — it unlocks SDK generation, partner integrations, and Zapier/Make connectors.

**Estimated scope:** S (1-3 days)

**Dependencies:** None.

**Open questions:** Should the docs be public (no auth) or require API key? Recommend public for discoverability.

---

### DOMAIN 13 — Integrations: Slack/Teams Notification UI

**Current status:** 🟡 PARTIAL — Backend: `SlackNotifierAdapter.ts`, `TeamsNotifierAdapter.ts`, `ExternalNotificationDispatcher.ts`, `externalNotificationRoutes.ts` (configure, delete, test, list). Prisma `ExternalNotificationConfig`. No UI.

**Recommendation:** IMPLEMENT — Build webhook config form in settings/integrations section.

**Rationale:** Quick win. Backend complete. UI is a simple form: webhook URL, platform type (Slack/Teams), notification triggers (post published, approval pending, crisis mode). Test button already backed by `TestExternalNotificationUseCase`.

**Estimated scope:** XS (< 1 day)

**Dependencies:** None — backend complete.

**Open questions:** None.

---

### DOMAIN 4 — Social Inbox: Internal Notes on Conversations

**Current status:** 🔴 MISSING — No `AddInternalNoteUseCase` or `InternalNote` model exists anywhere.

**Recommendation:** IMPLEMENT — Add internal note capability to conversation model.

**Rationale:** Internal notes are the mechanism that prevents agents from sending duplicate replies and lets teams coordinate on complex conversations. Required for any team using the inbox at scale.

**Estimated scope:** S (1-3 days) — new Prisma field + use case + UI addition to conversation view.

**Dependencies:** Inbox unified view (D4.1).

**Open questions:** Notes as a separate model or as a `SocialMessage` with `type: 'INTERNAL_NOTE'`? Recommend separate field on `SocialConversation` for simplicity.

---

## HOMOLOGATE — We have something similar; align it to the reference model.

---

### DOMAIN 2 — Scheduling: Bulk Scheduling via CSV

**Current status:** 🟡 PARTIAL — `BulkScheduleView.tsx` and `MultiPlatformSchedulerRefactored.tsx` exist. CSV import not confirmed — the form may require manual per-post entry.

**Recommendation:** HOMOLOGATE — Add CSV template download + bulk upload to the existing BulkScheduleView.

**Rationale:** CSV bulk scheduling is the standard for agencies managing campaigns weeks in advance. The UI scaffold exists. Adding file upload + CSV parsing + batch post creation aligns it to the reference model standard.

**Estimated scope:** S (1-3 days)

**Dependencies:** None.

**Open questions:** CSV column schema: `date, time, platform, copy, media_url, campaign` — confirm standard.

---

### DOMAIN 7 — Analytics: 12-Month Historical Tracking

**Current status:** 🟡 PARTIAL — Prisma `AnalyticsDailySummary` + `AnalyticsMonthlySummary` models exist. `GetHistoricalAnalyticsQuery.ts` exists. `analyticsAggregationWorker.ts` runs aggregation. 12-month specific retention policy not confirmed.

**Recommendation:** HOMOLOGATE — Add explicit 12-month data retention config and confirm the aggregation worker runs on a daily schedule.

**Rationale:** The infrastructure exists. Needs explicit configuration of retention period and a cron schedule for the aggregation worker.

**Estimated scope:** XS (< 1 day)

**Dependencies:** None.

**Open questions:** Archive strategy for data older than 12 months — delete vs. compress to annual summary.

---

### DOMAIN 7 — Analytics: GA4 / UTM Integration

**Current status:** 🟡 PARTIAL — `GA4TrackingPort.ts` (domain port) + `GenerateUTMLinksUseCase.ts` + `utmRoutes.ts`. Concrete GA4 adapter implementation not confirmed.

**Recommendation:** HOMOLOGATE — Implement GA4 Measurement Protocol adapter and wire it to tracked link clicks.

**Rationale:** UTM links are generated but GA4 reporting is incomplete. Implementing the `GA4TrackingPort` adapter with the Measurement Protocol API closes the loop: link click → UTM → GA4 event → attribution in Google Analytics.

**Estimated scope:** S (1-3 days)

**Dependencies:** `GA4TrackingPort` interface defined. Google Analytics Measurement Protocol API key needed.

**Open questions:** Server-side GA4 events (Measurement Protocol) vs. client-side — recommend server-side for reliability.

---

### DOMAIN 2 — Scheduling: Calendar Filtering

**Current status:** 🟡 PARTIAL — Basic scheduling rules and sidebar exist. Full multi-dimension filtering (platform + campaign + team member simultaneously) not confirmed.

**Recommendation:** HOMOLOGATE — Add platform, campaign, and assignee filters to the calendar sidebar.

**Rationale:** Users with large content calendars need to filter by platform or campaign to see relevant content. The Campaign model exists, the provider list exists — wiring them to calendar filters is straightforward.

**Estimated scope:** S (1-3 days)

**Dependencies:** Campaign model (exists), provider connections (exist).

**Open questions:** None.

---

### DOMAIN 6 — AI: Prompt Library — Make User-Editable

**Current status:** 🟡 PARTIAL — `ai-content-templates.ts` in admin + `AITemplateSelector.tsx`. Templates are hardcoded in source — not stored in DB, not user-editable.

**Recommendation:** HOMOLOGATE — Move prompt templates to Prisma + CRUD endpoints.

**Rationale:** A prompt library hardcoded in source code cannot be extended by users or customized per account. Storing prompts in DB (a simple `AIPromptTemplate` model: title, category, prompt, variables) enables personalization.

**Estimated scope:** S (1-3 days)

**Dependencies:** None.

**Open questions:** Per-account templates or global? Recommend both: global system templates + per-account custom templates.

---

### DOMAIN 9 — Asset Library: Search and Tag Support

**Current status:** 🟡 PARTIAL — `SearchAndSortBar.tsx` + `FilterPanel.tsx` exist. Folder-based organization and media-specific tags not confirmed in the data model.

**Recommendation:** HOMOLOGATE — Add media-level tags to `PostMedia` model and wire to ContentLibrary search.

**Rationale:** Users who upload hundreds of assets need search and filtering to find them. The UI components exist but the data model may not support media tagging independently of post tags.

**Estimated scope:** S (1-3 days)

**Dependencies:** None.

**Open questions:** Should tags be free-form text or predefined categories?

---

### DOMAIN 12 — Multi-Tenant: Detailed Usage Metering

**Current status:** 🟡 PARTIAL — `SubscriptionTier`, `maxProjects`, rate limiting via `advancedRateLimit.ts`. No per-tier metering of posts/month, API calls/month, or storage GB.

**Recommendation:** HOMOLOGATE — Add `UsageMetric` model tracking consumption per account per month, enforce tier limits.

**Rationale:** Without usage metering, enforcing feature limits per subscription tier is impossible. Required before scaling to paid customers.

**Estimated scope:** M (1-2 weeks)

**Dependencies:** None.

**Open questions:** Which dimensions to meter: posts/month, storage GB, AI calls/month, team members? Recommend all four.

---

## DECIDE — Requires a product/business decision before engineering proceeds.

---

### DOMAIN 2 — Scheduling: Optimal Timing (Heuristic vs. Real Predictions)

**Current status:** 🟡 PARTIAL — `PredictOptimalTimingUseCase.ts` is rule-based heuristic. `OptimalTimesView.tsx` shows suggestions.

**Recommendation:** DECIDE — Choose between keeping heuristic (simple) or wiring real historical analytics data.

**Rationale:** The use case currently uses `AnalyticsReadRepository` for timing input but the prediction logic is rule-based. With real analytics data per account, this can become genuinely useful without any ML. Decision: invest in smarter heuristic with real account data, or accept current level as sufficient.

**Estimated scope:** M (1-2 weeks) if real analytics wired.

**Dependencies:** `AnalyticsDailySummary` data accumulation per account.

**Open questions:** Is there enough historical data per account at launch to make per-account recommendations meaningful?

---

### DOMAIN 5 — Social Listening: Keyword Monitoring

**Current status:** 🔴 MISSING — No keyword monitoring infrastructure.

**Recommendation:** DECIDE — Build vs. Buy.

**Rationale:** Implementing real-time keyword monitoring across multiple platforms requires either (a) building integrations with each platform's search/stream APIs, or (b) integrating a third-party listening service (Brandwatch, Mention.com, Sprout Listening). Platform search APIs have severe rate limits. Option (b) is expensive but faster.

**Estimated scope:** XL if built internally. M if via third-party API integration.

**Dependencies:** Budget for third-party service, or significant engineering time.

**Open questions:** Is social listening a core differentiator or a nice-to-have? If core: build. If secondary: buy.

---

### DOMAIN 6 — AI: Brand Voice Profiles

**Current status:** 🔴 MISSING — No brand voice model or per-account AI configuration.

**Recommendation:** DECIDE — System prompts vs. fine-tuning.

**Rationale:** Brand voice can be simulated via a per-account system prompt injected into every AI request (cheap, immediate) or via fine-tuning a model on brand examples (expensive, much better results). The AI orchestrator already supports per-request configuration.

**Estimated scope:** S (1-3 days) for system prompt approach. XL for fine-tuning.

**Dependencies:** None for system prompt approach.

**Open questions:** Is fine-tuned brand voice a differentiator worth the cost, or is system prompt sufficient for target market?

---

### DOMAIN 8 — Team Collaboration: Task Assignment

**Current status:** 🔴 MISSING — No task model. Team member model exists but post-to-member assignment for creation (not approval) is not implemented.

**Recommendation:** DECIDE — Build internal task management or integrate with Linear/Jira/Asana.

**Rationale:** A full internal task system (task model, status, priority, due date) is significant scope. For most social media teams, approval workflow + inbox assignment covers 80% of coordination needs. External integration via webhook/API is cheaper.

**Estimated scope:** M (1-2 weeks) for basic internal tasks. L for full task management.

**Dependencies:** Notification system (D8.4).

**Open questions:** Is task management within OmniPost a feature our target users explicitly want, or do they already use a dedicated tool?

---

### DOMAIN 10 — Employee Advocacy: Full Module

**Current status:** 🔴 MISSING — Entire module does not exist.

**Recommendation:** DECIDE — Product scope decision required.

**Rationale:** Employee advocacy is a distinct product module with its own user type (advocate), data model, and UX. It makes sense for enterprise customers (10,000+ employee companies) but adds significant complexity for SMBs and agencies. Should only be built if the target market includes enterprise.

**Estimated scope:** XL (> 1 month)

**Dependencies:** D8 Team workflows fully functional, D3 Publishing engine stable.

**Open questions:** Is enterprise (advocacy use case) part of the target market for the current launch phase?

---

### DOMAIN 11 — Social Advertising: Post Boosting

**Current status:** 🔴 MISSING — No boost functionality.

**Recommendation:** DECIDE — Start with post-boost before full ad management.

**Rationale:** "Boost this post" is a simpler entry point into social advertising than full campaign creation. Meta (Facebook + Instagram) and TikTok support single-click boosting via their APIs. This could be a quick win with high perceived value, but requires ad API approval from Meta (review process, business verification).

**Estimated scope:** M (1-2 weeks) once API access granted.

**Dependencies:** Meta Marketing API approval (business verification required). TikTok Marketing API functional implementation.

**Open questions:** Is advertising in scope for the current product phase? What is the business verification status with Meta?

---

## DEFER — Not critical for current phase; add to backlog.

---

### DOMAIN 1 — Composer: Emoji Picker

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — Low priority, add after core features are complete.

**Rationale:** Users can paste emojis from their OS. An embedded picker improves UX but is not blocking for launch. Use `emoji-mart` or a similar library when prioritized.

**Estimated scope:** XS (< 1 day)

**Dependencies:** None.

**Open questions:** None.

---

### DOMAIN 1 — Composer: Design Tool Integration (Canva, Adobe Express)

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — Requires Canva Connect API partnership (free tier may not support embedded editing for SaaS) and API key setup.

**Rationale:** High effort to do correctly. Users can create in Canva and upload the result. Adds polish but not core functionality.

**Estimated scope:** L (2-4 weeks)

**Dependencies:** Canva Connect API access (partnership/agreement).

**Open questions:** Does Canva's free tier allow embedding in third-party SaaS applications?

---

### DOMAIN 1 — Composer: @Mention Autocomplete

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — Requires Social Inbox (D4) to have follower/contact data. Without inbox data, there's nothing to autocomplete against.

**Estimated scope:** M (1-2 weeks) after D4 is complete.

**Dependencies:** Social Inbox with contact/follower data.

**Open questions:** None.

---

### DOMAIN 5 — Social Listening: Sentiment Analysis

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — Requires keyword monitoring (D5 keyword monitoring) to have data. Without inbound mentions, there's nothing to run sentiment on. Implement after keyword monitoring decision is made.

**Estimated scope:** M (1-2 weeks) — could be wired through existing `aiService.ts`.

**Dependencies:** D5 keyword monitoring, Social Inbox data.

**Open questions:** None (decision depends on D5 keyword monitoring decision above).

---

### DOMAIN 5 — Social Listening: Competitor Tracking

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — Extremely high complexity. Requires scraping public profiles or expensive third-party data APIs. Not feasible without significant infrastructure investment.

**Estimated scope:** XL

**Dependencies:** D5 keyword monitoring infrastructure.

**Open questions:** None — defer until market validation confirms demand.

---

### DOMAIN 7 — Analytics: Custom Report Builder

**Current status:** 🔴 MISSING — Static dashboards only.

**Recommendation:** DEFER — Static dashboards cover 90% of use cases. A drag-and-drop report builder is high complexity UI work for marginal gain at launch.

**Estimated scope:** L (2-4 weeks)

**Dependencies:** Stable analytics data layer.

**Open questions:** None.

---

### DOMAIN 7 — Analytics: Industry Benchmark Data

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — Requires data from a large base of accounts or a third-party benchmark service. Not feasible until OmniPost has significant data of its own.

**Estimated scope:** XL

**Dependencies:** Large account base (>1000 accounts) or third-party benchmark data license.

**Open questions:** None.

---

### DOMAIN 8 — Team Collaboration: Multi-Level Approval Chains

**Current status:** 🔴 MISSING — Single-level approval exists in backend (submit → approve/reject).

**Recommendation:** DEFER — Single-level approval (D8.2) covers most use cases. Multi-level chains (manager → director → legal) are an enterprise feature. Build after single-level approval is proven in production.

**Estimated scope:** M (1-2 weeks)

**Dependencies:** D8.2 approval workflow UI.

**Open questions:** None.

---

### DOMAIN 9 — Asset Library: Brand Kit (Colors, Fonts, Logos)

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — No `BrandKit` Prisma model exists. Useful but not blocking for launch.

**Estimated scope:** M (1-2 weeks) — new model + settings UI + integration with content templates.

**Dependencies:** D9.1 asset library functional.

**Open questions:** Should brand colors enforce themselves in the TipTap editor (custom color palette)?

---

### DOMAIN 9 — Asset Library: External Storage Import (Google Drive, Dropbox)

**Current status:** 🟡 PARTIAL — Internal S3/Cloudinary storage works. No cloud storage import.

**Recommendation:** DEFER — Users can upload directly. Drive/Dropbox import is a convenience feature.

**Estimated scope:** M (1-2 weeks)

**Dependencies:** OAuth for Google/Dropbox (separate from provider OAuth).

**Open questions:** None.

---

### DOMAIN 11 — Social Advertising: Full Ad Management

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — Full campaign creation, budget management, audience targeting, and ad performance tracking is a product category unto itself. Far outside current scope.

**Estimated scope:** XL (> 2 months)

**Dependencies:** Meta Marketing API approval, LinkedIn Campaign Manager API access, ad creative model, budget model.

**Open questions:** None — this is a separate product phase decision.

---

### DOMAIN 12 — Multi-Tenant: SSO / SAML / OIDC

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — Required for enterprise customers but not for SMB/agency launch. Add when first enterprise deal requires it.

**Estimated scope:** L (2-4 weeks)

**Dependencies:** Auth infrastructure (already solid). Decision on provider: Keycloak (self-hosted) vs. Auth0 (SaaS).

**Open questions:** None — implement when a customer requires it.

---

### DOMAIN 13 — Integrations: CRM Integration

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — CRM integration (Salesforce, HubSpot) is an enterprise feature. Low priority for current phase.

**Estimated scope:** L (2-4 weeks per CRM)

**Dependencies:** None.

**Open questions:** None.

---

### DOMAIN 13 — Integrations: Zapier / Make Connector

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — The public API already exists. Zapier/Make connectors require publishing to their marketplaces and ongoing maintenance. Build after API documentation is complete.

**Estimated scope:** M (1-2 weeks)

**Dependencies:** D13 API documentation (Swagger/Scalar).

**Open questions:** Zapier first or Make? Recommend Zapier due to larger user base.

---

### DOMAIN 13 — Integrations: Integration Marketplace

**Current status:** 🔴 MISSING

**Recommendation:** DEFER — A marketplace requires multiple integrations to exist first. Premature at this stage.

**Estimated scope:** XL

**Dependencies:** 10+ integrations implemented.

**Open questions:** None.

---

## REMOVE — Dead code with no implementation path and no product value.

---

### DOMAIN 6 — AI: PredictAudienceResponseUseCase

**Current status:** 🟡 PARTIAL — `apps/api/src/application/ml/PredictAudienceResponseUseCase.ts` exists. Rule-based heuristic. No route wires to it. No frontend consumer.

**Recommendation:** REMOVE — This use case is unreachable from any route. It computes a heuristic "audience response" score with no real data. It is dead code that adds maintenance surface without value.

**Estimated scope:** XS (< 1 day) — delete file + remove DI registration.

**Dependencies:** None.

**Open questions:** None. If audience prediction is desired in future, rebuild properly using real analytics data.

---

### DOMAIN 11 — Social Advertising: TikTok Marketing API createPromotedContent stub

**Current status:** 🟡 PARTIAL — `packages/providers/tiktok/src/marketingApiClient.ts` `createPromotedContent()` logs `"Marketing campaign creation not fully implemented"` and does not return a valid result.

**Recommendation:** REMOVE the stub implementation. Keep the `marketingApiClient.ts` file as a placeholder for future work but remove the misleading `createPromotedContent()` body that pretends to work while doing nothing useful.

**Estimated scope:** XS (< 1 day)

**Dependencies:** None.

**Open questions:** None.

---

### DOMAIN 3 — Publishing: YouTube Community Posts stub

**Current status:** 🟡 PARTIAL — `publishCommunityPost()` in `YouTubeAdapter.ts` returns hardcoded `err("VALIDATION")`.

**Recommendation:** REMOVE the stub and replace with a clear `⚫ OUT OF SCOPE` comment explaining that YouTube Community Tab API requires YouTube Partner Program access (not available via standard API). Document in the adapter's capabilities object by setting `communityPosts: false`.

**Estimated scope:** XS (< 1 day)

**Dependencies:** None.

**Open questions:** None.

---

## TOP 10 IMPLEMENT PRIORITIES (Ordered by Impact × Effort)

| Priority | Capability                             | Domain | Status           | Scope | Rationale                              |
| -------- | -------------------------------------- | ------ | ---------------- | ----- | -------------------------------------- |
| 1        | Social Inbox UI (unified view)         | D4     | 🟡 Backend ready | L     | #1 expected feature, backend done      |
| 2        | Approval Workflow UI                   | D8     | 🟡 Backend ready | M     | Unblocks team adoption                 |
| 3        | Notification Center UI                 | D8     | 🟡 Backend ready | M     | Transversal — powers approvals + inbox |
| 4        | Reply from Inbox                       | D4     | 🟡 Backend ready | M     | Without reply, inbox is read-only      |
| 5        | AI Image Generation UI                 | D6     | 🟡 Backend ready | S     | Backend done, 1-3 days of UI           |
| 6        | Slack/Teams Notification UI            | D13    | 🟡 Backend ready | XS    | < 1 day, high perceived value          |
| 7        | Recurring Posts UI                     | D2     | 🟡 Backend ready | M     | Power user feature, backend done       |
| 8        | Platform Preview (6 missing providers) | D1     | 🟡 Partial       | S     | Core UX gap in composer                |
| 9        | Bluesky provider                       | D3     | 🔴 Missing       | M     | Growing platform, no approval needed   |
| 10       | API Documentation (Swagger/Scalar)     | D13    | 🔴 Missing       | S     | Unlocks developer adoption + SDK       |
