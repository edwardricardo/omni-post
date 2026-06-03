/**
 * @file hashtagTypes.ts
 * @description Shared type definitions for TikTok hashtag features.
 * Consumed by hashtagManager.ts, hashtagDiscovery.ts, and hashtagAnalytics.ts.
 * @layer infrastructure
 */

export interface HashtagStrategy {
  primary: string[]; // 1-3 main hashtags
  trending: string[]; // 3-5 trending hashtags
  niche: string[]; // 5-10 niche/specific hashtags
  branded: string[]; // 1-2 branded hashtags
  community: string[]; // 2-4 community hashtags
}

export interface HashtagPerformance {
  hashtag: string;
  usage: number;
  reach: number;
  engagement: number;
  difficulty: number;
  trend: "rising" | "stable" | "declining";
  competitiveness: number;
  recommendation: "use" | "avoid" | "monitor";
  optimalTiming: string[];
  relatedHashtags: string[];
}

export interface HashtagMix {
  strategy: HashtagStrategy;
  totalHashtags: number;
  estimatedReach: number;
  difficultyScore: number;
  competitionLevel: "low" | "medium" | "high";
  viralPotential: number;
  recommendations: string[];
  warnings: string[];
}

export interface HashtagChallenge {
  id: string;
  hashtag: string;
  name: string;
  description: string;
  startDate: string;
  endDate?: string;
  participantCount: number;
  totalViews: number;
  rules: string[];
  prizes?: string[];
  category: string;
  difficulty: "easy" | "medium" | "hard";
  eligibility: string[];
  submissionGuidelines: string[];
  judging: {
    criteria: string[];
    winners: number;
    announcement: string;
  };
  trending: boolean;
  officialAccount?: string;
  relatedHashtags: string[];
}

export interface HashtagAnalytics {
  hashtag: string;
  period: { start: string; end: string };
  metrics: {
    totalUses: number;
    uniqueCreators: number;
    totalViews: number;
    totalLikes: number;
    totalShares: number;
    totalComments: number;
    averageEngagement: number;
    growthRate: number;
    peakUsage: { date: string; count: number };
  };
  demographics: {
    age: Record<string, number>;
    gender: Record<string, number>;
    location: Record<string, number>;
  };
  content: {
    topVideos: Array<{
      videoId: string;
      views: number;
      engagement: number;
      creatorId: string;
    }>;
    commonTopics: string[];
    averageDuration: number;
    popularFormats: string[];
  };
  timing: {
    bestHours: number[];
    bestDays: string[];
    seasonality: Record<string, number>;
  };
}

export interface HashtagRecommendation {
  recommended: string[];
  reasons: Record<string, string[]>;
  alternatives: Record<string, string[]>;
  optimal: {
    mix: string[];
    reasoning: string;
    expectedReach: number;
    competitionLevel: string;
  };
  avoid: Array<{
    hashtag: string;
    reason: string;
    severity: "low" | "medium" | "high";
  }>;
  timing: {
    bestTimes: string[];
    avoid: string[];
    seasonal: string[];
  };
}
