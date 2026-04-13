# OmniPost -- Engagement Analytics API Reference

## Overview

OmniPost provides a comprehensive analytics subsystem covering engagement metrics, ROI calculation, cross-platform performance comparison, real-time WebSocket streaming, thread-specific analytics, and rule-based engagement prediction. Analytics data is sourced from the Prisma `Analytics` model and aggregated through dedicated infrastructure services with Redis caching.

---

## API Layer (`apps/api/`)

### AnalyticsRouteHandler

**File:** `apps/api/src/analytics/analyticsRoutes.ts`
**Layer:** infrastructure
**Description:** Fastify route handler serving client-facing analytics endpoints including dashboard data, thread performance, engagement trends, best posting times, geographic analytics, media performance, and CSV/JSON export.

#### Routes

| Method | Path                             | Auth   | Description                                                               |
| ------ | -------------------------------- | ------ | ------------------------------------------------------------------------- |
| `GET`  | `/analytics/project/:projectId`  | None   | Project-level analytics summary (views, likes, comments, shares)          |
| `GET`  | `/threads/:threadId/performance` | Client | Thread performance metrics via `ThreadAnalytics.getThreadMetrics`         |
| `GET`  | `/threads/compare`               | Client | Compare thread strategies via `ThreadAnalytics.compareStrategies`         |
| `GET`  | `/engagement/trends`             | Client | Engagement trends over time (501 -- not yet implemented at project level) |
| `GET`  | `/posts/best-times`              | Client | Optimal posting times (501 -- not yet implemented)                        |
| `GET`  | `/engagement/geographic`         | Client | Geographic analytics (501 -- not yet implemented)                         |
| `GET`  | `/content/media-performance`     | Client | Media vs text performance (501 -- not yet implemented)                    |
| `GET`  | `/dashboard`                     | Client | Comprehensive dashboard: overview, per-platform metrics, time range       |
| `GET`  | `/export`                        | Client | Export analytics as JSON or CSV with configurable sections                |

#### Methods

| Method                | Signature                                | Returns                                                                | Description                                              |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `getProjectAnalytics` | `(request, reply): Promise<void>`        | `{ projectId, postCount, views, likes, comments, shares, dataPoints }` | Aggregates latest 100 analytics records for a project    |
| `getDashboard`        | `(request, reply): Promise<void>`        | `{ overview, platformMetrics, timeRange, dataPoints }`                 | Full dashboard with per-platform breakdown               |
| `exportAnalytics`     | `(request, reply): Promise<void>`        | JSON payload or CSV file                                               | Exports posts, analytics, threads, channels with summary |
| `buildCsvRows`        | `(analytics, posts, channels): CsvRow[]` | `CsvRow[]`                                                             | Joins analytics with post/channel data into flat rows    |

**Has JSDoc:** &#9989; (file-level and `buildCsvRows`)

---

### Admin Analytics Routes

**File:** `apps/api/src/admin/analyticsRoutes.ts`
**Layer:** infrastructure
**Description:** Admin-only analytics endpoints for dashboard KPIs, compliance metrics, audit logs, and GDPR data. Protected by `requireAdminAuth` and RBAC permissions.

#### Routes

| Method | Path                               | Permission       | Description                              |
| ------ | ---------------------------------- | ---------------- | ---------------------------------------- |
| `GET`  | `/api/admin/analytics/metrics`     | `ANALYTICS_READ` | Analytics dashboard KPIs                 |
| `GET`  | `/api/admin/compliance/metrics`    | `AUDIT_READ`     | Compliance status overview               |
| `GET`  | `/api/admin/compliance/audit-logs` | `AUDIT_READ`     | Compliance audit log listing             |
| `GET`  | `/api/admin/compliance/gdpr`       | `AUDIT_READ`     | GDPR compliance data                     |
| `PUT`  | `/admin/accounts/:id/settings`     | `ACCOUNT_MANAGE` | Update account settings (trial, billing) |

**Has JSDoc:** &#9989;

---

### ThreadAnalytics

**File:** `apps/api/src/analytics/threadAnalytics.ts`
**Layer:** infrastructure
**Description:** Calculates thread-specific metrics including engagement per tweet, completion rates, publish duration, performance scoring, engagement trends, strategy comparisons, and batch processing for N+1 query elimination.

#### Methods

| Method                       | Signature                                                          | Returns                                                                       | Description                                                            |
| ---------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `getThreadMetrics`           | `(threadId: string): Promise<ThreadMetrics \| null>`               | `ThreadMetrics \| null`                                                       | Comprehensive metrics for a single thread (cached 5 min)               |
| `calculatePerformanceScore`  | `(threadId: string): Promise<ThreadPerformanceScore \| null>`      | `ThreadPerformanceScore \| null`                                              | Engagement, completion, timing scores (0-100) with recommendations     |
| `getEngagementTrends`        | `(threadId: string): Promise<EngagementTrend[]>`                   | `EngagementTrend[]`                                                           | Per-tweet engagement breakdown within a thread                         |
| `getAnalyticsSummary`        | `(projectId?, accountId?, days?): Promise<ThreadAnalyticsSummary>` | `ThreadAnalyticsSummary`                                                      | Summary: totals, top threads, daily/weekly trends, strategy comparison |
| `compareStrategies`          | `(projectId?, accountId?): Promise<StrategyComparison[]>`          | `Array<{ strategy, avgEngagement, avgCompletion, threadCount, successRate }>` | Compare thread strategies by engagement and completion                 |
| `calculatePerformanceRating` | `(avgEngagement, completionRate, totalTweets): string`             | `"excellent" \| "good" \| "average" \| "poor"`                                | Weighted score using engagement, completion, tweet count               |
| `cleanup`                    | `(): Promise<void>`                                                | `void`                                                                        | Clears Redis cache keys                                                |

**Has JSDoc:** &#9989; (file-level)

---

### ROICalculator

**File:** `apps/api/src/analytics/roiCalculator.ts`
**Layer:** infrastructure
**Description:** Orchestrates the ROI calculation pipeline by delegating to CostCalculator, RevenueCalculator, ROIMetrics, ROIForecasting, and ROIRecommendations. Caches results in Redis for 10 minutes.

#### Methods

| Method                     | Signature                                                                         | Returns                                                 | Description                                                                     |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `calculateROI`             | `(options: ROICalculationOptions): Promise<ROICalculation>`                       | `ROICalculation`                                        | Full ROI: costs, revenue, by-provider, by-content-type, trends, recommendations |
| `trackConversion`          | `(conversion: ConversionTracking): Promise<void>`                                 | `void`                                                  | Records conversion event and updates real-time ROI in Redis                     |
| `calculateCostAttribution` | `(options: ROICalculationOptions): Promise<Record<string, { cost, percentage }>>` | `Record<string, { cost: number; percentage: number }>`  | Cost breakdown by activity type                                                 |
| `generateROIForecast`      | `(options, forecastMonths?): Promise<Forecast>`                                   | `{ monthlyForecasts, totalProjection, keyAssumptions }` | Projects ROI forward based on 90-day historical data                            |
| `calculateDateRange`       | `(timeRange, startDate?, endDate?): { startDate, endDate }`                       | `{ startDate: Date; endDate: Date }`                    | Computes date boundaries from TimeRange enum                                    |
| `getSeasonalFactor`        | `(month: number): number`                                                         | `number`                                                | Returns seasonal multiplier for a given month                                   |

**Has JSDoc:** &#9989; (all public methods)

---

### ROI Sub-modules

| File                                               | Class                | Description                                                     |
| -------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| `apps/api/src/analytics/roi/CostCalculator.ts`     | `CostCalculator`     | Labor, tools, ad spend, content creation cost breakdown         |
| `apps/api/src/analytics/roi/RevenueCalculator.ts`  | `RevenueCalculator`  | Engagement-based and conversion-based revenue estimation        |
| `apps/api/src/analytics/roi/ROIMetrics.ts`         | `ROIMetrics`         | Overall ROI, by-provider, by-content-type, trend calculations   |
| `apps/api/src/analytics/roi/ROIForecasting.ts`     | `ROIForecasting`     | Monthly projections with seasonal factors and confidence levels |
| `apps/api/src/analytics/roi/ROIRecommendations.ts` | `ROIRecommendations` | Rule-based optimization recommendations                         |

---

### RealtimeAnalyticsService

**File:** `apps/api/src/analytics/realtimeAnalytics.ts`
**Layer:** infrastructure
**Description:** WebSocket-based real-time analytics service providing live metric streaming, Redis pub/sub event handling, connection management, and periodic metric updates (30-second interval).

#### Methods

| Method                    | Signature                                    | Returns                                                                            | Description                                     |
| ------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| `registerWebSocketRoutes` | `(fastify: FastifyInstance): Promise<void>`  | `void`                                                                             | Registers `/ws/analytics` WebSocket endpoint    |
| `broadcastMetricsUpdate`  | `(postId, metrics): Promise<void>`           | `void`                                                                             | Pushes metrics to all subscribers of a post     |
| `triggerUpdate`           | `(postId, provider, metrics): Promise<void>` | `void`                                                                             | External trigger for real-time metric broadcast |
| `getConnectionStats`      | `(): ConnectionStats`                        | `{ totalConnections, activeSubscriptions, subscribedPosts, connectionsByProject }` | Returns current WebSocket connection statistics |
| `calculateEngagementRate` | `(analytics): number`                        | `number`                                                                           | Engagement rate as percentage                   |
| `generateConnectionId`    | `(): string`                                 | `string`                                                                           | Generates `conn_<uuid>` identifiers             |
| `shutdown`                | `(): void`                                   | `void`                                                                             | Closes all connections and clears caches        |

**WebSocket Protocol:**

- `subscribe` -- Subscribe to post metrics (validates project access)
- `unsubscribe` -- Unsubscribe from posts
- `ping` / `pong` -- Keep-alive
- `metrics_update` -- Server push with delta metrics

**Has JSDoc:** &#9989; (all public methods)

---

### EngagementPredictor

**File:** `apps/api/src/analytics/engagementPredictor.ts`
**Layer:** infrastructure
**Description:** Rule-based engagement estimation service using hand-tuned weights, platform-specific multipliers, and historical context. Not machine learning despite the "predict" naming (retained for API compatibility).

#### Methods

| Method                       | Signature                                                                              | Returns                                                  | Description                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| `predictEngagement`          | `(request: PredictionRequest): Promise<PerformancePrediction>`                         | `PerformancePrediction`                                  | Engagement estimate with content, timing, and platform factors |
| `predictOptimalTiming`       | `(accountId, projectId, provider, contentType, timeframe?): Promise<TimingPrediction>` | `TimingPrediction`                                       | Top 3 optimal posting times with confidence and alternatives   |
| `analyzePerformancePatterns` | `(accountId, projectId?, timeRange?): Promise<PatternAnalysis>`                        | `{ patterns, insights, modelAccuracy, recommendations }` | Pattern identification from historical data                    |

**Has JSDoc:** &#9989; (all public methods with detailed notes about heuristic nature)

---

### CrossPlatformAnalyticsEngine

**File:** `apps/api/src/analytics/crossPlatform/index.ts`
**Layer:** infrastructure
**Description:** Main orchestrator that coordinates data fetching, summary generation, content analysis, trend analysis, competitive benchmarking, and recommendation generation across all social platforms. Uses Redis caching (5-minute TTL).

#### Methods

| Method                         | Signature                                                                 | Returns                       | Description                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `generateCrossPlatformMetrics` | `(options: CrossPlatformAnalyticsOptions): Promise<CrossPlatformMetrics>` | `CrossPlatformMetrics`        | Full cross-platform report: summary, per-provider, content insights, trends, benchmarks, recommendations |
| `groupByProvider`              | `(analyticsData): Record<string, Analytics[]>`                            | `Record<string, Analytics[]>` | Groups analytics records by provider name                                                                |
| `findTopPerformingProvider`    | `(providerPerformance): string`                                           | `string`                      | Returns provider with highest engagement rate                                                            |
| `calculateDateRange`           | `(timeRange, startDate?, endDate?): DateRange`                            | `{ startDate, endDate }`      | Date boundary computation from TimeRange                                                                 |

**Has JSDoc:** &#9989;

---

## Application Layer Use Cases

### CalculateROIUseCase

**File:** `apps/api/src/application/analytics/CalculateROIUseCase.ts`
**Layer:** application
**Description:** Orchestrates ROI calculation with optional per-channel breakdown and recommendations.

| Method    | Signature                                                                       | Returns                                    | Description                                     |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `execute` | `(input: CalculateROIInput): Promise<Result<CalculateROIOutput, UseCaseError>>` | `Result<CalculateROIOutput, UseCaseError>` | Validates input, delegates to ROICalculatorPort |

**Has JSDoc:** &#9989;

### GetCrossPlatformAnalyticsUseCase

**File:** `apps/api/src/application/analytics/GetCrossPlatformAnalyticsUseCase.ts`
**Layer:** application
**Description:** Retrieves and aggregates cross-platform analytics with optional competitive benchmarking.

| Method    | Signature                                                                       | Returns                                    | Description                                              |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `execute` | `(input: GetAnalyticsInput): Promise<Result<GetAnalyticsOutput, UseCaseError>>` | `Result<GetAnalyticsOutput, UseCaseError>` | Validates input, delegates to CrossPlatformAnalyticsPort |

**Has JSDoc:** &#9989;

### ComparePerformanceUseCase

**File:** `apps/api/src/application/analytics/ComparePerformanceUseCase.ts`
**Layer:** application
**Description:** Cross-period and cross-provider performance comparison with industry benchmarks and competitor data.

| Method    | Signature                                                                                   | Returns                                          | Description                                             |
| --------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `execute` | `(input: ComparePerformanceInput): Promise<Result<ComparePerformanceOutput, UseCaseError>>` | `Result<ComparePerformanceOutput, UseCaseError>` | Validates input, delegates to PerformanceComparatorPort |

**Has JSDoc:** &#9989;

---

## Cross-Platform Sub-modules

| File                                      | Module                                                                     | Description                                          |
| ----------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `crossPlatform/dataFetcher.ts`            | `getAnalyticsData`, `getPostsData`, `getChannelsData`, `getCompetitorData` | Parallel data retrieval using ProjectQueryRepository |
| `crossPlatform/summaryGenerator.ts`       | `generateSummary`, `generateProviderMetrics`                               | Aggregates totals and per-provider metrics           |
| `crossPlatform/contentAnalyzer.ts`        | `generateContentInsights`                                                  | Content type performance analysis                    |
| `crossPlatform/ContentMetricsAnalyzer.ts` | `ContentMetricsAnalyzer`                                                   | Detailed content metrics breakdown                   |
| `crossPlatform/trendAnalyzer.ts`          | `generateTrendAnalysis`                                                    | Time-series trend analysis                           |
| `crossPlatform/competitiveAnalyzer.ts`    | `generateCompetitiveAnalysis`, `generateBasicBenchmarking`                 | Competitor and industry benchmarking                 |
| `crossPlatform/recommendationEngine.ts`   | `generateRecommendations`                                                  | Rule-based optimization suggestions                  |
| `crossPlatform/PerformanceAnalyzer.ts`    | `PerformanceAnalyzer`                                                      | Performance scoring and analysis                     |
| `crossPlatform/HashtagTimingAnalyzer.ts`  | `HashtagTimingAnalyzer`                                                    | Hashtag and timing correlation analysis              |

---

## Performance Comparison Sub-modules

| File                                          | Module               | Description                         |
| --------------------------------------------- | -------------------- | ----------------------------------- |
| `performanceComparison/snapshotGenerator.ts`  | `snapshotGenerator`  | Point-in-time performance snapshots |
| `performanceComparison/benchmarkGenerator.ts` | `benchmarkGenerator` | Industry benchmark generation       |
| `performanceComparison/trendAnalyzer.ts`      | `trendAnalyzer`      | Period-over-period trend comparison |

---

## Shared Types

**File:** `apps/api/src/analytics/types.ts`

| Type                 | Description                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| `AnalyticsDataPoint` | `{ views?, likes?, comments?, shares? }`                                        |
| `HistoricalContext`  | Account performance, platform benchmarks, seasonal factors, trending topics     |
| `PredictionRequest`  | Input for engagement prediction: content, provider, scheduling, hashtags, media |

---

## Domain Layer

**File:** `apps/api/src/domain/analytics/ReportSchema.ts`
**Description:** Domain-level report schema definitions for analytics outputs.

---

## Key Implementation Notes

- **Caching:** Redis-backed with TTLs of 5-10 minutes across all analytics services
- **N+1 Prevention:** Thread analytics uses batch processing (`getThreadMetricsBatch`) and `AnalyticsReadRepositoryPort.getByPostIds`
- **Not-yet-implemented endpoints:** Geographic analytics, best posting times, media performance, and project-level engagement trends return 501
- **Heuristic, not ML:** EngagementPredictor uses rule-based scoring with platform multipliers, not trained models
- **Export formats:** JSON (default) and CSV via `@packages/api-common` `exportToCSV` utility
