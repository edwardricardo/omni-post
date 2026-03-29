# Phase 3: Analytics & Reporting

## Overview

Phase 3 adds campaign tracking, UTM/GA4 integration, historical analytics aggregation, analytics export, and scheduled reports to the OmniPost platform.

## Features

### 7.10 Campaign Tagging

Group posts by marketing campaign with lifecycle management.

**Domain Model:**

- `Campaign` entity with `CampaignStatus` state machine (DRAFT → ACTIVE → PAUSED → COMPLETED → ARCHIVED)
- `CampaignPost` join table (composite PK: campaignId + postId)
- Optional UTM parameters per campaign (utmSource, utmMedium)

**API Endpoints (8):**

| Method | Route                              | Description                                       |
| ------ | ---------------------------------- | ------------------------------------------------- |
| POST   | `/api/campaigns`                   | Create campaign                                   |
| GET    | `/api/campaigns`                   | List campaigns (by project, filterable by status) |
| GET    | `/api/campaigns/:id`               | Get campaign with post count                      |
| PATCH  | `/api/campaigns/:id`               | Update campaign details                           |
| POST   | `/api/campaigns/:id/archive`       | Archive campaign                                  |
| POST   | `/api/campaigns/:id/posts/:postId` | Tag post with campaign                            |
| DELETE | `/api/campaigns/:id/posts/:postId` | Untag post from campaign                          |
| GET    | `/api/campaigns/:id/analytics`     | Aggregated analytics for campaign posts           |

### 7.9 GA4/UTM Integration

UTM parameter management for tracked links and GA4 Measurement Protocol integration.

**Domain Model:**

- `UTMParameters` value object (source, medium, campaign, content?, term?)
- TrackedLink entity extended with UTM fields
- `GA4TrackingPort` for event tracking (no-op if not configured)

**API Endpoints (2):**

| Method | Route                    | Description                                |
| ------ | ------------------------ | ------------------------------------------ |
| POST   | `/api/links/:id/utm`     | Generate UTM parameters for a tracked link |
| GET    | `/api/links/:id/utm-url` | Get UTM-tagged URL                         |

**Configuration:**

- `GA4_MEASUREMENT_ID` — Google Analytics 4 measurement ID
- `GA4_API_SECRET` — GA4 API secret for Measurement Protocol
- `GA4_ENDPOINT` — Custom endpoint (default: GA4 Measurement Protocol)

### 7.8 12-Month Historical Tracking

Automated analytics aggregation with data retention policy.

**Data Model:**

- `AnalyticsDailySummary` — daily aggregates (kept 12 months)
- `AnalyticsMonthlySummary` — monthly aggregates (kept indefinitely)

**Background Jobs (BullMQ):**

- `aggregate-daily` — 2 AM UTC: aggregates raw analytics from previous day
- `aggregate-monthly` — 3 AM UTC, 1st of month: aggregates daily summaries
- `purge-raw` — 4 AM UTC: removes raw analytics older than 90 days (batch delete)

**Query Layer:**

- `GetHistoricalAnalyticsQuery` — selects daily or monthly granularity based on input

### 7.11 Scheduled Reports

Automated report generation and email delivery.

**Domain Model:**

- `ScheduledReport` entity with cron schedule, format (CSV/JSON), recipients, filters
- `EmailPort` for email delivery (Resend adapter, no-op fallback)

**API Endpoints (6):**

| Method | Route                       | Description               |
| ------ | --------------------------- | ------------------------- |
| POST   | `/api/reports`              | Create scheduled report   |
| GET    | `/api/reports`              | List reports (by project) |
| GET    | `/api/reports/:id`          | Get report details        |
| PATCH  | `/api/reports/:id`          | Update report schedule    |
| DELETE | `/api/reports/:id`          | Delete scheduled report   |
| POST   | `/api/reports/:id/generate` | Manual report generation  |

**Background Jobs:**

- Report generation worker checks for due reports every 15 minutes
- Generates CSV/JSON from analytics data
- Sends via email with attachment

**Configuration:**

- `RESEND_API_KEY` — Resend API key for email delivery (optional, logs only if not set)

### Analytics Export

The existing `/analytics/export` endpoint now supports CSV and JSON formats with configurable data inclusion (posts, analytics, threads).

## Data Model

### New Prisma Models (5)

| Model                     | Purpose                           |
| ------------------------- | --------------------------------- |
| `Campaign`                | Marketing campaign with lifecycle |
| `CampaignPost`            | Campaign-Post many-to-many join   |
| `AnalyticsDailySummary`   | Daily analytics aggregates        |
| `AnalyticsMonthlySummary` | Monthly analytics aggregates      |
| `ScheduledReport`         | Report scheduling configuration   |

### New Enums (2)

- `CampaignStatus` — DRAFT, ACTIVE, PAUSED, COMPLETED, ARCHIVED
- `ReportFormat` — CSV, JSON

### Modified Models

- `TrackedLink` — added UTM fields (utmSource, utmMedium, utmCampaign, utmContent, utmTerm, campaignId)
- `Post` — added `campaignPosts` relation
- `Project` — added `campaigns` and `scheduledReports` relations

## DI Tokens (21 new)

**Repositories:** CampaignRepository, CampaignQueryRepository, ScheduledReportRepository

**Use Cases:** CreateCampaignUseCase, UpdateCampaignUseCase, ArchiveCampaignUseCase, TagPostWithCampaignUseCase, UntagPostFromCampaignUseCase, GetCampaignAnalyticsUseCase, ListCampaignsQuery, GetCampaignQuery, GenerateUTMLinksUseCase, GetHistoricalAnalyticsQuery, CreateScheduledReportUseCase, UpdateScheduledReportUseCase, DeleteScheduledReportUseCase, ListScheduledReportsQuery, GenerateReportUseCase

**Ports/Adapters:** GA4TrackingPort, EmailPort

## Background Workers

| Worker                     | Queue                 | Schedule           | Purpose                              |
| -------------------------- | --------------------- | ------------------ | ------------------------------------ |
| analyticsAggregationWorker | ANALYTICS_AGGREGATION | Daily/Monthly cron | Aggregate and purge analytics        |
| reportGenerationWorker     | REPORT_GENERATION     | Every 15 minutes   | Generate and email scheduled reports |
