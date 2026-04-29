"use client";

/**
 * @file PerformanceInsights.tsx
 * @description Orchestrator component for performance insights. Fetches data via the
 * usePerformanceInsights hook, maps API responses to component types, and delegates
 * rendering to sub-components in the insights/ subdirectory.
 */

import React, { useState, useMemo } from "react";
import {
  usePerformanceInsights,
  type DashboardInsightsData,
} from "@/hooks/api/usePerformanceInsights";
import type {
  ContentPerformance,
  OptimalTiming,
  HashtagPerformance,
  AudienceInsight,
  Recommendation,
  RecommendationCategory,
} from "./insights/types";
import { generateRecommendations } from "./insights/utils";
import { LoadingState } from "./insights/LoadingState";
import { PerformanceInsightsHeader } from "./insights/PerformanceInsightsHeader";
import { TopPerformingContent } from "./insights/TopPerformingContent";
import { RecommendationsList } from "./insights/RecommendationsList";
import { OptimalTimingPanel } from "./insights/OptimalTimingPanel";
import { HashtagPerformancePanel } from "./insights/HashtagPerformancePanel";
import { AudienceInsightsPanel } from "./insights/AudienceInsightsPanel";

// ---------------------------------------------------------------------------
// API data mapping functions
// ---------------------------------------------------------------------------

function mapTopContent(data: DashboardInsightsData): ContentPerformance[] {
  if (data.topPosts && data.topPosts.length > 0) {
    return data.topPosts
      .map((post) => ({
        postId: post.id ?? "unknown",
        content: post.content ?? "No content available",
        platformId: post.platform ?? "unknown",
        publishedAt: new Date(post.publishedAt ?? Date.now()),
        metrics: {
          engagement: post.metrics?.engagement ?? 0,
          reach: post.metrics?.reach ?? 0,
          impressions: post.metrics?.impressions ?? 0,
          clicks: post.metrics?.clicks ?? 0,
          engagementRate: post.metrics?.engagementRate ?? 0,
        },
        score: post.score ?? 0,
        factors: {
          timeOfDay: post.factors?.timeOfDay ?? 0,
          dayOfWeek: post.factors?.dayOfWeek ?? 0,
          contentLength: post.factors?.contentLength ?? 0,
          hasMedia: post.factors?.hasMedia ?? false,
          hashtags: post.factors?.hashtags ?? [],
          mentions: post.factors?.mentions ?? [],
        },
      }))
      .sort((a, b) => b.score - a.score);
  }

  const topEngaging = data.engagement?.topEngagingContent ?? [];
  return topEngaging
    .map((post) => ({
      postId: post.id ?? "unknown",
      content: post.content ?? "No content available",
      platformId: post.platform ?? "unknown",
      publishedAt: new Date(post.publishedAt ?? Date.now()),
      metrics: {
        engagement: post.metrics?.engagement ?? 0,
        reach: post.metrics?.reach ?? 0,
        impressions: post.metrics?.impressions ?? 0,
        clicks: post.metrics?.clicks ?? 0,
        engagementRate: post.metrics?.engagementRate ?? post.engagementRate ?? 0,
      },
      score: post.score ?? 0,
      factors: {
        timeOfDay: post.factors?.timeOfDay ?? 0,
        dayOfWeek: post.factors?.dayOfWeek ?? 0,
        contentLength: post.factors?.contentLength ?? 0,
        hasMedia: post.factors?.hasMedia ?? false,
        hashtags: post.factors?.hashtags ?? [],
        mentions: post.factors?.mentions ?? [],
      },
    }))
    .sort((a, b) => b.score - a.score);
}

function mapOptimalTimings(data: DashboardInsightsData): OptimalTiming[] {
  const timings = data.optimalTiming ?? [];
  return timings.map((t) => ({
    platformId: t.platform ?? "unknown",
    dayOfWeek: t.dayOfWeek ?? 0,
    hour: t.hour ?? 12,
    engagementMultiplier: t.engagementMultiplier ?? 1,
    confidence: t.confidence ?? 0,
    audience: {
      demographic: t.audience?.demographic ?? "General",
      timezone: t.audience?.timezone ?? "UTC",
      activeHours: t.audience?.activeHours ?? [],
    },
  }));
}

function mapHashtagPerformance(data: DashboardInsightsData): HashtagPerformance[] {
  const hashtags = data.hashtagPerformance ?? [];
  return hashtags
    .map((h) => ({
      hashtag: h.hashtag ?? "#unknown",
      usage: h.usage ?? 0,
      avgEngagement: h.avgEngagement ?? 0,
      trending: h.trending ?? false,
      platforms: h.platforms ?? [],
      relatedTags: h.relatedTags ?? [],
      effectiveness: h.effectiveness ?? ("medium" as const),
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);
}

function mapAudienceInsights(data: DashboardInsightsData): AudienceInsight[] {
  const insights = data.audienceInsights ?? [];
  return insights.map((a) => ({
    platformId: a.platformId ?? "unknown",
    totalFollowers: a.totalFollowers ?? 0,
    growthRate: a.growthRate ?? 0,
    demographics: {
      ageGroups: a.demographics?.ageGroups ?? {},
      genders: a.demographics?.genders ?? {},
      locations: a.demographics?.locations ?? {},
      interests: a.demographics?.interests ?? [],
    },
    engagement: {
      avgRate: a.engagement?.avgRate ?? 0,
      peakTimes: a.engagement?.peakTimes ?? [],
      contentPreferences: a.engagement?.contentPreferences ?? [],
    },
    recommendations: a.recommendations ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

interface PerformanceInsightsProps {
  accountId: string;
  projectId: string;
  timeRange: string;
  platforms: string[];
  contentData?: ContentPerformance[];
  onRecommendationApplied?: (recommendation: Recommendation) => void;
}

// ---------------------------------------------------------------------------
// Orchestrator component
// ---------------------------------------------------------------------------

/**
 * @component PerformanceInsights
 * @description Performance insights dashboard fetching data via usePerformanceInsights,
 * mapping API responses to sub-components for recommendations, hashtag performance,
 * audience insights, optimal timing, and top-performing content.
 */
export function PerformanceInsights({
  accountId: _accountId,
  projectId,
  timeRange: _timeRange,
  platforms,
  contentData: _contentData,
  onRecommendationApplied,
}: PerformanceInsightsProps) {
  const [selectedCategory, setSelectedCategory] = useState<RecommendationCategory>("all");

  // Fetch real data via API hook
  const { data: insightsData, isLoading, error, refetch } = usePerformanceInsights(projectId);

  // Map API data to component types
  const topContent = useMemo(
    () => (insightsData ? mapTopContent(insightsData) : []),
    [insightsData]
  );
  const optimalTimings = useMemo(
    () => (insightsData ? mapOptimalTimings(insightsData) : []),
    [insightsData]
  );
  const hashtagPerformance = useMemo(
    () => (insightsData ? mapHashtagPerformance(insightsData) : []),
    [insightsData]
  );
  const audienceInsights = useMemo(
    () => (insightsData ? mapAudienceInsights(insightsData) : []),
    [insightsData]
  );

  const recommendations = useMemo(
    () =>
      generateRecommendations(
        topContent,
        optimalTimings,
        hashtagPerformance,
        audienceInsights,
        platforms
      ),
    [topContent, optimalTimings, hashtagPerformance, audienceInsights, platforms]
  );

  // Early return states
  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="performance-insights p-6">
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-medium mb-2">Failed to load performance insights</h3>
          <p className="text-red-700 text-sm mb-3">
            {error instanceof Error ? error.message : "An unexpected error occurred"}
          </p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!insightsData || topContent.length === 0) {
    return (
      <div className="performance-insights p-6">
        <div className="text-center py-12">
          <div className="text-4xl mb-4">📊</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No performance data yet</h3>
          <p className="text-gray-600">
            Start publishing content to see performance insights and recommendations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="performance-insights space-y-6">
      <PerformanceInsightsHeader
        lastAnalysisAt={null}
        isAnalyzing={isLoading}
        onRefresh={() => refetch()}
      />

      <TopPerformingContent content={topContent} maxItems={3} />

      <RecommendationsList
        recommendations={recommendations}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        {...(onRecommendationApplied !== undefined && {
          onApplyRecommendation: onRecommendationApplied,
        })}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <OptimalTimingPanel timings={optimalTimings} />
        <HashtagPerformancePanel hashtags={hashtagPerformance} maxItems={5} />
      </div>

      {audienceInsights.length > 0 && <AudienceInsightsPanel insights={audienceInsights} />}
    </div>
  );
}
