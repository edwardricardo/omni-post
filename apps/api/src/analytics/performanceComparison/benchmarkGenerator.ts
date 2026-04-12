/**
 * @file benchmarkGenerator.ts
 * @description Utility functions for percentile calculation and performance categorization.
 * @layer infrastructure
 */
import type { PerformanceSnapshot, AnalyticsDataPoint, IndustryBenchmark } from "./types.js";

// Future: Industry Benchmark Generation
// Generate real industry benchmarks by sourcing data from external benchmark
// APIs (e.g., Rival IQ, Sprout Social benchmark reports) or configurable
// reference datasets maintained by the platform admin.
// Requires: External benchmark data source integration, periodic refresh job.

/**
 * Generates industry benchmarks and performance comparisons
 */
export class BenchmarkGenerator {
  /**
   * Generate industry benchmarks based on current performance
   *
   * Returns empty array until real benchmark data source is integrated.
   */
  public static generateIndustryBenchmarks(
    _currentPerformance: PerformanceSnapshot,
    _analyticsData: AnalyticsDataPoint[]
  ): IndustryBenchmark[] {
    // Future: Requires external benchmark data source
    return [];
  }

  /**
   * Calculate percentile ranking
   */
  public static calculatePercentile(yourValue: number, benchmarkValue: number): number {
    if (benchmarkValue === 0) return yourValue > 0 ? 90 : 50;
    const ratio = yourValue / benchmarkValue;

    if (ratio >= 2.0) return 95;
    if (ratio >= 1.5) return 85;
    if (ratio >= 1.2) return 75;
    if (ratio >= 1.0) return 60;
    if (ratio >= 0.8) return 40;
    if (ratio >= 0.6) return 25;
    return 10;
  }

  /**
   * Get performance category based on percentile
   */
  public static getPerformanceCategory(
    percentile: number
  ): "excellent" | "above_average" | "average" | "below_average" | "poor" {
    if (percentile >= 85) return "excellent";
    if (percentile >= 70) return "above_average";
    if (percentile >= 40) return "average";
    if (percentile >= 20) return "below_average";
    return "poor";
  }
}
