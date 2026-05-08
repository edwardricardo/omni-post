/**
 * @file apiTypes.ts
 * @description Backend response shapes for the four predictive-analytics
 *              endpoints consumed by `usePredictiveData`. Each endpoint
 *              is currently scaffolded to 501 NOT_IMPLEMENTED on the
 *              backend; these types lock the contract for when the real
 *              implementations land.
 * @layer infrastructure
 */

export interface OptimalTimeSlot {
  dayOfWeek: number;
  hour: number;
  score: number;
  audienceReach: number;
  competitionLevel: "low" | "medium" | "high";
}

export interface ActivityPattern {
  hour: number;
  dayOfWeek: number;
  activityLevel: number;
  audiencePercentage: number;
}

export interface PredictTimingApiValue {
  optimalSlots: OptimalTimeSlot[];
  provider: string;
  timezone: string;
  recommendations: string[];
  activityPatterns?: ActivityPattern[];
}

export interface AudienceSegmentPrediction {
  segmentName: string;
  engagementScore: number;
  reachPotential: number;
  sentiment: "positive" | "neutral" | "negative";
}

export interface AudienceRiskFactor {
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
  mitigation: string;
}

export interface AudienceOptimizationSuggestion {
  area: string;
  suggestion: string;
  expectedImpact: number;
}

export interface PredictAudienceApiValue {
  overallEngagementScore: number;
  predictions: {
    likes: number;
    comments: number;
    shares: number;
    reach: number;
  };
  segmentPredictions?: AudienceSegmentPrediction[];
  riskFactors: AudienceRiskFactor[];
  optimizationSuggestions?: AudienceOptimizationSuggestion[];
  /**
   * Demographics + behaviour are returned by the backend when the model
   * has historical data to draw from. Frontend never fabricates these
   * fields — when the backend doesn't return them, the corresponding UI
   * surface is omitted.
   */
  demographics?: {
    ageGroup: string;
    location: string;
    interests: string[];
  };
  behavior?: {
    activeHours: string;
    preferredContent: string[];
    engagementTriggers: string[];
  };
}

export interface ROIChannelBreakdown {
  channel: string;
  investment: number;
  revenue: number;
  roi: number;
  performance: string;
}

export interface ROIApiValue {
  totalInvestment: number;
  totalRevenue: number;
  roi: number;
  roiPercentage: number;
  breakdown?: Record<string, unknown>;
  channelBreakdown?: ROIChannelBreakdown[];
  bestPerformingChannel?: string;
  recommendations?: string[];
}

export interface CrossPlatformProviderEntry {
  avgEngagementRate?: number;
  totalPosts?: number;
  topContentTypes?: string[];
  /**
   * Threats per provider — only populated when the backend computes a
   * real competitive analysis. Frontend never fabricates this list.
   */
  threats?: string[];
}

export interface CrossPlatformApiValue {
  summary: {
    totalPosts: number;
    totalEngagements: number;
    avgEngagementRate: number;
    totalReach: number;
    topPerformingProvider?: string;
  };
  byProvider?: Record<string, CrossPlatformProviderEntry>;
  contentInsights?: Record<string, unknown>;
  audienceAnalytics?: Record<string, unknown>;
  benchmarking?: Record<string, unknown>;
  trends?: Record<string, unknown>;
  recommendations?: string[];
}

/**
 * Common envelope returned by every backend route. The 501 stubs return
 * `ok: false` with an `error` code; consumers throw on either non-2xx
 * status or `ok === false` so TanStack Query surfaces an explicit error
 * state instead of silently treating it as "no data".
 */
export interface ApiEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: string;
  message?: string;
}
