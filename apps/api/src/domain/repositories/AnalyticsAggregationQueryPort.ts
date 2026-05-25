/**
 * @file AnalyticsAggregationQueryPort.ts
 * @description Re-export shim — the analytics aggregation query port moved to
 *              `@core/domain`. Kept here so existing import sites keep resolving
 *              during the @core migration (strangler-fig); removed at P8.
 * @layer domain
 */

export * from "@core/domain/repositories/AnalyticsAggregationQueryPort.js";
