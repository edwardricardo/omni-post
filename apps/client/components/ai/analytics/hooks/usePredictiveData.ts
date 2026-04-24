/**
 * @file usePredictiveData.ts
 * @description TanStack Query hook fetching predictive analytics data (performance predictions,
 *              ROI forecasts, audience insights, competitor analysis) from AI/analytics endpoints.
 * @layer infrastructure
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type {
  PerformancePrediction,
  ROIForecast,
  AudienceInsight,
  CompetitorAnalysis,
  Timeframe,
} from "../types";

// ---------------------------------------------------------------------------
// Internal API response shapes (from Fastify routes)
// ---------------------------------------------------------------------------

interface OptimalTimeSlot {
  dayOfWeek: number;
  hour: number;
  score: number;
  audienceReach: number;
  competitionLevel: "low" | "medium" | "high";
}

interface PredictTimingApiValue {
  optimalSlots: OptimalTimeSlot[];
  provider: string;
  timezone: string;
  recommendations: string[];
  activityPatterns?: Array<{
    hour: number;
    dayOfWeek: number;
    activityLevel: number;
    audiencePercentage: number;
  }>;
}

interface PredictAudienceApiValue {
  overallEngagementScore: number;
  predictions: {
    likes: number;
    comments: number;
    shares: number;
    reach: number;
  };
  segmentPredictions?: Array<{
    segmentName: string;
    engagementScore: number;
    reachPotential: number;
    sentiment: "positive" | "neutral" | "negative";
  }>;
  riskFactors: Array<{
    type: string;
    severity: "low" | "medium" | "high";
    description: string;
    mitigation: string;
  }>;
  optimizationSuggestions?: Array<{
    area: string;
    suggestion: string;
    expectedImpact: number;
  }>;
}

interface ROIApiValue {
  totalInvestment: number;
  totalRevenue: number;
  roi: number;
  roiPercentage: number;
  breakdown?: Record<string, unknown>;
  channelBreakdown?: Array<{
    channel: string;
    investment: number;
    revenue: number;
    roi: number;
    performance: string;
  }>;
  bestPerformingChannel?: string;
  recommendations?: string[];
}

interface CrossPlatformApiValue {
  summary: {
    totalPosts: number;
    totalEngagements: number;
    avgEngagementRate: number;
    totalReach: number;
    topPerformingProvider?: string;
  };
  byProvider?: Record<string, unknown>;
  contentInsights?: Record<string, unknown>;
  audienceAnalytics?: Record<string, unknown>;
  benchmarking?: Record<string, unknown>;
  trends?: Record<string, unknown>;
  recommendations?: string[];
}

// ---------------------------------------------------------------------------
// Helper: map numeric day-of-week to string name
// ---------------------------------------------------------------------------

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function dayName(dow: number): string {
  return DAY_NAMES[dow] ?? "Monday";
}

// ---------------------------------------------------------------------------
// Adapter: PredictTimingApiValue[] → PerformancePrediction[]
// ---------------------------------------------------------------------------

function mapToPerformancePredictions(
  timingResults: PredictTimingApiValue[] | undefined,
  platforms: string[]
): PerformancePrediction[] {
  if (!timingResults || timingResults.length === 0) return [];

  return platforms.map((platform, idx) => {
    const result = timingResults[idx];

    // Fallback when a single call failed / returned nothing
    if (!result || !result.optimalSlots || result.optimalSlots.length === 0) {
      return buildFallbackPrediction(platform);
    }

    const topSlot = result.optimalSlots[0];
    if (!topSlot) return buildFallbackPrediction(platform);

    // Derive engagement estimate from the score (0–100) scaled to a %
    const engagementValue = topSlot.score;
    const reachValue = topSlot.audienceReach * 100; // audienceReach is a percentage

    // Find peak activity from activityPatterns if available
    const peakHour = result.activityPatterns
      ? result.activityPatterns.reduce((best, cur) =>
          cur.activityLevel > best.activityLevel ? cur : best
        ).hour
      : topSlot.hour;

    const peakLabel = `${peakHour}:00 - ${(peakHour + 2) % 24}:00`;
    const lowHour = (peakHour + 12) % 24;
    const lowLabel = `${lowHour}:00 - ${(lowHour + 2) % 24}:00`;

    return {
      platform,
      expectedEngagement: {
        value: engagementValue,
        confidence: topSlot.score,
        range: {
          min: engagementValue * 0.7,
          max: engagementValue * 1.3,
        },
      },
      expectedReach: {
        value: reachValue,
        confidence: Math.min(95, topSlot.score + 5),
        range: {
          min: reachValue * 0.6,
          max: reachValue * 1.8,
        },
      },
      // Viral potential heuristic: high audienceReach + low competition = higher potential
      viralPotential:
        topSlot.competitionLevel === "low"
          ? Math.min(100, topSlot.audienceReach * 1.5)
          : topSlot.competitionLevel === "medium"
            ? topSlot.audienceReach
            : topSlot.audienceReach * 0.6,
      optimalPostingTime: {
        hour: topSlot.hour,
        day: dayName(topSlot.dayOfWeek),
        timezone: result.timezone,
        confidence: topSlot.score,
      },
      audienceActivity: {
        peak: peakLabel,
        low: lowLabel,
        pattern: "variable" as const,
      },
    };
  });
}

function buildFallbackPrediction(platform: string): PerformancePrediction {
  return {
    platform,
    expectedEngagement: {
      value: 0,
      confidence: 0,
      range: { min: 0, max: 0 },
    },
    expectedReach: {
      value: 0,
      confidence: 0,
      range: { min: 0, max: 0 },
    },
    viralPotential: 0,
    optimalPostingTime: {
      hour: 12,
      day: "Monday",
      timezone: "UTC",
      confidence: 0,
    },
    audienceActivity: {
      peak: "N/A",
      low: "N/A",
      pattern: "variable" as const,
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter: ROIApiValue → ROIForecast[]
// ---------------------------------------------------------------------------

function mapToROIForecasts(roiData: ROIApiValue | undefined, timeframe: Timeframe): ROIForecast[] {
  if (!roiData) return [];

  const { totalInvestment, totalRevenue, roi, roiPercentage } = roiData;

  // Only derive a factor breakdown when the backend actually returned channel
  // data. If the breakdown is empty we show no factors rather than fabricate
  // generic ones with invented impact percentages — see T2-H L-82.
  const factors: ROIForecast["factors"] = roiData.channelBreakdown?.length
    ? roiData.channelBreakdown.slice(0, 4).map((ch) => ({
        name: ch.channel,
        impact: Math.abs(ch.roi),
        description: `Channel performance: ${ch.performance}`,
      }))
    : [];

  return [
    {
      timeframe,
      expectedROI: roi,
      confidence: Math.min(95, Math.max(50, roiPercentage)),
      breakdown: {
        organicReach: totalRevenue * 0.6,
        paidReach: totalRevenue * 0.2,
        conversions: Math.round(totalRevenue / 20),
        revenue: totalRevenue,
        cost: totalInvestment,
      },
      factors,
    },
  ];
}

// ---------------------------------------------------------------------------
// Adapter: PredictAudienceApiValue → AudienceInsight[]
// ---------------------------------------------------------------------------

function mapToAudienceInsights(
  audienceData: PredictAudienceApiValue | undefined
): AudienceInsight[] {
  if (!audienceData) return [];

  const { overallEngagementScore, predictions, segmentPredictions, optimizationSuggestions } =
    audienceData;

  // Build one insight per segment prediction, or a single "General" one
  if (segmentPredictions && segmentPredictions.length > 0) {
    return segmentPredictions.map((seg) => ({
      segment: seg.segmentName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      size: predictions.reach,
      engagement: seg.engagementScore / 10, // normalize to 0–10 range
      growthRate: seg.reachPotential / 10,
      demographics: {
        ageGroup: "25-44",
        location: "Global",
        interests: optimizationSuggestions
          ? optimizationSuggestions.slice(0, 3).map((s) => s.area)
          : ["Engagement", "Content", "Timing"],
      },
      behavior: {
        activeHours: "9 AM - 6 PM",
        preferredContent: optimizationSuggestions
          ? optimizationSuggestions.slice(0, 3).map((s) => s.suggestion.slice(0, 40))
          : ["Educational content", "Visual content", "Interactive posts"],
        engagementTriggers: ["Questions", "Polls", "Behind-the-scenes"],
      },
      predictions: {
        nextWeekActivity: seg.engagementScore,
        seasonalTrends: "Consistent activity expected",
        contentPreferences: optimizationSuggestions
          ? optimizationSuggestions.slice(0, 3).map((s) => s.area)
          : ["Video content", "Educational posts"],
      },
    }));
  }

  // Fallback: single general insight from overall score
  return [
    {
      segment: "General Audience",
      size: predictions.reach,
      engagement: overallEngagementScore / 10,
      growthRate: 5,
      demographics: {
        ageGroup: "25-44",
        location: "Global",
        interests: ["Social Media", "Content Marketing", "Technology"],
      },
      behavior: {
        activeHours: "9 AM - 6 PM",
        preferredContent: ["Educational content", "Industry insights", "How-to guides"],
        engagementTriggers: ["Questions", "Polls", "Behind-the-scenes"],
      },
      predictions: {
        nextWeekActivity: overallEngagementScore,
        seasonalTrends: "Consistent activity expected",
        contentPreferences: ["Video content", "Interactive posts", "Educational content"],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Adapter: CrossPlatformApiValue → CompetitorAnalysis[]
// ---------------------------------------------------------------------------

function mapToCompetitorAnalysis(
  crossData: CrossPlatformApiValue | undefined
): CompetitorAnalysis[] {
  if (!crossData) return [];

  const { summary, byProvider, recommendations } = crossData;

  if (!byProvider || Object.keys(byProvider).length === 0) {
    // No provider breakdown available — return a single benchmark entry
    return [
      {
        competitor: "Industry Average",
        performance: {
          avgEngagement: summary.avgEngagementRate,
          postFrequency: Math.round(summary.totalPosts / 4),
          topContentTypes: ["Text posts", "Images", "Videos"],
        },
        opportunities: recommendations?.slice(0, 3) ?? [
          "Increase posting frequency",
          "Add more video content",
          "Improve engagement rate",
        ],
        threats: ["Strong competitor presence", "Algorithm changes", "Audience fatigue"],
        benchmarkComparison: {
          engagement:
            summary.avgEngagementRate > 3
              ? ("above" as const)
              : summary.avgEngagementRate > 1
                ? ("similar" as const)
                : ("below" as const),
          reach:
            summary.totalReach > 10000
              ? ("above" as const)
              : summary.totalReach > 1000
                ? ("similar" as const)
                : ("below" as const),
          growth: "similar" as const,
        },
      },
    ];
  }

  // One entry per provider in the byProvider map
  return Object.entries(byProvider).map(([providerKey, providerData]) => {
    const data = providerData as Record<string, unknown>;
    const avgEngagement =
      typeof data.avgEngagementRate === "number"
        ? data.avgEngagementRate
        : summary.avgEngagementRate;
    const postCount = typeof data.totalPosts === "number" ? data.totalPosts : summary.totalPosts;

    return {
      competitor: providerKey,
      performance: {
        avgEngagement,
        postFrequency: postCount,
        topContentTypes: Array.isArray(data.topContentTypes)
          ? (data.topContentTypes as string[]).slice(0, 3)
          : ["Text posts", "Images", "Videos"],
      },
      opportunities: recommendations?.slice(0, 3) ?? [
        "Increase posting frequency",
        "Add more video content",
      ],
      threats: ["Algorithm changes", "Audience fatigue", "Competitor growth"],
      benchmarkComparison: {
        engagement:
          avgEngagement > summary.avgEngagementRate
            ? ("above" as const)
            : avgEngagement < summary.avgEngagementRate * 0.9
              ? ("below" as const)
              : ("similar" as const),
        reach: "similar" as const,
        growth: "similar" as const,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Platform name → MLProvider enum (uppercase)
// ---------------------------------------------------------------------------

function toMLProvider(platform: string): string {
  const map: Record<string, string> = {
    twitter: "X",
    x: "X",
    instagram: "INSTAGRAM",
    facebook: "FACEBOOK",
    tiktok: "TIKTOK",
    youtube: "YOUTUBE",
    linkedin: "LINKEDIN",
  };
  return map[platform.toLowerCase()] ?? platform.toUpperCase();
}

// ---------------------------------------------------------------------------
// Hook options / return types
// ---------------------------------------------------------------------------

interface UsePredictiveDataOptions {
  accountId: string;
  platforms: string[];
  timeframe: Timeframe;
  onPredictionUpdate?: (predictions: PerformancePrediction[]) => void;
}

interface UsePredictiveDataResult {
  predictions: PerformancePrediction[];
  roiForecasts: ROIForecast[];
  audienceInsights: AudienceInsight[];
  competitorData: CompetitorAnalysis[];
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export const usePredictiveData = ({
  accountId,
  platforms,
  timeframe,
  onPredictionUpdate,
}: UsePredictiveDataOptions): UsePredictiveDataResult => {
  const queryClient = useQueryClient();

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const firstProvider = toMLProvider(platforms[0] ?? "twitter");

  // --- Query 1: Timing predictions (one POST per platform, run in parallel) ---
  const timingQuery = useQuery<PredictTimingApiValue[]>({
    queryKey: ["predictions-timing", platforms, timeframe],
    enabled: platforms.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const results = await Promise.all(
        platforms.map(async (p) => {
          try {
            const res = await fetch("/api/backend/ai/predict-timing", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accountId,
                provider: toMLProvider(p),
                contentType: "text",
                timezone: tz,
                includeActivityPatterns: true,
              }),
            });
            if (!res.ok) return null;
            const body = (await res.json()) as { ok: boolean; value?: PredictTimingApiValue };
            return body.ok && body.value ? body.value : null;
          } catch {
            return null;
          }
        })
      );
      // Filter nulls but keep array aligned with platforms
      return results.map(
        (r, i) =>
          r ??
          ({
            provider: toMLProvider(platforms[i] ?? "X"),
            optimalSlots: [],
            timezone: tz,
            recommendations: [],
          } as PredictTimingApiValue)
      );
    },
  });

  // --- Query 2: ROI forecast ---
  const roiQuery = useQuery<ROIApiValue | null>({
    queryKey: ["roi-forecast", accountId, timeframe],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        const res = await fetch(
          `/api/backend/analytics/roi?accountId=${accountId}&timeRange=${timeframe}`
        );
        if (!res.ok) return null;
        const body = (await res.json()) as { ok: boolean; value?: ROIApiValue };
        return body.ok && body.value ? body.value : null;
      } catch {
        return null;
      }
    },
  });

  // --- Query 3: Audience prediction ---
  const audienceQuery = useQuery<PredictAudienceApiValue | null>({
    queryKey: ["audience-prediction", accountId, firstProvider],
    enabled: platforms.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        const res = await fetch("/api/backend/ai/predict-audience", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            contentDescription: {
              type: "mixed",
              topic: "general",
              tone: "professional",
              provider: firstProvider,
            },
            includeOptimizationSuggestions: true,
          }),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { ok: boolean; value?: PredictAudienceApiValue };
        return body.ok && body.value ? body.value : null;
      } catch {
        return null;
      }
    },
  });

  // --- Query 4: Cross-platform / competitive analysis ---
  const competitiveQuery = useQuery<CrossPlatformApiValue | null>({
    queryKey: ["competitive-analysis", accountId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        const res = await fetch(
          `/api/backend/analytics/cross-platform?accountId=${accountId}&includeCompetitive=true`
        );
        if (!res.ok) return null;
        const body = (await res.json()) as { ok: boolean; value?: CrossPlatformApiValue };
        return body.ok && body.value ? body.value : null;
      } catch {
        return null;
      }
    },
  });

  // --- Mapped output values ---
  const predictions = mapToPerformancePredictions(timingQuery.data, platforms);
  const roiForecasts = mapToROIForecasts(roiQuery.data ?? undefined, timeframe);
  const audienceInsights = mapToAudienceInsights(audienceQuery.data ?? undefined);
  const competitorData = mapToCompetitorAnalysis(competitiveQuery.data ?? undefined);

  const isLoading =
    (timingQuery.isLoading && platforms.length > 0) ||
    roiQuery.isLoading ||
    (audienceQuery.isLoading && platforms.length > 0) ||
    competitiveQuery.isLoading;

  // Notify parent when predictions change (mirrors old onPredictionUpdate behaviour)
  useEffect(() => {
    if (predictions.length > 0) {
      onPredictionUpdate?.(predictions);
    }
  }, [predictions, onPredictionUpdate]);

  // Expose queryClient for advanced cache invalidation (unused in UI but useful for tests)
  void queryClient;

  return {
    predictions,
    roiForecasts,
    audienceInsights,
    competitorData,
    isLoading,
  };
};
