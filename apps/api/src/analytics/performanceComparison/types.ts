/**
 * @file types.ts
 * @description Type definitions for the performance comparison subsystem including
 *              snapshots, benchmarks, comparisons, trends, and recommendations.
 * @layer infrastructure
 */
import type {
  ProviderType,
  ContentType,
  TimeRange,
  MetricType,
  CompetitorComparison,
  TrendDataPoint,
} from "@shared/analytics";

export interface PerformanceComparisonOptions {
  accountId: string;
  projectId?: string;
  timeRange: TimeRange;
  startDate?: Date;
  endDate?: Date;
  providers?: ProviderType[];
  includeIndustryBenchmarks?: boolean;
  includeCompetitorData?: boolean;
  includeHistoricalComparison?: boolean;
}

export interface PerformanceComparison {
  currentPerformance: PerformanceSnapshot;
  industryBenchmarks: IndustryBenchmark[];
  competitorComparisons: CompetitorComparison[];
  historicalComparison: HistoricalComparison;
  providerComparison: ProviderPerformanceComparison[];
  contentTypeComparison: ContentTypeComparison[];
  keyInsights: PerformanceInsight[];
  recommendations: PerformanceRecommendation[];
}

export interface PerformanceSnapshot {
  period: string;
  totalPosts: number;
  totalImpressions: number;
  totalEngagements: number;
  avgEngagementRate: number;
  totalReach: number;
  totalClicks: number;
  clickThroughRate: number;
  followerGrowth: number;
  costPerEngagement: number;
  costPerClick: number;
  roi: number;
}

export interface IndustryBenchmark {
  metric: MetricType;
  industry: string;
  yourValue: number;
  industryAverage: number;
  industryMedian: number;
  topQuartile: number;
  topDecile: number;
  percentileRank: number;
  performance: "excellent" | "above_average" | "average" | "below_average" | "poor";
  gapToTopQuartile: number;
  improvementOpportunity: number;
}

export interface HistoricalComparison {
  comparisonPeriod: string;
  currentPeriod: PerformanceSnapshot;
  previousPeriod: PerformanceSnapshot;
  yearOverYear: PerformanceSnapshot;
  changes: {
    vsLastPeriod: PerformanceChange;
    vsYearAgo: PerformanceChange;
  };
  trends: {
    shortTerm: "improving" | "declining" | "stable";
    longTerm: "improving" | "declining" | "stable";
  };
}

export interface PerformanceChange {
  impressions: { absolute: number; percentage: number };
  engagements: { absolute: number; percentage: number };
  engagementRate: { absolute: number; percentage: number };
  reach: { absolute: number; percentage: number };
  clicks: { absolute: number; percentage: number };
  followerGrowth: { absolute: number; percentage: number };
  roi: { absolute: number; percentage: number };
}

export interface ProviderPerformanceComparison {
  provider: ProviderType;
  currentMetrics: ProviderMetrics;
  industryBenchmark: ProviderBenchmark;
  competitorAverage: ProviderMetrics;
  ranking: {
    vsIndustry: number; // Percentile
    vsCompetitors: number; // Rank
  };
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
}

export interface ProviderMetrics {
  posts: number;
  impressions: number;
  engagements: number;
  engagementRate: number;
  reach: number;
  clicks: number;
  clickThroughRate: number;
  followerGrowth: number;
  costPerEngagement: number;
  roi: number;
}

export interface ProviderBenchmark {
  avgEngagementRate: number;
  avgClickThroughRate: number;
  avgFollowerGrowthRate: number;
  avgCostPerEngagement: number;
  avgROI: number;
}

export interface ContentTypeComparison {
  contentType: ContentType;
  yourPerformance: ContentPerformanceMetrics;
  industryAverage: ContentPerformanceMetrics;
  competitorAverage: ContentPerformanceMetrics;
  ranking: number; // Your rank among content types
  relativePerformance: number; // Multiplier vs your average
  recommendations: string[];
}

export interface ContentPerformanceMetrics {
  avgImpressions: number;
  avgEngagements: number;
  avgEngagementRate: number;
  avgReach: number;
  avgClicks: number;
  avgViralScore: number;
  costEffectiveness: number;
}

export interface PerformanceInsight {
  type: "strength" | "weakness" | "opportunity" | "threat" | "trend";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  confidence: number;
  supportingData: Record<string, unknown>;
  actionable: boolean;
}

export interface PerformanceRecommendation {
  category: "content" | "timing" | "platform" | "budget" | "strategy";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  expectedImpact: string;
  confidenceLevel: number;
  implementation: {
    difficulty: "easy" | "medium" | "hard";
    timeToImplement: string;
    timeToSeeResults: string;
    steps: string[];
  };
  metrics: MetricType[];
}

export interface AnalyticsDataPoint {
  provider: { toString(): string };
  capturedAt: Date;
  postId: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
}

export interface PostData {
  id: string;
}

export interface MetricComparison {
  metrics: MetricType[];
  periods: Array<{
    period: TimeRange;
    startDate: Date;
    endDate: Date;
    data: Record<MetricType, number>;
  }>;
  trends: Record<MetricType, TrendDataPoint[]>;
  insights: string[];
}

export interface CompetitivePositioning {
  overallRanking: {
    yourRank: number;
    totalCompetitors: number;
    percentile: number;
    category: "leader" | "challenger" | "follower" | "niche";
  };
  strengthsAndWeaknesses: {
    strengths: Array<{ metric: MetricType; advantage: number; description: string }>;
    weaknesses: Array<{ metric: MetricType; gap: number; description: string }>;
  };
  competitiveGaps: Array<{
    competitor: string;
    gaps: Array<{ metric: MetricType; gap: number; priority: "high" | "medium" | "low" }>;
  }>;
  marketOpportunities: Array<{
    opportunity: string;
    description: string;
    requiredImprovement: Record<MetricType, number>;
    potentialImpact: "high" | "medium" | "low";
  }>;
}
