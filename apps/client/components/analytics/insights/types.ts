/**
 * @file types.ts
 * @description TypeScript interfaces and type aliases shared across all performance
 * insight components, including ContentPerformance, OptimalTiming, HashtagPerformance,
 * AudienceInsight, and Recommendation.
 */

// Types for performance insights

export interface ContentPerformance {
  postId: string;
  content: string;
  platformId: string;
  publishedAt: Date;
  metrics: {
    engagement: number;
    reach: number;
    impressions: number;
    clicks: number;
    engagementRate: number;
  };
  score: number;
  factors: {
    timeOfDay: number;
    dayOfWeek: number;
    contentLength: number;
    hasMedia: boolean;
    hashtags: string[];
    mentions: string[];
  };
}

export interface OptimalTiming {
  platformId: string;
  dayOfWeek: number;
  hour: number;
  engagementMultiplier: number;
  confidence: number;
  audience: {
    demographic: string;
    timezone: string;
    activeHours: number[];
  };
}

export interface HashtagPerformance {
  hashtag: string;
  usage: number;
  avgEngagement: number;
  trending: boolean;
  platforms: string[];
  relatedTags: string[];
  effectiveness: "high" | "medium" | "low";
}

export interface AudienceInsight {
  platformId: string;
  totalFollowers: number;
  growthRate: number;
  demographics: {
    ageGroups: Record<string, number>;
    genders: Record<string, number>;
    locations: Record<string, number>;
    interests: string[];
  };
  engagement: {
    avgRate: number;
    peakTimes: string[];
    contentPreferences: string[];
  };
  recommendations: string[];
}

export interface Recommendation {
  id: string;
  type: "timing" | "content" | "hashtags" | "frequency" | "audience" | "platform";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  expectedImpact: string;
  actionItems: string[];
  relatedData?: unknown;
  confidence: number;
}

export type RecommendationCategory = "all" | "timing" | "content" | "hashtags" | "audience";
