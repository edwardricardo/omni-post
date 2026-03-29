# Sprint 3 Report — Wave 3 Features

Date: 2026-03-29

## Batches Summary

| Batch | Feature               | Status | Tests Added |
| ----- | --------------------- | ------ | ----------- |
| 1     | @Mention autocomplete | ✅     | 27          |
| 2     | Google Drive import   | ✅     | 20          |
| 3     | SSO / SAML            | ✅     | 32          |
| 4     | OIDC                  | ✅     | 45          |
| 5     | Custom report builder | ✅     | 59          |
| 6     | Backlog update        | ✅     | —           |

## Batch 1 — @Mention

MentionParser: format `@[DisplayName](teamMemberId)`, pure domain service
NotifyMentionedUsersService: parses mentions, deduplicates, skips self-mentions, creates MENTION notifications
Autocomplete endpoint: `GET /api/team/mention-search?q=&accountId=` (top 10 matches)
Wired into: AddConversationNoteUseCase, CreateTaskUseCase (fire-and-forget notification)
Tests: 27 (19 parser + 8 notification service)

## Batch 2 — Google Drive Import

Approach: **Option A — Google Picker API (client-side OAuth)**
New use case: ImportFromGoogleDriveUseCase (validates MIME type, stores Google Drive URL as asset)
Route: `POST /api/assets/import/google-drive`
Supported types: image/_, video/_
Env vars added: NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_GOOGLE_API_KEY
Tests: 20

## Batch 3 — SSO / SAML

SAML library: @node-saml/node-saml@5.1.0
New Prisma models: SamlConfiguration, SamlSession
Migration: add_saml_sso
Domain entity: SamlConfiguration (validates HTTPS URL, PEM certificate, email in attribute mapping)
Use cases: ConfigureSamlUseCase, EnableSsoUseCase, DisableSsoUseCase, GetSamlConfigurationQuery
SAML flow: SP metadata XML, AuthnRequest redirect, POST callback with response validation
Routes: 7 endpoints (4 admin + 3 public SAML flow)
Account extended: ssoEnabled, ssoProvider (NONE/SAML/OIDC)
Tests: 32 (14 entity + 18 use cases)

## Batch 4 — OIDC

OIDC library: openid-client@6.8.2
New Prisma model: OidcConfiguration
Migration: add_oidc_sso
Domain entity: OidcConfiguration (validates HTTPS issuer, clientId/Secret, masks secret in toJSON)
Use cases: ConfigureOidcUseCase, EnableOidcSsoUseCase, DisableOidcSsoUseCase, GetOidcConfigurationQuery
OIDC flow: Authorization Code + PKCE, token exchange, UserInfo fetch
Routes: 6 endpoints (4 admin + 2 public OIDC flow)
Shared: SsoProvider enum (NONE/SAML/OIDC) — mutually exclusive
Tests: 45 (20 entity + 25 use cases)

## Batch 5 — Custom Report Builder

New Prisma models: CustomReport, ReportSchedule
Enums: ReportChartType (LINE/BAR/AREA/PIE/TABLE), ReportFormat extended (CSV/JSON/PDF/XLSX/XML)
Migration: add_custom_reports + add_xml_report_format
Available metrics: 12 (impressions, reach, engagement_rate, likes, comments, shares, saves, video_views, watch_time, follower_growth, link_clicks, post_count)
Available dimensions: 4 (date, platform, post_type, campaign)
Date range presets: 8 (LAST_7/30/90_DAYS, LAST_12_MONTHS, THIS/LAST_MONTH, THIS_YEAR, CUSTOM)
Use cases: Create, Update, Delete, List, Get, Run, Schedule (7 total)
Routes: 8 endpoints at /api/custom-reports/\* + /api/reports/schema
Tests: 59 (29 entity + 30 use cases)

## Totals

| Metric          | Before Sprint 3 | After Sprint 3 | Delta |
| --------------- | --------------- | -------------- | ----- |
| Tests passing   | 6,695           | 6,878          | +183  |
| Test files      | 316             | 325            | +9    |
| Prisma models   | 76              | 81             | +5    |
| API route files | 51              | 54             | +3    |

## Build and Test

| Check                   | Result                           |
| ----------------------- | -------------------------------- |
| TypeScript build        | 0 errors, 9/9 tasks              |
| All tests               | 325 files, 6878 passed, 0 failed |
| ESLint                  | 0 errors, 0 warnings             |
| Architecture boundaries | Clean (0 violations)             |

## Decisions Made

| Decision                | Choice                   | Reason                                              |
| ----------------------- | ------------------------ | --------------------------------------------------- |
| Google Drive auth       | Option A (Picker API)    | No server-side Google OAuth needed, faster to ship  |
| SAML config per account | Option A (single config) | Covers 95% of enterprise, extensible to multi later |

## Backlog Items Closed

| ID       | Item                  | Score | Status  |
| -------- | --------------------- | ----- | ------- |
| D-UX-02  | @Mention autocomplete | 16    | ✅ Done |
| D-AL-02  | Google Drive import   | 14    | ✅ Done |
| D-ENT-01 | SSO / SAML            | 15    | ✅ Done |
| D-ENT-02 | OIDC                  | 13    | ✅ Done |
| D-AN-01  | Custom report builder | 13    | ✅ Done |

## Cumulative Progress (Sprints 1-3)

| Sprint    | Items Closed                                    | Tests Added |
| --------- | ----------------------------------------------- | ----------- |
| Sprint 1  | D-UX-01, D-TC-03, D-AL-01, D-INT-02 + tech debt | +105        |
| Sprint 2  | D-INT-03, D-TC-01, D-TC-02                      | +112        |
| Sprint 3  | D-UX-02, D-AL-02, D-ENT-01, D-ENT-02, D-AN-01   | +183        |
| **Total** | **12 backlog items + tech debt**                | **+400**    |

## Wave 4 Candidates

| ID      | Item                    | Score | Notes                                 |
| ------- | ----------------------- | ----- | ------------------------------------- |
| D-UX-03 | Canva / Adobe Express   | ~13   | Blocked by partnership                |
| D-AD-01 | Post boosting (Meta)    | ~11   | Meta API approval needed              |
| D-SL-01 | Social listening        | ~11   | XL effort                             |
| D-EA-01 | Employee advocacy       | ~11   | Enterprise, tasks could be foundation |
| D-AN-02 | Industry benchmarks     | ~10   | Needs user base for data              |
| D-AI-01 | Brand Voice fine-tuning | ~10   | Enterprise customers now (SSO)        |
