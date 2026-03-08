/**
 * Facebook Insights Type Definitions
 *
 * Shared interfaces and option types for Facebook Insights API responses.
 * Consumed by FacebookInsightsApi (insights.ts) and any analytics consumers.
 */

export interface FacebookInsightsOptions {
  metric: string | string[];
  period: "day" | "week" | "days_28" | "month" | "lifetime";
  since?: Date;
  until?: Date;
  breakdown?: string[];
  datePreset?:
    | "today"
    | "yesterday"
    | "this_week"
    | "last_week"
    | "this_month"
    | "last_month"
    | "this_quarter"
    | "this_year";
}

export interface FacebookAudienceInsights {
  pageId: string;
  period: {
    since: string;
    until: string;
  };
  totalFans: number;
  totalFollowers: number;
  totalReach: number;
  totalImpressions: number;
  demographics: {
    ageGroups: Record<string, { male: number; female: number; unknown: number }>;
    genders: {
      male: number;
      female: number;
      unknown: number;
    };
    countries: Record<string, number>;
    cities: Record<string, number>;
    locales: Record<string, number>;
  };
  activity: {
    peakHours: Array<{
      hour: number;
      day: string;
      activity: number;
    }>;
    peakDays: Array<{
      day: string;
      activity: number;
    }>;
    timeZones: Record<string, number>;
  };
  devices: {
    desktop: number;
    mobile: number;
    tablet: number;
  };
  fanAcquisition: {
    totalNewLikes: number;
    totalUnlikes: number;
    netLikeChange: number;
    likesSources: {
      organic: number;
      paid: number;
      viral: number;
    };
  };
  engagement: {
    totalEngagements: number;
    engagementRate: number;
    avgEngagementsPerPost: number;
    topEngagementTypes: Record<string, number>;
  };
}

export interface FacebookContentInsights {
  pageId: string;
  period: {
    since: string;
    until: string;
  };
  posts: Array<{
    postId: string;
    type: "photo" | "video" | "link" | "status" | "event" | "note";
    createdTime: string;
    message?: string;
    reach: number;
    impressions: number;
    engagements: number;
    engagementRate: number;
    clicks: number;
    reactions: {
      like: number;
      love: number;
      wow: number;
      haha: number;
      sad: number;
      angry: number;
      care: number;
      total: number;
    };
    comments: number;
    shares: number;
    saves: number;
    videoViews?: number;
    videoViewsUnique?: number;
    videoAvgTimeWatched?: number;
    videoViewsRetention?: Array<{
      timestamp: number;
      retention: number;
    }>;
    linkClicks?: number;
    photosViews?: number;
  }>;
  summary: {
    totalPosts: number;
    avgReach: number;
    avgEngagements: number;
    avgEngagementRate: number;
    topPerformingPost: string;
    topPostType: string;
    bestPostingTime: {
      hour: number;
      day: string;
    };
  };
  contentCategories: Array<{
    category: string;
    postCount: number;
    avgEngagement: number;
    avgReach: number;
  }>;
}

export interface FacebookVideoInsights {
  videoId: string;
  title?: string;
  description?: string;
  duration: number;
  thumbnailUrl?: string;
  createdTime: string;
  views: {
    total: number;
    unique: number;
    repeat: number;
    autoplay: number;
    clickToPlay: number;
  };
  watchTime: {
    total: number; // Total seconds watched
    average: number; // Average seconds per view
    averagePercentage: number; // Average percentage watched
  };
  audience: {
    retention: Array<{
      timestamp: number; // Seconds into video
      percentage: number; // Percentage of viewers still watching
    }>;
    dropOffPoints: Array<{
      timestamp: number;
      dropOffRate: number;
    }>;
    replaySegments: Array<{
      startTime: number;
      endTime: number;
      replayCount: number;
    }>;
  };
  engagement: {
    likes: number;
    comments: number;
    shares: number;
    reactions: Record<string, number>;
    saves: number;
  };
  demographics: {
    ageGroups: Record<string, number>;
    genders: Record<string, number>;
    countries: Record<string, number>;
    cities: Record<string, number>;
  };
  devices: {
    desktop: number;
    mobile: number;
    tablet: number;
    connectedTV: number;
  };
  traffic: {
    facebook: number;
    instagram: number;
    external: number;
    direct: number;
    suggested: number;
  };
  subtitles: {
    viewsWithSubtitles: number;
    viewsWithoutSubtitles: number;
    subtitleLanguages: Record<string, number>;
  };
}

export interface FacebookRealtimeInsights {
  pageId: string;
  timestamp: string;
  currentMetrics: {
    onlineFollowers: number;
    currentReach: number;
    currentImpressions: number;
    currentEngagements: number;
    recentPostPerformance: Array<{
      postId: string;
      ageMinutes: number;
      reach: number;
      engagements: number;
      trendDirection: "up" | "down" | "stable";
    }>;
  };
  trending: {
    hashtags: Array<{
      hashtag: string;
      mentions: number;
      growth: number;
    }>;
    topics: Array<{
      topic: string;
      mentions: number;
      sentiment: "positive" | "negative" | "neutral";
    }>;
  };
  competitors: Array<{
    pageId: string;
    pageName: string;
    currentEngagement: number;
    recentPostCount: number;
    avgEngagementRate: number;
  }>;
  alerts: Array<{
    type: "spike" | "drop" | "viral" | "negative_sentiment";
    metric: string;
    value: number;
    threshold: number;
    message: string;
    timestamp: string;
  }>;
}

export interface FacebookCompetitorInsights {
  targetPageId: string;
  competitors: Array<{
    pageId: string;
    pageName: string;
    followers: number;
    avgEngagementRate: number;
    postFrequency: number; // Posts per week
    topContentTypes: Array<{
      type: string;
      percentage: number;
    }>;
    performanceGap: {
      followers: number; // Difference in followers
      engagement: number; // Difference in engagement rate
      reach: number; // Difference in reach
    };
  }>;
  benchmarks: {
    industryAvgEngagement: number;
    industryAvgFollowers: number;
    industryAvgPostFrequency: number;
    yourRanking: number; // Out of total competitors
  };
  opportunities: Array<{
    type: "content_gap" | "timing_opportunity" | "engagement_strategy" | "audience_expansion";
    description: string;
    priority: "high" | "medium" | "low";
    estimatedImpact: number;
  }>;
}
