/**
 * @file types.ts
 * @description TypeScript interfaces and union types used across the predictive
 * analytics components, including PerformancePrediction, ROIForecast, AudienceInsight,
 * CompetitorAnalysis, AnalysisTab, Timeframe, and PredictiveAnalyticsProps.
 */

export interface PerformancePrediction {
  platform: string;
  expectedEngagement: {
    value: number;
    confidence: number;
    range: { min: number; max: number };
  };
  expectedReach: {
    value: number;
    confidence: number;
    range: { min: number; max: number };
  };
  viralPotential: number;
  optimalPostingTime: {
    hour: number;
    day: string;
    timezone: string;
    confidence: number;
  };
  audienceActivity: {
    peak: string;
    low: string;
    pattern: "consistent" | "variable" | "seasonal";
  };
}

export interface ROIForecast {
  timeframe: "7d" | "30d" | "90d";
  expectedROI: number;
  confidence: number;
  breakdown: {
    organicReach: number;
    paidReach: number;
    conversions: number;
    revenue: number;
    cost: number;
  };
  factors: Array<{
    name: string;
    impact: number;
    description: string;
  }>;
}

export interface AudienceInsight {
  segment: string;
  size: number;
  engagement: number;
  growthRate: number;
  demographics: {
    ageGroup: string;
    location: string;
    interests: string[];
  };
  behavior: {
    activeHours: string;
    preferredContent: string[];
    engagementTriggers: string[];
  };
  predictions: {
    nextWeekActivity: number;
    seasonalTrends: string;
    contentPreferences: string[];
  };
}

export interface CompetitorAnalysis {
  competitor: string;
  performance: {
    avgEngagement: number;
    postFrequency: number;
    topContentTypes: string[];
  };
  opportunities: string[];
  threats: string[];
  benchmarkComparison: {
    engagement: "above" | "below" | "similar";
    reach: "above" | "below" | "similar";
    growth: "above" | "below" | "similar";
  };
}

export interface PredictiveAnalyticsProps {
  accountId: string;
  contentId?: string;
  platforms?: string[];
  timeframe?: "7d" | "30d" | "90d";
  analysisType?: "performance" | "roi" | "audience" | "competitive";
  onPredictionUpdate?: (predictions: PerformancePrediction[]) => void;
  showAdvanced?: boolean;
}

export type AnalysisTab = "performance" | "roi" | "audience" | "competitive";
export type Timeframe = "7d" | "30d" | "90d";
