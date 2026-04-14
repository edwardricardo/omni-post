# OmniPost -- Client Portal API Reference

## Overview

The client portal is a Next.js application (`apps/client/`) providing end-users with a full social media management dashboard. It includes post composition and publishing, multi-platform scheduling, content library, template management with version control, AI content generation and optimization, predictive analytics, campaign management, task management, asset library, social inbox, approval workflows, channel management, settings (billing, privacy, SSO, CRM, brand voice, notifications, referral, usage), and Instagram-specific features (stories, media upload, video splitting).

---

## Pages

### Dashboard Home

**File:** `apps/client/app/dashboard/page.tsx`
**Type:** page
**Description:** Main client dashboard with project stats, recent posts, provider status, and quick-action cards. Uses `usePosts`, `useProjects`, `useApiProviders` hooks.

**Has JSDoc:** No

### Posts

#### Post List

**File:** `apps/client/app/dashboard/posts/page.tsx`
**Type:** page
**Description:** Post management page with filtering, search, status badges, bulk actions, and delete confirmation. Navigates to post detail and new-post editor.

**Has JSDoc:** No

#### New Post

**File:** `apps/client/app/dashboard/posts/new/page.tsx`
**Type:** page
**Description:** Post creation page with content editor and platform selection.

**Has JSDoc:** No (file name implies)

#### Post Detail

**File:** `apps/client/app/dashboard/posts/[id]/page.tsx`
**Type:** page
**Description:** Single post detail view.

**Has JSDoc:** No

#### Post Preview

**File:** `apps/client/app/dashboard/posts/[id]/preview/page.tsx`
**Type:** page
**Description:** Platform-specific post preview rendering.

**Has JSDoc:** No

### Scheduling

#### Scheduling Dashboard

**File:** `apps/client/app/dashboard/scheduling/page.tsx`
**Type:** page
**Description:** Scheduling page with tabbed views: calendar, multi-platform scheduler, bulk scheduling, optimal times, and rules. Integrates SchedulingDashboard, MultiPlatformScheduler, BulkScheduleView, OptimalTimesView, and RulesView components.

**Has JSDoc:** Yes

#### Recurring Posts

**File:** `apps/client/app/dashboard/scheduling/recurring/page.tsx`
**Type:** page
**Description:** Recurring posts listing page.

**Has JSDoc:** No

#### New Recurring Post

**File:** `apps/client/app/dashboard/scheduling/recurring/new/page.tsx`
**Type:** page
**Description:** Create new recurring post schedule.

**Has JSDoc:** No

#### Edit Recurring Post

**File:** `apps/client/app/dashboard/scheduling/recurring/[id]/edit/page.tsx`
**Type:** page
**Description:** Edit an existing recurring post schedule.

**Has JSDoc:** No

### Analytics

#### Analytics Dashboard

**File:** `apps/client/app/dashboard/analytics/page.tsx`
**Type:** page
**Description:** Customer analytics dashboard showing post performance, engagement metrics, and per-platform breakdown using Recharts. Uses `useAnalytics` hook.

**Has JSDoc:** Yes

#### Analytics Reports

**File:** `apps/client/app/dashboard/analytics/reports/page.tsx`
**Type:** page
**Description:** Scheduled and on-demand analytics report management.

**Has JSDoc:** No

#### Performance Insights

**File:** `apps/client/app/dashboard/analytics/insights/page.tsx`
**Type:** page
**Description:** AI-driven performance insights page.

**Has JSDoc:** No

### AI Features

#### AI Content Generation

**File:** `apps/client/app/dashboard/ai/generate/page.tsx`
**Type:** page
**Description:** AI content generation page.

**Has JSDoc:** No

#### AI Content Optimizer

**File:** `apps/client/app/dashboard/ai/optimizer/page.tsx`
**Type:** page
**Description:** Smart content optimizer page.

**Has JSDoc:** No

#### AI Predictive Analytics

**File:** `apps/client/app/dashboard/ai/analytics/page.tsx`
**Type:** page
**Description:** Predictive analytics dashboard with performance, audience, ROI, and competitive analysis.

**Has JSDoc:** No

#### AI Prompt Templates

**File:** `apps/client/app/dashboard/ai/templates/page.tsx`
**Type:** page
**Description:** AI prompt template management.

**Has JSDoc:** No

#### AI Trends

**File:** `apps/client/app/dashboard/ai/trends/page.tsx`
**Type:** page
**Description:** AI trend analysis page.

**Has JSDoc:** No

#### AI Repurpose

**File:** `apps/client/app/dashboard/ai/repurpose/page.tsx`
**Type:** page
**Description:** Content repurposing with AI-powered platform adaptation.

**Has JSDoc:** No

### Content

#### Content Library

**File:** `apps/client/app/dashboard/content/library/page.tsx`
**Type:** page
**Description:** Content library with grid/list views, filtering, bulk actions, and search.

**Has JSDoc:** No

#### Content Templates

**File:** `apps/client/app/dashboard/content/templates/page.tsx`
**Type:** page
**Description:** Content templates management page.

**Has JSDoc:** No

### Inbox

**File:** `apps/client/app/dashboard/inbox/page.tsx`
**Type:** page
**Description:** Social inbox page (see notifications.md for full component details).

**Has JSDoc:** No

### Approvals

**File:** `apps/client/app/dashboard/approvals/page.tsx`
**Type:** page
**Description:** Approval queue page (see notifications.md for full component details).

**Has JSDoc:** No

### Assets

**File:** `apps/client/app/dashboard/assets/page.tsx`
**Type:** page
**Description:** Standalone asset library with folder sidebar, grid view, detail panel, and upload functionality. Uses `apiClient` for asset operations.

**Has JSDoc:** Yes

### Campaigns

#### Campaign List

**File:** `apps/client/app/dashboard/campaigns/page.tsx`
**Type:** page
**Description:** Campaigns list page with creation modal.

**Has JSDoc:** Yes

#### Campaign Detail

**File:** `apps/client/app/dashboard/campaigns/[id]/page.tsx`
**Type:** page
**Description:** Single campaign detail view.

**Has JSDoc:** No

### Tasks

**File:** `apps/client/app/dashboard/tasks/page.tsx`
**Type:** page
**Description:** Task management page with list, creation modal, and detail panel.

**Has JSDoc:** Yes

### Channels

**File:** `apps/client/app/dashboard/channels/page.tsx`
**Type:** page
**Description:** Social media channels management. Lists connected provider channels with capability badges, usage stats, and disconnect functionality.

**Has JSDoc:** Yes

### Templates

**File:** `apps/client/app/dashboard/templates/page.tsx`
**Type:** page
**Description:** Template library and management page.

**Has JSDoc:** No

### Instagram

#### Instagram Upload

**File:** `apps/client/app/dashboard/instagram/upload/page.tsx`
**Type:** page
**Description:** Instagram media upload page.

**Has JSDoc:** No

#### Instagram Stories

**File:** `apps/client/app/dashboard/instagram/stories/page.tsx`
**Type:** page
**Description:** Instagram Stories editor and management.

**Has JSDoc:** No

### Integrations

**File:** `apps/client/app/dashboard/integrations/page.tsx`
**Type:** page
**Description:** Integration marketplace for connecting third-party services.

**Has JSDoc:** No

### Settings

#### Notifications

**File:** `apps/client/app/dashboard/settings/notifications/page.tsx`
**Type:** page
**Description:** Notification preferences page with external notification (Slack/Teams) config management.

**Has JSDoc:** No

#### Billing

**File:** `apps/client/app/dashboard/settings/billing/page.tsx`
**Type:** page
**Description:** Billing and subscription management page.

**Has JSDoc:** No

#### Privacy

**File:** `apps/client/app/dashboard/settings/privacy/page.tsx`
**Type:** page
**Description:** Privacy settings and data management page.

**Has JSDoc:** No

#### SSO

**File:** `apps/client/app/dashboard/settings/sso/page.tsx`
**Type:** page
**Description:** Single Sign-On configuration (SAML/OIDC).

**Has JSDoc:** No

#### CRM

**File:** `apps/client/app/dashboard/settings/crm/page.tsx`
**Type:** page
**Description:** CRM integration settings.

**Has JSDoc:** No

#### Brand Voice

**File:** `apps/client/app/dashboard/settings/brand-voice/page.tsx`
**Type:** page
**Description:** Brand voice configuration for AI content generation.

**Has JSDoc:** No

#### Team

**File:** `apps/client/app/dashboard/settings/team/page.tsx`
**Type:** page
**Description:** Team member management.

**Has JSDoc:** No

#### Usage

**File:** `apps/client/app/dashboard/settings/usage/page.tsx`
**Type:** page
**Description:** Resource usage metrics page.

**Has JSDoc:** No

#### Referral

**File:** `apps/client/app/dashboard/settings/referral/page.tsx`
**Type:** page
**Description:** Referral program management page.

**Has JSDoc:** No

#### Integrations Settings

**File:** `apps/client/app/dashboard/settings/integrations/page.tsx`
**Type:** page
**Description:** Integration configuration settings.

**Has JSDoc:** No

### Shared Reports

**File:** `apps/client/app/reports/shared/[token]/page.tsx`
**Type:** page
**Description:** Public shared report view accessed via unique token.

**Has JSDoc:** No

### Auth

#### Login

**File:** `apps/client/app/login/page.tsx`
**Type:** page
**Description:** Client login page.

**Has JSDoc:** No

#### Register

**File:** `apps/client/app/register/page.tsx`
**Type:** page
**Description:** Client registration page.

**Has JSDoc:** No

---

## Components by Feature Area

### Publishing

#### UnifiedPublishingDashboard

**File:** `apps/client/components/publishing/UnifiedPublishingDashboard.tsx`
**Type:** component
**Description:** Main publishing dashboard combining post creation, scheduling, and publishing flows in a unified interface.

| Export                       | Type      | Description                  |
| ---------------------------- | --------- | ---------------------------- |
| `UnifiedPublishingDashboard` | component | Unified publishing interface |

**Has JSDoc:** No

#### PublishingInterface

**File:** `apps/client/components/publishing/PublishingInterface.tsx`
**Type:** component
**Description:** Post publishing interface with platform selection and content preview.

| Export                | Type      | Description               |
| --------------------- | --------- | ------------------------- |
| `PublishingInterface` | component | Publishing flow interface |

**Has JSDoc:** No

#### PublishDialog

**File:** `apps/client/components/publishing/PublishDialog.tsx`
**Type:** component
**Description:** Confirmation dialog before publishing a post.

| Export          | Type      | Description                 |
| --------------- | --------- | --------------------------- |
| `PublishDialog` | component | Publish confirmation dialog |

**Has JSDoc:** No

#### publishingDashboardApi

**File:** `apps/client/components/publishing/publishingDashboardApi.ts`
**Type:** utility
**Description:** API helper functions for the publishing dashboard.

**Has JSDoc:** No

### Editor

#### ClientContentEditor

**File:** `apps/client/components/editor/ClientContentEditor.tsx`
**Type:** component
**Description:** Main content editor for composing posts.

| Export                | Type      | Description         |
| --------------------- | --------- | ------------------- |
| `ClientContentEditor` | component | Post content editor |

**Has JSDoc:** No

#### PlatformPreview

**File:** `apps/client/components/editor/PlatformPreview.tsx`
**Type:** component
**Description:** Real-time platform-specific post preview (X, Instagram, Facebook, etc.).

| Export            | Type      | Description                     |
| ----------------- | --------- | ------------------------------- |
| `PlatformPreview` | component | Multi-platform preview renderer |

**Has JSDoc:** No

#### ContentPreviewSystem

**File:** `apps/client/components/editor/ContentPreviewSystem.tsx`
**Type:** component
**Description:** Content preview system with provider adaptation engine.

**Has JSDoc:** No

#### ProviderAdaptationEngine

**File:** `apps/client/components/editor/ProviderAdaptationEngine.tsx`
**Type:** component
**Description:** Adapts content for different social media platforms.

**Has JSDoc:** No

#### SchedulePicker

**File:** `apps/client/components/editor/SchedulePicker.tsx`
**Type:** component
**Description:** Date/time picker for scheduling post publication.

| Export           | Type      | Description                 |
| ---------------- | --------- | --------------------------- |
| `SchedulePicker` | component | Schedule date/time selector |

**Has JSDoc:** No

#### TemplateSelector

**File:** `apps/client/components/editor/TemplateSelector.tsx`
**Type:** component
**Description:** Template selection dropdown for the editor.

| Export             | Type      | Description                     |
| ------------------ | --------- | ------------------------------- |
| `TemplateSelector` | component | Template picker for post editor |

**Has JSDoc:** No

### Scheduling

#### SchedulingDashboard

**File:** `apps/client/components/scheduling/SchedulingDashboard.tsx`
**Type:** component
**Description:** Calendar-based scheduling dashboard with day/week views.

| Export                | Type      | Description              |
| --------------------- | --------- | ------------------------ |
| `SchedulingDashboard` | component | Calendar scheduling view |

**Has JSDoc:** No

#### MultiPlatformSchedulerRefactored

**File:** `apps/client/components/scheduling/MultiPlatformSchedulerRefactored.tsx`
**Type:** component
**Description:** Multi-platform post scheduler with per-platform timing and content customization.

| Export                   | Type      | Description                         |
| ------------------------ | --------- | ----------------------------------- |
| `MultiPlatformScheduler` | component | Multi-platform scheduling interface |

**Has JSDoc:** No

#### RecurringPostForm / RecurringPostsList / RecurringPostCard

**Files:** `apps/client/components/scheduling/RecurringPost{Form,sList,Card}.tsx`
**Type:** components
**Description:** Recurring post management: form for creating/editing, list for displaying, card for individual items.

**Has JSDoc:** No

#### CSVBulkUpload

**File:** `apps/client/components/scheduling/CSVBulkUpload.tsx`
**Type:** component
**Description:** CSV file upload for bulk scheduling posts.

| Export          | Type      | Description                    |
| --------------- | --------- | ------------------------------ |
| `CSVBulkUpload` | component | CSV bulk upload for scheduling |

**Has JSDoc:** No

#### DayCalendar / WeekCalendar

**Files:** `apps/client/components/scheduling/{Day,Week}Calendar.tsx`
**Type:** components
**Description:** Day and week calendar views for the scheduling dashboard.

**Has JSDoc:** No

### AI Features

#### AIContentGenerator

**File:** `apps/client/components/ai/AIContentGenerator.tsx`
**Type:** component
**Description:** AI content generation orchestrator.

| Export               | Type      | Description                |
| -------------------- | --------- | -------------------------- |
| `AIContentGenerator` | component | AI content generation flow |

**Has JSDoc:** No

#### AIPromptForm

**File:** `apps/client/components/ai/AIPromptForm.tsx`
**Type:** component
**Description:** Form for submitting AI generation prompts with platform and tone selection.

| Export         | Type      | Description          |
| -------------- | --------- | -------------------- |
| `AIPromptForm` | component | AI prompt input form |

**Has JSDoc:** No

#### AIContentResults

**File:** `apps/client/components/ai/AIContentResults.tsx`
**Type:** component
**Description:** Displays AI-generated content results with copy and edit actions.

| Export             | Type      | Description                   |
| ------------------ | --------- | ----------------------------- |
| `AIContentResults` | component | AI generation results display |

**Has JSDoc:** No

#### AIGenerationPreview

**File:** `apps/client/components/ai/AIGenerationPreview.tsx`
**Type:** component
**Description:** Preview of AI-generated content before insertion.

| Export                | Type      | Description        |
| --------------------- | --------- | ------------------ |
| `AIGenerationPreview` | component | AI content preview |

**Has JSDoc:** No

#### AIImageGenerator

**File:** `apps/client/components/ai/AIImageGenerator.tsx`
**Type:** component
**Description:** AI-powered image generation interface.

| Export             | Type      | Description                   |
| ------------------ | --------- | ----------------------------- |
| `AIImageGenerator` | component | AI image generation interface |

**Has JSDoc:** No

#### AITemplateSelector

**File:** `apps/client/components/ai/AITemplateSelector.tsx`
**Type:** component
**Description:** Template selector for AI generation presets.

| Export               | Type      | Description        |
| -------------------- | --------- | ------------------ |
| `AITemplateSelector` | component | AI template picker |

**Has JSDoc:** No

#### SmartContentOptimizer

**File:** `apps/client/components/ai/SmartContentOptimizer.tsx`
**Type:** component
**Description:** Smart content optimizer with sub-views for overview, tone, suggestions, hashtags, and metrics.

| Export                  | Type      | Description                |
| ----------------------- | --------- | -------------------------- |
| `SmartContentOptimizer` | component | Content optimization suite |

**Has JSDoc:** No

Sub-components: `SmartContentOptimizerOverview.tsx`, `SmartContentOptimizerTone.tsx`, `SmartContentOptimizerSuggestions.tsx`, `SmartContentOptimizerHashtags.tsx`, `SmartContentOptimizerMetrics.tsx`

#### PromptTemplateManager

**File:** `apps/client/components/ai/PromptTemplateManager.tsx`
**Type:** component
**Description:** CRUD management for AI prompt templates.

| Export                  | Type      | Description          |
| ----------------------- | --------- | -------------------- |
| `PromptTemplateManager` | component | Prompt template CRUD |

**Has JSDoc:** No

#### PredictiveAnalytics

**File:** `apps/client/components/ai/PredictiveAnalytics.tsx`
**Type:** component
**Description:** Predictive analytics dashboard with tabbed views (Performance, Audience, ROI, Competitive). Uses sub-components in `ai/analytics/`.

| Export                | Type      | Description                       |
| --------------------- | --------- | --------------------------------- |
| `PredictiveAnalytics` | component | AI predictive analytics dashboard |

**Has JSDoc:** No

Sub-components in `apps/client/components/ai/analytics/`:

- `AnalyticsHeader.tsx` - Header with controls
- `TabNavigation.tsx` - Tab navigation
- `tabs/PerformanceTab.tsx` - Performance predictions
- `tabs/AudienceTab.tsx` - Audience insights
- `tabs/ROITab.tsx` - ROI forecasting
- `tabs/CompetitiveTab.tsx` - Competitive analysis
- `cards/PerformancePredictionCard.tsx`, `AudienceInsightCard.tsx`, `ROIForecastCard.tsx`, `CompetitorAnalysisCard.tsx` - Visualization cards
- `hooks/usePredictiveData.ts` - Data fetching hook

### Analytics

#### PerformanceInsights

**File:** `apps/client/components/analytics/PerformanceInsights.tsx`
**Type:** component
**Description:** Performance insights dashboard with sub-panels for recommendations, hashtag performance, audience insights, optimal timing, and top-performing content.

| Export                | Type      | Description                    |
| --------------------- | --------- | ------------------------------ |
| `PerformanceInsights` | component | Performance insights dashboard |

**Has JSDoc:** No

Sub-components in `apps/client/components/analytics/insights/`:

- `RecommendationsList.tsx` - AI recommendations
- `HashtagPerformancePanel.tsx` - Hashtag analytics
- `AudienceInsightsPanel.tsx` - Audience demographics
- `OptimalTimingPanel.tsx` - Best posting times
- `TopPerformingContent.tsx` - Top content analysis

#### ScheduledReportsList

**File:** `apps/client/components/analytics/ScheduledReportsList.tsx`
**Type:** component
**Description:** List of scheduled analytics reports.

**Has JSDoc:** No

#### CreateReportForm

**File:** `apps/client/components/analytics/CreateReportForm.tsx`
**Type:** component
**Description:** Form for creating new scheduled or on-demand analytics reports.

**Has JSDoc:** No

### Content Library

#### ContentLibrary

**File:** `apps/client/components/content/ContentLibrary.tsx`
**Type:** component
**Description:** Content library main component with grid/list views.

Sub-components in `apps/client/components/content/library/`:

- `ContentLibraryHeader.tsx` - Header with view toggles
- `SearchAndSortBar.tsx` - Search and sort controls
- `FilterPanel.tsx` - Content filters
- `ContentGridView.tsx` / `ContentListView.tsx` - View modes
- `ContentGridItem.tsx` - Grid item card
- `BulkActionsBar.tsx` - Bulk action controls
- `Pagination.tsx` - Pagination control
- `useContentLibraryState.ts` - State management hook

**Has JSDoc:** No

#### ContentTemplates

**File:** `apps/client/components/content/ContentTemplates.tsx`
**Type:** component
**Description:** Content templates management.

Sub-components in `apps/client/components/content/templates/`:

- `TemplatesHeader.tsx`, `TemplatesTabs.tsx`, `TemplatesLoadingSkeleton.tsx`
- `useTemplateData.ts` - Data hook

**Has JSDoc:** No

### Templates

**Directory:** `apps/client/components/templates/`

#### TemplateLibrary

**File:** `apps/client/components/templates/TemplateLibrary.tsx`
**Type:** component
**Description:** Template library with search, grid, and dialog management.

Sub-components: `TemplateLibrarySearch.tsx`, `TemplateLibraryGrid.tsx`, `TemplateLibraryDialogs.tsx`

**Has JSDoc:** No

#### TemplateEditor

**File:** `apps/client/components/templates/TemplateEditor.tsx`
**Type:** component
**Description:** Template editor with canvas, sidebar, and toolbar.

Sub-components: `TemplateEditorCanvas.tsx`, `TemplateEditorSidebar.tsx`, `TemplateEditorToolbar.tsx`

**Has JSDoc:** No

#### TipTapEditor

**File:** `apps/client/components/templates/TipTapEditor.tsx`
**Type:** component
**Description:** TipTap rich-text editor integration for template content.

**Has JSDoc:** No

#### TemplateVersionControl

**File:** `apps/client/components/templates/TemplateVersionControl.tsx`
**Type:** component
**Description:** Version control for templates with branching, versioning, and comparison.

Sub-components: `VersionCard.tsx`, `BranchCard.tsx`, `VersionCompareView.tsx`, `CreateVersionDialog.tsx`, `CreateBranchDialog.tsx`
Hook: `useTemplateVersionControl.ts`

**Has JSDoc:** No

#### ABTestManager

**File:** `apps/client/components/templates/ABTestManager.tsx`
**Type:** component
**Description:** A/B test management for template variations.

Sub-components: `ABTestCard.tsx`, `ABTestCreateDialog.tsx`, `ABTestResultsTab.tsx`, `ABTestStatsCards.tsx`
Hook: `useABTestManager.ts`

**Has JSDoc:** No

#### VariableInserter

**File:** `apps/client/components/templates/VariableInserter.tsx`
**Type:** component
**Description:** Dynamic variable insertion tool for templates.

**Has JSDoc:** No

### Campaigns

#### CampaignList

**File:** `apps/client/components/campaigns/CampaignList.tsx`
**Type:** component
**Description:** Campaign listing with status badges and actions.

**Has JSDoc:** No

#### CampaignCard

**File:** `apps/client/components/campaigns/CampaignCard.tsx`
**Type:** component
**Description:** Individual campaign card display.

**Has JSDoc:** No

#### CreateCampaignModal

**File:** `apps/client/components/campaigns/CreateCampaignModal.tsx`
**Type:** component
**Description:** Modal for creating new campaigns.

**Has JSDoc:** No

#### CampaignStatusBadge

**File:** `apps/client/components/campaigns/CampaignStatusBadge.tsx`
**Type:** component
**Description:** Color-coded campaign status badge.

**Has JSDoc:** No

### Tasks

#### TaskList

**File:** `apps/client/components/tasks/TaskList.tsx`
**Type:** component
**Description:** Task listing with filtering and sorting.

**Has JSDoc:** No

#### TaskCard

**File:** `apps/client/components/tasks/TaskCard.tsx`
**Type:** component
**Description:** Individual task card display.

**Has JSDoc:** No

#### TaskDetailPanel

**File:** `apps/client/components/tasks/TaskDetailPanel.tsx`
**Type:** component
**Description:** Task detail panel with edit and status management.

**Has JSDoc:** No

#### CreateTaskModal

**File:** `apps/client/components/tasks/CreateTaskModal.tsx`
**Type:** component
**Description:** Modal for creating new tasks.

**Has JSDoc:** No

#### TaskBadge

**File:** `apps/client/components/tasks/TaskBadge.tsx`
**Type:** component
**Description:** Color-coded task status/priority badge.

**Has JSDoc:** No

### Assets

#### AssetGrid

**File:** `apps/client/components/assets/AssetGrid.tsx`
**Type:** component
**Description:** Grid view of uploaded assets (images, videos).

**Has JSDoc:** No

#### AssetThumbnail

**File:** `apps/client/components/assets/AssetThumbnail.tsx`
**Type:** component
**Description:** Asset thumbnail with type indicator.

**Has JSDoc:** No

#### AssetDetailPanel

**File:** `apps/client/components/assets/AssetDetailPanel.tsx`
**Type:** component
**Description:** Asset detail side panel with metadata, preview, and actions.

**Has JSDoc:** No

#### FolderSidebar

**File:** `apps/client/components/assets/FolderSidebar.tsx`
**Type:** component
**Description:** Folder navigation sidebar for the asset library.

**Has JSDoc:** No

### Instagram

#### StoriesEditor

**File:** `apps/client/components/instagram/StoriesEditor.tsx`
**Type:** component
**Description:** Instagram Stories editor with frame management.

Sub-components in `apps/client/components/instagram/stories/`:

- `StoryPreview.tsx` - Story frame preview
- `StoriesTimeline.tsx` - Stories timeline navigator
- `StoriesHeader.tsx` - Editor header
- `StoryEditorControls.tsx` - Editor controls
- `LoadingOverlay.tsx` - Upload loading indicator
- Hooks: `useFileUpload.ts`, `useStoryManagement.ts`, `useKeyboardShortcuts.ts`

**Has JSDoc:** No

#### MediaUploadZone

**File:** `apps/client/components/instagram/MediaUploadZone.tsx`
**Type:** component
**Description:** Drag-and-drop media upload zone for Instagram posts.

**Has JSDoc:** No

#### VideoSplitPreview

**File:** `apps/client/components/instagram/VideoSplitPreview.tsx`
**Type:** component
**Description:** Video split preview for Instagram carousel/reels.

**Has JSDoc:** No

### Settings

#### SsoSettings

**File:** `apps/client/components/settings/sso/SsoSettings.tsx`
**Type:** component
**Description:** SSO configuration management.

Sub-components: `SamlConfigForm.tsx`, `OidcConfigForm.tsx`, `SsoStatusBanner.tsx`

**Has JSDoc:** No

#### BrandVoiceForm

**File:** `apps/client/components/settings/BrandVoiceForm.tsx`
**Type:** component
**Description:** Brand voice configuration form for AI content generation.

**Has JSDoc:** No

#### CrmSettings

**File:** `apps/client/components/settings/crm/CrmSettings.tsx`
**Type:** component
**Description:** CRM integration settings and connection management.

Sub-components: `CrmConnectionCard.tsx`, `CrmSyncLog.tsx`

**Has JSDoc:** No

### Integrations

#### IntegrationMarketplace

**File:** `apps/client/components/integrations/IntegrationMarketplace.tsx`
**Type:** component
**Description:** Third-party integration marketplace for connecting services.

**Has JSDoc:** No

---

## Hooks

### API Hooks

| File                                      | Exports                                               | Description                                 |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| `hooks/api/useAnalytics.ts`               | `useAnalytics`                                        | Customer analytics data by time range       |
| `hooks/api/useChannels.ts`                | `useChannels`, `useProviders`, `useDisconnectChannel` | Channel management                          |
| `hooks/api/useScheduledPosts.ts`          | `useScheduledPosts`                                   | Scheduled posts listing                     |
| `hooks/api/useMultiPlatformScheduling.ts` | Multi-platform scheduling hooks                       | Multi-platform scheduling operations        |
| `hooks/api/useRecurringPosts.ts`          | Recurring post hooks                                  | Recurring post CRUD                         |
| `hooks/api/useContentCalendar.ts`         | `useContentCalendar`                                  | Calendar view data                          |
| `hooks/api/useContentLibrary.ts`          | Content library hooks                                 | Content library CRUD and search             |
| `hooks/api/useAIContentGeneration.ts`     | AI generation hooks                                   | AI content generation mutations             |
| `hooks/api/useAIImages.ts`                | AI image hooks                                        | AI image generation                         |
| `hooks/api/useAIPromptTemplates.ts`       | Prompt template hooks                                 | AI prompt template CRUD                     |
| `hooks/api/usePlatformVariants.ts`        | `usePlatformVariants`                                 | Platform-specific content variants          |
| `hooks/api/useBrandVoice.ts`              | `useBrandVoice`                                       | Brand voice configuration                   |
| `hooks/api/useReports.ts`                 | Report hooks                                          | Analytics report management                 |
| `hooks/api/usePerformanceInsights.ts`     | `usePerformanceInsights`                              | Performance insights data                   |
| `hooks/api/useUniversalAnalytics.ts`      | `useUniversalAnalytics`                               | Cross-platform analytics                    |
| `hooks/api/useCampaigns.ts`               | Campaign hooks                                        | Campaign CRUD and analytics                 |
| `hooks/api/useTasks.ts`                   | Task hooks                                            | Task CRUD                                   |
| `hooks/api/useAssets.ts`                  | Asset hooks                                           | Asset upload, listing, and management       |
| `hooks/api/useTeam.ts`                    | Team hooks                                            | Team member management                      |
| `hooks/api/useBilling.ts`                 | Billing hooks                                         | Billing and subscription management         |
| `hooks/api/useUsage.ts`                   | Usage hooks                                           | Resource usage data                         |
| `hooks/api/useUsageMetrics.ts`            | `useUsageMetrics`                                     | Detailed usage metrics                      |
| `hooks/api/usePrivacy.ts`                 | Privacy hooks                                         | Privacy settings management                 |
| `hooks/api/useSso.ts`                     | SSO hooks                                             | SSO configuration                           |
| `hooks/api/useCrm.ts`                     | CRM hooks                                             | CRM integration operations                  |
| `hooks/api/useInbox.ts`                   | Inbox hooks                                           | Social inbox (see notifications.md)         |
| `hooks/api/useComments.ts`                | Comment hooks                                         | Post comments (see notifications.md)        |
| `hooks/api/useApprovals.ts`               | Approval hooks                                        | Approvals (see notifications.md)            |
| `hooks/api/useExternalNotifications.ts`   | External notification hooks                           | Slack/Teams webhooks (see notifications.md) |

### Utility Hooks

| File                             | Export                  | Description                                    |
| -------------------------------- | ----------------------- | ---------------------------------------------- |
| `hooks/useAIContentGenerator.ts` | `useAIContentGenerator` | AI content generation state machine            |
| `hooks/useNotificationStream.ts` | `useNotificationStream` | SSE notification stream (see notifications.md) |
| `hooks/useFocusTrap.ts`          | `useFocusTrap`          | Accessibility focus trap for modal dialogs     |
