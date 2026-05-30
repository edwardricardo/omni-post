/**
 * @file index.ts
 * @description Barrel for `trends` bounded context (`@core/trends`).
 * @layer application
 */
export * from "./DetectTrendsUseCase.js";
export * from "./DispatchDetectTrendsUseCase.js";
export * from "./FetchTrendingTopicsUseCase.js";
export * from "./GetTrendRadarQuery.js";
export * from "./ScoreTrendRelevanceUseCase.js";
export * from "./TrendRadarResultPort.js";
