# Feature trace matrix in the code — OmniPost

> Cross-check of the ~70 features of the competitive catalog ([COMPETITIVE_ANALYSIS_ES.md §6](COMPETITIVE_ANALYSIS_ES.md)) against OmniPost's actual code and documentation (`apps/`, `packages/`, `infra/prisma/schema.prisma`, `docs/`). Traced in May 2026 through a parallel exploration of the repository.
>
> **Order:** ascending by need — from ⬛ _Waste of time_ (least needed) to 🟥 _Mandatory_ (most needed). Within each level, grouped by category.
>
> **Trace status:**
>
> | Status         | Meaning                                           |
> | -------------- | ------------------------------------------------- |
> | ✅ IMPLEMENTED | Real working code (use case + route + model)      |
> | 🟡 PARTIAL     | Model/infra/stub present, not complete end-to-end |
> | 📐 CONSIDERED  | In design/backlog/audit docs, not in code         |
> | 💬 MENTION     | Isolated name or comment, no design and no code   |
> | ⛔ NO TRACE    | Nothing in code or in product docs                |
>
> **Note on methodological honesty:** some features (voiceover, meme generator, blog→video, WordPress) appeared as "evidence" only in the `COMPETITIVE_ANALYSIS_ES.md` we wrote earlier — that is a circular reference, **not** a trace in the product. They are marked ⛔ NO TRACE with the stated caveat.

---

## ⬛ Level 1 — Waste of time (minimal need)

| Feature              | Category | Status      | Evidence / note                                                                                            |
| -------------------- | -------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| AI voiceover         | AI       | ⛔ NO TRACE | Only in our own competitive analysis (circular). Correct: it is classified as bloat and must not be built. |
| Meme generator       | AI       | ⛔ NO TRACE | Same. Consistent with the decision not to invest.                                                          |
| Influencer marketing | Agency   | ⛔ NO TRACE | No model and no route. Consistent: out of focus.                                                           |

_Reading: all three ⬛ are correctly absent from the code. There is no debt here — it is intentional alignment._

---

## 🟦 Level 2 — Interesting (differentiation bet)

| Feature                                       | Category   | Status         | Evidence / note                                                                                                                                                                            |
| --------------------------------------------- | ---------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Content informed by real analytics            | AI         | ✅ IMPLEMENTED | `apps/api/src/application/ai/GetTopPerformersContextUseCase.ts:66`, `buildEnhancedSystemPrompt.ts` — injects the top performers into the prompt. **A real differentiator, already built.** |
| Multi-provider AI with routing                | AI         | ✅ IMPLEMENTED | `apps/api/src/ai/orchestrator.ts:99`, `AIProviderFactory.ts:13` (OpenAI/Gemini/Perplexity/Anthropic + fallback).                                                                           |
| Integrated HubSpot/Salesforce CRM             | Agency     | ✅ IMPLEMENTED | `infra/prisma/schema.prisma:2649,2669`, `apps/api/src/crm/crmRoutes.ts`.                                                                                                                   |
| ROI reporting                                 | Analytics  | ✅ IMPLEMENTED | `apps/api/src/analytics/roiCalculator.ts`, [docs/features/advanced-analytics.md:109].                                                                                                      |
| Autonomous features (repurpose/triage/trends) | AI         | 🟡 PARTIAL     | Queues defined (`docs/technical/DEPENDENCIES.md:116`); `apps/api/src/repurpose/repurposeRoutes.ts` returns **501 NOT_IMPLEMENTED**. Scaffolding with no worker.                            |
| AI video generation                           | AI         | 🟡 PARTIAL     | `VideoProcessingJob` `schema.prisma:1279`, `videoProcessor.ts` — only video splitting/processing, no text-to-video.                                                                        |
| AI message triage/classification              | Inbox      | 🟡 PARTIAL     | `apps/api/src/application/inbox/TriageInboxMessageUseCase.ts:1`, `schema.prisma:2134` (priority).                                                                                          |
| Multi-tone AI reply suggestions               | Inbox      | 🟡 PARTIAL     | `schema.prisma:2135` (`suggestedReplies`), `TriageInboxMessageUseCase.ts:19`.                                                                                                              |
| Content discovery / curation                  | Agency     | 🟡 PARTIAL     | `apps/api/src/trends/trendTypes.ts:4` — trend analysis with discovery insights.                                                                                                            |
| RSS / blog auto-posting                       | Publishing | ⛔ NO TRACE    | No RSS feed model and no auto-post.                                                                                                                                                        |
| Image-to-caption                              | AI         | ⛔ NO TRACE    | Image generation exists; image→caption analysis does not.                                                                                                                                  |
| Blog→video / blog→carousel                    | AI         | ⛔ NO TRACE    | Only a circular reference in our analysis.                                                                                                                                                 |
| E-commerce product → post/video               | AI         | ⛔ NO TRACE    | No Shopify/WooCommerce and no product feed.                                                                                                                                                |
| Paid ads analytics                            | Analytics  | ⛔ NO TRACE    | No ad spend models or code.                                                                                                                                                                |
| Audience targeting / sponsoring               | Publishing | 💬 MENTION     | `schema.prisma:2230` (campaign references), no boosting/sponsoring.                                                                                                                        |
| Employee advocacy                             | Agency     | ⛔ NO TRACE    | No infrastructure.                                                                                                                                                                         |

_Reading: your 4 strongest bets (analytics-informed content, multi-LLM AI, CRM, ROI) **are already implemented** — it is your sales narrative, and it is real. The autonomous features (key in the investor pitch) exist only as scaffolding (501) — a gap between the promise and the code._

---

## 🟩 Level 3 — Nice to have

| Feature                                 | Category     | Status         | Evidence / note                                                                                      |
| --------------------------------------- | ------------ | -------------- | ---------------------------------------------------------------------------------------------------- |
| Brand kit / asset library               | AI           | ✅ IMPLEMENTED | `schema.prisma:2475` (`BrandKit`), `2753` (`MediaAsset`/`AssetFolder`/`AssetTag`).                   |
| Sentiment analysis                      | Inbox        | ✅ IMPLEMENTED | `schema.prisma:2138` (`sentimentScore`), `aiService.test.ts:263`.                                    |
| Customizable reports / templates        | Analytics    | ✅ IMPLEMENTED | `apps/api/src/custom-reports/customReportRoutes.ts`, `schema.prisma:2599` (`CustomReport`).          |
| Audit logs                              | Enterprise   | ✅ IMPLEMENTED | `schema.prisma:200` (`AuditLog`), `apps/admin/app/(dashboard)/logs/page.tsx`.                        |
| Zapier / Make                           | Integrations | ✅ IMPLEMENTED | `apps/api/src/integrations/zapierRoutes.ts`, `makeRoutes.ts`.                                        |
| Competitor benchmarking                 | Analytics    | 🟡 PARTIAL     | `apps/api/src/analytics/crossPlatform/competitiveAnalyzer.ts:32`.                                    |
| Link-in-bio                             | Publishing   | 🟡 PARTIAL     | `schema.prisma:782,2245`, `CreateTrackedLinkUseCase.ts`.                                             |
| AI carousels                            | AI           | 🟡 PARTIAL     | `provider-capabilities.md` ("10 carousel" capability), no generation service.                        |
| Public API / MCP                        | Integrations | 🟡 PARTIAL     | `apps/api/src/auth/integrationAuthMiddleware.ts` (API keys); no MCP.                                 |
| AI alt-text                             | AI           | 💬 MENTION     | [docs/features/platform-expansion.md] (alt text as metadata), not implemented.                       |
| Recycling / evergreen queues            | Publishing   | ⛔ NO TRACE    | No recurring posts and no evergreen queue.                                                           |
| Collision detection                     | Inbox        | ⛔ NO TRACE    | No reply-collision.                                                                                  |
| Review management                       | Inbox        | ⛔ NO TRACE    | Only `FirstComment` (`schema.prisma:2360`), which is not review management. **Confirmed sales gap.** |
| Moderation rules / automation           | Inbox        | ⛔ NO TRACE    | No auto-moderation.                                                                                  |
| Platform white-label                    | Agency       | ⛔ NO TRACE    | Only an implicit report white-label; no platform branding/domain.                                    |
| Looker Studio connector / analytics API | Analytics    | ⛔ NO TRACE    | No Looker connector.                                                                                 |

A bracketed reference such as `[docs/x.md:12]` links the version of the page that measured the citation, which for a page deleted from the repository is its last version; each link names the commit and the path, so `git show <commit>:<path>` reads it offline. A path in backticks names the page as it is today.

[docs/features/platform-expansion.md]: https://github.com/edwardricardo/omni-post/blob/d53b66a0597323a6c604f5695e39ea3078bed123/docs/features/platform-expansion.md
[docs/features/analytics.md:100]: https://github.com/edwardricardo/omni-post/blob/d53b66a0597323a6c604f5695e39ea3078bed123/docs/features/analytics.md#L100
[docs/features/advanced-analytics.md:109]: https://github.com/edwardricardo/omni-post/blob/d53b66a0597323a6c604f5695e39ea3078bed123/docs/features/advanced-analytics.md#L109
[docs/features/advanced-analytics.md:41]: https://github.com/edwardricardo/omni-post/blob/d53b66a0597323a6c604f5695e39ea3078bed123/docs/features/advanced-analytics.md#L41
[docs/features/social-inbox.md]: https://github.com/edwardricardo/omni-post/blob/d53b66a0597323a6c604f5695e39ea3078bed123/docs/features/social-inbox.md
[docs/client/editor.md:6]: https://github.com/edwardricardo/omni-post/blob/d53b66a0597323a6c604f5695e39ea3078bed123/docs/client/editor.md#L725

---

## 🟨 Level 4 — Commonplace (hygiene commodity)

| Feature                         | Category     | Status         | Evidence / note                                                                                        |
| ------------------------------- | ------------ | -------------- | ------------------------------------------------------------------------------------------------------ |
| Best time to post               | Publishing   | ✅ IMPLEMENTED | `apps/api/src/admin/SchedulingSlotHandlers.ts:18`, `schema.prisma:1441` (`SchedulingRule`).            |
| Scheduled first comment         | Publishing   | ✅ IMPLEMENTED | `schema.prisma:520`, `SetFirstCommentUseCase.ts`.                                                      |
| Post templates                  | Publishing   | ✅ IMPLEMENTED | `schema.prisma:930` (`ContentTemplate`), `docs/features/templates.md`.                                 |
| AI image generation             | AI           | ✅ IMPLEMENTED | `apps/api/src/ai-image/aiImageRoutes.ts:59`, `schema.prisma:2374` (`GeneratedImage`).                  |
| Scheduled email reports         | Analytics    | ✅ IMPLEMENTED | `schema.prisma:2629` (`ReportSchedule`), `reportRoutes.ts:16`.                                         |
| Internal comments / notes       | Agency       | ✅ IMPLEMENTED | `schema.prisma:520` (`PostComment`), `2190` (`ConversationNote`).                                      |
| Slack/Teams notifications       | Agency       | ✅ IMPLEMENTED | `schema.prisma:2337`, `externalNotificationRoutes.ts`.                                                 |
| Bitly / shortener + UTM         | Integrations | ✅ IMPLEMENTED | `schema.prisma:782` (`TrackedLink`), `GenerateUTMLinksUseCase.ts`.                                     |
| Hashtag / audience demographics | Analytics    | 🟡 PARTIAL     | `apps/api/src/analytics/crossPlatform/HashtagTimingAnalyzer.ts`.                                       |
| Hashtag manager/generator       | AI           | 📐 CONSIDERED  | `apps/api/src/trends/TrendReportBuilder.ts` (`generateHashtagRecommendations`), no standalone manager. |
| Google Drive / Dropbox          | Integrations | 🟡 PARTIAL     | `ImportFromGoogleDriveUseCase.ts` — Google Drive only, no Dropbox.                                     |

_Reading: the hygiene commodity is almost entirely covered ✅ — good, its absence would eliminate you on a checklist. The only real gap: Dropbox (minor)._

---

## 🟧 Level 5 — Necessary (a sales objection if missing)

| Feature                                 | Category     | Status         | Evidence / note                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-channel preview/mockup              | Publishing   | ✅ IMPLEMENTED | `apps/client/components/editor/PlatformPreview.tsx`, `TwitterPreview.tsx`, `FacebookPreview.tsx`.                                                                                                                                                                                                                                                                                                                                            |
| Automatic Brand Voice                   | AI           | ✅ IMPLEMENTED | `schema.prisma:2459` (`BrandVoice`), `ai/routes.ts:104` (`resolveBrandVoicePrompt`), `UpsertBrandVoiceUseCase.ts`.                                                                                                                                                                                                                                                                                                                           |
| Exportable PDF/PPT reports              | Analytics    | ✅ IMPLEMENTED | `schema.prisma:2416` (`ReportFormat`), [docs/features/analytics.md:100].                                                                                                                                                                                                                                                                                                                                                                     |
| Unified inbox                           | Inbox        | ✅ IMPLEMENTED | `schema.prisma:2113` (`SocialMessage`/`SocialConversation`), [docs/features/social-inbox.md].                                                                                                                                                                                                                                                                                                                                                |
| Message assignment / tagging            | Inbox        | ✅ IMPLEMENTED | `schema.prisma:2132`, `AssignMessageUseCase.ts`.                                                                                                                                                                                                                                                                                                                                                                                             |
| RBAC / roles and permissions            | Enterprise   | ✅ IMPLEMENTED | `schema.prisma:94,110,236`, `apps/admin/components/security/RbacManager.tsx`.                                                                                                                                                                                                                                                                                                                                                                |
| Onboarding without sharing passwords    | Agency       | ✅ IMPLEMENTED | `schema.prisma:3350` (OAuth token encryption), the client's connect flow.                                                                                                                                                                                                                                                                                                                                                                    |
| Per-project members with granular roles | Agency       | 🟡 PARTIAL     | `ProjectMember` `schema.prisma:369` (join projectId+memberId+`permissions[]`) — model present, **not wired**: 0 reads/writes in prod, access today is account-wide through the tenant guard; roles are account-level (`CustomerRole`), not per project. Distinct from "RBAC/roles" (this level, account-level) and "Per-client dashboards/workspaces" (Level 6, multi-tenant). Gap: enforcement + write path + per-project role are missing. |
| SSO SAML/OIDC                           | Enterprise   | ✅ IMPLEMENTED | `schema.prisma:2539,2567`, `apps/api/src/auth/samlRoutes.ts`, `oidcRoutes.ts`.                                                                                                                                                                                                                                                                                                                                                               |
| Bulk / CSV scheduling                   | Publishing   | 🟡 PARTIAL     | `apps/api/src/admin/schedulingSchemas.ts`, `schema.prisma:1034` — the schema exists, the CSV flow is incomplete.                                                                                                                                                                                                                                                                                                                             |
| Multi-language generation               | AI           | 📐 CONSIDERED  | `docs/development/ADMIN_TO_CLIENT_MIGRATION_GUIDE.md`, audit T5-I (blocked by a product decision). A `locale` (es\|en) exists on Post, not in the generation layer.                                                                                                                                                                                                                                                                          |
| Real social listening                   | Agency       | 💬 MENTION     | Deferred as low priority in `docs/reports/audits/`. **Sales objection #1 — confirmed gap.**                                                                                                                                                                                                                                                                                                                                                  |
| Mobile app                              | Agency       | 💬 MENTION     | [docs/client/editor.md:6] (React Native on the roadmap); no app code.                                                                                                                                                                                                                                                                                                                                                                        |
| Canva / design tools                    | Integrations | ⛔ NO TRACE    | No Canva integration (only the HTML `<canvas>`). **An expected gap.**                                                                                                                                                                                                                                                                                                                                                                        |

_Reading: most of the Necessary level is ✅. The gaps that will cost deals: **social listening** (mention), **Canva** (no trace), **mobile app** (roadmap), **multi-language** (blocked by a decision — critical for LATAM), **bulk CSV** (half done)._

---

## 🟥 Level 6 — Mandatory (a deal-breaker if missing)

| Feature                            | Category   | Status         | Evidence / note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ---------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unlimited scheduling + calendar    | Publishing | ✅ IMPLEMENTED | `schema.prisma:981,1427`, `SchedulingSlotHandlers.ts:40`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Native publishing per network      | Publishing | ✅ IMPLEMENTED | `apps/api/src/content/platformContentAdapterTypes.ts:16`, `schema.prisma:1010`, 12 adapters in `packages/providers/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AI text/caption                    | AI         | ✅ IMPLEMENTED | `apps/api/src/ai/routes.ts:132`, `useAIContentGenerator.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Cross-platform analytics           | Analytics  | ✅ IMPLEMENTED | `apps/api/src/analytics/crossPlatform/index.ts`, [docs/features/advanced-analytics.md:41].                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Multi-level approval workflows     | Agency     | ✅ IMPLEMENTED | `schema.prisma:405,423,439,461`, `apps/api/src/approvals/approvalWorkflowRoutes.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Per-client dashboards / workspaces | Agency     | ✅ IMPLEMENTED | `schema.prisma:11,584,339` (native multi-tenant). **Your architectural advantage.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2FA / account security             | Enterprise | ✅ IMPLEMENTED | `MfaManager.tsx`. **Correction 2026-10-05:** `SecuritySettings.require2FA` (`schema.prisma:3310`) is no longer cited as evidence: it is edited from Admin and no code enforces it; mandatory MFA per role is N-SEC-5.b (`MASTER_PLAN_ES.md` §1, N.A). **Consolidated 2026-07 (PRs #129-133, N-SEC-5):** a unified subject-typed `MfaService` behind `MfaUserRepositoryPort` + admin+customer Prisma adapters; customer MFA persistence; single-use TOTP (atomic claim) + single-use CAS backup codes; **an MFA gate on the customer login** end-to-end (a challenge in Redis 180s + a step-2 route + client UI). Legacy `auth/mfaService.ts` removed. Living specs: `openspec/specs/{unified-mfa-service-and-port,customer-mfa-persistence,mfa-flow-correctness,customer-login-mfa-challenge}`. |

_Reading: **100% of the Mandatory level is implemented.** The foundation is solid — there is no existential debt. Communicate it as "we take it for granted", not as a differentiator._

---

## 7. Capabilities in the code that were NOT on the competitors' list

During the trace, features/infrastructure **built in OmniPost that no competitor on the list exposes** turned up — several are differentiators not exploited in the marketing/investor material:

| Capability                                            | Evidence                                                                                                  | Why it matters                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Content version control**                           | `ContentVersion` `schema.prisma:1065`                                                                     | Post history/rollback — no competitor has it as such.                                                           |
| **Git-like template versioning**                      | `TemplateVersion:1779`, `TemplateCommit:1924`, `TemplateCollaboration:1946`, `TemplateComponent:1886`     | "Commits" and collaboration on templates — unique on the market. A strong differentiator for agencies.          |
| **Native A/B testing**                                | `ABTest` `schema.prisma:1815`, `TemplateUsageEvent`                                                       | Integrated content A/B testing — Predis hints at it, nobody has it as formally.                                 |
| **Instagram Stories as a project**                    | `InstagramStoryProject:1175`, `InstagramStory:1226`                                                       | A dedicated multi-slide Stories flow.                                                                           |
| **Video processing/segmentation**                     | `VideoProcessingJob:1279`, `VideoSegment:1335`, `apps/api/src/video/videoProcessor.ts`                    | Our own video pipeline (split, segments).                                                                       |
| **Crisis management**                                 | `apps/api/src/application/crisis/EnterCrisisModeUseCase.ts`, `crisisRoutes.ts`, event `CrisisModeEntered` | Crisis mode with a workflow — an enterprise feature Sprout/Hootsuite charge a lot for; here it is native.       |
| **Task management**                                   | `Task` `schema.prisma:491`                                                                                | Task management integrated into the editorial flow.                                                             |
| **Thread composer (X/Threads)**                       | `Thread:868`, `Tweet:883`                                                                                 | Native thread composition.                                                                                      |
| **Outgoing webhooks + dead-letter**                   | `WebhookSubscription:1528`, `WebhookEvent:1475`, `WebhookDeadLetter:1573`, `apps/api/src/webhooks/`       | Platform webhooks with retries — mature integration infrastructure.                                             |
| **In-app notifications + preferences**                | `Notification:360`, `NotificationPreference:381`                                                          | Our own notification center.                                                                                    |
| **Dual payment gateway (Stripe + Paddle)**            | `apps/api/src/infrastructure/billing/PaddlePaymentAdapter.ts`, `GatewayAdapterRegistry.ts`, `billing/`    | Gateway switching by env — relevant for LATAM expansion (the investor doc highlights it).                       |
| **Transactional Saga / Outbox, idempotent consumers** | `SagaInstance:2062`, `OutboxEvent:2029`                                                                   | Distributed consistency — not a user feature, but it is the pitch's "architecture that enables speed" argument. |
| **Audited secret rotation**                           | `SecretRotationLog:223`                                                                                   | Operational security — an enterprise argument.                                                                  |

**Conclusion:** OmniPost has **at least 5 differentiators built and not communicated** — Git-like template versioning, native A/B testing, crisis mode, content version control and integrated task management. [INVESTOR_ES.md](INVESTOR_ES.md) does not mention them; they should enter the narrative because they are defensible and no competitor on the list offers them. Conversely, the confirmed gaps (social listening, Canva, review management, blocked multi-language, autonomous features at 501) must be prioritized on the roadmap before they are communicated as existing.

---

## 8. Map by app and implementation order

### 8.1 App convention

| Code    | App            | Role                                                                                                                                                   | Verified in                                            |
| ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **API** | `apps/api`     | Fastify backbone — every feature with logic/data goes through here                                                                                     | always                                                 |
| **CLI** | `apps/client`  | End-user surface (agency/creator): composer, AI, inbox, analytics, reports                                                                             | `app/{dashboard,reports}`                              |
| **ADM** | `apps/admin`   | Governance/operations: RBAC, audit, billing, webhooks, pricing, security, slots                                                                        | `app/(dashboard)/{security,logs,billing,webhooks,...}` |
| **WRK** | `apps/workers` | Async BullMQ. Workers **active today**: `publishWorker`, `analyticsIngestWorker`, `inboxSyncWorker`, `autoRenewalWorker`, `instagram/publishingWorker` | `apps/workers/src/`                                    |

> Critical infrastructure finding: only **4 active workers** exist. The queues `DETECT_REPURPOSE / GENERATE_REPURPOSE / TRIAGE_INBOX / TREND_RADAR` are defined but **have no worker consuming them** → this confirms why the autonomous features return 501.

### 8.2 What each app owns today (✅/🟡 features)

- **API (backbone):** all of them. API-only: Zapier/Make, public API, Looker (future), multi-LLM AI routing.
- **CLI:** composer + per-channel preview, text/image AI, Brand Voice, brand kit, templates, inbox, assignment, cross-platform analytics, reports/custom reports, ROI, CRM, bitly/UTM, internal comments, onboarding connect, link-in-bio (🟡).
- **ADM:** RBAC, audit logs, MFA/2FA, scheduling slots (best time), billing admin, webhooks config, pricing, multi-tenant governance.
- **WRK:** publishing (scheduling + native per network + first comment), analytics ingestion, inbox sync (+ sentiment), scheduled reports, Slack/Teams notifications, billing auto-renewal.

### 8.3 Feature → app combination matrix

| Feature                                                 | Level | Status   | App combination                    |
| ------------------------------------------------------- | ----- | -------- | ---------------------------------- |
| Scheduling + calendar                                   | 🟥    | ✅       | API + CLI + WRK                    |
| Native publishing per network                           | 🟥    | ✅       | API + WRK (+ `packages/providers`) |
| AI text/caption                                         | 🟥    | ✅       | API + CLI                          |
| Cross-platform analytics                                | 🟥    | ✅       | API + WRK + CLI                    |
| Multi-level approval                                    | 🟥    | ✅       | API + CLI                          |
| Per-client dashboards                                   | 🟥    | ✅       | API + CLI + ADM                    |
| 2FA / security                                          | 🟥    | ✅       | API + ADM + CLI                    |
| Per-channel preview/mockup                              | 🟧    | ✅       | CLI + API                          |
| Automatic Brand Voice                                   | 🟧    | ✅       | API + CLI                          |
| PDF/PPT reports                                         | 🟧    | ✅       | API + WRK + CLI                    |
| Unified inbox                                           | 🟧    | ✅       | API + WRK + CLI                    |
| Message assignment/tagging                              | 🟧    | ✅       | API + CLI                          |
| RBAC / roles                                            | 🟧    | ✅       | API + ADM                          |
| Onboarding without passwords                            | 🟧    | ✅       | API + CLI                          |
| SSO SAML/OIDC                                           | 🟧    | ✅       | API + ADM + CLI                    |
| **Bulk/CSV scheduling**                                 | 🟧    | 🟡       | API + CLI + WRK                    |
| **Multi-language generation**                           | 🟧    | 📐       | API + CLI                          |
| **Real social listening**                               | 🟧    | 💬       | API + WRK + CLI                    |
| **Canva**                                               | 🟧    | ⛔       | CLI + API                          |
| **Mobile app**                                          | 🟧    | 💬       | (new mobile app) + API             |
| Best time to post                                       | 🟨    | ✅       | API + ADM + CLI                    |
| First comment                                           | 🟨    | ✅       | API + WRK + CLI                    |
| Post templates                                          | 🟨    | ✅       | API + CLI                          |
| AI image generation                                     | 🟨    | ✅       | API + CLI                          |
| Scheduled email reports                                 | 🟨    | ✅       | API + WRK                          |
| Internal comments/notes                                 | 🟨    | ✅       | API + CLI                          |
| Slack/Teams notifications                               | 🟨    | ✅       | API + WRK                          |
| Bitly / UTM                                             | 🟨    | ✅       | API + CLI                          |
| Hashtag/audience demographics                           | 🟨    | 🟡       | API + WRK + CLI                    |
| Hashtag manager                                         | 🟨    | 📐       | API + CLI                          |
| Google Drive / Dropbox                                  | 🟨    | 🟡       | CLI + API                          |
| Brand kit / asset library                               | 🟩    | ✅       | API + CLI                          |
| Sentiment analysis                                      | 🟩    | ✅       | API + WRK                          |
| Customizable reports                                    | 🟩    | ✅       | API + CLI                          |
| Audit logs                                              | 🟩    | ✅       | API + ADM                          |
| Zapier / Make                                           | 🟩    | ✅       | API                                |
| Competitor benchmarking                                 | 🟩    | 🟡       | API + WRK + CLI                    |
| Link-in-bio                                             | 🟩    | 🟡       | API + CLI                          |
| AI carousels                                            | 🟩    | 🟡       | API + CLI                          |
| Public API / MCP                                        | 🟩    | 🟡       | API                                |
| **Recycling / evergreen**                               | 🟩    | ⛔       | API + WRK + CLI                    |
| **Collision detection**                                 | 🟩    | ⛔       | API + CLI                          |
| **Review management**                                   | 🟩    | ⛔       | API + WRK + CLI                    |
| **Moderation rules**                                    | 🟩    | ⛔       | API + WRK + CLI                    |
| **Platform white-label**                                | 🟩    | ⛔       | API + ADM + CLI                    |
| **Looker Studio connector**                             | 🟩    | ⛔       | API                                |
| AI alt-text                                             | 🟩    | 💬       | API + CLI                          |
| Analytics-informed content                              | 🟦    | ✅       | API + CLI (← WRK data)             |
| Multi-LLM AI routing                                    | 🟦    | ✅       | API                                |
| CRM HubSpot/Salesforce                                  | 🟦    | ✅       | API + CLI                          |
| ROI reporting                                           | 🟦    | ✅       | API + CLI                          |
| **Autonomous features**                                 | 🟦    | 🟡 (501) | **WRK + API + CLI**                |
| **AI video generation (real)**                          | 🟦    | 🟡       | WRK + API + CLI                    |
| **AI message triage**                                   | 🟦    | 🟡       | API + WRK + CLI                    |
| **Multi-tone reply suggestions**                        | 🟦    | 🟡       | API + CLI                          |
| **Content discovery**                                   | 🟦    | 🟡       | API + WRK + CLI                    |
| **RSS auto-posting**                                    | 🟦    | ⛔       | WRK + API + CLI                    |
| **Image-to-caption**                                    | 🟦    | ⛔       | API + CLI                          |
| **Paid ads analytics**                                  | 🟦    | ⛔       | WRK + API + CLI                    |
| Audience targeting/sponsoring                           | 🟦    | 💬       | API + CLI                          |
| Employee advocacy                                       | 🟦    | ⛔       | API + CLI                          |
| voiceover / meme / influencer / blog→video / e-commerce | ⬛    | ⛔       | — (do not build)                   |

### 8.4 Recommended implementation order

> Only the **gaps** (🟡/📐/💬/⛔) are sequenced. What is ✅ does not enter the roadmap. Within each feature, the app order respects dependencies: **data first (WRK/API) → surface after (CLI/ADM)**.

#### Phase 0 — Close the pitch↔code gap _(urgent: it is sold to investors and returns 501)_

| #   | Feature                                           | App sequence                                                                                                                                        | Why this order                                                                                                                                                                  |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Autonomous features** (repurpose/triage/trends) | **WRK** (create the 4 workers for the queues already defined) → **API** (remove the `501` from `repurposeRoutes.ts`, expose) → **CLI** (control UI) | Credibility risk: [INVESTOR_ES.md](INVESTOR_ES.md) sells it as a central differentiator, and it does not exist. The queues are already declared — only the consumer is missing. |

#### Phase 1 — Necessary (they lose deals if missing)

| #   | Feature                                   | App sequence                                                                         | Dependency / note                                                                               |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1   | **Multi-language generation**             | _Product decision_ → **API** (i18n in the AI layer) → **CLI** (i18n UI)              | Blocked by a pending decision (audit T5-I). Critical for the LATAM ICP — unblock it first.      |
| 2   | **Real social listening**                 | **WRK** (mention ingestion worker) → **API** (model + queries) → **CLI** (dashboard) | Sales objection #1. Reuses the `analyticsIngestWorker` pattern.                                 |
| 3   | **Bulk/CSV scheduling** (complete the 🟡) | **API** (CSV parser) → **CLI** (upload) → WRK (batch already exists)                 | Partial scaffolding; low effort, high agency value.                                             |
| 4   | **Canva**                                 | **API** (OAuth/proxy) → **CLI** (embed in the composer)                              | No trace; a bounded integration.                                                                |
| 5   | **Mobile app**                            | a separate project + **API** (already exposes REST)                                  | The largest effort. Decide the scope (PWA vs. native) before committing — a candidate to defer. |

#### Phase 2 — Nice to have (agency objections)

| #   | Feature                                                                                                           | App sequence                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 6   | **Review management**                                                                                             | **WRK** (review sync, extend `inboxSyncWorker`) → **API** → **CLI**  |
| 7   | **Platform white-label**                                                                                          | **API** (per-tenant branding) → **ADM** (config) → **CLI** (theming) |
| 8   | **Recycling / evergreen queues**                                                                                  | **API** (recurrence model) → **WRK** (re-enqueueing) → **CLI**       |
| 9   | **Moderation rules**                                                                                              | **API** (engine) → **WRK** (apply in the inbox sync) → **CLI**       |
| 10  | **Collision detection**                                                                                           | **API** (per-conversation lock) → **CLI** (indicator in the inbox)   |
| 11  | Complete the 🟡: competitor benchmarking, link-in-bio, AI carousels, API/MCP, hashtag analytics, Looker connector | **API** → **CLI** (per feature)                                      |

#### Phase 3 — Interesting (differentiation, after closing the gaps)

| #   | Feature                                                                                     | App sequence                                                    |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 12  | Complete **AI triage + multi-tone suggestions** (🟡→full)                                   | **API** → **WRK** (in the inbox sync) → **CLI**                 |
| 13  | **Real AI video generation** (text-to-video)                                                | **WRK** (pipeline, `videoProcessor` exists) → **API** → **CLI** |
| 14  | **Content discovery**                                                                       | **API** → **WRK** (feed) → **CLI**                              |
| 15  | **RSS auto-posting**                                                                        | **WRK** (poller) → **API** → **CLI**                            |
| 16  | image-to-caption, AI alt-text, audience targeting, analytics of paid ads, employee advocacy | **API** → **CLI** (+ WRK as applicable)                         |

#### Never (unless the ICP pivots)

`AI voiceover`, `meme generator`, `influencer marketing`, `blog→video`, `e-commerce product→post`. Assign no resources — confirmed bloat in §6.

### 8.5 Roadmap summary

- **Effort concentrated in WRK:** 7 of the priority gaps (autonomous, listening, reviews, recycling, moderation, AI video, RSS) need **new or extended workers** — the real bottleneck is in `apps/workers`, not in the frontend.
- **CLI almost always comes last** within each feature: the user surface depends on data that WRK/API produce. Plan backend-first sprints.
- **ADM appears in only 3 gaps** (white-label, and RBAC/audit support already done) — the admin panel is mature; it is not a roadmap priority.
- **Macro order:** Phase 0 (credibility) → Phase 1 (do not lose deals) → Phase 2 (win agencies) → Phase 3 (differentiate). Do not jump to Phase 3 with Phase 1 gaps open.

---

## 9. Modern implementation canon (2026) per feature

> Web research from May 2026: for each feature, the current canonical approach, the key best practice and the anti-pattern to avoid. Grouped by **implementation domain** (features that share a canon). Apply it especially to the roadmap gaps of §8.4.

### 9.1 AI and content generation

| Feature                                       | Canon 2026                                                                                                                                                                                                | Key best practice                                                                                                      | Anti-pattern                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Multi-LLM AI routing                          | A gateway with an OpenAI-compatible interface; **semantic** routing (a cheap model for simple intents, frontier for reasoning), retries with backoff+jitter, cross-provider fallback chains               | Test the fallback in CI (simulate timeout/quota) — the router is only worth it if it is tested degraded                | A single hardcoded provider with no fallback; trusting the gateway's supply chain without pinning a version (LiteLLM compromise, Mar 2026) |
| Analytics-informed content (RAG)              | Hybrid retrieval (dense vector + BM25) over the top performers → **rerank to top 5** → inject as grounded context. "RAG vs fine-tune" is dead: RAG for volatile data                                      | Add a reranker (cross-encoder/Cohere): a better quality/cost ratio (~10-20% NDCG)                                      | Vector-only with no rerank; dumping the raw top 50 into the context                                                                        |
| Automatic Brand Voice                         | A specific persona + style guide + **few-shot exemplars** in the system prompt; the stable block first for **prompt caching** (−90% cost). An off-brand output guardrail                                  | Few-shot is the _primary_ style mechanism, not a fallback                                                              | A vague "be on-brand" with no exemplars                                                                                                    |
| Autonomous features (repurpose/triage/trends) | Stateful graph orchestration (**LangGraph**, stable) ReAct plan→act→reflect→recover; Orchestrator-Worker + Reflection; Tool Search Tool (−95% context) + Programmatic Tool Calling (−37% tokens)          | **Full-trajectory** evals (tool choice, args, cost, policy) with deterministic mocks in CI; pre/post-action guardrails | Loading every tool upfront; a human out of the loop on irreversible actions                                                                |
| Triage/classification + sentiment             | An LLM with **structured outputs** (JSON with grammar/constrained decoding) + few-shot per class. Frontier 5-shot ≈ fine-tuned BERT                                                                       | Few-shot + schema-constrained decoding so that intent/sentiment does not drift                                         | Parsing free text and regexing the label; no consistency eval set                                                                          |
| Multi-tone reply suggestions                  | **One** call → a structured, tone-labeled array, grounded in the thread + brand voice (RAG); a self-correction loop before exposing it                                                                    | Self-correction on the output (review in flight, do not return failures)                                               | N calls (one per tone); suggestions with no human step on sensitive intents                                                                |
| AI image generation                           | Per-case routing behind one API: GPT Image 1.5 (text in image ~95%), Imagen 4 Ultra/Flux 2 Max (photorealism), a fast model for prototyping                                                               | "There is no best model" — route by task                                                                               | One model for all image work                                                                                                               |
| AI video generation                           | Routing among Veo 3.1 (native audio, 4K), Kling 3.0, Seedance 2.0, Runway Gen-4.5; an **async job + webhook pipeline** (it generates in minutes). ⚠️ **Sora 2 is being discontinued** (API ends Sep 2026) | Models with native audio + an async job; do not couple to Sora 2                                                       | A separate post TTS/audio step when the model does it in one pass                                                                          |
| Hashtag/caption + image-to-caption            | A **multimodal** LLM (image + persona + the user's entities) → caption + ranked hashtags in one structured call                                                                                           | Condition on brand personality + injectable entities                                                                   | Generic image-only captioning with no brand grounding                                                                                      |
| Multi-language generation                     | **Native per-locale** generation (not EN→translate), routing by language; RAG over translation memory + glossary + per-locale style guide; a human reviews the draft                                      | Grounding in an approved TM/glossary for consistent terminology                                                        | Pivot-translating from an EN master with no per-locale glossary                                                                            |

_Sources: [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use), [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [RAG Production 2026](https://lushbinary.com/blog/rag-retrieval-augmented-generation-production-guide/), [Agentic Patterns 2026](https://www.sitepoint.com/the-definitive-guide-to-agentic-design-patterns-in-2026/), [AI Video 2026](https://lushbinary.com/blog/ai-video-generation-sora-veo-kling-seedance-comparison/), [LLM translation 2026](https://lingvanex.com/blog/what-is-the-best-llm-for-translation-in-2026/)._

### 9.2 Social data: listening, inbox, reviews, moderation

| Feature                          | Canon 2026                                                                                                                                                                                                                           | Key best practice                                                                                 | Anti-pattern                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Social listening                 | Fan-in pipeline: push (Meta/X stream webhooks) + polling for sources with no push → durable stream → NLP/sentiment enrichment → windowed read model. SoV = `mentions_marca / mentions_mercado` from the normalized corpus            | Decouple ingestion from enrichment; normalize to a canonical schema before sentiment/SoV          | SoV from inconsistent per-platform queries; blocking LLM sentiment in the ingestion |
| Unified inbox (sync)             | **Webhook-first** (Meta Graph DMs/comments/mentions, X, LinkedIn) + backfill polling; normalize to a conversation/message model by a stable external ID; inbox table before the ack (at-least-once + dedupe). Respect the 24h window | **Webhooks are notifications, not data**: fetch-before-process (re-read the API state on receipt) | Processing synchronously inside the webhook handler (timeouts → retry storm)        |
| Review management                | Per-source adapters (Google Business Profile API, official Yelp/Trustpilot), rate-limit-aware polling; idempotent upsert by `(source, externalReviewId)` + content hash; a `ReviewIngested` event                                    | Idempotent upsert by a composite natural key; low-star alerts from the event, not the poll        | HTML scraping of Google/Yelp; a full re-import on every poll                        |
| Collision detection              | A short-TTL distributed lease per conversation (Redis/DB with expiry), auto-renewed, broadcast through WebSocket presence + an **optimistic concurrency check** (version) on send                                                    | Defense in depth: presence (UX) + a server-side conditional write (version) on send               | Only "is typing" with no server-side guard; permanent locks with no TTL             |
| Moderation rules                 | Cascading pipeline: fast deterministic rules (<50ms) for the bulk → an LLM judge with **policy-as-prompt** only on the slice that escalates → a human on high uncertainty. Rules configurable as data                                | Tiered routing (cost/latency): a cheap classifier first, the LLM only on escalation               | One LLM call on _every_ item as the only layer                                      |
| Webhook vs polling / rate limits | Hybrid: webhooks for "now", polling for completeness/backfill. **Queue-first**: validate+enqueue+200 immediately, process async. A token bucket per tenant/endpoint; on 429 backoff+jitter; a 24-72h reconciliation job              | Queue-first ingestion with a fast ack; reconcile the recent window as a safety net                | Processing synchronously in the webhook; backoff with no jitter (thundering herd)   |
| Idempotent consumers             | Exactly-once does not exist: at-least-once + an idempotent consumer. **Inbox pattern**: persist by unique message ID (DB constraint) before the ack; Outbox in the same transaction; `SELECT FOR UPDATE SKIP LOCKED`                 | Dedupe by the provider's stable message ID with a unique constraint inside the transaction        | Assuming exactly-once from the broker and skipping the dedupe store                 |

_Sources: [Meta IG Webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks/), [Hookdeck webhooks at scale](https://hookdeck.com/blog/webhooks-at-scale), [Google Business Profile API](https://developers.google.com/my-business/content/review-data), [Policy-as-Prompt arXiv](https://arxiv.org/html/2502.18695v1), [event-driven.io Outbox/Inbox](https://event-driven.io/en/outbox_inbox_patterns_and_delivery_guarantees_explained/)._

### 9.3 Queues, scheduling and publishing (BullMQ + PostgreSQL)

| Feature                       | Canon 2026                                                                                                                                                                                              | Key best practice                                                                     | Anti-pattern                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Reliable scheduled publishing | A **delayed** job with a deterministic `jobId` (`publish:{postId}:{rev}`) + deduplication; a handler that is **idempotent** against the provider (persist the provider post ID, short-circuit on retry) | An idempotent handler independent of the dedup; dedup is a defense, not the guarantee | Relying on BullMQ "exactly-once" with a non-idempotent POST        |
| Bulk/CSV scheduling           | Validate the whole CSV upfront (Zod per row) → `addBulk()` or a **FlowProducer** parent + one child per row, **`continueParentOnFailure: true`**; failed rows → DLQ                                     | Per-row job isolation + a per-row result manifest                                     | One giant job that iterates the CSV (one failure loses everything) |
| Recycling / evergreen         | A rotation queue per category; on publishing, **re-enqueue to the queue** with the next computed slot (not a static repeatable); a "minimum recycling time" guard                                       | Re-enqueue on the _completed_ event with a recomputed delay                           | Treating recurring posts as an infinite repeatable                 |
| RSS auto-posting              | Poll with a **Job Scheduler**; send `If-None-Match`(ETag)/`If-Modified-Since`, treat 304 as a no-op; dedupe by a persisted stable GUID/`<id>`                                                           | Store ETag/Last-Modified exactly as received; conditional GET                         | A full re-fetch with no conditional headers; dedupe by URL only    |
| Scheduled email reports       | A Job Scheduler (cron) fan-out per account; PDF render through **pooled headless Chromium**; a separate delivery job                                                                                    | Decouple generation from delivery (separate idempotent jobs) + a browser pool         | Launching a new Chromium per report in a mega-job                  |
| Timezone-correct scheduling   | Store the **IANA zone** (not an offset); compute the next UTC instant in that zone and enqueue a delayed job; recompute every cycle (DST self-corrects)                                                 | Persist the IANA tz + recompute per occurrence                                        | Fixed UTC offsets or naive local timestamps (drift on DST)         |
| Outbox → publishing           | The event goes to the outbox **in the same transaction** as the mutation; a **separate relay** (not on every API replica) with `SELECT FOR UPDATE SKIP LOCKED` → BullMQ → mark processed                | The relay as an independent low-replica deployment                                    | A relay embedded in every scaled API instance (lock contention)    |

_Sources: [BullMQ deduplication](https://docs.bullmq.io/guide/jobs/deduplication), [BullMQ flows](https://docs.bullmq.io/guide/flows), [BullMQ job schedulers](https://docs.bullmq.io/guide/job-schedulers/repeat-strategies), [Transactional Outbox 2025](https://www.npiontko.pro/2025/05/19/outbox-pattern)._

### 9.4 Analytics, reporting and BI

| Feature                           | Canon 2026                                                                                                                                                                                                                                           | Key best practice                                                                         | Anti-pattern                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Cross-platform analytics modeling | ELT → **star schema in columnar OLAP** (BigQuery/ClickHouse): `fact_post_metrics` at daily grain per `tenant_id` + conformed dims; **pre-aggregated rollups** as materialized views; isolation by `tenant_id` (shared schema, not schema-per-tenant) | Daily rollups as first-class incremental models; partition/cluster by `(tenant_id, date)` | Ad-hoc aggregations over the transactional Postgres; schema-per-tenant for analytics |
| ROI reporting / attribution       | **GA4 Data API** by `sessionSource/Medium/Campaign` (UTM links) + cost import; **data-driven attribution**; the GA4 attribution report of Feb 2026 (not last-click)                                                                                  | Strict UTM governance + per-conversion attribution settings                               | Last-click for social; trusting the platform's self-reported conversions             |
| Competitor benchmarking           | Share of Voice derived over the rollups of the versioned competitive set; public API + listening (untagged/visual mentions)                                                                                                                          | Version the competitive set per tenant as a dimension (comparable historical SoV)         | Only public followers/engagement; a fixed global competitor list                     |
| Paid ads analytics                | ELT connectors per source (Meta Insights, Google Ads → **Data Manager API** end of 2026) into the same star schema as organic; ⚠️ Meta deprecated the 7/28-day view windows in Jan 2026                                                              | Persist the attribution window + API version with every metric row                        | Treating Meta Insights as complete with no metadata; hardcoded windows               |
| Scheduled PDF/PPT reports         | **Async job**: the API enqueues → a worker renders off-request → artifact to **object storage** → short-TTL **signed URL V4**                                                                                                                        | A short signed URL; rendering decoupled from the request                                  | A synchronous PDF in the request; public/long-lived storage links                    |
| Custom report builder             | The builder points at a **governed semantic layer** (curated metrics/dims), not raw SQL; the layer compiles the query                                                                                                                                | Every metric defined once in the semantic layer (single source of truth)                  | Allowing arbitrary SQL (or AI generating it) → inconsistent metrics                  |
| Looker Studio / BI API            | A **Community Connector** (Apps Script) over a **versioned external BI API** that reads the semantic layer (headless BI)                                                                                                                             | The connector returns governed metrics through a stable API contract, not the DB directly | Pointing the connector at the warehouse/transactional DB                             |
| Hashtag tracking + demographics   | **Instagram Graph API v21** (hashtag string→ID, cap 30/7 days); demographics through `/insights` (`audience_*`); store as a time series in the rollup                                                                                                | Cache the hashtag-ID resolution and budget the 30/7d quota; pin the API version           | Deprecated v21 metrics; re-resolving hashtag IDs on every poll (exhausts the quota)  |

_Sources: [Multi-tenant data modeling](https://www.flightcontrol.dev/blog/ultimate-guide-to-multi-tenant-saas-data-modeling), [GA4 attribution 2026](https://almcorp.com/blog/ga4-attribution-model-restructure-april-2026/), [Looker Studio Connector](https://developers.google.com/looker-studio/connector), [Instagram Graph API 2026](https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2026/)._

### 9.5 Platform and integrations

| Feature                   | Canon 2026                                                                                                                                                                                    | Key best practice                                                                                                        | Anti-pattern                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Public API + MCP          | An **MCP server over Streamable HTTP**, **stateless** and horizontally scalable; `.well-known` metadata; tools protected with **OAuth 2.1**; MCP as a thin facade over the REST API           | Design stateless from day 1; every tool read-only first, write after observing real use                                  | Per-session state in the process (it fights the load balancer)                      |
| Canva                     | **OAuth 2.0 Auth Code + PKCE (S256)**, confidential client; token exchange in the backend; tokens encrypted at rest; validate `state` server-side                                             | Single-use refresh tokens with rotation (persist the new one on every refresh)                                           | Token exchange from the browser; exposing the `code_verifier`                       |
| Zapier / Make             | A **REST Hook trigger** (subscribe/unsubscribe push), not polling; polling fallback only with no event emission                                                                               | REST Hooks (instant, avoids the dedup cap of 100); manage subscriptions through your API                                 | Polling for time-sensitive events (1-15 min latency, drops)                         |
| Connect without passwords | **Delegated OAuth 2.1 with mandatory PKCE**; no implicit grant; exact-match redirect; **refresh token rotation**; only scoped/revocable tokens                                                | Per-tenant token isolation + rotation + minimal scopes, encrypted                                                        | Implicit grant; wildcard redirect; collecting credentials ("password anti-pattern") |
| Outgoing webhooks         | **Standard Webhooks** spec: `webhook-id/timestamp/signature` headers, HMAC-SHA256 signing `msg_id.timestamp.payload`, `v1,` prefix; timestamp tolerance (anti-replay)                         | Exponential backoff + multi-day jitter; a DLQ with the full payload; auto-disable of an endpoint that fails persistently | Ad-hoc HMAC with no anti-replay; immediate retries only                             |
| Multi-tenant white-label  | **Next.js edge middleware resolves the tenant by hostname**; domains through wildcard DNS + automatic TLS; branding through runtime **CSS custom properties**, not per-tenant builds          | Hostname→tenant resolution in middleware with a cached lookup; theming through CSS vars                                  | Forking/rebuilding per tenant; tenant logic in pages                                |
| i18n (incl. AI)           | **next-intl in the App Router**: a `[locale]` segment, negotiation middleware, `localePrefix:'as-needed'`, `setRequestLocale()` + `generateStaticParams()`; messages in **ICU MessageFormat** | ICU skeletons for locale-aware numbers/dates; `generateStaticParams` for every locale                                    | Concatenating strings/manual pluralization; omitting `setRequestLocale`             |
| Mobile app                | **Expo + React Native + Expo Router** (iOS/Android/web from one codebase), EAS + **OTA updates**; PWA as the MVP/desktop tier. It is not "PWA vs native", it is Expo as a converging platform | Expo with OTA for fast cycles; PWA for low budget/SEO                                                                    | Treating PWA vs native as binary; maintaining separate native + web code            |
| Link-in-bio + UTM         | **Bitly API** (Connections Platform) for branded short links, programmatic UTM, scan data; add the UTM **before** shortening; a consistent lowercase taxonomy                                 | A centralized lowercase UTM taxonomy applied programmatically (GA is case-sensitive)                                     | Ad-hoc mixed-case UTMs; shortening before adding parameters                         |

_Sources: [MCP roadmap 2026](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/), [Canva Connect auth](https://www.canva.dev/docs/connect/authentication/), [OAuth 2.1](https://oauth.net/2.1/), [Standard Webhooks spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), [Vercel multi-tenant](https://vercel.com/guides/nextjs-multi-tenant-application), [next-intl App Router](https://next-intl.dev/docs/getting-started/app-router), [Expo](https://docs.expo.dev/)._

### 9.6 Cross-cutting canon and alignment with the current architecture

**Cross-cutting AI canon (applies to every feature with an LLM):** structured outputs wherever there is classification/extraction; prompt caching on stable prefixes; few-shot as the primary style mechanism; pre/post guardrails with failure-rate telemetry; trajectory evals with deterministic mocks in CI; semantic routing behind a gateway as the default architecture.

**Good news — the canon does NOT contradict [CLAUDE.md](../../CLAUDE.md):** domains 9.2 and 9.3 map directly to primitives the repo already has: the Outbox relay with `SELECT FOR UPDATE SKIP LOCKED`, a deterministic `dedupeKey` (`cmd-${sagaId}-${stepId}`, never `randomUUID`), Unit of Work with transactional dispatch, `BackgroundTaskScheduler` for polls/reconciliation, the canon-aligned Saga pattern. **New social adapters must reuse inbox/outbox + UoW + scheduler, not create parallel paths.**

**Concrete upgrades to adopt (identified technical debt):**

1. **BullMQ: migrate repeatable jobs → Job Schedulers (`upsert`)** — repeatable jobs are deprecated since BullMQ 5.16.0. This affects recurring scheduling and the RSS poller.
2. **Add `continueParentOnFailure: true`** to the bulk/CSV flows (gap §8.4 Phase 1 #3) for partial per-row failure.
3. **Autonomous features (Phase 0):** implement them with **LangGraph** (a stateful graph) + Tool Search Tool + trajectory evals — not as a simple BullMQ consumer that calls an LLM.
4. **Social listening / inbox (Phase 1-2):** **webhook-first + fetch-before-process**, not polling-only. Reuse the pattern of the existing `analyticsIngestWorker`/`inboxSyncWorker`.
5. **Reports and AI video:** the **async job → object storage → short signed URL** pattern; never a synchronous render in the request.
6. **Multi-language:** `next-intl` App Router + ICU; **native per-locale** AI generation with RAG over a glossary — the blocking product decision (§8.4 #1) must include this architecture.
7. **Account connect / Canva / MCP:** a common **OAuth 2.1 + PKCE** substrate; outgoing webhooks to **Standard Webhooks** (the repo already has `WebhookSubscription/WebhookDeadLetter` — align the signing with the spec).

---

_Traced over the code tree at HEAD (May 2026). The `schema.prisma` line numbers match the current state; re-verify after migrations. The per-app attribution was verified against `apps/workers/src/`, `apps/admin/app/(dashboard)/`, `apps/client/app/` and the routes/use cases cited in §1-7. The canon of §9 comes from web research of May 2026 (official docs + best-practice articles cited per domain); re-verify before architecture decisions — the model/API landscape changes fast._
