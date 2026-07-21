/**
 * @file analytics.ts
 * @description Advanced analytics and ML integration types — time ranges, metric identifiers,
 *              and analytics shapes shared by admin and client analytics features.
 * @layer domain
 */
import type { ProviderName } from "./types.js";

// Advanced Analytics & ML Integration Types
export type TimeRange = "7d" | "30d" | "90d" | "1y" | "custom";
export type MetricType =
  | "engagement_rate"
  | "click_through_rate"
  | "impression_rate"
  | "conversion_rate"
  | "reach"
  | "views"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "profile_visits"
  | "follower_growth"
  | "cost_per_engagement"
  | "roi";

export type ProviderType = ProviderName;

export type ContentType =
  "text" | "image" | "video" | "carousel" | "story" | "reel" | "thread" | "poll" | "live";

export type AudienceSegment =
  | "super_engaged"
  | "regular_engaged"
  | "passive"
  | "new_followers"
  | "returning_visitors"
  | "high_value"
  | "at_risk"
  | "churned";

// Core Analytics Interfaces
export interface CrossPlatformMetrics {
  summary: AnalyticsSummary;
  byProvider: ProviderMetrics[];
  contentInsights: ContentPerformanceInsights;
  audienceAnalytics?: AudienceInsights;
  benchmarking: CompetitiveAnalysis;
  trends: TrendAnalysis;
  recommendations: AnalyticsRecommendation[];
}

export interface AnalyticsSummary {
  totalImpressions: number;
  totalEngagements: number;
  averageEngagementRate: number;
  totalReach: number;
  totalClicks: number;
  clickThroughRate: number;
  totalCost: number;
  totalRevenue: number;
  roi: number;
  followerGrowth: number;
  topPerformingProvider: string;
  topPerformingContentType: string;
}

export interface ProviderMetrics {
  provider: ProviderType;
  impressions: number;
  engagements: number;
  clicks: number;
  shares: number;
  comments: number;
  likes: number;
  saves: number;
  reach: number;
  followerGrowth: number;
  engagementRate: number;
  clickRate: number;
  cost: number;
  revenue: number;
  roi: number;
  postCount: number;
  avgPostPerformance: number;
  bestPostingTime: OptimalTiming;
  topHashtags: string[];
}

export interface OptimalTiming {
  bestDayOfWeek: string;
  bestHour: number;
  bestTimeZone: string;
  engagementMultiplier: number;
  confidence: "high" | "medium" | "low";
}

export interface ContentPerformanceInsights {
  topPerformingPosts: TopPerformingPost[];
  performanceByContentType: ContentTypePerformance[];
  hashtagAnalytics: HashtagAnalytics[];
  optimalPostTiming: OptimalTiming;
  contentLengthAnalysis: ContentLengthAnalysis;
  mediaPerformanceComparison: MediaPerformanceComparison;
  viralContentPatterns: ViralPattern[];
}

export interface TopPerformingPost {
  postId: string;
  provider: ProviderType;
  contentType: ContentType;
  title: string;
  publishedAt: Date;
  impressions: number;
  engagements: number;
  engagementRate: number;
  clicks: number;
  reach: number;
  viralScore: number;
  hashtags: string[];
  mediaCount: number;
}

export interface ContentTypePerformance {
  contentType: ContentType;
  provider: ProviderType;
  postCount: number;
  avgImpressions: number;
  avgEngagements: number;
  avgEngagementRate: number;
  avgReach: number;
  performanceScore: number;
  trendDirection: "up" | "down" | "stable";
  recommendation: string;
}

export interface HashtagAnalytics {
  hashtag: string;
  usageCount: number;
  avgImpressions: number;
  avgEngagements: number;
  avgEngagementRate: number;
  reach: number;
  trendingScore: number;
  competitionLevel: "low" | "medium" | "high";
  recommendedUsage: boolean;
}

export interface ContentLengthAnalysis {
  byProvider: Record<
    ProviderType,
    {
      shortContent: { avgLength: number; avgEngagement: number };
      mediumContent: { avgLength: number; avgEngagement: number };
      longContent: { avgLength: number; avgEngagement: number };
      optimal: { length: number; engagementRate: number };
    }
  >;
  generalRecommendation: string;
}

export interface MediaPerformanceComparison {
  textOnly: { count: number; avgEngagement: number; avgReach: number };
  withImages: { count: number; avgEngagement: number; avgReach: number };
  withVideos: { count: number; avgEngagement: number; avgReach: number };
  withCarousel: { count: number; avgEngagement: number; avgReach: number };
  mixed: { count: number; avgEngagement: number; avgReach: number };
  recommendation: string;
  performanceMultipliers: Record<string, number>;
}

export interface ViralPattern {
  pattern: string;
  description: string;
  frequency: number;
  avgViralScore: number;
  examplePosts: string[];
  recommendations: string[];
}

export interface AudienceInsights {
  demographics: AudienceDemographics;
  engagementPatterns: EngagementPatterns;
  topSegments: AudienceSegmentInsight[];
  audienceGrowth: AudienceGrowthTrends;
  geographicDistribution: GeographicInsights;
  behaviorAnalysis: BehaviorAnalysis;
}

export interface AudienceDemographics {
  ageGroups: Record<string, { percentage: number; engagementRate: number }>;
  genderDistribution: Record<string, { percentage: number; engagementRate: number }>;
  locationDistribution: Record<string, { percentage: number; engagementRate: number }>;
  languagePreferences: Record<string, { percentage: number; engagementRate: number }>;
  deviceUsage: Record<string, { percentage: number; engagementRate: number }>;
}

export interface EngagementPatterns {
  byTimeOfDay: Record<string, { engagementRate: number; activeUsers: number }>;
  byDayOfWeek: Record<string, { engagementRate: number; activeUsers: number }>;
  byContentType: Record<ContentType, { avgEngagementTime: number; completionRate: number }>;
  seasonalPatterns: Record<string, { engagementMultiplier: number }>;
}

export interface AudienceSegmentInsight {
  segment: AudienceSegment;
  size: number;
  percentage: number;
  engagementRate: number;
  avgLifetimeValue: number;
  preferredContentTypes: ContentType[];
  growthRate: number;
  churnRisk: "low" | "medium" | "high";
  recommendations: string[];
}

export interface AudienceGrowthTrends {
  followerGrowth: TrendDataPoint[];
  engagementGrowth: TrendDataPoint[];
  reachGrowth: TrendDataPoint[];
  segmentGrowth: Record<AudienceSegment, TrendDataPoint[]>;
  projections: GrowthProjection;
}

export interface TrendDataPoint {
  date: Date;
  value: number;
  change: number;
  changePercentage: number;
}

export interface GrowthProjection {
  nextMonth: { followers: number; engagement: number; confidence: number };
  nextQuarter: { followers: number; engagement: number; confidence: number };
  nextYear: { followers: number; engagement: number; confidence: number };
  keyDrivers: string[];
}

export interface GeographicInsights {
  countries: CountryInsight[];
  cities: CityInsight[];
  regions: RegionInsight[];
  timeZoneDistribution: Record<string, { percentage: number; peakHours: number[] }>;
}

export interface CountryInsight {
  countryCode: string;
  countryName: string;
  userPercentage: number;
  engagementRate: number;
  averageSessionDuration: number;
  contentPreferences: ContentType[];
  growthRate: number;
}

export interface CityInsight {
  cityName: string;
  countryCode: string;
  userCount: number;
  engagementRate: number;
  topHashtags: string[];
}

export interface RegionInsight {
  regionName: string;
  userPercentage: number;
  engagementRate: number;
  culturalInsights: string[];
}

export interface BehaviorAnalysis {
  scrollPatterns: { avgScrollDepth: number; engagementDepth: number };
  clickPatterns: { avgClickThroughTime: number; mostClickedElements: string[] };
  sharePatterns: { avgShareTime: number; shareReasons: string[] };
  commentPatterns: { avgCommentTime: number; sentimentDistribution: Record<string, number> };
  returnVisitPatterns: { avgReturnTime: number; loyaltyScore: number };
}

export interface CompetitiveAnalysis {
  benchmarkMetrics: BenchmarkMetric[];
  competitorComparison: CompetitorComparison[];
  marketPosition: MarketPosition;
  opportunityAnalysis: OpportunityAnalysis;
}

export interface BenchmarkMetric {
  metric: MetricType;
  yourValue: number;
  industryAverage: number;
  topQuartile: number;
  performance: "excellent" | "good" | "average" | "below_average";
  improvementPotential: number;
}

export interface CompetitorComparison {
  competitorId: string;
  competitorName: string;
  followers: number;
  avgEngagementRate: number;
  postFrequency: number;
  contentTypeDistribution: Record<ContentType, number>;
  strengthsAndWeaknesses: { strengths: string[]; weaknesses: string[] };
}

export interface MarketPosition {
  rank: number;
  totalCompetitors: number;
  marketShare: number;
  voiceShare: number;
  brandMentions: number;
  sentimentScore: number;
}

export interface OpportunityAnalysis {
  contentGaps: ContentGap[];
  hashtagOpportunities: string[];
  timingOpportunities: OptimalTiming[];
  collaborationOpportunities: string[];
  emergingTrends: string[];
}

export interface ContentGap {
  contentType: ContentType;
  provider: ProviderType;
  opportunity: string;
  potentialReach: number;
  competitionLevel: "low" | "medium" | "high";
  recommendedAction: string;
}

export interface TrendAnalysis {
  engagementTrends: TrendDataPoint[];
  reachTrends: TrendDataPoint[];
  followerTrends: TrendDataPoint[];
  contentTypeTrends: Record<ContentType, TrendDataPoint[]>;
  hashtagTrends: Record<string, TrendDataPoint[]>;
  seasonalAnalysis: SeasonalAnalysis;
  anomalyDetection: AnomalyDetection[];
}

export interface SeasonalAnalysis {
  quarterlyTrends: Record<
    string,
    { engagementMultiplier: number; contentRecommendations: string[] }
  >;
  monthlyPatterns: Record<
    string,
    { bestPerformingContentTypes: ContentType[]; avgEngagement: number }
  >;
  weeklyPatterns: Record<string, { optimalPostingTimes: number[]; engagementRate: number }>;
  holidayEffects: Record<string, { engagementChange: number; contentSuggestions: string[] }>;
}

export interface AnomalyDetection {
  date: Date;
  metric: MetricType;
  expectedValue: number;
  actualValue: number;
  severity: "low" | "medium" | "high";
  possibleCauses: string[];
  recommendation: string;
}

export interface AnalyticsRecommendation {
  id: string;
  type:
    | "content_optimization"
    | "timing_optimization"
    | "audience_targeting"
    | "platform_optimization"
    | "hashtag_optimization"
    | "budget_optimization";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  expectedImpact: string;
  confidence: number;
  actionItems: string[];
  implementationDifficulty: "easy" | "medium" | "hard";
  estimatedTimeToSee: string;
  metrics: MetricType[];
  createdAt: Date;
  status: "pending" | "in_progress" | "completed" | "dismissed";
}

// ML Prediction Interfaces
export interface ContentOptimizationSuggestion {
  postId?: string;
  suggestions: OptimizationSuggestion[];
  predictedPerformance: PerformancePrediction;
  confidence: number;
  generatedAt: Date;
}

export interface OptimizationSuggestion {
  type: "content" | "timing" | "hashtags" | "media" | "length" | "tone";
  current: string;
  suggested: string;
  reason: string;
  expectedImprovement: number;
  implementationNotes: string[];
}

export interface PerformancePrediction {
  expectedImpressions: number;
  expectedEngagements: number;
  expectedEngagementRate: number;
  expectedReach: number;
  expectedClicks: number;
  viralPotential: number;
  confidence: number;
  factors: PredictionFactor[];
}

export interface PredictionFactor {
  factor: string;
  impact: number;
  confidence: number;
  description: string;
}

export interface TimingPrediction {
  optimalTimes: OptimalTimeSlot[];
  reasoning: string;
  expectedPerformanceIncrease: number;
  confidence: number;
  alternativeSlots: OptimalTimeSlot[];
}

export interface OptimalTimeSlot {
  dayOfWeek: string;
  hour: number;
  minute: number;
  timeZone: string;
  expectedEngagementRate: number;
  audienceSize: number | null;
  competitionLevel: "low" | "medium" | "high";
}

export interface AudienceAnalyzerResult {
  segments: AudienceSegmentPrediction[];
  growthPredictions: AudienceGrowthPrediction[];
  engagementPatterns: PredictedEngagementPattern[];
  recommendations: AudienceRecommendation[];
}

export interface AudienceSegmentPrediction {
  segment: AudienceSegment;
  currentSize: number;
  predictedSize: number;
  growthRate: number;
  engagementProbability: number;
  conversionProbability: number;
  lifetimeValuePrediction: number;
  keyCharacteristics: string[];
}

export interface AudienceGrowthPrediction {
  timeFrame: "1_week" | "1_month" | "3_months" | "6_months" | "1_year";
  predictedFollowers: number;
  predictedEngagement: number;
  confidenceInterval: { lower: number; upper: number };
  keyGrowthDrivers: string[];
}

export interface PredictedEngagementPattern {
  timeSlot: { dayOfWeek: string; hour: number };
  predictedEngagementRate: number;
  predictedAudienceSize: number;
  contentTypeOptimal: ContentType;
  confidence: number;
}

export interface AudienceRecommendation {
  type: "targeting" | "content_customization" | "engagement_strategy" | "growth_strategy";
  segment: AudienceSegment;
  recommendation: string;
  expectedImpact: string;
  implementationSteps: string[];
  priority: "high" | "medium" | "low";
}

// ROI & Business Intelligence
export interface ROICalculation {
  totalCost: number;
  totalRevenue: number;
  roi: number;
  roiByProvider: Record<ProviderType, ROIMetric>;
  roiByContentType: Record<ContentType, ROIMetric>;
  roiByTimeRange: TrendDataPoint[];
  costBreakdown: CostBreakdown;
  revenueBreakdown: RevenueBreakdown;
  recommendations: ROIRecommendation[];
}

export interface ROIMetric {
  cost: number;
  revenue: number;
  roi: number;
  conversions: number;
  costPerConversion: number;
  conversionRate: number;
}

export interface CostBreakdown {
  platformCosts: Record<ProviderType, number>;
  contentCreationCosts: number;
  toolingCosts: number;
  personnelCosts: number;
  advertisingCosts: number;
  otherCosts: number;
}

export interface RevenueBreakdown {
  directSales: number;
  leadGeneration: number;
  brandAwareness: number;
  customerRetention: number;
  organicTraffic: number;
  paidTraffic: number;
}

export interface ROIRecommendation {
  type: "cost_reduction" | "revenue_optimization" | "budget_reallocation" | "platform_optimization";
  description: string;
  currentROI: number;
  projectedROI: number;
  implementation: string[];
  priority: "high" | "medium" | "low";
}

// Real-time Analytics
export interface RealTimeMetrics {
  liveEngagement: LiveEngagementMetrics;
  activeAudience: ActiveAudienceMetrics;
  contentPerformance: RealTimeContentMetrics;
  alerts: RealTimeAlert[];
  liveComparison: LivePerformanceComparison;
}

export interface LiveEngagementMetrics {
  currentEngagementRate: number;
  engagementVelocity: number;
  activeUsers: number;
  interactionsPerMinute: number;
  topPerformingPosts: string[];
  engagementHeatmap: Record<string, number>;
}

export interface ActiveAudienceMetrics {
  onlineNow: number;
  geographicDistribution: Record<string, number>;
  deviceDistribution: Record<string, number>;
  newVsReturning: { new: number; returning: number };
  averageSessionDuration: number;
}

export interface RealTimeContentMetrics {
  postsPublishedToday: number;
  avgPerformanceToday: number;
  viralContent: string[];
  underperformingContent: string[];
  contentOpportunities: string[];
}

export interface RealTimeAlert {
  id: string;
  type: "performance_spike" | "performance_drop" | "unusual_activity" | "opportunity" | "threat";
  severity: "info" | "warning" | "critical";
  message: string;
  affectedMetrics: MetricType[];
  suggestedActions: string[];
  timestamp: Date;
  acknowledged: boolean;
}

export interface LivePerformanceComparison {
  vsYesterday: { change: number; changePercentage: number };
  vsLastWeek: { change: number; changePercentage: number };
  vsLastMonth: { change: number; changePercentage: number };
  vsBenchmark: { difference: number; percentageDifference: number };
}

// Export Data Types
export interface AnalyticsExportRequest {
  accountId: string;
  projectId?: string;
  timeRange: TimeRange;
  startDate?: Date;
  endDate?: Date;
  metrics: MetricType[];
  providers: ProviderType[];
  format: "json" | "csv" | "excel" | "pdf";
  includeRawData: boolean;
  includeVisualizations: boolean;
  includeRecommendations: boolean;
}

export interface AnalyticsExportResult {
  exportId: string;
  status: "processing" | "completed" | "failed";
  downloadUrl?: string;
  fileSize?: number;
  createdAt: Date;
  expiresAt: Date;
  metadata: {
    recordCount: number;
    timeRange: string;
    providers: ProviderType[];
    metrics: MetricType[];
  };
}
