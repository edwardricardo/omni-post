/**
 * @file trendTypes.ts
 * @description Type definitions for the trend analysis system including trending content,
 *              predictions, viral analysis, content discovery insights, and trend reports.
 * @layer infrastructure
 */

export interface TrendingContent {
  id: string;
  type: "video" | "hashtag" | "sound" | "effect" | "challenge";
  title: string;
  description?: string;
  creator?: {
    id: string;
    username: string;
    displayName: string;
    verified: boolean;
    followerCount: number;
  };
  metrics: {
    views: number;
    likes: number;
    shares: number;
    comments: number;
    usageCount: number;
    growthRate: number;
    viralScore: number;
    trendingDuration: number; // days
  };
  trend: {
    phase: "emerging" | "growing" | "peak" | "declining" | "stable";
    momentum: number; // 0-100
    sustainability: number; // 0-100
    peakDate?: Date;
    estimatedLifespan: number; // days
  };
  demographics: {
    primaryAge: string;
    primaryGender: string;
    topRegions: string[];
    deviceTypes: Record<string, number>;
  };
  characteristics: {
    category: string;
    mood: string;
    tempo?: string;
    visualStyle: string[];
    audioFeatures?: string[];
    hashtags: string[];
    sounds: string[];
  };
  viralFactors: {
    hooks: string[];
    timing: string[];
    format: string[];
    participation: string[];
    algorithmic: string[];
  };
  opportunity: {
    entryDifficulty: "low" | "medium" | "high";
    saturationLevel: number; // 0-100
    remainingPotential: number; // 0-100
    bestEntryTime: Date;
    recommendedApproach: string[];
  };
}

export interface TrendPrediction {
  trendId: string;
  type: "hashtag" | "sound" | "format" | "topic" | "challenge";
  title: string;
  description: string;
  prediction: {
    probability: number; // 0-1
    confidence: number; // 0-1
    timeframe: string; // "1-3 days", "1 week", etc.
    peakProbability: Date;
    estimatedDuration: number; // days
  };
  earlySignals: {
    signal: string;
    strength: number; // 0-100
    source: string;
    detectedAt: Date;
  }[];
  riskFactors: {
    factor: string;
    impact: "low" | "medium" | "high";
    probability: number;
  }[];
  actionItems: {
    action: string;
    priority: "low" | "medium" | "high" | "urgent";
    deadline: Date;
    expectedImpact: string;
  }[];
  competitiveIntel: {
    earlyAdopters: string[];
    marketGaps: string[];
    contentOpportunities: string[];
  };
}

export interface ViralContentAnalysis {
  contentId: string;
  type: "video" | "sound" | "hashtag";
  viralMetrics: {
    viralCoefficient: number; // R0 equivalent for content
    peakVelocity: number; // max views/hour
    sustainabilityIndex: number; // how long viral performance lasted
    reachAmplification: number; // organic vs paid reach ratio
    crossPlatformSpread: number; // spread to other platforms
  };
  viralDNA: {
    contentElements: {
      hook: { strength: number; type: string; timestamp?: number };
      narrative: { structure: string; completion: number };
      visual: { style: string; quality: number; uniqueness: number };
      audio: { type: string; recognition: number; engagement: number };
      timing: { optimal: boolean; context: string };
    };
    platformFit: {
      algorithm: { score: number; factors: string[] };
      audience: { alignment: number; demographics: string[] };
      format: { optimization: number; specifications: string[] };
    };
    socialFactors: {
      shareability: number;
      memability: number;
      participability: number;
      conversationStarter: number;
    };
  };
  replicationBlueprint: {
    coreElements: string[];
    variationPoints: string[];
    timingConsiderations: string[];
    audienceTargeting: string[];
    distributionStrategy: string[];
    riskMitigation: string[];
  };
  competitorResponse: {
    copycats: Array<{ contentId: string; similarity: number; performance: number }>;
    variations: Array<{ contentId: string; approach: string; success: number }>;
    marketSaturation: number;
  };
}

export interface ContentDiscoveryInsight {
  category: string;
  region: string;
  timeframe: string;
  gaps: {
    contentType: string;
    audience: string;
    competitionLevel: "low" | "medium" | "high";
    opportunitySize: number;
    barriers: string[];
    suggestedApproach: string[];
  }[];
  emerging: {
    topic: string;
    signals: string[];
    strength: number;
    timeToMainstream: number; // days
    firstMoverAdvantage: number;
  }[];
  saturated: {
    topic: string;
    saturationLevel: number;
    alternatives: string[];
    revitalizationOpportunities: string[];
  }[];
  seasonal: {
    topic: string;
    pattern: string;
    nextPeak: Date;
    preparationTime: number; // days before peak
    expectedImpact: number;
  }[];
}

export interface TrendReport {
  id: string;
  generatedAt: Date;
  period: { start: Date; end: Date };
  region: string;
  category?: string;

  summary: {
    totalTrends: number;
    emergingTrends: number;
    peakTrends: number;
    decliningTrends: number;
    topCategory: string;
    averageLifespan: number;
  };

  trending: {
    videos: TrendingContent[];
    hashtags: TrendingContent[];
    sounds: TrendingContent[];
    challenges: TrendingContent[];
  };

  predictions: TrendPrediction[];

  opportunities: {
    immediate: Array<{
      type: string;
      description: string;
      difficulty: "low" | "medium" | "high";
      potential: number;
      deadline: Date;
    }>;
    upcoming: Array<{
      type: string;
      description: string;
      timeframe: string;
      preparation: string[];
    }>;
  };

  insights: {
    patterns: string[];
    shifts: string[];
    anomalies: string[];
    crossTrends: string[];
  };

  recommendations: {
    content: string[];
    timing: string[];
    hashtags: string[];
    sounds: string[];
    strategy: string[];
  };
}
