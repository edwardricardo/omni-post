/**
 * @file index.ts
 * @description Barrel export for analytics use cases, ports, and shared type definitions.
 * @layer application
 */

// Types
export type {
  TimeRange,
  ProviderType,
  ContentType,
  MetricType,
  // GetAnalytics types
  GetAnalyticsInput,
  GetAnalyticsOutput,
  AnalyticsSummary,
  // ComparePerformance types
  ComparePerformanceInput,
  ComparePerformanceOutput,
  PerformanceSnapshot,
  // PredictEngagement types
  PredictEngagementInput,
  PredictEngagementOutput,
  OptimalTimeSlot,
  TimingPrediction,
  // CalculateROI types
  CalculateROIInput,
  CalculateROIOutput,
  InvestmentDetails,
  ROIBreakdown,
  ChannelROI,
} from "./types.js";

// Use Cases
export {
  GetCrossPlatformAnalyticsUseCase,
  type CrossPlatformAnalyticsPort,
} from "./GetCrossPlatformAnalyticsUseCase.js";

export {
  ComparePerformanceUseCase,
  type PerformanceComparatorPort,
} from "./ComparePerformanceUseCase.js";

// Note: PredictEngagementUseCase removed — was not registered in DI and not called from any route.

export { CalculateROIUseCase, type ROICalculatorPort } from "./CalculateROIUseCase.js";

export {
  GetHistoricalAnalyticsQuery,
  type GetHistoricalAnalyticsInput,
  type GetHistoricalAnalyticsOutput,
} from "./GetHistoricalAnalyticsQuery.js";
